/**
 * service/continuation/agent/agent-main-loop.ts — 主 Agent 文本协议循环
 *
 * 主 Agent 每次迭代只做一件事：读证据、输出一个协议动作。运行时执行该动作后把结果
 * 回灌成新的证据，再进入下一次迭代，直到 finalize / block / 预算耗尽。
 *
 * 装配顺序：伪 role 提示词 → 真实历史 → 本回合运行时证据 → 尾部预填充。
 * 真实历史插在 `$HISTORY_ANCHOR` 段的位置上，该段本身不发送。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { normalizeContinuationInternalAiRetryLimit_ACU } from '../defaults';
import { callContinuationInternalAi_ACU } from '../internal-ai-call';
import { resolveContinuationApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from '../api-preset';
import { renderContinuationPrompt_ACU } from '../prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationSettings_ACU,
} from '../model';
import { AGENT_PREFILLS_ACU } from './agent-defaults';
import { renderAgentModuleCatalog_ACU, renderAgentSubagentCatalog_ACU } from './agent-catalog';
import { readAgentModuleSnapshot_ACU, writeAgentModuleSnapshot_ACU } from './agent-module-store';
import { renderAgentTableCatalog_ACU } from './agent-tables';
import { applyAgentConstraintRegistration_ACU, applyAgentModuleDelta_ACU, mergeAgentDeltaRevisions_ACU } from './agent-transaction';
import { compactAgentProtocolError_ACU, parseAgentJsonPayload_ACU, parseAgentMainAction_ACU } from './agent-protocol';
import { renderAgentOutlineWindow_ACU, renderAgentUnsettledHistory_ACU, type AgentResolveContext_ACU } from './agent-placeholder-resolver';
import { AgentSubagentRuntime_ACU, type AgentSubagentRunResult_ACU } from './agent-subagent-runtime';
import {
  DEFAULT_AGENT_RUN_BUDGET_ACU,
  type AgentDelegateAction_ACU,
  type AgentDelegation_ACU,
  type AgentDelegationOutcome_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentRunBudget_ACU,
  type ContinuationAgentTurnPlanRequest_ACU,
  type ContinuationAgentTurnPlanResult_ACU,
} from './agent-model';

/** 真实历史插入位置的内部哨兵。用不可见字符避免与提示词正文撞车。 */
const HISTORY_SENTINEL_ACU = '\u0000__QRF_AGENT_HISTORY__\u0000';

export interface ContinuationAgentTurnPlannerDependencies_ACU {
  resolveApiPreset: typeof resolveContinuationApiPreset_ACU;
  callInternalAi: (
    messages: Array<{ role: string; content: string }>,
    preset: ContinuationResolvedApiPreset_ACU,
    identity: ContinuationInternalAiRequestIdentity_ACU,
    signal?: AbortSignal | null,
  ) => Promise<string | null>;
  subagentRuntime: AgentSubagentRuntime_ACU;
  readChat: () => any[];
  readModuleSnapshot: (chat: any[]) => AgentModuleSnapshot_ACU;
  writeModuleSnapshot: (chat: any[], targetIndex: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>;
  budget: AgentRunBudget_ACU;
}

const defaultDependencies_ACU: ContinuationAgentTurnPlannerDependencies_ACU = {
  resolveApiPreset: resolveContinuationApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
  subagentRuntime: new AgentSubagentRuntime_ACU(),
  readChat: getChatArray_ACU,
  readModuleSnapshot: readAgentModuleSnapshot_ACU,
  writeModuleSnapshot: writeAgentModuleSnapshot_ACU,
  budget: DEFAULT_AGENT_RUN_BUDGET_ACU,
};

interface AgentRunLedger_ACU {
  delegationsUsed: number;
  perAgent: Map<string, number>;
  outcomes: AgentDelegationOutcome_ACU[];
}

function failLoop_ACU(
  code: 'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED' | 'CONTINUATION_AGENT_BLOCKED' | 'CONTINUATION_AGENT_OUTLINE_REPLANNED' | 'CONTINUATION_AGENT_PROTOCOL_INVALID',
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'agent_loop', message, false, details));
}

/**
 * 把聊天数组投影成真实历史消息。
 * @param chat 聊天数组
 * @returns 逐楼消息，用户楼为 user，AI 楼为 assistant；空楼被跳过
 */
export function buildAgentRealHistory_ACU(chat: readonly any[]): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  chat.forEach((message, index) => {
    if (!message || typeof message !== 'object') return;
    const text = String(message.mes ?? '').trim();
    if (!text) return;
    messages.push({ role: message.is_user ? 'user' : 'assistant', content: `【楼层 ${index}】\n${text}` });
  });
  return messages;
}

/**
 * 渲染本轮预算状态。
 * @param budget 预算配置
 * @param iteration 当前迭代序号，从 1 开始
 * @param ledger 运行账本
 * @param waveLimit 本轮实际可用的同波次并发上限
 * @returns 自然语言文本；进入最后一轮时明确禁止继续派工
 */
export function renderAgentBudget_ACU(budget: AgentRunBudget_ACU, iteration: number, ledger: AgentRunLedger_ACU, waveLimit: number): string {
  const isFinal = iteration >= budget.maxIterations;
  const lines = [
    `迭代：第 ${iteration} / ${budget.maxIterations} 次`,
    `派工：已用 ${ledger.delegationsUsed} / ${budget.maxDelegations} 次`,
    `单代理上限：同一代理最多 ${budget.maxSameAgent} 次`,
    `并发上限：同一波次最多 ${waveLimit} 个子代理`,
  ];
  lines.push(isFinal
    ? 'FINAL_ITERATION：本轮已是最后一次迭代，delegate 已被禁用。请基于现有证据输出 finalize；关键信息确实缺失时输出 block，不许伪造。'
    : '预算充足，可以继续派工。但只要证据已经足够，就应立刻 finalize，不要为「或许还能更好」继续消耗。');
  return lines.join('\n');
}

/**
 * 渲染已完成的工具结果，作为下一次迭代的证据。
 * @param ledger 运行账本
 * @returns 自然语言文本；尚无结果时如实标注
 */
export function renderAgentToolResults_ACU(ledger: AgentRunLedger_ACU): string {
  if (!ledger.outcomes.length) return '本轮尚未派工，还没有任何子代理结果。';
  return ledger.outcomes
    .map((outcome, index) => {
      const head = `【结果 ${index + 1}｜${outcome.agentName}｜${outcome.ok ? '成功' : '失败'}】`;
      const body = outcome.ok
        ? [outcome.summary ? `摘要：${outcome.summary}` : '', outcome.detail].filter(Boolean).join('\n')
        : `未采用，原因：${outcome.rejectedReason}`;
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

/**
 * 计算同波次实际可用的并发上限。
 * @param settings 续写设置
 * @param budget 预算配置
 * @returns 并发上限；跟随当前活动 API 时为 1，因为主 API 的归因机制不支持并发内部请求
 */
function resolveWaveLimit_ACU(settings: ContinuationSettings_ACU, budget: AgentRunBudget_ACU): number {
  return settings.apiPresetMode === 'current' ? 1 : Math.max(1, budget.maxConcurrent);
}

function describePlannerOutcome_ACU(summary: string, recommendation: string, mustPreserve: readonly string[], risks: readonly string[]): string {
  return [
    recommendation ? `建议：${recommendation}` : '',
    mustPreserve.length ? `必须保留：${mustPreserve.join('；')}` : '',
    risks.length ? `风险：${risks.join('；')}` : '',
    summary && !recommendation ? `摘要：${summary}` : '',
  ].filter(Boolean).join('\n');
}

/** 主 Agent 轮次规划器。替代 V7 的一次性指令生成器，对外只暴露 plan 一个入口。 */
export class ContinuationAgentTurnPlanner_ACU {
  constructor(private readonly dependencies: ContinuationAgentTurnPlannerDependencies_ACU = defaultDependencies_ACU) {}

  /**
   * 跑完一轮 Agent 循环，产出最终写作指导。
   * @param request 设置、执行快照、身份工厂与大纲改写回调
   * @param apiDependencies 可选的 API 预设依赖，用于测试注入
   * @returns 最终指导与本轮使用的 API 预设信息
   */
  async plan(request: ContinuationAgentTurnPlanRequest_ACU, apiDependencies?: ContinuationApiPresetDependencies_ACU): Promise<ContinuationAgentTurnPlanResult_ACU> {
    const preset = this.dependencies.resolveApiPreset(request.settings, 'turn_call', apiDependencies);
    const budget = this.dependencies.budget;
    const chat = this.dependencies.readChat();
    let snapshot = this.dependencies.readModuleSnapshot(chat);
    const context: AgentResolveContext_ACU = {
      chat,
      moduleSnapshot: snapshot,
      settledThroughIndex: snapshot.settledThroughIndex,
      execution: request.snapshot,
      originInstruction: request.snapshot.task.originInstruction,
      recentTurnCount: request.settings.contextTurnCount,
    };
    const ledger: AgentRunLedger_ACU = { delegationsUsed: 0, perAgent: new Map(), outcomes: [] };
    const history = buildAgentRealHistory_ACU(chat);
    let totalAttempts = 0;

    for (let iteration = 1; iteration <= budget.maxIterations; iteration += 1) {
      const allowDelegate = iteration < budget.maxIterations && ledger.delegationsUsed < budget.maxDelegations;
      const round = await this.callMainAgent(request, preset, history, context, ledger, budget, iteration, allowDelegate);
      totalAttempts += round.attempts;
      const action = round.action;

      if (action.kind === 'finalize') {
        if (action.constraints) {
          snapshot = applyAgentConstraintRegistration_ACU(snapshot, action.constraints.current, action.constraints.retired, chat.length - 1);
          context.moduleSnapshot = snapshot;
          await this.persistSnapshot_ACU(chat, snapshot);
        }
        return { instruction: action.instruction, attempts: totalAttempts, apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason } };
      }

      if (action.kind === 'block') {
        failLoop_ACU('CONTINUATION_AGENT_BLOCKED', `主 Agent 阻断本轮：${action.reason}`, { unresolved: action.unresolved });
      }

      if (action.kind === 'revise_outline') {
        if (!request.reviseOutline) failLoop_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', '当前上下文不支持改写大纲');
        await request.reviseOutline(action.replanInstruction);
        // 开了大纲预览时重规划会停在待确认态，用户要做的动作不同，错误信息必须分开说。
        const next = request.settings.outlinePreview
          ? '主 Agent 已改写当前阶段大纲，新大纲等待你确认后才能继续本轮'
          : '主 Agent 已改写当前阶段大纲，本轮需要按新大纲重新开始';
        failLoop_ACU('CONTINUATION_AGENT_OUTLINE_REPLANNED', next, { replanInstruction: action.replanInstruction, requiresReview: request.settings.outlinePreview });
      }

      snapshot = await this.runDelegations(action, request, preset, context, ledger, budget, chat, snapshot);
    }

    failLoop_ACU('CONTINUATION_AGENT_ITERATIONS_EXHAUSTED', `主 Agent 在 ${budget.maxIterations} 次迭代内没有交付最终指导`, { delegationsUsed: ledger.delegationsUsed });
  }

  private async callMainAgent(
    request: ContinuationAgentTurnPlanRequest_ACU,
    preset: ContinuationResolvedApiPreset_ACU,
    history: ReadonlyArray<{ role: string; content: string }>,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    iteration: number,
    allowDelegate: boolean,
  ) {
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(request.settings.internalAiRetryLimit);
    let lastReason = '';

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const base = request.createInternalRequestIdentity(attempt);
      const identity: ContinuationInternalAiRequestIdentity_ACU = { ...base, source: 'agent_main' };
      if (!request.isInternalRequestCurrent(base)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '主 Agent 请求已失效', false));
      }
      const toolResults = lastReason
        ? `${renderAgentToolResults_ACU(ledger)}\n\n【上一次输出被拒绝】原因：${lastReason}\n请修正后重新输出符合协议的 JSON 对象。`
        : renderAgentToolResults_ACU(ledger);
      const rendered = await renderContinuationPrompt_ACU(request.settings.agentPrompts.main, {
        $HISTORY_ANCHOR: () => HISTORY_SENTINEL_ACU,
        $USER_INTENT: () => context.originInstruction || '（用户未提供初始要求）',
        $CURRENT_TURN_GOAL: () => context.execution.turn.goal || '（本轮目标为空）',
        $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(context),
        $UNSETTLED_RANGE: () => this.renderUnsettledRange_ACU(context),
        $AGENT_CATALOG: () => renderAgentSubagentCatalog_ACU(),
        $MODULE_CATALOG: () => renderAgentModuleCatalog_ACU(),
        $TABLE_CATALOG: () => renderAgentTableCatalog_ACU(context.tableData),
        $BUDGET: () => renderAgentBudget_ACU(budget, iteration, ledger, resolveWaveLimit_ACU(request.settings, budget)),
        $TOOL_RESULTS: () => toolResults,
      }, 'agent_loop');
      const messages = this.spliceHistory_ACU(rendered.messages, history);
      const raw = await this.dependencies.callInternalAi(messages, preset, identity, request.signal);
      if (!request.isInternalRequestCurrent(base)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '主 Agent 结果已失效', false));
      }
      try {
        const payload = parseAgentJsonPayload_ACU(raw, AGENT_PREFILLS_ACU.main);
        return { action: parseAgentMainAction_ACU(payload, allowDelegate), attempts: attempt + 1 };
      } catch (error) {
        lastReason = compactAgentProtocolError_ACU(error);
      }
    }

    failLoop_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', `主 Agent 连续 ${retries + 1} 次返回不符合协议`, { lastReason });
  }

  private renderUnsettledRange_ACU(context: AgentResolveContext_ACU): string {
    const start = context.settledThroughIndex + 1;
    const last = context.chat.length - 1;
    if (start > last) return '没有尚未结算的真实历史，无需派工结算维护类代理。';
    const preview = renderAgentUnsettledHistory_ACU(context);
    return `未结算楼层区间：${start} 到 ${last}（共 ${last - start + 1} 楼）。派工结算时请把 $HISTORY_UNSETTLED 放进读集。\n区间内容预览：\n${preview}`;
  }

  private spliceHistory_ACU(
    messages: ReadonlyArray<{ role: string; content: string }>,
    history: ReadonlyArray<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    let inserted = false;
    for (const message of messages) {
      if (message.content.includes(HISTORY_SENTINEL_ACU)) {
        result.push(...history.map(item => ({ ...item })));
        inserted = true;
        continue;
      }
      result.push({ ...message });
    }
    // 提示词被用户删掉锚点段时历史无处可插，此时把历史接在最前面而不是静默丢弃。
    if (!inserted && history.length) return [...history.map(item => ({ ...item })), ...result];
    return result;
  }

  private async runDelegations(
    action: AgentDelegateAction_ACU,
    request: ContinuationAgentTurnPlanRequest_ACU,
    preset: ContinuationResolvedApiPreset_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    chat: any[],
    snapshot: AgentModuleSnapshot_ACU,
  ): Promise<AgentModuleSnapshot_ACU> {
    const waveLimit = resolveWaveLimit_ACU(request.settings, budget);
    const accepted: AgentDelegation_ACU[] = [];
    for (const delegation of action.delegations) {
      const used = ledger.perAgent.get(delegation.agentName) ?? 0;
      if (ledger.delegationsUsed + accepted.length >= budget.maxDelegations) {
        ledger.outcomes.push({ agentName: delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: `派工总数已达上限 ${budget.maxDelegations} 次` });
        continue;
      }
      if (used + accepted.filter(item => item.agentName === delegation.agentName).length >= budget.maxSameAgent) {
        ledger.outcomes.push({ agentName: delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: `同一代理最多派工 ${budget.maxSameAgent} 次` });
        continue;
      }
      if (accepted.length >= waveLimit) {
        const why = waveLimit === 1 && request.settings.apiPresetMode === 'current'
          ? '当前跟随活动 API，同一波次只能派工 1 个子代理'
          : `同一波次并发上限为 ${waveLimit} 个`;
        ledger.outcomes.push({ agentName: delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: `${why}，本次未执行，可在下一次迭代重派` });
        continue;
      }
      accepted.push(delegation);
    }

    const settled = await Promise.all(accepted.map(async (delegation): Promise<{ delegation: AgentDelegation_ACU; result: AgentSubagentRunResult_ACU | null; error: unknown }> => {
      try {
        const result = await this.dependencies.subagentRuntime.run({
          delegation,
          settings: request.settings,
          resolveContext: context,
          budget,
          preset,
          // attemptId 必须原样保留：轮次一致性校验按它比对，改写会让所有子代理请求被判失效。
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
        });
        return { delegation, result, error: null as unknown };
      } catch (error) {
        return { delegation, result: null, error };
      }
    }));

    let nextSnapshot = snapshot;
    let snapshotChanged = false;

    for (const item of settled) {
      ledger.delegationsUsed += 1;
      ledger.perAgent.set(item.delegation.agentName, (ledger.perAgent.get(item.delegation.agentName) ?? 0) + 1);
      if (!item.result) {
        ledger.outcomes.push({ agentName: item.delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: compactAgentProtocolError_ACU(item.error) });
        continue;
      }
      const result = item.result;
      if (result.maintainer) {
        try {
          const delta = mergeAgentDeltaRevisions_ACU(result.maintainer.delta, result.readRevisions);
          const applied = applyAgentModuleDelta_ACU(nextSnapshot, delta, result.writes, chat.length - 1);
          // 结算水位跟着快照一起走：全流程只有快照一个真值来源，避免上下文与落盘值各说一套。
          if (applied !== nextSnapshot) { nextSnapshot = { ...applied, settledThroughIndex: chat.length - 1 }; snapshotChanged = true; }
          const proposals = result.maintainer.delta.constraintProposals;
          ledger.outcomes.push({
            agentName: result.agentName,
            ok: true,
            summary: result.maintainer.summary,
            detail: [
              `已结算：伏笔 ${result.maintainer.delta.hooks.length} 条、信息差 ${result.maintainer.delta.infoGap.length} 条`,
              proposals.length ? `约束提议（需你裁决后登记）：${proposals.join('；')}` : '',
              result.expandedReads.length ? `补充读取：${result.expandedReads.join('、')}` : '',
            ].filter(Boolean).join('\n'),
            rejectedReason: '',
          });
        } catch (error) {
          ledger.outcomes.push({ agentName: result.agentName, ok: false, summary: result.maintainer.summary, detail: '', rejectedReason: compactAgentProtocolError_ACU(error) });
        }
        continue;
      }
      if (result.planner) {
        ledger.outcomes.push({
          agentName: result.agentName,
          ok: true,
          summary: result.planner.summary,
          detail: describePlannerOutcome_ACU(result.planner.summary, result.planner.recommendation, result.planner.mustPreserve, result.planner.risks),
          rejectedReason: '',
        });
        continue;
      }
      if (result.reviewer) {
        ledger.outcomes.push({
          agentName: result.agentName,
          ok: true,
          summary: `判词 ${result.reviewer.verdict}`,
          detail: [`判词：${result.reviewer.verdict}`, result.reviewer.reason ? `依据：${result.reviewer.reason}` : '', result.reviewer.fixes.length ? `修正项：${result.reviewer.fixes.join('；')}` : ''].filter(Boolean).join('\n'),
          rejectedReason: '',
        });
        continue;
      }
      ledger.outcomes.push({ agentName: result.agentName, ok: false, summary: '', detail: '', rejectedReason: '子代理没有返回可用输出' });
    }

    if (snapshotChanged) {
      context.moduleSnapshot = nextSnapshot;
      context.settledThroughIndex = nextSnapshot.settledThroughIndex;
      await this.persistSnapshot_ACU(chat, nextSnapshot);
    }
    return nextSnapshot;
  }

  private async persistSnapshot_ACU(chat: any[], snapshot: AgentModuleSnapshot_ACU): Promise<void> {
    const targetIndex = chat.length - 1;
    if (targetIndex < 0) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', '当前聊天没有可承载资料快照的楼层', false));
    }
    await this.dependencies.writeModuleSnapshot(chat, targetIndex, snapshot);
  }
}

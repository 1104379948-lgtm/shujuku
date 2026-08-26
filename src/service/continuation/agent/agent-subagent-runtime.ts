/**
 * service/continuation/agent/agent-subagent-runtime.ts — 子代理运行时
 *
 * 子代理不是一次性问答，而是一个受限的小循环：它可以在返回 needMore 时申请补充读集，
 * 运行时在读集权限与预算允许的范围内扩充材料并重跑一次。
 *
 * 这里只负责「调用 + 解析 + 权限校验」，不落盘。写集事务由主循环串行应用，
 * 避免同一波次里多个子代理并发改同一份快照造成互相覆盖。
 */

import { normalizeContinuationInternalAiRetryLimit_ACU } from '../defaults';
import { callContinuationInternalAi_ACU } from '../internal-ai-call';
import { resolveContinuationApiPreset_ACU, type ContinuationResolvedApiPreset_ACU } from '../api-preset';
import { renderContinuationPrompt_ACU } from '../prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationSettings_ACU,
} from '../model';
import { AGENT_PREFILLS_ACU } from './agent-defaults';
import { findAgentSubagentDefinition_ACU, type AgentSubagentDefinition_ACU } from './agent-catalog';
import {
  compactAgentProtocolError_ACU,
  parseAgentJsonPayload_ACU,
  parseAgentMaintainerOutput_ACU,
  parseAgentPlannerOutput_ACU,
  parseAgentReviewerOutput_ACU,
} from './agent-protocol';
import {
  AGENT_TABLE_TOKEN_PREFIX_ACU,
  renderAgentReadMaterials_ACU,
  resolveAgentWriteTokens_ACU,
  type AgentResolveContext_ACU,
} from './agent-placeholder-resolver';
import type {
  AgentDelegation_ACU,
  AgentMaintainerOutput_ACU,
  AgentModuleRevisions_ACU,
  AgentPlannerOutput_ACU,
  AgentReviewerOutput_ACU,
  AgentRunBudget_ACU,
  AgentSubagentKind_ACU,
  AgentWritableModule_ACU,
} from './agent-model';

/** 一次子代理执行的结果。写集事务留给主循环应用，这里只交出解析后的输出。 */
export interface AgentSubagentRunResult_ACU {
  agentName: string;
  kind: AgentSubagentKind_ACU;
  writes: AgentWritableModule_ACU[];
  maintainer: AgentMaintainerOutput_ACU | null;
  planner: AgentPlannerOutput_ACU | null;
  reviewer: AgentReviewerOutput_ACU | null;
  iterations: number;
  attempts: number;
  expandedReads: string[];
  /** 渲染读集材料那一刻的模块修订号。主循环用它做写入并发校验，不依赖子代理自报。 */
  readRevisions: AgentModuleRevisions_ACU;
}

export interface AgentSubagentRunInput_ACU {
  delegation: AgentDelegation_ACU;
  settings: ContinuationSettings_ACU;
  resolveContext: AgentResolveContext_ACU;
  budget: AgentRunBudget_ACU;
  preset: ContinuationResolvedApiPreset_ACU;
  createIdentity: (agentName: string, attempt: number) => ContinuationInternalAiRequestIdentity_ACU;
  isCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  signal?: AbortSignal | null;
}

export interface AgentSubagentRuntimeDependencies_ACU {
  callInternalAi: (
    messages: Array<{ role: string; content: string }>,
    preset: ContinuationResolvedApiPreset_ACU,
    identity: ContinuationInternalAiRequestIdentity_ACU,
    signal?: AbortSignal | null,
  ) => Promise<string | null>;
  resolveApiPreset: typeof resolveContinuationApiPreset_ACU;
}

const defaultDependencies_ACU: AgentSubagentRuntimeDependencies_ACU = {
  callInternalAi: callContinuationInternalAi_ACU,
  resolveApiPreset: resolveContinuationApiPreset_ACU,
};

const PROMPT_KEY_PREFILLS_ACU: Record<AgentSubagentDefinition_ACU['promptKey'], string> = {
  maintainer: AGENT_PREFILLS_ACU.maintainer,
  mainlinePlanner: AGENT_PREFILLS_ACU.planner,
  beatPlanner: AGENT_PREFILLS_ACU.planner,
  reviewer: AGENT_PREFILLS_ACU.reviewer,
};

function rejectDelegation_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', message, false, details));
}

function subagentFailed_ACU(message: string, retryable: boolean, details?: Record<string, unknown>): ContinuationValidationError_ACU {
  return new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SUBAGENT_FAILED', 'agent_delegate', message, retryable, details));
}

/**
 * 校验读集权限。表格读取对所有子代理开放（表格是公共只读投影），
 * 其余 token 必须落在该代理的 allowedReads 内。
 * @param tokens 主 Agent 请求的读集
 * @param definition 子代理定义
 * @returns 通过校验的读集；越权 token 会直接拒绝整次派工
 */
export function authorizeAgentReads_ACU(tokens: readonly string[], definition: AgentSubagentDefinition_ACU): string[] {
  const authorized: string[] = [];
  for (const raw of tokens) {
    const token = String(raw ?? '').trim();
    if (!token) continue;
    if (token.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU)) {
      if (!authorized.includes(token)) authorized.push(token);
      continue;
    }
    if (!definition.allowedReads.includes(token)) {
      rejectDelegation_ACU(`${definition.name} 无权读取 ${token}`, { token, allowedReads: [...definition.allowedReads] });
    }
    if (!authorized.includes(token)) authorized.push(token);
  }
  return authorized;
}

/**
 * 过滤子代理申请的补充读集，只保留它有权读取且本次尚未注入的 token。
 * @param needMore 子代理申请的 token 列表
 * @param current 本次已注入的读集
 * @param definition 子代理定义
 * @returns 可以追加的 token 列表；越权申请被丢弃而不是拒绝整次派工
 */
export function filterAgentExtraReads_ACU(needMore: readonly string[], current: readonly string[], definition: AgentSubagentDefinition_ACU): string[] {
  const extra: string[] = [];
  for (const raw of needMore) {
    const token = String(raw ?? '').trim();
    if (!token || current.includes(token) || extra.includes(token)) continue;
    const allowed = token.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU) || definition.allowedReads.includes(token);
    if (allowed) extra.push(token);
  }
  return extra;
}

function selectPromptSegments_ACU(settings: ContinuationSettings_ACU, definition: AgentSubagentDefinition_ACU): unknown {
  return settings.agentPrompts[definition.promptKey];
}

function describeWriteScope_ACU(writes: readonly AgentWritableModule_ACU[]): string {
  if (!writes.length) return '本次没有授予你任何写入权限。你只需返回建议或判词，不要输出 delta。';
  const labels: Record<AgentWritableModule_ACU, string> = { hooks: '$HOOKS_LEDGER 伏笔账本', infoGap: '$INFO_GAP 认知与信息差时间线', constraints: '$ACTIVE_CONSTRAINTS 长期约束' };
  return `你被授权写入：${writes.map(item => labels[item]).join('、')}。授权之外的模块一律不许出现在 delta 里。`;
}

function readNeedMore_ACU(result: AgentSubagentRunResult_ACU): string[] {
  if (result.maintainer) return result.maintainer.needMore;
  if (result.planner) return result.planner.needMore;
  if (result.reviewer) return result.reviewer.needMore;
  return [];
}

/** 子代理运行时。一个实例可服务多次派工，自身不持有任何本轮状态。 */
export class AgentSubagentRuntime_ACU {
  constructor(private readonly dependencies: AgentSubagentRuntimeDependencies_ACU = defaultDependencies_ACU) {}

  /**
   * 执行一次派工。
   * @param input 派工内容、设置、解析上下文、预算与身份工厂
   * @returns 解析后的子代理输出；权限越权或重试耗尽时抛错
   */
  async run(input: AgentSubagentRunInput_ACU): Promise<AgentSubagentRunResult_ACU> {
    const definition = findAgentSubagentDefinition_ACU(input.delegation.agentName);
    if (!definition) {
      rejectDelegation_ACU(`目录里没有名为 ${input.delegation.agentName} 的子代理`, { agentName: input.delegation.agentName });
    }
    const writes = resolveAgentWriteTokens_ACU(input.delegation.writes, definition.allowedWrites);
    let reads = authorizeAgentReads_ACU(input.delegation.reads, definition);
    const expandedReads: string[] = [];
    const maxIterations = 1 + Math.max(0, input.budget.maxExtraReads);
    let totalAttempts = 0;
    let result: AgentSubagentRunResult_ACU | null = null;

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const round = await this.callOnce(input, definition, reads, writes);
      totalAttempts += round.attempts;
      result = { ...round, iterations: iteration, attempts: totalAttempts, expandedReads: [...expandedReads] };
      const extra = filterAgentExtraReads_ACU(readNeedMore_ACU(round), reads, definition);
      if (!extra.length || iteration === maxIterations) break;
      reads = [...reads, ...extra];
      expandedReads.push(...extra);
    }

    if (!result) throw subagentFailed_ACU(`${definition.name} 没有产生任何结果`, false, { agentName: definition.name });
    return result;
  }

  private async callOnce(
    input: AgentSubagentRunInput_ACU,
    definition: AgentSubagentDefinition_ACU,
    reads: readonly string[],
    writes: readonly AgentWritableModule_ACU[],
  ): Promise<AgentSubagentRunResult_ACU> {
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    const prefill = PROMPT_KEY_PREFILLS_ACU[definition.promptKey];
    // 捕获与渲染必须同一时刻取自同一份快照，否则并发校验的基准就不是子代理真正读到的版本。
    const readRevisions: AgentModuleRevisions_ACU = { ...input.resolveContext.moduleSnapshot.revisions };
    const materials = renderAgentReadMaterials_ACU(reads, input.resolveContext);
    const writeScope = describeWriteScope_ACU(writes);
    let lastReason = '';

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const identity = input.createIdentity(definition.name, attempt);
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '子代理请求已失效', false));
      }
      const task = lastReason
        ? `${input.delegation.prompt}\n\n【上一次返回被拒绝】原因：${lastReason}\n请修正后重新输出符合契约的 JSON。`
        : input.delegation.prompt;
      const rendered = await renderContinuationPrompt_ACU(selectPromptSegments_ACU(input.settings, definition), {
        $AGENT_READ_MATERIALS: () => materials,
        $AGENT_TASK: () => task,
        $AGENT_WRITE_SCOPE: () => writeScope,
      }, 'agent_delegate');
      const raw = await this.dependencies.callInternalAi(rendered.messages, input.preset, identity, input.signal);
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '子代理结果已失效', false));
      }
      try {
        const payload = parseAgentJsonPayload_ACU(raw, prefill);
        return {
          agentName: definition.name,
          kind: definition.kind,
          writes: [...writes],
          maintainer: definition.kind === 'maintain' ? parseAgentMaintainerOutput_ACU(payload) : null,
          planner: definition.kind === 'plan' ? parseAgentPlannerOutput_ACU(payload) : null,
          reviewer: definition.kind === 'review' ? parseAgentReviewerOutput_ACU(payload) : null,
          iterations: 1,
          attempts: attempt + 1,
          expandedReads: [],
          readRevisions,
        };
      } catch (error) {
        lastReason = compactAgentProtocolError_ACU(error);
      }
    }

    throw subagentFailed_ACU(`${definition.name} 连续 ${retries + 1} 次返回不符合协议`, false, { agentName: definition.name, lastReason });
  }
}

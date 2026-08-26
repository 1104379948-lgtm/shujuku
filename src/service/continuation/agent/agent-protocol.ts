/**
 * service/continuation/agent/agent-protocol.ts — Agent 文本协议解析
 *
 * 内部 AI 没有原生工具调用能力，所有动作都通过模型输出的 JSON 块表达。
 * 项目里既有的大纲链路证明：尾部 assistant 段在实际后端只起格式示范作用，
 * 模型常常重新完整输出而不是续写。所以解析必须同时容忍两种返回形态：
 * 直接输出完整 JSON，或只续写预填充之后的部分。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  AGENT_REVIEW_VERDICTS_ACU,
  type AgentDelegation_ACU,
  type AgentHookDeltaItem_ACU,
  type AgentInfoGapDeltaItem_ACU,
  type AgentMainAction_ACU,
  type AgentMaintainerOutput_ACU,
  type AgentModuleDelta_ACU,
  type AgentPlannerOutput_ACU,
  type AgentReviewerOutput_ACU,
} from './agent-model';

function failProtocol_ACU(reason: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_loop', reason, true, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText_ACU(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTextList_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readText_ACU).filter(Boolean);
}

/**
 * 从任意文本里提取首个配平的 JSON 对象。
 * @param text 模型返回的原始文本，可能带 Markdown 围栏或前后解释
 * @returns 提取到的 JSON 子串；找不到返回 null
 */
export function extractFirstJsonObject_ACU(text: string): string | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = inString; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * 解析一份 Agent 协议载荷，兼容「完整输出」与「仅续写预填充后半段」两种形态。
 * @param raw 模型返回的原始文本
 * @param prefill 该请求尾段预填充文本，可为空
 * @returns 解析出的对象
 */
export function parseAgentJsonPayload_ACU(raw: string | null | undefined, prefill = ''): Record<string, unknown> {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空');
  const candidates = [text, `${prefill}${text}`];
  for (const candidate of candidates) {
    const extracted = extractFirstJsonObject_ACU(candidate);
    if (!extracted) continue;
    try {
      const parsed = JSON.parse(extracted);
      if (isRecord_ACU(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  failProtocol_ACU('返回内容不包含可解析的 JSON 对象');
}

function parseDelegations_ACU(value: unknown): AgentDelegation_ACU[] {
  if (!Array.isArray(value) || !value.length) failProtocol_ACU('delegate 动作必须提供非空的 delegations 数组');
  return value.map((raw, index) => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delegations[${index}] 必须是对象`);
    const agentName = readText_ACU(raw.agentName);
    const prompt = readText_ACU(raw.prompt);
    if (!agentName) failProtocol_ACU(`delegations[${index}].agentName 不能为空`);
    if (!prompt) failProtocol_ACU(`delegations[${index}].prompt 不能为空`);
    return { agentName, prompt, reads: readTextList_ACU(raw.reads), writes: readTextList_ACU(raw.writes) };
  });
}

/**
 * 解析主 Agent 的一次协议动作。
 * @param payload 已解析的 JSON 载荷
 * @param allowDelegate 本轮是否仍允许派工（预算最后一轮为 false）
 * @returns 判别联合形式的动作对象
 */
export function parseAgentMainAction_ACU(payload: Record<string, unknown>, allowDelegate: boolean): AgentMainAction_ACU {
  const action = readText_ACU(payload.action);
  const thought = readText_ACU(payload.thought);
  if (action === 'delegate') {
    if (!allowDelegate) failProtocol_ACU('本轮为预算最后一轮，已禁用 delegate，必须输出 finalize 或 block');
    return { kind: 'delegate', thought, delegations: parseDelegations_ACU(payload.delegations) };
  }
  if (action === 'revise_outline') {
    const replanInstruction = readText_ACU(payload.replanInstruction);
    if (!replanInstruction) failProtocol_ACU('revise_outline 动作必须提供 replanInstruction');
    return { kind: 'revise_outline', thought, replanInstruction };
  }
  if (action === 'finalize') {
    const instruction = readText_ACU(payload.instruction);
    if (!instruction) failProtocol_ACU('finalize 动作必须提供非空 instruction');
    const rawConstraints = payload.constraints;
    const constraints = isRecord_ACU(rawConstraints)
      ? { current: readTextList_ACU(rawConstraints.current), retired: readTextList_ACU(rawConstraints.retired) }
      : null;
    return { kind: 'finalize', thought, instruction, summary: readText_ACU(payload.summary), constraints };
  }
  if (action === 'block') {
    const reason = readText_ACU(payload.reason);
    if (!reason) failProtocol_ACU('block 动作必须提供 reason');
    return { kind: 'block', thought, reason, unresolved: readTextList_ACU(payload.unresolved) };
  }
  failProtocol_ACU(`action 必须是 delegate / revise_outline / finalize / block 之一，实际收到：${action || '(空)'}`);
}

function parseHookItems_ACU(value: unknown): AgentHookDeltaItem_ACU[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) failProtocol_ACU('delta.hooks 必须是数组');
  return value.map((raw, index) => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.hooks[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.hooks[${index}].action 必须是 upsert 或 retire`);
    const status = readText_ACU(raw.status);
    const importance = readText_ACU(raw.importance);
    return {
      action,
      id: readText_ACU(raw.id),
      summary: readText_ACU(raw.summary),
      status: ((AGENT_HOOK_STATUSES_ACU as readonly string[]).includes(status) ? status : 'planted') as AgentHookDeltaItem_ACU['status'],
      importance: ((AGENT_HOOK_IMPORTANCES_ACU as readonly string[]).includes(importance) ? importance : 'mid') as AgentHookDeltaItem_ACU['importance'],
      plantedIndex: typeof raw.plantedIndex === 'number' && Number.isInteger(raw.plantedIndex) && raw.plantedIndex >= 0 ? raw.plantedIndex : -1,
      plannedPayoff: readText_ACU(raw.plannedPayoff),
      reason: readText_ACU(raw.reason),
    };
  });
}

function parseInfoGapItems_ACU(value: unknown): AgentInfoGapDeltaItem_ACU[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) failProtocol_ACU('delta.infoGap 必须是数组');
  return value.map((raw, index) => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.infoGap[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.infoGap[${index}].action 必须是 upsert 或 retire`);
    const revealStatus = readText_ACU(raw.revealStatus);
    const knowledge = Array.isArray(raw.characterKnowledge) ? raw.characterKnowledge : [];
    return {
      action,
      id: readText_ACU(raw.id),
      topic: readText_ACU(raw.topic),
      objectiveFact: readText_ACU(raw.objectiveFact),
      readerKnown: readText_ACU(raw.readerKnown),
      characterKnowledge: knowledge.flatMap(item => {
        if (!isRecord_ACU(item)) return [];
        const name = readText_ACU(item.name);
        return name ? [{ name, knows: readText_ACU(item.knows) }] : [];
      }),
      revealStatus: ((AGENT_REVEAL_STATUSES_ACU as readonly string[]).includes(revealStatus) ? revealStatus : 'unrevealed') as AgentInfoGapDeltaItem_ACU['revealStatus'],
      revealIndex: typeof raw.revealIndex === 'number' && Number.isInteger(raw.revealIndex) && raw.revealIndex >= 0 ? raw.revealIndex : null,
      reason: readText_ACU(raw.reason),
    };
  });
}

function parseExpectedRevisions_ACU(value: unknown): AgentModuleDelta_ACU['expectedRevisions'] {
  if (!isRecord_ACU(value)) return {};
  const result: AgentModuleDelta_ACU['expectedRevisions'] = {};
  for (const key of ['hooks', 'infoGap', 'constraints'] as const) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) result[key] = raw;
  }
  return result;
}

/**
 * 解析维护类子代理的输出。
 * @param payload 已解析的 JSON 载荷
 * @returns 摘要 + 写集事务 + 追加读取请求
 */
export function parseAgentMaintainerOutput_ACU(payload: Record<string, unknown>): AgentMaintainerOutput_ACU {
  const rawDelta = isRecord_ACU(payload.delta) ? payload.delta : {};
  return {
    summary: readText_ACU(payload.summary),
    delta: {
      expectedRevisions: parseExpectedRevisions_ACU(rawDelta.expectedRevisions ?? payload.expectedRevisions),
      hooks: parseHookItems_ACU(rawDelta.hooks),
      infoGap: parseInfoGapItems_ACU(rawDelta.infoGap),
      constraintProposals: readTextList_ACU(rawDelta.constraintProposals),
    },
    needMore: readTextList_ACU(payload.needMore),
  };
}

/**
 * 解析策划类子代理的输出。外层字段结构化，创作内容保持自然语言。
 * @param payload 已解析的 JSON 载荷
 * @returns 摘要、建议正文、必须保留项、风险项与追加读取请求
 */
export function parseAgentPlannerOutput_ACU(payload: Record<string, unknown>): AgentPlannerOutput_ACU {
  const needMore = readTextList_ACU(payload.needMore);
  const recommendation = readText_ACU(payload.recommendation);
  if (!recommendation && !needMore.length) failProtocol_ACU('策划子代理必须给出 recommendation，或用 needMore 申请补充资料');
  return {
    summary: readText_ACU(payload.summary),
    recommendation,
    mustPreserve: readTextList_ACU(payload.mustPreserve),
    risks: readTextList_ACU(payload.risks),
    needMore,
  };
}

/**
 * 解析审查类子代理的输出。
 * @param payload 已解析的 JSON 载荷
 * @returns 判词、理由、修正建议与追加读取请求
 */
export function parseAgentReviewerOutput_ACU(payload: Record<string, unknown>): AgentReviewerOutput_ACU {
  const verdict = readText_ACU(payload.verdict);
  const needMore = readTextList_ACU(payload.needMore);
  if (!(AGENT_REVIEW_VERDICTS_ACU as readonly string[]).includes(verdict)) {
    if (needMore.length) return { verdict: 'revise', reason: '资料不足，已申请补充读取', fixes: [], needMore };
    failProtocol_ACU(`审查子代理的 verdict 必须是 pass / revise / block，实际收到：${verdict || '(空)'}`);
  }
  return {
    verdict: verdict as AgentReviewerOutput_ACU['verdict'],
    reason: readText_ACU(payload.reason),
    fixes: readTextList_ACU(payload.fixes),
    needMore,
  };
}

/** 把协议错误压成可回喂给模型的紧凑单行原因串。 */
export function compactAgentProtocolError_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return `${error.error.code}: ${error.error.message}`;
  return error instanceof Error ? error.message : String(error);
}

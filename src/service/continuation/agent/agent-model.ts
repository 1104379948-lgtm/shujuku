/**
 * service/continuation/agent/agent-model.ts — Agent 续写运行时的类型层
 *
 * 只放类型、常量与判定谓词，不含任何 IO 或宿主调用。
 * 叙事资料模块只覆盖表格系统没有的三项：伏笔账本、认知与信息差、长期约束。
 */

import type { ContinuationExecutionSnapshot_ACU } from '../stage-execution-engine';
import type { ContinuationInternalAiRequestIdentity_ACU, ContinuationPromptSegment_ACU, ContinuationSettings_ACU } from '../model';

/** 楼层锚定快照挂在消息对象上的独立字段名，与首楼 `_qrf_continuation` 并列、互不干扰。 */
export const AGENT_MODULE_FIELD_ACU = '_qrf_continuation_agent';

export const AGENT_MODULE_SCHEMA_VERSION_ACU = 1 as const;

/** 热上下文里最多展示的活跃伏笔条数，超出部分如实标注不静默丢弃。 */
export const AGENT_HOT_HOOK_LIMIT_ACU = 8;

/** 单个资料块渲染字符上限，超出即截断并标注。 */
export const AGENT_BLOCK_CHAR_LIMIT_ACU = 4000;

export const AGENT_HOOK_STATUSES_ACU = ['planted', 'reinforced', 'misled', 'partially_paid', 'paid', 'abandoned'] as const;
export type AgentHookStatus_ACU = typeof AGENT_HOOK_STATUSES_ACU[number];

export const AGENT_HOOK_IMPORTANCES_ACU = ['high', 'mid', 'low'] as const;
export type AgentHookImportance_ACU = typeof AGENT_HOOK_IMPORTANCES_ACU[number];

export const AGENT_REVEAL_STATUSES_ACU = ['unrevealed', 'partial', 'revealed'] as const;
export type AgentRevealStatus_ACU = typeof AGENT_REVEAL_STATUSES_ACU[number];

/** 已进入真实正文的一条伏笔。retired 的条目退出热上下文但保留在快照里可追溯。 */
export interface AgentHookEntry_ACU {
  id: string;
  summary: string;
  status: AgentHookStatus_ACU;
  importance: AgentHookImportance_ACU;
  plantedIndex: number;
  updatedIndex: number;
  plannedPayoff: string;
  retired: boolean;
  retiredReason: string;
}

/** 某个角色对某条信息的知晓状态。 */
export interface AgentCharacterKnowledge_ACU {
  name: string;
  knows: string;
}

/** 一条客观事实与各方认知的差值。未揭示的条目 revealIndex 必须为 null。 */
export interface AgentInfoGapEntry_ACU {
  id: string;
  topic: string;
  objectiveFact: string;
  readerKnown: string;
  characterKnowledge: AgentCharacterKnowledge_ACU[];
  revealStatus: AgentRevealStatus_ACU;
  revealIndex: number | null;
  retired: boolean;
  retiredReason: string;
}

/** 一条长期约束。只能由主 Agent 裁决后登记，子代理只能提议。 */
export interface AgentConstraintEntry_ACU {
  id: string;
  text: string;
  reason: string;
  createdIndex: number;
}

export interface AgentModuleRevisions_ACU {
  hooks: number;
  infoGap: number;
  constraints: number;
}

/** 楼层锚定的全量快照。读取=从尾向前找最近的合法快照，删楼即自动回退。 */
export interface AgentModuleSnapshot_ACU {
  schemaVersion: typeof AGENT_MODULE_SCHEMA_VERSION_ACU;
  settledThroughIndex: number;
  updatedAt: number;
  revisions: AgentModuleRevisions_ACU;
  hooks: AgentHookEntry_ACU[];
  infoGap: AgentInfoGapEntry_ACU[];
  constraints: AgentConstraintEntry_ACU[];
}

export const AGENT_WRITABLE_MODULES_ACU = ['hooks', 'infoGap', 'constraints'] as const;
export type AgentWritableModule_ACU = typeof AGENT_WRITABLE_MODULES_ACU[number];

export const AGENT_SUBAGENT_NAMES_ACU = ['hook-cognition-maintainer', 'mainline-planner', 'beat-planner', 'continuity-reviewer'] as const;
export type AgentSubagentName_ACU = typeof AGENT_SUBAGENT_NAMES_ACU[number];

export type AgentSubagentKind_ACU = 'maintain' | 'plan' | 'review';

/** 主 Agent 一次派工的完整输入。读集/写集用占位符 token 表达，不暴露存储路径。 */
export interface AgentDelegation_ACU {
  agentName: string;
  prompt: string;
  reads: string[];
  writes: string[];
}

export interface AgentFinalizeAction_ACU {
  kind: 'finalize';
  thought: string;
  instruction: string;
  summary: string;
  constraints: { current: string[]; retired: string[] } | null;
}

export interface AgentDelegateAction_ACU {
  kind: 'delegate';
  thought: string;
  delegations: AgentDelegation_ACU[];
}

export interface AgentReviseOutlineAction_ACU {
  kind: 'revise_outline';
  thought: string;
  replanInstruction: string;
}

export interface AgentBlockAction_ACU {
  kind: 'block';
  thought: string;
  reason: string;
  unresolved: string[];
}

export type AgentMainAction_ACU = AgentFinalizeAction_ACU | AgentDelegateAction_ACU | AgentReviseOutlineAction_ACU | AgentBlockAction_ACU;

/** 运行时硬边界。预留最后一轮让主 Agent 有机会正常交付而不是被突然掐断。 */
export interface AgentRunBudget_ACU {
  maxIterations: number;
  maxDelegations: number;
  maxSameAgent: number;
  maxConcurrent: number;
  maxExtraReads: number;
}

export const DEFAULT_AGENT_RUN_BUDGET_ACU: AgentRunBudget_ACU = {
  maxIterations: 5,
  maxDelegations: 6,
  maxSameAgent: 2,
  maxConcurrent: 3,
  maxExtraReads: 2,
};

/** 一次派工的执行结果。被运行时拒绝的委派也走这里回灌给主 Agent。 */
export interface AgentDelegationOutcome_ACU {
  agentName: string;
  ok: boolean;
  summary: string;
  detail: string;
  rejectedReason: string;
}

/** 子代理维护类输出解析后的写集事务。 */
export interface AgentModuleDelta_ACU {
  expectedRevisions: Partial<AgentModuleRevisions_ACU>;
  hooks: AgentHookDeltaItem_ACU[];
  infoGap: AgentInfoGapDeltaItem_ACU[];
  constraintProposals: string[];
}

export interface AgentHookDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  summary: string;
  status: AgentHookStatus_ACU;
  importance: AgentHookImportance_ACU;
  plantedIndex: number;
  plannedPayoff: string;
  reason: string;
}

export interface AgentInfoGapDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  topic: string;
  objectiveFact: string;
  readerKnown: string;
  characterKnowledge: AgentCharacterKnowledge_ACU[];
  revealStatus: AgentRevealStatus_ACU;
  revealIndex: number | null;
  reason: string;
}

/** 子代理维护类的完整输出。 */
export interface AgentMaintainerOutput_ACU {
  summary: string;
  delta: AgentModuleDelta_ACU;
  needMore: string[];
}

/** 子代理策划类的完整输出。外层结构化便于运行时识别，创作内容保持自然语言。 */
export interface AgentPlannerOutput_ACU {
  summary: string;
  recommendation: string;
  mustPreserve: string[];
  risks: string[];
  needMore: string[];
}

export const AGENT_REVIEW_VERDICTS_ACU = ['pass', 'revise', 'block'] as const;
export type AgentReviewVerdict_ACU = typeof AGENT_REVIEW_VERDICTS_ACU[number];

/** 子代理审查类的完整输出。 */
export interface AgentReviewerOutput_ACU {
  verdict: AgentReviewVerdict_ACU;
  reason: string;
  fixes: string[];
  needMore: string[];
}

/** 主 Agent 循环最终交付给宿主装配器的结果，字段形状与旧生成器保持一致。 */
export interface ContinuationAgentTurnPlanResult_ACU {
  instruction: string;
  attempts: number;
  apiPreset: { presetName: string; source: 'current' | 'fixed'; reason: 'fixed_preset' | 'current_configuration' };
}

/** 一次轮次准备所需的全部外部输入。 */
export interface ContinuationAgentTurnPlanRequest_ACU {
  settings: ContinuationSettings_ACU;
  snapshot: ContinuationExecutionSnapshot_ACU;
  createInternalRequestIdentity: (attempt: number) => ContinuationInternalAiRequestIdentity_ACU & { source: 'turn_instruction' };
  isInternalRequestCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  reviseOutline?: (replanInstruction: string) => Promise<void>;
  signal?: AbortSignal | null;
}

export function isAgentSubagentName_ACU(value: unknown): value is AgentSubagentName_ACU {
  return typeof value === 'string' && (AGENT_SUBAGENT_NAMES_ACU as readonly string[]).includes(value);
}

export function isAgentWritableModule_ACU(value: unknown): value is AgentWritableModule_ACU {
  return typeof value === 'string' && (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

export function cloneAgentPromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

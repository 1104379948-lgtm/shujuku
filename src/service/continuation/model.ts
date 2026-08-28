export const CONTINUATION_SCHEMA_VERSION_ACU = 1 as const;

export type ContinuationStageSize_ACU = 'short' | 'standard' | 'long' | 'custom';
export type ContinuationTaskStatus_ACU = 'drafting' | 'awaiting_outline_review' | 'paused' | 'running' | 'stopping_after_inflight' | 'completed' | 'abandoned' | 'failed';
export type ContinuationStageStatus_ACU = 'planning' | 'awaiting_review' | 'running' | 'completed' | 'abandoned' | 'failed';
export type ContinuationRevisionReason_ACU = 'initial' | 'auto_next_stage' | 'manual_replan';
export type ContinuationInternalCallStatus_ACU = 'idle' | 'planning_outline' | 'generating_turn_instruction' | 'retry_waiting' | 'failed';
export type ContinuationStopReason_ACU = 'manual' | 'duration_reached' | 'stage_limit_reached' | 'outline_validation_failed' | 'internal_ai_retry_exhausted' | 'generation_retry_exhausted' | 'host_input_unavailable' | 'api_preset_missing' | 'state_invalid' | 'chat_changed' | 'completed';

/**
 * 用户点「继续」即可从当前轮次恢复的停止原因。
 * 这四类都是「环境或产出问题，任务本身还能走」：manual 是用户手停；state_invalid 是宿主正文
 * 归属失败（如生成报错、楼层无法唯一归属）；host_input_unavailable 是酒馆输入框暂时不可用；
 * generation_retry_exhausted 是自动重试用完——用户显式点继续等于手动追加一次重试。
 * 不在集合内的保持不可继续：duration_reached / stage_limit_reached 是用户设定的上限（放行会
 * 立刻再次触发停止），completed 是终态，其余枚举值当前无赋值点，按保守处理。
 */
export const CONTINUATION_RECOVERABLE_STOP_REASONS_ACU: readonly ContinuationStopReason_ACU[] = ['manual', 'state_invalid', 'host_input_unavailable', 'generation_retry_exhausted'];
export type ContinuationErrorPhase_ACU = 'load' | 'persist' | 'outline_prompt' | 'outline_call' | 'outline_parse' | 'outline_validate' | 'turn_prompt' | 'turn_call' | 'host_send' | 'generation_evaluate' | 'replan' | 'agent_loop' | 'agent_delegate' | 'agent_persist';

export type ContinuationErrorCode_ACU =
  | 'CONTINUATION_CONFIG_MISSING'
  | 'CONTINUATION_CONFIG_NOT_INTEGER'
  | 'CONTINUATION_CONFIG_OUT_OF_RANGE'
  | 'CONTINUATION_STAGE_SIZE_INVALID'
  | 'CONTINUATION_CUSTOM_RANGE_INVALID'
  | 'CONTINUATION_ENVELOPE_INVALID'
  | 'CONTINUATION_CHAT_UNAVAILABLE'
  | 'CONTINUATION_CHAT_CHANGED'
  | 'CONTINUATION_WRITE_GUARD_MISMATCH'
  | 'CONTINUATION_PERSIST_FAILED'
  | 'CONTINUATION_PROMPT_INVALID'
  | 'CONTINUATION_PROMPT_EMPTY'
  | 'CONTINUATION_API_PRESET_MISSING'
  | 'CONTINUATION_MIGRATION_INVALID'
  | 'CONTINUATION_OUTLINE_NOT_OBJECT'
  | 'CONTINUATION_OUTLINE_UNKNOWN_FIELD'
  | 'CONTINUATION_OUTLINE_FIELD_MISSING'
  | 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID'
  | 'CONTINUATION_OUTLINE_STRING_EMPTY'
  | 'CONTINUATION_OUTLINE_SCHEMA_VERSION_INVALID'
  | 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE'
  | 'CONTINUATION_OUTLINE_NODES_EMPTY'
  | 'CONTINUATION_OUTLINE_NODE_ID_DUPLICATE'
  | 'CONTINUATION_OUTLINE_TURN_ID_DUPLICATE'
  | 'CONTINUATION_OUTLINE_SUGGESTED_TURNS_INVALID'
  | 'CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH'
  | 'CONTINUATION_OUTLINE_TOTAL_TURNS_MISMATCH'
  | 'CONTINUATION_REPLAN_CONTEXT_INVALID'
  | 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED'
  | 'CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH'
  | 'CONTINUATION_OUTLINE_JSON_INVALID'
  | 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED'
  | 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED'
  | 'CONTINUATION_REVISION_FROZEN'
  | 'CONTINUATION_TURN_INSTRUCTION_EMPTY'
  | 'CONTINUATION_TURN_INSTRUCTION_RETRY_EXHAUSTED'
  | 'CONTINUATION_INTERNAL_REQUEST_STALE'
  | 'CONTINUATION_OPERATION_BUSY'
  | 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY'
  | 'CONTINUATION_TASK_NOT_FOUND'
  | 'CONTINUATION_TASK_STATE_INVALID'
  | 'CONTINUATION_HOST_INPUT_UNAVAILABLE'
  | 'CONTINUATION_GENERATION_TAGS_MISSING'
  | 'CONTINUATION_GENERATION_FAILED'
  | 'CONTINUATION_AGENT_PROTOCOL_INVALID'
  | 'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED'
  | 'CONTINUATION_AGENT_BLOCKED'
  | 'CONTINUATION_AGENT_SUBAGENT_FAILED'
  | 'CONTINUATION_AGENT_WRITE_REJECTED'
  | 'CONTINUATION_AGENT_OUTLINE_REPLANNED'
  | 'CONTINUATION_AGENT_SNAPSHOT_INVALID';

export interface ContinuationError_ACU {
  code: ContinuationErrorCode_ACU;
  message: string;
  phase: ContinuationErrorPhase_ACU;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class ContinuationValidationError_ACU extends Error {
  readonly error: ContinuationError_ACU;

  constructor(error: ContinuationError_ACU) {
    super(error.message);
    this.name = 'ContinuationValidationError_ACU';
    this.error = error;
  }
}

export type ContinuationResult_ACU<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContinuationError_ACU };

export interface ContinuationRulePair_ACU {
  start: string;
  end: string;
}

export interface ContinuationPromptSegment_ACU {
  role: string;
  content: string;
  enabled?: boolean;
  deletable?: boolean;
  pinned?: boolean;
}

/** 一组 Agent 提示词。每个 key 对应一个内部请求的伪 role + 预填充提示词组。 */
export interface ContinuationAgentPrompts_ACU {
  main: ContinuationPromptSegment_ACU[];
  maintainer: ContinuationPromptSegment_ACU[];
  mainlinePlanner: ContinuationPromptSegment_ACU[];
  beatPlanner: ContinuationPromptSegment_ACU[];
  reviewer: ContinuationPromptSegment_ACU[];
}

export const CONTINUATION_AGENT_PROMPT_KEYS_ACU = ['main', 'maintainer', 'mainlinePlanner', 'beatPlanner', 'reviewer'] as const;

export type ContinuationAgentPromptKey_ACU = typeof CONTINUATION_AGENT_PROMPT_KEYS_ACU[number];

/** 可独立配置 AI 渠道的六个角色：主 Agent、大纲子代理与四个派工子代理。 */
export const CONTINUATION_AGENT_API_PRESET_ROLES_ACU = ['main', 'outline', 'maintainer', 'mainlinePlanner', 'beatPlanner', 'reviewer'] as const;

export type ContinuationAgentApiPresetRole_ACU = typeof CONTINUATION_AGENT_API_PRESET_ROLES_ACU[number];

/** 单个角色的渠道选择。inherit 表示沿用全局 apiPresetMode/fixedApiPresetName。 */
export interface ContinuationAgentApiPresetChoice_ACU {
  mode: 'inherit' | 'current' | 'fixed';
  presetName: string;
}

export type ContinuationAgentApiPresets_ACU = Record<ContinuationAgentApiPresetRole_ACU, ContinuationAgentApiPresetChoice_ACU>;

export interface ContinuationTurnRange_ACU {
  min: number;
  max: number;
}

export interface StageTurn_ACU {
  id: string;
  goal: string;
}

export interface StageNode_ACU {
  id: string;
  title: string;
  goal: string;
  suggestedTurns: number;
  turns: StageTurn_ACU[];
}

export interface StageOutline_ACU {
  schemaVersion: typeof CONTINUATION_SCHEMA_VERSION_ACU;
  title: string;
  goal: string;
  totalTurns: number;
  nodes: StageNode_ACU[];
}

export interface ContinuationSettings_ACU {
  stageSize: ContinuationStageSize_ACU;
  customTurnMin: number | null;
  customTurnMax: number | null;
  outlinePreview: boolean;
  autoNextStage: boolean;
  maxAutomaticStages: number;
  loopTags: string;
  loopDelaySeconds: number;
  totalDurationMinutes: number;
  retryDelaySeconds: number;
  generationRetryLimit: number;
  internalAiRetryLimit: number;
  contextTurnCount: number;
  /** Agent 可读/可搜正文窗口：只有最近 N 个已结算 AI 楼层可被 read/search；0 表示只给未结算部分。 */
  storyWindowFloors: number;
  /** 主 Agent 自身会话历史的 token 预算；超出后压缩最早的轮次为交接报告。0 表示不限制。 */
  agentHistoryTokenBudget: number;
  /** 骨架里固定注入全文的末尾 AI 楼层数（承接锚点），其余窗口内楼层只进目录。 */
  storyTailFloors: number;
  /** 一次规划运行内 read/search 结果的累计 token 预算；正整数为固定值，"30%" 形式按历史预算折算。 */
  agentReadTokenBudget: number | string;
  /** 临近历史预算阈值时仍放行的精读兜底额度（token）；有效值为 min(该值, 读取预算)。 */
  agentReadFallbackTokens: number;
  contextExtractRules: ContinuationRulePair_ACU[];
  contextExcludeRules: ContinuationRulePair_ACU[];
  apiPresetMode: 'current' | 'fixed';
  fixedApiPresetName: string;
  agentApiPresets: ContinuationAgentApiPresets_ACU;
  outlinePrompt: ContinuationPromptSegment_ACU[];
  agentPrompts: ContinuationAgentPrompts_ACU;
  promptForceDefaultVersion?: string;
}

export interface ContinuationEnvelope_ACU {
  schemaVersion: typeof CONTINUATION_SCHEMA_VERSION_ACU;
  settings: ContinuationSettings_ACU;
  activeTask: ContinuationTask_ACU | null;
}

export interface ContinuationTask_ACU {
  taskId: string;
  originInstruction: string;
  status: ContinuationTaskStatus_ACU;
  createdAt: number;
  updatedAt: number;
  runStartedAt: number | null;
  deadlineAt: number | null;
  runStageCount: number;
  activeStageId: string | null;
  stages: ContinuationStage_ACU[];
  timeline: ContinuationTimelineEntry_ACU[];
  stopReason: ContinuationStopReason_ACU | null;
  lastError: ContinuationError_ACU | null;
  pendingHostTurn?: ContinuationPendingHostTurn_ACU | null;
}

export interface ContinuationStage_ACU {
  stageId: string;
  stageNumber: number;
  status: ContinuationStageStatus_ACU;
  chronicleStartCount: number;
  chronicleEndCount: number | null;
  chronicleAddedCount: number | null;
  chronicleRange: { first: string; last: string } | null;
  activeRevision: number;
  revisions: StageRevision_ACU[];
  activeNodeIndex: number;
  activeTurnIndex: number;
  completedTurns: number;
}

export interface StageRevision_ACU {
  revision: number;
  createdAt: number;
  reason: ContinuationRevisionReason_ACU;
  replanInstruction: string;
  frozen: boolean;
  outline: StageOutline_ACU;
}

export interface TurnAttemptIdentity_ACU {
  chatIdentity: string;
  taskId: string;
  stageId: string;
  revision: number;
  nodeId: string;
  turnId: string;
  attemptId: string;
}

/** Durable, non-content state needed to attribute a host generation. */
export interface ContinuationHostGenerationCapture_ACU {
  capturedAt: number;
  capturedChatLength: number;
  capturedAiFloorCount: number;
  generationSeq: number | null;
}

export interface ContinuationPendingHostTurn_ACU {
  identity: TurnAttemptIdentity_ACU;
  capture: ContinuationHostGenerationCapture_ACU;
  retryCount: number;
  status: 'awaiting_generation' | 'retry_ready' | 'exhausted';
}

export type ContinuationInternalAiSource_ACU = 'outline' | 'turn_instruction' | 'agent_main' | 'agent_subagent';

/**
 * Request-scoped provenance for an internal AI call. It deliberately contains
 * only durable identifiers, never prompts or generated text.
 */
export interface ContinuationInternalAiRequestIdentity_ACU {
  source: ContinuationInternalAiSource_ACU;
  requestId: string;
  chatIdentity: string;
  taskId: string;
  stageId: string;
  revision: number;
  nodeId?: string;
  turnId?: string;
  attemptId?: string;
}

export interface ContinuationTurnInstructionRequestIdentity_ACU extends TurnAttemptIdentity_ACU {
  requestId: string;
  source: 'turn_instruction';
}

export type ContinuationTimelineKind_ACU = 'task_created' | 'outline_ready' | 'turn_sent' | 'turn_completed' | 'turn_retry' | 'stage_completed' | 'paused' | 'stopped' | 'failed';

export interface ContinuationTimelineEntry_ACU {
  id: string;
  at: number;
  kind: ContinuationTimelineKind_ACU;
  stageId?: string;
  revision?: number;
  nodeId?: string;
  turnId?: string;
  attemptId?: string;
  messageIndex?: number;
  errorCode?: ContinuationErrorCode_ACU;
}

export interface ContinuationReplanConstraints_ACU {
  previousOutline: StageOutline_ACU;
  completedTurns: number;
  expectedRemainingTurns: number;
}


export interface ContinuationWriteGuard_ACU {
  chatIdentity: string;
  taskId?: string | null;
  stageId?: string | null;
  revision?: number | null;
}

export function createContinuationError_ACU(code: ContinuationErrorCode_ACU, phase: ContinuationErrorPhase_ACU, message: string, retryable = false, details?: Record<string, unknown>): ContinuationError_ACU {
  return details === undefined ? { code, phase, message, retryable } : { code, phase, message, retryable, details };
}

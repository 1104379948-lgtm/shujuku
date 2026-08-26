import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationPromptSegment_ACU, type ContinuationSettings_ACU, type ContinuationStageSize_ACU, type ContinuationTurnRange_ACU } from './model';

export const CONTINUATION_TURN_RANGES_ACU: Readonly<Record<Exclude<ContinuationStageSize_ACU, 'custom'>, ContinuationTurnRange_ACU>> = {
  short: { min: 3, max: 5 },
  standard: { min: 6, max: 10 },
  long: { min: 11, max: 20 },
};

const DEFAULT_OUTLINE_PROMPT_ACU: readonly ContinuationPromptSegment_ACU[] = [
  {
    role: 'system',
    content: '你是阶段大纲规划器。只能输出一个严格 JSON 对象，不得输出 Markdown、代码围栏、解释或额外文本。对象必须包含 schemaVersion、title、goal、totalTurns、nodes；每个节点必须包含 id、title、goal、suggestedTurns、turns；每个轮次必须包含 id、goal。schemaVersion 必须为 1，节点建议轮数总和与逐轮目标数量必须等于 totalTurns。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '初始要求：\n$ORIGIN_INSTRUCTION\n\n阶段轮数范围：\n$TURN_RANGE\n\n当前任务阶段历史：\n$STAGE_HISTORY\n\n已完成且不可改写的当前阶段部分：\n$COMPLETED_STAGE_PART\n\n重规划补充要求：\n$REPLAN_INSTRUCTION\n\n允许重新分配的剩余轮数：\n$REMAINING_TURNS\n\n相关世界书背景：\n$1\n\n上一阶段纪要：\n$LAST_STAGE_CHRONICLES\n\n更早阶段概要：\n$EARLIER_STAGE_SUMMARIES\n\n最近剧情：\n$RECENT_STORY\n\n上次校验错误：\n$VALIDATION_ERRORS\n\n请据此输出严格 JSON 大纲。',
    enabled: true,
    deletable: true,
  },
];

const DEFAULT_TURN_INSTRUCTION_PROMPT_ACU: readonly ContinuationPromptSegment_ACU[] = [
  {
    role: 'system',
    content: '你是续写指令生成器。只输出将直接发送给 SillyTavern 的最终普通文本，不得输出分析、JSON、Markdown 围栏、伪 Role 标记、占位符名称或内部状态。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '初始要求：\n$ORIGIN_INSTRUCTION\n\n当前阶段：\n$CURRENT_STAGE\n\n当前节点：\n$CURRENT_NODE\n\n当前轮子目标：\n$CURRENT_TURN_GOAL\n\n阶段内轮次序号：\n$TURN_NUMBER\n\n节点内轮次序号：\n$NODE_TURN_NUMBER\n\n相关世界书背景：\n$1\n\n上一阶段纪要：\n$LAST_STAGE_CHRONICLES\n\n更早阶段概要：\n$EARLIER_STAGE_SUMMARIES\n\n最近剧情：\n$RECENT_STORY\n\n请输出最终普通文本。',
    enabled: true,
    deletable: true,
  },
];

function clonePromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

export function buildDefaultContinuationOutlinePrompt_ACU(): ContinuationPromptSegment_ACU[] {
  return clonePromptSegments_ACU(DEFAULT_OUTLINE_PROMPT_ACU);
}

export function buildDefaultContinuationTurnInstructionPrompt_ACU(): ContinuationPromptSegment_ACU[] {
  return clonePromptSegments_ACU(DEFAULT_TURN_INSTRUCTION_PROMPT_ACU);
}

export function buildDefaultContinuationSettings_ACU(): ContinuationSettings_ACU {
  return {
    stageSize: 'standard',
    customTurnMin: null,
    customTurnMax: null,
    outlinePreview: false,
    autoNextStage: true,
    maxAutomaticStages: 6,
    loopTags: '',
    loopDelaySeconds: 5,
    totalDurationMinutes: 0,
    retryDelaySeconds: 3,
    generationRetryLimit: 3,
    internalAiRetryLimit: 3,
    contextTurnCount: 3,
    contextExtractRules: [],
    contextExcludeRules: [],
    apiPresetMode: 'current',
    fixedApiPresetName: '',
    outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU(),
    turnInstructionPrompt: buildDefaultContinuationTurnInstructionPrompt_ACU(),
  };
}

function normalizeOptionalInteger_ACU(value: unknown, fallback: number, minimum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_NOT_INTEGER', 'load', `${field} 必须是整数`, false, { field, valueType: typeof value }));
  }
  if (value < minimum) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_OUT_OF_RANGE', 'load', `${field} 超出允许范围`, false, { field, minimum, actual: value }));
  }
  return value;
}

/** Missing values receive the supplied default; 0 remains a valid explicit retry limit. */
export function normalizeContinuationInternalAiRetryLimit_ACU(value: unknown, fallback = 3): number {
  return normalizeOptionalInteger_ACU(value, fallback, 0, 'internalAiRetryLimit');
}

/** Missing values receive the supplied default; 0 is rejected because auto-stage limit must be positive. */
export function normalizeContinuationMaxAutomaticStages_ACU(value: unknown, fallback = 6): number {
  return normalizeOptionalInteger_ACU(value, fallback, 1, 'maxAutomaticStages');
}

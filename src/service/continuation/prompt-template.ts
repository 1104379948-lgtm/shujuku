import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationPromptSegment_ACU,
  type ContinuationSettings_ACU,
} from './model';
import { buildDefaultContinuationOutlinePrompt_ACU } from './defaults';
import {
  buildDefaultAgentBeatPlannerPrompt_ACU,
  buildDefaultAgentMainPrompt_ACU,
  buildDefaultAgentMainlinePlannerPrompt_ACU,
  buildDefaultAgentMaintainerPrompt_ACU,
  buildDefaultAgentReviewerPrompt_ACU,
} from './agent/agent-defaults';

export const CONTINUATION_PROMPT_PLACEHOLDERS_ACU = [
  '$ORIGIN_INSTRUCTION', '$1', '$LAST_STAGE_CHRONICLES', '$EARLIER_STAGE_SUMMARIES',
  '$RECENT_STORY', '$STAGE_HISTORY', '$COMPLETED_STAGE_PART', '$REPLAN_INSTRUCTION',
  '$TURN_RANGE', '$REMAINING_TURNS', '$CURRENT_STAGE', '$CURRENT_NODE',
  '$CURRENT_TURN_GOAL', '$TURN_NUMBER', '$NODE_TURN_NUMBER', '$VALIDATION_ERRORS',
  // 以下为 Agent 续写链路专用占位符。$TABLE:<表名> 形式的动态读集不在此列，
  // 它只作为读集标识符，由解析器汇入 $AGENT_READ_MATERIALS。
  '$HISTORY_ANCHOR', '$UNSETTLED_RANGE', '$AGENT_CATALOG', '$MODULE_CATALOG',
  '$TABLE_CATALOG', '$TABLE_GLOBAL', '$TABLE_CHARACTERS', '$TABLE_CHRONICLES',
  '$HOOKS_LEDGER', '$INFO_GAP', '$ACTIVE_CONSTRAINTS', '$BUDGET', '$TOOL_RESULTS',
  '$AGENT_READ_MATERIALS', '$AGENT_TASK', '$AGENT_WRITE_SCOPE', '$USER_INTENT', '$OUTLINE_WINDOW',
] as const;

export type ContinuationPromptPlaceholder_ACU = typeof CONTINUATION_PROMPT_PLACEHOLDERS_ACU[number];
export type ContinuationPromptKind_ACU = 'outline' | 'agent_main' | 'agent_maintainer' | 'agent_mainline' | 'agent_beat' | 'agent_reviewer';
type PlaceholderResolver_ACU = () => string | Promise<string | null | undefined> | null | undefined;

function failPrompt_ACU(code: 'CONTINUATION_ENVELOPE_INVALID' | 'CONTINUATION_PROMPT_INVALID' | 'CONTINUATION_PROMPT_EMPTY', phase: ContinuationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

export function validateContinuationPromptSegments_ACU(value: unknown, phase: ContinuationErrorPhase_ACU, errorCode: 'CONTINUATION_ENVELOPE_INVALID' | 'CONTINUATION_PROMPT_INVALID' = 'CONTINUATION_PROMPT_INVALID'): ContinuationPromptSegment_ACU[] {
  if (!Array.isArray(value)) failPrompt_ACU(errorCode, phase, '提示词必须是数组');
  const result = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) failPrompt_ACU(errorCode, phase, '提示词段必须是对象', { index });
    const segment = raw as Record<string, unknown>;
    if (Object.keys(segment).some(key => !['role', 'content', 'enabled', 'deletable', 'pinned'].includes(key))) failPrompt_ACU(errorCode, phase, '提示词段包含未知字段', { index });
    if (!['system', 'user', 'assistant'].includes(segment.role as string) || typeof segment.content !== 'string') failPrompt_ACU(errorCode, phase, '提示词段角色或内容非法', { index });
    if (segment.enabled !== undefined && typeof segment.enabled !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 enabled 非法', { index });
    if (segment.deletable !== undefined && typeof segment.deletable !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 deletable 非法', { index });
    if (segment.pinned !== undefined && typeof segment.pinned !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 pinned 非法', { index });
    if (!segment.content.trim()) failPrompt_ACU(errorCode, phase, '提示词段内容不能为空', { index });
    return { role: segment.role, content: segment.content, ...(segment.enabled === undefined ? {} : { enabled: segment.enabled }), ...(segment.deletable === undefined ? {} : { deletable: segment.deletable }), ...(segment.pinned === undefined ? {} : { pinned: segment.pinned }) } as ContinuationPromptSegment_ACU;
  });
  if (!result.length) failPrompt_ACU(errorCode, phase, '提示词不能为空');
  return result;
}

export async function renderContinuationPrompt_ACU(segments: unknown, resolvers: Partial<Record<ContinuationPromptPlaceholder_ACU, PlaceholderResolver_ACU>>, phase: ContinuationErrorPhase_ACU): Promise<{ messages: Array<{ role: string; content: string }>; usedPlaceholders: ContinuationPromptPlaceholder_ACU[] }> {
  const validated = validateContinuationPromptSegments_ACU(segments, phase);
  const enabledSegments = validated.filter(segment => segment.enabled !== false);
  if (!enabledSegments.length) failPrompt_ACU('CONTINUATION_PROMPT_EMPTY', phase, '提示词至少需要一个启用段');
  const usedPlaceholders = CONTINUATION_PROMPT_PLACEHOLDERS_ACU.filter(token => enabledSegments.some(segment => segment.content.includes(token)));
  const values = new Map<ContinuationPromptPlaceholder_ACU, string>();
  for (const token of usedPlaceholders) values.set(token, String(await resolvers[token]?.() ?? ''));
  const tokenPattern = new RegExp(CONTINUATION_PROMPT_PLACEHOLDERS_ACU.map(token => token.replace(/[$]/g, '\\$')).join('|'), 'g');
  return { usedPlaceholders, messages: enabledSegments.map(segment => ({ role: segment.role, content: segment.content.replace(tokenPattern, token => values.get(token as ContinuationPromptPlaceholder_ACU) ?? '') })) };
}

/**
 * 把指定提示词组恢复为默认值。
 * @param settings 当前设置草稿
 * @param kind 要恢复的提示词组
 * @returns 新的设置对象，只替换目标提示词组
 */
export function restoreContinuationPromptDefault_ACU(settings: ContinuationSettings_ACU, kind: ContinuationPromptKind_ACU): ContinuationSettings_ACU {
  if (kind === 'outline') return { ...settings, outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU() };
  const agentPrompts = { ...settings.agentPrompts };
  if (kind === 'agent_main') agentPrompts.main = buildDefaultAgentMainPrompt_ACU();
  if (kind === 'agent_maintainer') agentPrompts.maintainer = buildDefaultAgentMaintainerPrompt_ACU();
  if (kind === 'agent_mainline') agentPrompts.mainlinePlanner = buildDefaultAgentMainlinePlannerPrompt_ACU();
  if (kind === 'agent_beat') agentPrompts.beatPlanner = buildDefaultAgentBeatPlannerPrompt_ACU();
  if (kind === 'agent_reviewer') agentPrompts.reviewer = buildDefaultAgentReviewerPrompt_ACU();
  return { ...settings, agentPrompts };
}

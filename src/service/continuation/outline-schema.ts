import { CONTINUATION_TURN_RANGES_ACU } from './defaults';
import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationErrorCode_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationReplanConstraints_ACU,
  type ContinuationStageSize_ACU,
  type ContinuationTurnRange_ACU,
  type StageNode_ACU,
  type StageOutline_ACU,
  type StageTurn_ACU,
} from './model';

const OUTLINE_KEYS_ACU = ['schemaVersion', 'title', 'goal', 'totalTurns', 'nodes'] as const;
const NODE_KEYS_ACU = ['id', 'title', 'goal', 'suggestedTurns', 'turns'] as const;
const TURN_KEYS_ACU = ['id', 'goal'] as const;

function fail_ACU(code: ContinuationErrorCode_ACU, phase: ContinuationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail_ACU('CONTINUATION_OUTLINE_FIELD_MISSING', 'outline_validate', `缺少必填字段：${path}.${key}`, { path: `${path}.${key}` });
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail_ACU('CONTINUATION_OUTLINE_UNKNOWN_FIELD', 'outline_validate', `存在未知字段：${path}.${key}`, { path: `${path}.${key}` });
    }
  }
}

function requireText_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是字符串：${path}`, { path });
  }
  if (value.trim().length === 0) {
    fail_ACU('CONTINUATION_OUTLINE_STRING_EMPTY', 'outline_validate', `字段不能为空：${path}`, { path });
  }
  return value;
}

function requirePositiveInteger_ACU(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是整数：${path}`, { path });
  }
  if (value <= 0) {
    fail_ACU('CONTINUATION_OUTLINE_SUGGESTED_TURNS_INVALID', 'outline_validate', `字段必须为正整数：${path}`, { path });
  }
  return value;
}

function validateTurn_ACU(raw: unknown, path: string): StageTurn_ACU {
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是对象：${path}`, { path });
  }
  assertExactKeys_ACU(raw, TURN_KEYS_ACU, path);
  return { id: requireText_ACU(raw.id, `${path}.id`), goal: requireText_ACU(raw.goal, `${path}.goal`) };
}

function validateNode_ACU(raw: unknown, index: number, turnIds: Set<string>): StageNode_ACU {
  const path = `nodes[${index}]`;
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是对象：${path}`, { path });
  }
  assertExactKeys_ACU(raw, NODE_KEYS_ACU, path);
  if (!Array.isArray(raw.turns)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是数组：${path}.turns`, { path: `${path}.turns` });
  }
  const suggestedTurns = requirePositiveInteger_ACU(raw.suggestedTurns, `${path}.suggestedTurns`);
  const turns = raw.turns.map((turn, turnIndex) => validateTurn_ACU(turn, `${path}.turns[${turnIndex}]`));
  if (turns.length !== suggestedTurns) {
    fail_ACU('CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH', 'outline_validate', `节点轮次数与 suggestedTurns 不一致：${path}`, { path, expected: suggestedTurns, actual: turns.length });
  }
  for (const turn of turns) {
    if (turnIds.has(turn.id)) {
      fail_ACU('CONTINUATION_OUTLINE_TURN_ID_DUPLICATE', 'outline_validate', `轮次 ID 重复：${turn.id}`, { id: turn.id });
    }
    turnIds.add(turn.id);
  }
  return { id: requireText_ACU(raw.id, `${path}.id`), title: requireText_ACU(raw.title, `${path}.title`), goal: requireText_ACU(raw.goal, `${path}.goal`), suggestedTurns, turns };
}


/** Returns the hard turn range for the selected stage size without coercing raw values. */
export function resolveContinuationTurnRange_ACU(stageSize: unknown, customTurnMin?: unknown, customTurnMax?: unknown): ContinuationTurnRange_ACU {
  if (stageSize === 'short' || stageSize === 'standard' || stageSize === 'long') {
    return { ...CONTINUATION_TURN_RANGES_ACU[stageSize] };
  }
  if (stageSize !== 'custom') {
    fail_ACU('CONTINUATION_STAGE_SIZE_INVALID', 'outline_validate', '阶段规模必须是 short、standard、long 或 custom', { valueType: typeof stageSize });
  }
  if (typeof customTurnMin !== 'number' || !Number.isInteger(customTurnMin) || typeof customTurnMax !== 'number' || !Number.isInteger(customTurnMax)) {
    fail_ACU('CONTINUATION_CUSTOM_RANGE_INVALID', 'outline_validate', '自定义轮数范围必须由两个整数构成');
  }
  if (customTurnMin < 1 || customTurnMax > 50 || customTurnMin > customTurnMax) {
    fail_ACU('CONTINUATION_CUSTOM_RANGE_INVALID', 'outline_validate', '自定义轮数范围必须在 1 到 50 之间且最小值不得大于最大值', { min: customTurnMin, max: customTurnMax });
  }
  return { min: customTurnMin, max: customTurnMax };
}

/**
 * Validates an untrusted model payload before any serialization or cloning.
 * The returned outline is a fresh, typed value assembled only from validated fields.
 */
export function validateStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutline_ACU {
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_NOT_OBJECT', 'outline_validate', '阶段大纲必须是单一 JSON 对象');
  }
  assertExactKeys_ACU(raw, OUTLINE_KEYS_ACU, 'outline');
  if (raw.schemaVersion !== CONTINUATION_SCHEMA_VERSION_ACU) {
    fail_ACU('CONTINUATION_OUTLINE_SCHEMA_VERSION_INVALID', 'outline_validate', '阶段大纲 schemaVersion 必须为 1', { actual: raw.schemaVersion });
  }
  if (typeof raw.totalTurns !== 'number' || !Number.isInteger(raw.totalTurns)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', 'totalTurns 必须是整数', { path: 'outline.totalTurns' });
  }
  if (raw.totalTurns < range.min || raw.totalTurns > range.max) {
    fail_ACU('CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE', 'outline_validate', 'totalTurns 超出当前阶段规模范围', { min: range.min, max: range.max, actual: raw.totalTurns });
  }
  if (!Array.isArray(raw.nodes)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', 'nodes 必须是数组', { path: 'outline.nodes' });
  }
  if (raw.nodes.length === 0) {
    fail_ACU('CONTINUATION_OUTLINE_NODES_EMPTY', 'outline_validate', 'nodes 不能为空');
  }
  const nodeIds = new Set<string>();
  const turnIds = new Set<string>();
  const nodes = raw.nodes.map((node, index) => {
    const validated = validateNode_ACU(node, index, turnIds);
    if (nodeIds.has(validated.id)) {
      fail_ACU('CONTINUATION_OUTLINE_NODE_ID_DUPLICATE', 'outline_validate', `节点 ID 重复：${validated.id}`, { id: validated.id });
    }
    nodeIds.add(validated.id);
    return validated;
  });
  const summedTurns = nodes.reduce((sum, node) => sum + node.suggestedTurns, 0);
  if (summedTurns !== raw.totalTurns) {
    fail_ACU('CONTINUATION_OUTLINE_TOTAL_TURNS_MISMATCH', 'outline_validate', '节点 suggestedTurns 总和必须等于 totalTurns', { expected: raw.totalTurns, actual: summedTurns });
  }
  return {
    schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU,
    title: requireText_ACU(raw.title, 'outline.title'),
    goal: requireText_ACU(raw.goal, 'outline.goal'),
    totalTurns: raw.totalTurns,
    nodes,
  };
}

function flattenTurns_ACU(outline: StageOutline_ACU): StageTurn_ACU[] {
  return outline.nodes.flatMap(node => node.turns);
}

/** Ensures a replan preserves completed turns and allocates exactly the remaining quota. */
export function validateReplannedStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU, constraints: ContinuationReplanConstraints_ACU): StageOutline_ACU {
  if (!Number.isInteger(constraints.completedTurns) || constraints.completedTurns < 0 || !Number.isInteger(constraints.expectedRemainingTurns) || constraints.expectedRemainingTurns < 0) {
    fail_ACU('CONTINUATION_REPLAN_CONTEXT_INVALID', 'replan', '重新规划约束必须包含非负整数');
  }
  const previousTurns = flattenTurns_ACU(constraints.previousOutline);
  if (constraints.completedTurns > previousTurns.length) {
    fail_ACU('CONTINUATION_REPLAN_CONTEXT_INVALID', 'replan', '已完成轮数超过旧 revision 的轮次总数', { completedTurns: constraints.completedTurns, totalTurns: previousTurns.length });
  }
  const outline = validateStageOutline_ACU(raw, range);
  const candidateTurns = flattenTurns_ACU(outline);
  const completedPrefix = previousTurns.slice(0, constraints.completedTurns);
  if (candidateTurns.length < completedPrefix.length) {
    fail_ACU('CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED', 'replan', '重新规划结果缺少已完成轮次');
  }
  for (let index = 0; index < completedPrefix.length; index += 1) {
    const expected = completedPrefix[index];
    const actual = candidateTurns[index];
    if (actual.id !== expected.id || actual.goal !== expected.goal) {
      fail_ACU('CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED', 'replan', '重新规划不得修改已完成轮次', { index, expectedId: expected.id, actualId: actual.id });
    }
  }
  const remainingTurns = candidateTurns.length - completedPrefix.length;
  if (remainingTurns !== constraints.expectedRemainingTurns) {
    fail_ACU('CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH', 'replan', '重新规划结果的剩余轮数不符合额度', { expected: constraints.expectedRemainingTurns, actual: remainingTurns });
  }
  return outline;
}

import { CONTINUATION_TURN_RANGES_ACU } from './defaults';
import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  STAGE_TURN_DOWNTIME_PACINGS_ACU,
  STAGE_TURN_PACINGS_ACU,
  type ContinuationErrorCode_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationReplanConstraints_ACU,
  type ContinuationStageSize_ACU,
  type ContinuationTurnRange_ACU,
  type StageNode_ACU,
  type StageOutline_ACU,
  type StageTurn_ACU,
  type StageTurnPacing_ACU,
} from './model';

const OUTLINE_KEYS_ACU = ['schemaVersion', 'title', 'goal', 'totalTurns', 'nodes'] as const;
const NODE_KEYS_ACU = ['id', 'title', 'goal', 'suggestedTurns', 'turns'] as const;
const TURN_KEYS_ACU = ['id', 'goal'] as const;
/**
 * pacing 晚于 turn 的其余字段加入。信封每次加载都会对所有历史 revision 重跑本校验器，
 * 写成必填会让全部存量任务加载即失败，因此它是可选键：缺失时回填 pressure。
 */
const TURN_OPTIONAL_KEYS_ACU = ['pacing'] as const;
const DEFAULT_TURN_PACING_ACU: StageTurnPacing_ACU = 'pressure';

/** 连续高压（pressure / turn）轮的上限。超过这个长度，读者对紧张的感知会钝化。 */
export const STAGE_MAX_CONSECUTIVE_PRESSURE_TURNS_ACU = 3;

function fail_ACU(code: ContinuationErrorCode_ACU, phase: ContinuationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string, optionalKeys: readonly string[] = []): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail_ACU('CONTINUATION_OUTLINE_FIELD_MISSING', 'outline_validate', `缺少必填字段：${path}.${key}`, { path: `${path}.${key}` });
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optionalKeys.includes(key)) {
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

/**
 * 读取轮次节奏档。缺失回填 pressure（迁移路径），但写错枚举值要报错而不是静默回填——
 * 静默回填会让模型永远不知道自己写错了，节奏标注就变成随机的。
 */
function requirePacing_ACU(value: unknown, path: string): StageTurnPacing_ACU {
  if (value === undefined) return DEFAULT_TURN_PACING_ACU;
  if (typeof value !== 'string' || !(STAGE_TURN_PACINGS_ACU as readonly string[]).includes(value)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `节奏档必须是 ${STAGE_TURN_PACINGS_ACU.join(' / ')} 之一：${path}`, { path, actual: value });
  }
  return value as StageTurnPacing_ACU;
}

function validateTurn_ACU(raw: unknown, path: string): StageTurn_ACU {
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是对象：${path}`, { path });
  }
  assertExactKeys_ACU(raw, TURN_KEYS_ACU, path, TURN_OPTIONAL_KEYS_ACU);
  return { id: requireText_ACU(raw.id, `${path}.id`), goal: requireText_ACU(raw.goal, `${path}.goal`), pacing: requirePacing_ACU(raw.pacing, `${path}.pacing`) };
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

/** 展开一份大纲的全部轮次，供节奏校验与外部渲染共用。 */
export function listStageOutlineTurns_ACU(outline: StageOutline_ACU): StageTurn_ACU[] {
  return flattenTurns_ACU(outline);
}

export interface StageOutlinePacingOptions_ACU {
  /** 低压轮（setup + cooldown）的最低占比。0 表示关闭占比校验。 */
  downtimeTurnRatio: number;
  /**
   * 跳过前 N 轮不参与校验。重规划时传已完成轮数：已完成前缀不可改，其中还混着迁移回填的
   * pressure，把它算进来会让重规划永远无法满足配比要求。
   */
  skipTurns?: number;
}

function describePacingLabels_ACU(turns: readonly StageTurn_ACU[], offset: number): string {
  return turns.map((turn, index) => `第${offset + index + 1}轮=${turn.pacing}`).join('、');
}

/**
 * 校验一份大纲的节奏配比。
 *
 * 与 validateStageOutline_ACU 分开调用而不是并入其中：结构校验在每次信封加载时对所有历史
 * revision 重跑，节奏规则是新增约束，并进去会让存量任务直接加载失败。它只用在生成链路上，
 * 目的是让模型经 $VALIDATION_ERRORS 自愈。
 * @param turns 待校验的全部轮次（按阶段内顺序）
 * @param options 占比要求与跳过的前缀轮数
 */
export function validateStageOutlinePacing_ACU(turns: readonly StageTurn_ACU[], options: StageOutlinePacingOptions_ACU): void {
  const skip = Math.max(0, Math.min(options.skipTurns ?? 0, turns.length));
  const scope = turns.slice(skip);
  if (!scope.length) return;
  const labels = describePacingLabels_ACU(scope, skip);

  const ratio = Number.isFinite(options.downtimeTurnRatio) ? Math.max(0, options.downtimeTurnRatio) : 0;
  const required = Math.ceil(scope.length * ratio);
  if (required > 0) {
    const actual = scope.filter(turn => STAGE_TURN_DOWNTIME_PACINGS_ACU.includes(turn.pacing)).length;
    if (actual < required) {
      fail_ACU(
        'CONTINUATION_OUTLINE_PACING_INVALID',
        'outline_validate',
        `低压轮不足：本次规划的 ${scope.length} 轮里至少要有 ${required} 轮标为 setup 或 cooldown，实际只有 ${actual} 轮。请把其中 ${required - actual} 轮改成铺垫日常或余波消化——写关系推进、生活场景、情绪落地，不要再安排新的外部危机。当前各轮节奏：${labels}`,
        { scopeTurns: scope.length, required, actual, ratio, skippedTurns: skip, labels },
      );
    }
  }

  let streak = 0;
  for (let index = 0; index < scope.length; index += 1) {
    const pacing = scope[index].pacing;
    streak = pacing === 'pressure' || pacing === 'turn' ? streak + 1 : 0;
    if (streak > STAGE_MAX_CONSECUTIVE_PRESSURE_TURNS_ACU) {
      const startTurnNumber = skip + index - STAGE_MAX_CONSECUTIVE_PRESSURE_TURNS_ACU + 1;
      fail_ACU(
        'CONTINUATION_OUTLINE_PACING_INVALID',
        'outline_validate',
        `连续高压轮超限：从第 ${startTurnNumber} 轮起连续 ${streak} 轮都是 pressure 或 turn，上限为 ${STAGE_MAX_CONSECUTIVE_PRESSURE_TURNS_ACU} 轮。请在第 ${skip + index + 1} 轮之前插入一轮 setup 或 cooldown 让读者喘口气。当前各轮节奏：${labels}`,
        { startTurnNumber, streak, limit: STAGE_MAX_CONSECUTIVE_PRESSURE_TURNS_ACU, skippedTurns: skip, labels },
      );
    }
  }
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

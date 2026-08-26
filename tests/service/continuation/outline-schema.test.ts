import { describe, expect, it } from 'vitest';

import {
  buildDefaultContinuationSettings_ACU,
  normalizeContinuationInternalAiRetryLimit_ACU,
  normalizeContinuationMaxAutomaticStages_ACU,
} from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import {
  resolveContinuationTurnRange_ACU,
  validateReplannedStageOutline_ACU,
  validateStageOutline_ACU,
} from '../../../src/service/continuation/outline-schema';

function buildOutline_ACU(totalTurns = 6) {
  return {
    schemaVersion: 1,
    title: '阶段标题',
    goal: '阶段目标',
    totalTurns,
    nodes: [
      {
        id: 'node-1',
        title: '节点一',
        goal: '节点目标一',
        suggestedTurns: totalTurns,
        turns: Array.from({ length: totalTurns }, (_, index) => ({
          id: `turn-${index + 1}`,
          goal: `轮次目标 ${index + 1}`,
        })),
      },
    ],
  };
}

function expectValidationCode_ACU(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected validation error ${code}`);
}

describe('Continuation outline schema', () => {
  it.each([
    ['short', undefined, undefined, { min: 3, max: 5 }],
    ['standard', undefined, undefined, { min: 6, max: 10 }],
    ['long', undefined, undefined, { min: 11, max: 20 }],
    ['custom', 1, 50, { min: 1, max: 50 }],
  ] as const)('resolves %s turn range strictly', (stageSize, min, max, expected) => {
    expect(resolveContinuationTurnRange_ACU(stageSize, min, max)).toEqual(expected);
  });

  it.each([
    ['short', 3, resolveContinuationTurnRange_ACU('short')],
    ['standard', 6, resolveContinuationTurnRange_ACU('standard')],
    ['long', 11, resolveContinuationTurnRange_ACU('long')],
    ['custom', 1, resolveContinuationTurnRange_ACU('custom', 1, 50)],
  ] as const)('accepts a %s outline at its lower bound', (_stageSize, totalTurns, range) => {
    const outline = validateStageOutline_ACU(buildOutline_ACU(totalTurns), range);

    expect(outline.totalTurns).toBe(totalTurns);
  });

  it('rejects invalid custom ranges instead of coercing them', () => {
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 0, 5), 'CONTINUATION_CUSTOM_RANGE_INVALID');
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 3, 2), 'CONTINUATION_CUSTOM_RANGE_INVALID');
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 1.5, 5), 'CONTINUATION_CUSTOM_RANGE_INVALID');
  });

  it('accepts a complete outline and returns a newly assembled value', () => {
    const raw = buildOutline_ACU();
    const validated = validateStageOutline_ACU(raw, resolveContinuationTurnRange_ACU('standard'));

    expect(validated).toEqual(raw);
    expect(validated).not.toBe(raw);
    expect(validated.nodes).not.toBe(raw.nodes);
  });

  it('rejects undefined required values before a clone could discard them', () => {
    const raw = buildOutline_ACU() as Record<string, unknown>;
    raw.title = undefined;

    expectValidationCode_ACU(() => validateStageOutline_ACU(raw, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
  });

  it('rejects unknown fields, duplicate ids and inconsistent turn totals', () => {
    const unknownField = buildOutline_ACU() as Record<string, unknown>;
    unknownField.unexpected = true;
    expectValidationCode_ACU(() => validateStageOutline_ACU(unknownField, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_UNKNOWN_FIELD');

    const duplicateNode = buildOutline_ACU();
    duplicateNode.nodes.push({
      id: 'node-1',
      title: '重复节点',
      goal: '重复节点目标',
      suggestedTurns: 1,
      turns: [{ id: 'turn-7', goal: '额外轮次' }],
    });
    duplicateNode.totalTurns = 7;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateNode, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_ID_DUPLICATE');

    const duplicateTurn = buildOutline_ACU();
    duplicateTurn.nodes.push({
      id: 'node-2',
      title: '节点二',
      goal: '节点目标二',
      suggestedTurns: 1,
      turns: [{ id: 'turn-1', goal: '重复轮次' }],
    });
    duplicateTurn.totalTurns = 7;
    duplicateTurn.nodes[0].suggestedTurns = 6;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateTurn, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_TURN_ID_DUPLICATE');

    const mismatch = buildOutline_ACU();
    mismatch.nodes[0].suggestedTurns = 5;
    expectValidationCode_ACU(() => validateStageOutline_ACU(mismatch, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH');
  });

  it('enforces replan completed-prefix and remaining-turn invariants', () => {
    const previous = validateStageOutline_ACU(buildOutline_ACU(), resolveContinuationTurnRange_ACU('standard'));
    const constraints = { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 };

    expect(validateReplannedStageOutline_ACU(buildOutline_ACU(), resolveContinuationTurnRange_ACU('standard'), constraints)).toEqual(previous);

    const rewritten = buildOutline_ACU();
    rewritten.nodes[0].turns[1].goal = '篡改已完成目标';
    expectValidationCode_ACU(() => validateReplannedStageOutline_ACU(rewritten, resolveContinuationTurnRange_ACU('standard'), constraints), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');

    expectValidationCode_ACU(() => validateReplannedStageOutline_ACU(buildOutline_ACU(), resolveContinuationTurnRange_ACU('standard'), { ...constraints, expectedRemainingTurns: 3 }), 'CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH');
  });
});

describe('Continuation defaults', () => {
  it('keeps required default settings and independent prompt arrays', () => {
    const first = buildDefaultContinuationSettings_ACU();
    const second = buildDefaultContinuationSettings_ACU();

    expect(first.stageSize).toBe('standard');
    expect(first.outlinePreview).toBe(false);
    expect(first.autoNextStage).toBe(true);
    expect(first.maxAutomaticStages).toBe(6);
    expect(first.internalAiRetryLimit).toBe(3);
    expect(first.apiPresetMode).toBe('current');
    expect(first.outlinePrompt[0].content).toContain('严格的 JSON 对象');
    expect(first.agentPrompts.main[0].content).toContain('主控 Agent');
    expect(first.agentPrompts.maintainer[0].content).toContain('伏笔与认知维护子代理');
    expect(first.agentPrompts.mainlinePlanner[0].content).toContain('主线推进策划子代理');
    expect(first.agentPrompts.beatPlanner[0].content).toContain('伏笔与节拍策划子代理');
    expect(first.agentPrompts.reviewer[0].content).toContain('连续性审查子代理');

    first.outlinePrompt[0].content = 'modified';
    first.agentPrompts.main[0].content = 'modified';
    expect(second.outlinePrompt[0].content).not.toBe('modified');
    expect(second.agentPrompts.main[0].content).not.toBe('modified');
  });

  it('distinguishes missing settings, explicit zero, and invalid numeric values', () => {
    expect(normalizeContinuationInternalAiRetryLimit_ACU(undefined)).toBe(3);
    expect(normalizeContinuationInternalAiRetryLimit_ACU(0)).toBe(0);
    expectValidationCode_ACU(() => normalizeContinuationInternalAiRetryLimit_ACU(-1), 'CONTINUATION_CONFIG_OUT_OF_RANGE');
    expectValidationCode_ACU(() => normalizeContinuationInternalAiRetryLimit_ACU(1.5), 'CONTINUATION_CONFIG_NOT_INTEGER');

    expect(normalizeContinuationMaxAutomaticStages_ACU(undefined)).toBe(6);
    expect(normalizeContinuationMaxAutomaticStages_ACU(1)).toBe(1);
    expectValidationCode_ACU(() => normalizeContinuationMaxAutomaticStages_ACU(0), 'CONTINUATION_CONFIG_OUT_OF_RANGE');
  });
});

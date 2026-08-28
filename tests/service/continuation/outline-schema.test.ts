import { describe, expect, it } from 'vitest';

import {
  buildDefaultContinuationSettings_ACU,
  normalizeContinuationInternalAiRetryLimit_ACU,
  normalizeContinuationMaxAutomaticStages_ACU,
} from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import {
  listStageOutlineTurns_ACU,
  resolveContinuationTurnRange_ACU,
  validateReplannedStageOutline_ACU,
  validateStageOutline_ACU,
  validateStageOutlinePacing_ACU,
} from '../../../src/service/continuation/outline-schema';
import type { StageTurnPacing_ACU } from '../../../src/service/continuation/model';

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
          pacing: 'pressure' as StageTurnPacing_ACU,
        })),
      },
    ],
  };
}

function turns_ACU(pacings: readonly StageTurnPacing_ACU[]) {
  return pacings.map((pacing, index) => ({ id: `turn-${index + 1}`, goal: `轮次目标 ${index + 1}`, pacing }));
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
      turns: [{ id: 'turn-7', goal: '额外轮次', pacing: 'pressure' as StageTurnPacing_ACU }],
    });
    duplicateNode.totalTurns = 7;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateNode, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_ID_DUPLICATE');

    const duplicateTurn = buildOutline_ACU();
    duplicateTurn.nodes.push({
      id: 'node-2',
      title: '节点二',
      goal: '节点目标二',
      suggestedTurns: 1,
      turns: [{ id: 'turn-1', goal: '重复轮次', pacing: 'pressure' as StageTurnPacing_ACU }],
    });
    duplicateTurn.totalTurns = 7;
    duplicateTurn.nodes[0].suggestedTurns = 6;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateTurn, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_TURN_ID_DUPLICATE');

    const mismatch = buildOutline_ACU();
    mismatch.nodes[0].suggestedTurns = 5;
    expectValidationCode_ACU(() => validateStageOutline_ACU(mismatch, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH');
  });

  it('把 pacing 当可选键：存量大纲缺字段时回填 pressure，写错枚举值则报错', () => {
    const legacy = buildOutline_ACU(3) as Record<string, any>;
    for (const turn of legacy.nodes[0].turns) delete turn.pacing;

    const migrated = validateStageOutline_ACU(legacy, resolveContinuationTurnRange_ACU('short'));
    expect(migrated.nodes[0].turns.map(turn => turn.pacing)).toEqual(['pressure', 'pressure', 'pressure']);

    const bogus = buildOutline_ACU(3) as Record<string, any>;
    bogus.nodes[0].turns[0].pacing = 'fast';
    expectValidationCode_ACU(() => validateStageOutline_ACU(bogus, resolveContinuationTurnRange_ACU('short')), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
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

describe('validateStageOutlinePacing_ACU', () => {
  const ratio = 0.3;

  it('低压轮占比按 ceil 取整，刚好满足时放行、差一轮时报错并给出实际占比', () => {
    // 6 轮 × 0.3 → 至少 2 轮低压。
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['setup', 'pressure', 'pressure', 'turn', 'cooldown', 'pressure']), { downtimeTurnRatio: ratio })).not.toThrow();

    try {
      validateStageOutlinePacing_ACU(turns_ACU(['setup', 'pressure', 'pressure', 'turn', 'pressure', 'pressure']), { downtimeTurnRatio: ratio });
      throw new Error('expected pacing rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      const failure = (error as ContinuationValidationError_ACU).error;
      expect(failure.code).toBe('CONTINUATION_OUTLINE_PACING_INVALID');
      expect(failure.phase).toBe('outline_validate');
      expect(failure.details).toMatchObject({ scopeTurns: 6, required: 2, actual: 1 });
      expect(String(failure.details?.labels)).toContain('第1轮=setup');
    }
  });

  it('3 轮短阶段按默认比例至少要有 1 轮低压', () => {
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'turn', 'pressure']), { downtimeTurnRatio: ratio }), 'CONTINUATION_OUTLINE_PACING_INVALID');
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'cooldown', 'pressure']), { downtimeTurnRatio: ratio })).not.toThrow();
  });

  it('比例为 0 时整条占比规则关闭', () => {
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'pressure', 'pressure']), { downtimeTurnRatio: 0 })).not.toThrow();
  });

  it('连续高压超过三轮报错，插入一轮低压后放行', () => {
    try {
      validateStageOutlinePacing_ACU(turns_ACU(['setup', 'pressure', 'turn', 'pressure', 'pressure', 'cooldown']), { downtimeTurnRatio: ratio });
      throw new Error('expected pacing rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      const failure = (error as ContinuationValidationError_ACU).error;
      expect(failure.code).toBe('CONTINUATION_OUTLINE_PACING_INVALID');
      expect(failure.details).toMatchObject({ startTurnNumber: 2, streak: 4, limit: 3 });
    }

    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['setup', 'pressure', 'turn', 'pressure', 'cooldown', 'pressure']), { downtimeTurnRatio: ratio })).not.toThrow();
  });

  it('重规划只校验剩余轮次：已完成前缀里的高压轮不计入', () => {
    // 前 4 轮是迁移回填的 pressure，全量校验必然违规；跳过后剩余 3 轮自身合规。
    const all = turns_ACU(['pressure', 'pressure', 'pressure', 'pressure', 'setup', 'pressure', 'cooldown']);
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(all, { downtimeTurnRatio: ratio }), 'CONTINUATION_OUTLINE_PACING_INVALID');
    expect(() => validateStageOutlinePacing_ACU(all, { downtimeTurnRatio: ratio, skipTurns: 4 })).not.toThrow();
  });

  it('剩余轮次为空时直接放行，不做除零判断', () => {
    const all = turns_ACU(['pressure', 'pressure']);
    expect(() => validateStageOutlinePacing_ACU(all, { downtimeTurnRatio: ratio, skipTurns: 2 })).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU(all, { downtimeTurnRatio: ratio, skipTurns: 99 })).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU([], { downtimeTurnRatio: ratio })).not.toThrow();
  });

  it('listStageOutlineTurns_ACU 按阶段内顺序展开全部轮次', () => {
    const outline = validateStageOutline_ACU(buildOutline_ACU(6), resolveContinuationTurnRange_ACU('standard'));
    expect(listStageOutlineTurns_ACU(outline).map(turn => turn.id)).toEqual(['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6']);
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
    expect(first.outlinePrompt[0].content).toContain('<stage_title>');
    expect(first.downtimeTurnRatio).toBe(0.3);
    expect(first.agentPrompts.main[0].content).toContain('主控 Agent');
    expect(first.agentPrompts.arcArchitect[0].content).toContain('故事总纲子代理');
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

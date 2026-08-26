import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type StageOutline_ACU } from '../../../src/service/continuation/model';
import { ContinuationOutlinePlanner_ACU, acceptPlannedStageRevision_ACU, createPlannedStageRevision_ACU, freezePlannedStageRevision_ACU } from '../../../src/service/continuation/outline-planner';

function buildOutline_ACU(totalTurns = 6): StageOutline_ACU {
  return { schemaVersion: 1, title: '阶段标题', goal: '阶段目标', totalTurns, nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: totalTurns, turns: Array.from({ length: totalTurns }, (_, index) => ({ id: `turn-${index + 1}`, goal: `目标 ${index + 1}` })) }] };
}

function createPlanner_ACU(outputs: Array<string | Error>, resolveApiPresetOverride?: () => any) {
  const callInternalAi = vi.fn(async () => {
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    return output ?? '';
  });
  const resolveApiPreset = vi.fn(resolveApiPresetOverride ?? (() => ({ presetName: 'preset-a', source: 'fixed' as const, reason: 'fixed_preset' as const, apiMode: 'custom' as const, apiConfig: { url: 'https://example.invalid', apiKey: '', model: 'test', useMainApi: false, max_tokens: 1, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: '' })));
  return { planner: new ContinuationOutlinePlanner_ACU({ callInternalAi, resolveApiPreset } as any), callInternalAi, resolveApiPreset };
}

function settings_ACU(retries = 3) {
  return { ...buildDefaultContinuationSettings_ACU(), apiPresetMode: 'fixed' as const, fixedApiPresetName: 'preset-a', internalAiRetryLimit: retries, outlinePrompt: [{ role: 'user', content: '$ORIGIN_INSTRUCTION $VALIDATION_ERRORS' }] };
}

function request_ACU(settings = settings_ACU(), overrides: Record<string, unknown> = {}) {
  return {
    settings,
    reason: 'initial' as const,
    createInternalRequestIdentity: (attempt: number) => ({ source: 'outline' as const, requestId: `outline-${attempt}`, chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1 }),
    isInternalRequestCurrent: () => true,
    ...overrides,
  };
}

async function expectCode_ACU(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('ContinuationOutlinePlanner_ACU', () => {
  it('renders the strict prompt and returns a validated outline on the first call', async () => {
    const { planner, callInternalAi, resolveApiPreset } = createPlanner_ACU([JSON.stringify(buildOutline_ACU())]);
    const result = await planner.plan(request_ACU(settings_ACU(), { resolvers: { $ORIGIN_INSTRUCTION: () => '推进剧情' } }));
    expect(result).toMatchObject({ outline: buildOutline_ACU(), attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed' } });
    expect(callInternalAi).toHaveBeenCalledWith([{ role: 'user', content: '推进剧情 ' }], expect.any(Object), expect.objectContaining({ source: 'outline', requestId: 'outline-0' }));
    expect(resolveApiPreset).toHaveBeenCalledTimes(1);
  });

  it('retries malformed output with a compact validation error and never parses markdown heuristically', async () => {
    const { planner, callInternalAi } = createPlanner_ACU(['```json\n{}\n```', JSON.stringify(buildOutline_ACU())]);
    const result = await planner.plan(request_ACU(settings_ACU(1), { resolvers: { $ORIGIN_INSTRUCTION: () => '继续' } }));
    expect(result.attempts).toBe(2);
    expect(callInternalAi).toHaveBeenCalledTimes(2);
    expect(callInternalAi.mock.calls[1][0][0].content).toContain('CONTINUATION_OUTLINE_JSON_INVALID@outline_parse');
  });

  it('retries strict schema violations with the validation error rather than accepting a partial outline', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([JSON.stringify({ schemaVersion: 1 }), JSON.stringify(buildOutline_ACU())]);
    await expect(planner.plan(request_ACU(settings_ACU(1)))).resolves.toMatchObject({ attempts: 2, outline: buildOutline_ACU() });
    expect(callInternalAi.mock.calls[1][0][0].content).toContain('CONTINUATION_OUTLINE_FIELD_MISSING@outline_validate');
  });

  it('counts the first call separately and stops after the configured retry limit', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([new Error('offline'), new Error('offline')]);
    await expectCode_ACU(() => planner.plan(request_ACU(settings_ACU(1))), 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED');
    expect(callInternalAi).toHaveBeenCalledTimes(2);
  });

  it('treats explicit zero as no automatic retry', async () => {
    const { planner, callInternalAi } = createPlanner_ACU(['not-json']);
    await expectCode_ACU(() => planner.plan(request_ACU(settings_ACU(0))), 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED');
    expect(callInternalAi).toHaveBeenCalledTimes(1);
  });

  it('does not call internal AI when preset resolution fails closed', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([JSON.stringify(buildOutline_ACU())], () => { throw new ContinuationValidationError_ACU({ code: 'CONTINUATION_API_PRESET_MISSING', phase: 'outline_call', message: 'missing', retryable: false }); });
    await expectCode_ACU(() => planner.plan(request_ACU()), 'CONTINUATION_API_PRESET_MISSING');
    expect(callInternalAi).not.toHaveBeenCalled();
  });

  it('rejects an outline result that becomes stale after dispatch without retrying', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([JSON.stringify(buildOutline_ACU())]);
    let checks = 0;
    await expectCode_ACU(
      () => planner.plan(request_ACU(settings_ACU(3), { isInternalRequestCurrent: () => ++checks === 1 })),
      'CONTINUATION_INTERNAL_REQUEST_STALE',
    );
    expect(callInternalAi).toHaveBeenCalledTimes(1);
  });

  it('enforces replan constraints and keeps preview revisions mutable until explicitly frozen', async () => {
    const previous = buildOutline_ACU();
    const { planner } = createPlanner_ACU([JSON.stringify(previous)]);
    const result = await planner.plan(request_ACU({ ...settings_ACU(), outlinePreview: true }, { reason: 'manual_replan', replanConstraints: { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 } }));
    const planned = createPlannedStageRevision_ACU(result.outline, 2, 'manual_replan', '收束', 123);
    const frozen = freezePlannedStageRevision_ACU(planned);
    expect(result.requiresReview).toBe(true);
    expect(planned).toMatchObject({ frozen: false, revision: 2, createdAt: 123 });
    expect(frozen).toMatchObject({ frozen: true, revision: 2 });
    expect(frozen.outline).not.toBe(planned.outline);

    const edited = { ...planned, outline: { ...planned.outline, title: '用户编辑标题' } };
    expect(acceptPlannedStageRevision_ACU(edited, settings_ACU(), { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 }))
      .toMatchObject({ frozen: true, outline: { title: '用户编辑标题' } });
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(frozen, settings_ACU()), 'CONTINUATION_REVISION_FROZEN');

    const invalidEdited = { ...planned, outline: { ...planned.outline, totalTurns: 5 } };
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(invalidEdited, settings_ACU(), { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 }), 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE');
    const rewrittenCompleted = { ...planned, outline: { ...planned.outline, nodes: [{ ...planned.outline.nodes[0], turns: [{ ...planned.outline.nodes[0].turns[0], goal: '篡改已完成轮次' }, ...planned.outline.nodes[0].turns.slice(1)] }] } };
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(rewrittenCompleted, settings_ACU(), { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 }), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');
  });
});

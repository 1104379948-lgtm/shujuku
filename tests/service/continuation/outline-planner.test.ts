import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type StageOutline_ACU } from '../../../src/service/continuation/model';
import { ContinuationOutlinePlanner_ACU, acceptPlannedStageRevision_ACU, createPlannedStageRevision_ACU, freezePlannedStageRevision_ACU } from '../../../src/service/continuation/outline-planner';

function buildOutline_ACU(totalTurns = 6): StageOutline_ACU {
  return { schemaVersion: 1, title: '阶段标题', goal: '阶段目标', totalTurns, nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: totalTurns, turns: Array.from({ length: totalTurns }, (_, index) => ({ id: `turn-${index + 1}`, goal: `目标 ${index + 1}` })) }] };
}

function tagOutline_ACU(turnCount = 6, title = '阶段标题'): string {
  const turns = Array.from({ length: turnCount }, (_, index) => `<turn>目标 ${index + 1}</turn>`).join('\n');
  return `<stage_title>${title}</stage_title>\n<stage_goal>阶段目标</stage_goal>\n<node>\n<node_title>节点</node_title>\n<node_goal>节点目标</node_goal>\n${turns}\n</node>`;
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
  let counter = 0;
  return {
    settings,
    reason: 'initial' as const,
    createInternalRequestIdentity: (attempt: number) => ({ source: 'outline' as const, requestId: `outline-${attempt}`, chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1 }),
    isInternalRequestCurrent: () => true,
    allocateId: (prefix: string) => `${prefix}-fresh-${++counter}`,
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
  it('builds a validated outline from tag output with runtime-generated structure', async () => {
    const { planner, callInternalAi, resolveApiPreset } = createPlanner_ACU([tagOutline_ACU(6)]);
    const result = await planner.plan(request_ACU(settings_ACU(), { resolvers: { $ORIGIN_INSTRUCTION: () => '推进剧情' } }));
    expect(result).toMatchObject({ attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed' } });
    expect(result.outline).toMatchObject({ schemaVersion: 1, title: '阶段标题', goal: '阶段目标', totalTurns: 6 });
    expect(result.outline.nodes).toHaveLength(1);
    expect(result.outline.nodes[0]).toMatchObject({ id: 'node-fresh-1', suggestedTurns: 6 });
    expect(result.outline.nodes[0].turns.map(turn => turn.id)).toEqual(['turn-fresh-2', 'turn-fresh-3', 'turn-fresh-4', 'turn-fresh-5', 'turn-fresh-6', 'turn-fresh-7']);
    expect(callInternalAi).toHaveBeenCalledWith([{ role: 'user', content: '推进剧情 ' }], expect.any(Object), expect.objectContaining({ source: 'outline', requestId: 'outline-0' }));
    expect(resolveApiPreset).toHaveBeenCalledTimes(1);
  });

  it('parses tags surrounded by reasoning prose and markdown fences', async () => {
    const { planner } = createPlanner_ACU([`先写思路：这一阶段要做铺垫。\n\`\`\`xml\n${tagOutline_ACU(6)}\n\`\`\`\n以上是本阶段规划。`]);
    const result = await planner.plan(request_ACU());
    expect(result.outline.totalTurns).toBe(6);
  });

  it('retries untagged output and feeds back a compact error with the reason message', async () => {
    const { planner, callInternalAi } = createPlanner_ACU(['这段返回没有任何标签', tagOutline_ACU(6)]);
    const result = await planner.plan(request_ACU(settings_ACU(1), { resolvers: { $ORIGIN_INSTRUCTION: () => '继续' } }));
    expect(result.attempts).toBe(2);
    expect(callInternalAi).toHaveBeenCalledTimes(2);
    const retryContent = callInternalAi.mock.calls[1][0][0].content as string;
    expect(retryContent).toContain('CONTINUATION_OUTLINE_JSON_INVALID@outline_parse');
    expect(retryContent).toContain('<node>');
  });

  it('retries range violations with the validation error rather than accepting a short outline', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([tagOutline_ACU(2), tagOutline_ACU(6)]);
    await expect(planner.plan(request_ACU(settings_ACU(1)))).resolves.toMatchObject({ attempts: 2, outline: { totalTurns: 6 } });
    const retryContent = callInternalAi.mock.calls[1][0][0].content as string;
    expect(retryContent).toContain('CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE@outline_validate');
    // 回灌必须带具体数字（min/max/actual），否则模型只能瞎猜再撞一次墙。
    expect(retryContent).toContain('"min":6');
    expect(retryContent).toContain('"max":10');
    expect(retryContent).toContain('"actual":2');
  });

  it('injects the authoritative $TURN_RANGE text so the model knows the stage size up front', async () => {
    const rangeSettings = { ...settings_ACU(), outlinePrompt: [{ role: 'user' as const, content: '阶段轮数范围：$TURN_RANGE' }] };
    const { planner, callInternalAi } = createPlanner_ACU([tagOutline_ACU(6)]);
    await planner.plan(request_ACU(rangeSettings));
    const content = callInternalAi.mock.calls[0][0][0].content as string;
    expect(content).toContain('必须在 6 到 10 之间');
  });

  it('tells the model the remaining-turn window on replan instead of only the stage total', async () => {
    const rangeSettings = { ...settings_ACU(), outlinePrompt: [{ role: 'user' as const, content: '范围：$TURN_RANGE' }] };
    const remainingOnly = '<node>\n<node_title>剩余</node_title>\n<node_goal>目标</node_goal>\n<turn>1</turn>\n<turn>2</turn>\n<turn>3</turn>\n<turn>4</turn>\n</node>';
    const { planner, callInternalAi } = createPlanner_ACU([remainingOnly]);
    await planner.plan(request_ACU(rangeSettings, {
      reason: 'manual_replan',
      replanConstraints: { previousOutline: buildOutline_ACU(6), completedTurns: 2, expectedRemainingTurns: 4 },
    }));
    const content = callInternalAi.mock.calls[0][0][0].content as string;
    expect(content).toContain('必须在 6 到 10 之间');
    expect(content).toContain('已完成 2 轮不可改动');
    expect(content).toContain('剩余的 <turn> 数量必须在 4 到 8 之间');
  });

  it('counts the first call separately and stops after the configured retry limit', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([new Error('offline'), new Error('offline')]);
    await expectCode_ACU(() => planner.plan(request_ACU(settings_ACU(1))), 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED');
    expect(callInternalAi).toHaveBeenCalledTimes(2);
  });

  it('treats explicit zero as no automatic retry', async () => {
    const { planner, callInternalAi } = createPlanner_ACU(['not-tags']);
    await expectCode_ACU(() => planner.plan(request_ACU(settings_ACU(0))), 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED');
    expect(callInternalAi).toHaveBeenCalledTimes(1);
  });

  it('does not call internal AI when preset resolution fails closed', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([tagOutline_ACU(6)], () => { throw new ContinuationValidationError_ACU({ code: 'CONTINUATION_API_PRESET_MISSING', phase: 'outline_call', message: 'missing', retryable: false }); });
    await expectCode_ACU(() => planner.plan(request_ACU()), 'CONTINUATION_API_PRESET_MISSING');
    expect(callInternalAi).not.toHaveBeenCalled();
  });

  it('rejects an outline result that becomes stale after dispatch without retrying', async () => {
    const { planner, callInternalAi } = createPlanner_ACU([tagOutline_ACU(6)]);
    let checks = 0;
    await expectCode_ACU(
      () => planner.plan(request_ACU(settings_ACU(3), { isInternalRequestCurrent: () => ++checks === 1 })),
      'CONTINUATION_INTERNAL_REQUEST_STALE',
    );
    expect(callInternalAi).toHaveBeenCalledTimes(1);
  });

  it('splices the completed prefix back on replan and allows a different remaining quota', async () => {
    const previous = buildOutline_ACU(6);
    const remainingOnly = '<node>\n<node_title>改写节点</node_title>\n<node_goal>改写目标</node_goal>\n<turn>新目标 1</turn>\n<turn>新目标 2</turn>\n<turn>新目标 3</turn>\n<turn>新目标 4</turn>\n<turn>新目标 5</turn>\n</node>';
    const { planner } = createPlanner_ACU([remainingOnly]);
    const result = await planner.plan(request_ACU(settings_ACU(), {
      reason: 'manual_replan',
      replanConstraints: { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 },
    }));
    // 前缀逐字保留：原 node/turn id 与 goal 不变，截断处 suggestedTurns 重算。
    expect(result.outline.nodes[0]).toMatchObject({ id: 'node-1', suggestedTurns: 2 });
    expect(result.outline.nodes[0].turns).toEqual([{ id: 'turn-1', goal: '目标 1' }, { id: 'turn-2', goal: '目标 2' }]);
    // 剩余额度放宽：旧额度 4 轮，模型给了 5 轮，拼接后 7 轮仍在 standard 范围内。
    expect(result.outline.totalTurns).toBe(7);
    expect(result.outline.nodes[1]).toMatchObject({ title: '改写节点', suggestedTurns: 5 });
    // 模型未重述阶段标题/目标时沿用旧值。
    expect(result.outline).toMatchObject({ title: '阶段标题', goal: '阶段目标' });
  });

  it('still rejects a replan whose spliced total leaves the stage range', async () => {
    const previous = buildOutline_ACU(6);
    const { planner, callInternalAi } = createPlanner_ACU([
      '<node><node_goal>目标</node_goal><turn>仅一轮</turn></node>',
      '<node><node_title>补足</node_title><node_goal>目标</node_goal><turn>1</turn><turn>2</turn><turn>3</turn><turn>4</turn></node>',
    ]);
    const result = await planner.plan(request_ACU(settings_ACU(1), {
      reason: 'manual_replan',
      replanConstraints: { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 },
    }));
    expect(result.attempts).toBe(2);
    expect(callInternalAi.mock.calls[1][0][0].content).toContain('CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE@outline_validate');
    expect(result.outline.totalTurns).toBe(6);
  });

  it('keeps preview revisions mutable until explicitly frozen and revalidates user edits', async () => {
    const previous = buildOutline_ACU();
    const remainingOnly = '<node>\n<node_title>剩余节点</node_title>\n<node_goal>剩余目标</node_goal>\n<turn>新 1</turn>\n<turn>新 2</turn>\n<turn>新 3</turn>\n<turn>新 4</turn>\n</node>';
    const { planner } = createPlanner_ACU([remainingOnly]);
    const result = await planner.plan(request_ACU({ ...settings_ACU(), outlinePreview: true }, { reason: 'manual_replan', replanConstraints: { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 } }));
    const planned = createPlannedStageRevision_ACU(result.outline, 2, 'manual_replan', '收束', 123);
    const frozen = freezePlannedStageRevision_ACU(planned);
    expect(result.requiresReview).toBe(true);
    expect(planned).toMatchObject({ frozen: false, revision: 2, createdAt: 123 });
    expect(frozen).toMatchObject({ frozen: true, revision: 2 });
    expect(frozen.outline).not.toBe(planned.outline);

    const constraints = { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 };
    const edited = { ...planned, outline: { ...planned.outline, title: '用户编辑标题' } };
    expect(acceptPlannedStageRevision_ACU(edited, settings_ACU(), constraints))
      .toMatchObject({ frozen: true, outline: { title: '用户编辑标题' } });
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(frozen, settings_ACU()), 'CONTINUATION_REVISION_FROZEN');

    const invalidEdited = { ...planned, outline: { ...planned.outline, totalTurns: 5 } };
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(invalidEdited, settings_ACU(), constraints), 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE');
    const rewrittenCompleted = { ...planned, outline: { ...planned.outline, nodes: [{ ...planned.outline.nodes[0], turns: [{ ...planned.outline.nodes[0].turns[0], goal: '篡改已完成轮次' }, ...planned.outline.nodes[0].turns.slice(1)] }, ...planned.outline.nodes.slice(1)] } };
    await expectCode_ACU(async () => acceptPlannedStageRevision_ACU(rewrittenCompleted, settings_ACU(), constraints), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');
  });
});

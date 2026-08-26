import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { ContinuationOrchestrator_ACU } from '../../../src/service/continuation/continuation-orchestrator';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const outline = { schemaVersion: 1 as const, title: '阶段', goal: '目标', totalTurns: 6, nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }] };

/**
 * 执行引擎桩：模拟主 Agent 的大纲行为——没有可执行大纲（无阶段或阶段已完成）时
 * 先通过注入的回调派工大纲子代理，review/stopped 时按真实循环的行为抛错中止。
 */
function createOrchestrator(options: { preview?: boolean; planner?: ReturnType<typeof vi.fn>; hasLiveHostClaim?: () => boolean } = {}) {
  const planner = options.planner ?? vi.fn().mockResolvedValue({ outline, attempts: 1, requiresReview: !!options.preview, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
  let sequence = 0;
  const store = new FirstFloorContinuationStore_ACU();
  const executionEngine = {
    prepareCurrentTurnInstruction: vi.fn().mockImplementation(async (_isLeaseCurrent: unknown, _retryAttempt: unknown, applyOutline: (instruction: string) => Promise<{ requiresReview: boolean; stopped: string | null }>) => {
      const task = store.readPersisted()?.activeTask;
      const stage = task?.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
      if (!stage || stage.status === 'completed') {
        const result = await applyOutline('按当前要求规划大纲');
        if (result.stopped) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_TASK_STATE_INVALID', 'agent_loop', '任务已停止', false, { stopped: result.stopped }));
        }
        if (result.requiresReview) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_OUTLINE_REPLANNED', 'agent_loop', '新大纲等待确认', false));
        }
      }
      return { identity: {}, instruction: { instruction: '发送文本', attempts: 1 } };
    }),
  };
  const orchestrator = new ContinuationOrchestrator_ACU({
    store, planner: { plan: planner } as any, executionEngine: executionEngine as any,
    getChatIdentity: () => 'chat-a', now: () => 1_000, allocateId: prefix => `${prefix}-${++sequence}`,
    readChronicleSnapshot: vi.fn().mockResolvedValue({ count: 3, range: { first: 'AM1', last: 'AM3' } }),
    createOutlineResolvers: () => ({}),
    ...(options.hasLiveHostClaim ? { hasLiveHostClaim: options.hasLiveHostClaim } : {}),
  });
  return { orchestrator, planner, store, executionEngine };
}

async function recordPendingHostTurn(orchestrator: ContinuationOrchestrator_ACU, identity: any): Promise<void> {
  await orchestrator.recordHostTurn({
    identity,
    capture: { capturedAt: 1_000, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: 1 },
  });
}

async function confirmTurns(orchestrator: ContinuationOrchestrator_ACU, store: FirstFloorContinuationStore_ACU, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    // 每轮确认后任务统一落 paused，真实链路由桥的自动续写调 continueTask 再进入下一轮。
    const before = store.readPersisted()!.activeTask!;
    if (before.status === 'paused' && before.stopReason === null) await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages.find(item => item.stageId === task.activeStageId)!;
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision)!;
    const node = revision.outline.nodes[stage.activeNodeIndex];
    const turn = node.turns[stage.activeTurnIndex];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id, attemptId: `attempt-${index}` };
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.confirmCurrentTurn(identity);
  }
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('ContinuationOrchestrator_ACU', () => {
  beforeEach(() => _set_SillyTavern_API_ACU({ chat: [{}], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn().mockResolvedValue(undefined) } as any));

  it('creates the task instantly without planning; the agent-driven continue creates the frozen first stage', async () => {
    const { orchestrator, store, planner } = createOrchestrator();
    const created = await orchestrator.createTask({ originInstruction: '  推进剧情  ' });
    expect(planner).not.toHaveBeenCalled();
    expect(created.task).toMatchObject({ originInstruction: '推进剧情', status: 'paused', runStageCount: 0, activeStageId: null });
    expect(created.task.stages).toEqual([]);

    await orchestrator.continueTask();
    expect(planner).toHaveBeenCalledTimes(1);
    const task = store.readPersisted()!.activeTask!;
    expect(task.runStageCount).toBe(1);
    expect(task.stages[0]).toMatchObject({ status: 'running', activeRevision: 1, chronicleStartCount: 3 });
    expect(task.stages[0].revisions[0].frozen).toBe(true);
    expect(task.stages[0].revisions[0].replanInstruction).toBe('按当前要求规划大纲');
  });

  it('persists replacement settings through the first-floor transaction and rejects the running state', async () => {
    const { orchestrator, store } = createOrchestrator();
    const settings = { ...buildDefaultContinuationSettings_ACU(), loopTags: 'required-tag', internalAiRetryLimit: 0 };

    await expect(orchestrator.replaceSettings({ settings })).resolves.toMatchObject({ settings });
    expect(store.readPersisted()).toMatchObject({ settings });

    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    await expectCode(() => orchestrator.replaceSettings({ settings }), 'CONTINUATION_OPERATION_BUSY');
  });

  it('keeps preview revisions mutable until acceptance and rejects blank task input', async () => {
    const { orchestrator, store } = createOrchestrator({ preview: true });
    await expectCode(() => orchestrator.createTask({ originInstruction: '   ' }), 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY');
    await orchestrator.createTask({ originInstruction: '推进剧情' });

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_AGENT_OUTLINE_REPLANNED');
    const preview = store.readPersisted()!.activeTask!;
    expect(preview.status).toBe('awaiting_outline_review');
    expect(preview.stages[0].revisions[0].frozen).toBe(false);

    const accepted = await orchestrator.acceptOutline();
    expect(accepted.task).toMatchObject({ status: 'paused' });
    expect(accepted.task.stages[0].revisions[0].frozen).toBe(true);
    expect(store.readPersisted()?.activeTask?.status).toBe('paused');
  });

  it('sets one persistent deadline on continue and never calls the engine after it expires', async () => {
    let now = 1_000;
    const { orchestrator, executionEngine, store } = createOrchestrator();
    (orchestrator as any).dependencies.now = () => now;
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const stored = store.readPersisted()!;
    stored.settings = { ...buildDefaultContinuationSettings_ACU(), totalDurationMinutes: 1 };
    await store.replaceAtomically(stored, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(1);
    now = 61_001;
    const result = await orchestrator.continueTask();
    expect(result.task.stopReason).toBe('duration_reached');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(1);
  });

  it('advances only a uniquely current confirmed turn and rejects the same attempt after the cursor moves', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-a' };
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.confirmCurrentTurn(identity);
    expect(store.readPersisted()!.activeTask!.stages[0]).toMatchObject({ completedTurns: 1, activeNodeIndex: 0, activeTurnIndex: 1 });
    await expectCode(() => orchestrator.confirmCurrentTurn(identity), 'CONTINUATION_INTERNAL_REQUEST_STALE');
  });

  it('pauses at every confirmed turn boundary and exposes auto-continue eligibility', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 1);

    // 非最后一轮的确认同样落 paused：自动续写与手动继续都从这个状态出发。
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: null, lastError: null, pendingHostTurn: null });
    expect(orchestrator.readAutoContinueState()).toEqual({ eligible: true, delaySeconds: 5 });
  });

  it('denies auto-continue for stopped tasks, recorded errors, and pending host turns', async () => {
    const { orchestrator, store } = createOrchestrator();
    expect(orchestrator.readAutoContinueState()).toEqual({ eligible: false, delaySeconds: 0 });

    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-a' };
    await recordPendingHostTurn(orchestrator, identity);
    expect(orchestrator.readAutoContinueState().eligible).toBe(false);

    await orchestrator.confirmCurrentTurn(identity);
    expect(orchestrator.readAutoContinueState().eligible).toBe(true);
    await orchestrator.stopTask();
    expect(orchestrator.readAutoContinueState().eligible).toBe(false);
  });

  it('pauses after the final confirmed turn; the next continue delegates the next stage outline to the agent', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);

    // 末轮确认后不再自动规划：任务落到可继续的暂停态。
    const completed = store.readPersisted()!.activeTask!;
    expect(planner).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({ status: 'paused', runStageCount: 1 });
    expect(completed.stages[0].status).toBe('completed');

    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    expect(planner).toHaveBeenCalledTimes(2);
    expect(task).toMatchObject({ runStageCount: 2 });
    expect(task.stages.map(stage => stage.status)).toEqual(['completed', 'running']);
    expect(task.stages[1].revisions[0].frozen).toBe(true);
  });

  it('replans the remaining stage as an agent outline op and freezes the next revision', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    const result = await orchestrator.replanRemaining({ instruction: '收束当前冲突' });
    expect(planner).toHaveBeenCalledTimes(2);
    expect(result.task).toMatchObject({ status: 'paused' });
    const stage = store.readPersisted()!.activeTask!.stages[0];
    expect(stage.activeRevision).toBe(2);
    const revision = stage.revisions.find(item => item.revision === 2)!;
    expect(revision).toMatchObject({ reason: 'manual_replan', replanInstruction: '收束当前冲突', frozen: true });
  });

  it('persists a host-turn identity before dispatch and rejects a mismatched attempt result', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    await recordPendingHostTurn(orchestrator, identity);
    expect(store.readPersisted()!.activeTask!.pendingHostTurn).toMatchObject({ identity, status: 'awaiting_generation', retryCount: 0 });
    await expectCode(() => orchestrator.confirmCurrentTurn({ ...identity, attemptId: 'attempt-host-b' }), 'CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(store.readPersisted()!.activeTask!.stages[0].completedTurns).toBe(0);
  });

  it('retries the current host turn with its stable attempt and pauses after the generation retry limit', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const initial = store.readPersisted()!;
    initial.settings = { ...initial.settings, generationRetryLimit: 1 };
    await store.replaceAtomically(initial, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForMissingTags({ identity, messageIndex: 1 });
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', pendingHostTurn: { retryCount: 1, status: 'retry_ready' }, lastError: { code: 'CONTINUATION_GENERATION_TAGS_MISSING' } });

    await orchestrator.continueTask();
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForMissingTags({ identity, messageIndex: 2 });
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'generation_retry_exhausted', pendingHostTurn: { retryCount: 1, status: 'exhausted' }, lastError: { code: 'CONTINUATION_GENERATION_TAGS_MISSING', retryable: false } });
  });

  it('keeps a manual stop authoritative when an invalidated outline op returns late', async () => {
    let resolvePlan: ((value: any) => void) | undefined;
    const planner = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve; }));
    const { orchestrator, store } = createOrchestrator({ planner });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const replan = orchestrator.replanRemaining({ instruction: '改为收束冲突' });
    const guarded = replan.catch(error => error);
    await Promise.resolve();
    await orchestrator.stopTask();
    resolvePlan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    const error = await guarded;
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'manual' });
    expect(store.readPersisted()!.activeTask!.stages).toEqual([]);
  });

  it('stops after the initial stage when the automatic stage limit is one', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, maxAutomaticStages: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'stage_limit_reached', runStageCount: 1 });
    expect(planner).toHaveBeenCalledTimes(1);
  });

  it('applies sentence-level outline edits as a frozen next revision without an AI call', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    expect(planner).toHaveBeenCalledTimes(1);

    const result = await (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'set_turn_goal', turnId: 'turn-2', goal: '守门人先露出破绽' },
      { op: 'insert_turn', nodeId: 'node-1', afterTurnId: 'turn-3', goal: '巡查队提前到场' },
    ], 'running');
    expect(result.summary).toContain('2 处');
    expect(planner).toHaveBeenCalledTimes(1);

    const stage = store.readPersisted()!.activeTask!.stages[0];
    expect(stage.activeRevision).toBe(2);
    expect(stage).toMatchObject({ activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: 0 });
    const revision = stage.revisions.find(item => item.revision === 2)!;
    expect(revision.frozen).toBe(true);
    const turns = revision.outline.nodes.flatMap(node => node.turns);
    expect(turns).toHaveLength(7);
    expect(turns[1].goal).toBe('守门人先露出破绽');
    expect(turns[3].goal).toBe('巡查队提前到场');
    expect(revision.outline.totalTurns).toBe(7);
    expect(revision.outline.nodes[0].suggestedTurns).toBe(7);
  });

  it('outline edits cannot touch completed turns, remove the cursor turn, or leave the stage-size range', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'remove_turn', turnId: 'turn-1' },
    ], 'running'), 'CONTINUATION_AGENT_WRITE_REJECTED');

    // 标准阶段规模下限为 6：删一轮使总轮数掉出范围。
    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'remove_turn', turnId: 'turn-6' },
    ], 'running'), 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE');

    await confirmTurns(orchestrator, store, 1);
    await orchestrator.continueTask();
    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'set_turn_goal', turnId: 'turn-1', goal: '篡改已完成轮次' },
    ], 'running'), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');
    expect(store.readPersisted()!.activeTask!.stages[0].activeRevision).toBe(1);
  });

  it('stays busy while the bridge holds a live claim for the awaiting host turn', async () => {
    const { orchestrator, store } = createOrchestrator({ hasLiveHostClaim: () => true });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-live' };
    await recordPendingHostTurn(orchestrator, identity);

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_OPERATION_BUSY');
    expect(store.readPersisted()!.activeTask!.pendingHostTurn).toMatchObject({ status: 'awaiting_generation' });
  });

  it('recovers a stale awaiting host turn without a live claim and continues from current progress', async () => {
    const { orchestrator, store, executionEngine } = createOrchestrator({ hasLiveHostClaim: () => false });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stale' };
    await recordPendingHostTurn(orchestrator, identity);

    // 重载/事件丢失后的滞留等待轮：桥没有活认领，继续应当丢弃它并重新规划当前轮。
    await orchestrator.continueTask();
    const recovered = store.readPersisted()!.activeTask!;
    expect(recovered.pendingHostTurn).toBeNull();
    expect(recovered.status).toBe('running');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(2);
  });

  it('resumes a manually stopped task from current progress and clears its awaiting turn on stop', async () => {
    const { orchestrator, store, executionEngine } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stop' };
    await recordPendingHostTurn(orchestrator, identity);

    await orchestrator.stopTask();
    const stopped = store.readPersisted()!.activeTask!;
    expect(stopped).toMatchObject({ status: 'paused', stopReason: 'manual' });
    expect(stopped.pendingHostTurn).toBeNull();

    await orchestrator.continueTask();
    const resumed = store.readPersisted()!.activeTask!;
    expect(resumed.stopReason).toBeNull();
    expect(resumed.status).toBe('running');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(2);
  });

  it('keeps non-manual stop reasons non-resumable', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, maxAutomaticStages: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);
    expect(store.readPersisted()!.activeTask!.stopReason).toBe('stage_limit_reached');

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_TASK_STATE_INVALID');
  });

  it('converts a stopped host generation into a retryable turn without consuming the retry budget', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stopped' };
    await recordPendingHostTurn(orchestrator, identity);

    await orchestrator.failHostTurnForStoppedGeneration(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({
      status: 'paused',
      stopReason: null,
      pendingHostTurn: { status: 'retry_ready', retryCount: 0 },
      lastError: { code: 'CONTINUATION_TASK_STATE_INVALID', retryable: true },
    });
  });

  it('requires explicit confirmation before abandoning the current task', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await expectCode(() => orchestrator.abandonAndCreate({ originInstruction: '新任务' }), 'CONTINUATION_TASK_STATE_INVALID');
    expect(store.readPersisted()!.activeTask?.originInstruction).toBe('推进剧情');
  });
});

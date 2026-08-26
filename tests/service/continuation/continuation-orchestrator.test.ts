import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { ContinuationOrchestrator_ACU } from '../../../src/service/continuation/continuation-orchestrator';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const outline = { schemaVersion: 1 as const, title: '阶段', goal: '目标', totalTurns: 6, nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }] };

function createOrchestrator(options: { preview?: boolean; planner?: ReturnType<typeof vi.fn> } = {}) {
  const planner = options.planner ?? vi.fn().mockResolvedValue({ outline, attempts: 1, requiresReview: !!options.preview, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
  let sequence = 0;
  const store = new FirstFloorContinuationStore_ACU();
  const executionEngine = { prepareCurrentTurnInstruction: vi.fn().mockResolvedValue({ identity: {}, instruction: { instruction: '发送文本', attempts: 1 } }) };
  const orchestrator = new ContinuationOrchestrator_ACU({
    store, planner: { plan: planner } as any, executionEngine: executionEngine as any,
    getChatIdentity: () => 'chat-a', now: () => 1_000, allocateId: prefix => `${prefix}-${++sequence}`,
    readChronicleSnapshot: vi.fn().mockResolvedValue({ count: 3, range: { first: 'AM1', last: 'AM3' } }),
    createOutlineResolvers: () => ({}),
  });
  return { orchestrator, planner, store, executionEngine };
}

async function recordPendingHostTurn(orchestrator: ContinuationOrchestrator_ACU, identity: any): Promise<void> {
  await orchestrator.recordHostTurn({
    identity,
    capture: { capturedAt: 1_000, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: 1 },
  });
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

  it('plans before atomically replacing the terminal task and leaves a paused, frozen stage ready to continue', async () => {
    const { orchestrator, store, planner } = createOrchestrator();
    const result = await orchestrator.createTask({ originInstruction: '  推进剧情  ' });
    expect(planner).toHaveBeenCalledTimes(1);
    expect(result.task).toMatchObject({ originInstruction: '推进剧情', status: 'paused', runStageCount: 1 });
    expect(result.task.stages[0]).toMatchObject({ status: 'running', activeRevision: 1, chronicleStartCount: 3 });
    expect(result.task.stages[0].revisions[0].frozen).toBe(true);
    expect(store.readPersisted()).toEqual(result.envelope);
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
    const preview = await orchestrator.createTask({ originInstruction: '推进剧情' });
    expect(preview.task.status).toBe('awaiting_outline_review');
    expect(preview.task.stages[0].revisions[0].frozen).toBe(false);
    const accepted = await orchestrator.acceptOutline();
    expect(accepted.task).toMatchObject({ status: 'paused' });
    expect(accepted.task.stages[0].revisions[0].frozen).toBe(true);
    expect(store.readPersisted()?.activeTask?.status).toBe('paused');
  });

  it('sets one persistent deadline on continue and never calls the engine after it expires', async () => {
    let now = 1_000;
    const { orchestrator, executionEngine } = createOrchestrator();
    (orchestrator as any).dependencies.now = () => now;
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const stored = (orchestrator as any).dependencies.store.readPersisted();
    stored.settings = { ...buildDefaultContinuationSettings_ACU(), totalDurationMinutes: 1 };
    await (orchestrator as any).dependencies.store.replaceAtomically(stored, { chatIdentity: 'chat-a', taskId: stored.activeTask.taskId, stageId: stored.activeTask.activeStageId, revision: 1 });
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

  it('plans the next stage only after the final confirmed turn and counts the initial stage toward the automatic limit', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    for (let index = 0; index < 6; index += 1) {
      const task = store.readPersisted()!.activeTask!;
      const stage = task.stages.find(item => item.stageId === task.activeStageId)!;
      const revision = stage.revisions.find(item => item.revision === stage.activeRevision)!;
      const node = revision.outline.nodes[stage.activeNodeIndex];
      const turn = node.turns[stage.activeTurnIndex];
      const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id, attemptId: `attempt-${index}` };
      await recordPendingHostTurn(orchestrator, identity);
      await orchestrator.confirmCurrentTurn(identity);
    }
    const task = store.readPersisted()!.activeTask!;
    expect(planner).toHaveBeenCalledTimes(2);
    expect(task).toMatchObject({ status: 'paused', runStageCount: 2 });
    expect(task.stages.map(stage => stage.status)).toEqual(['completed', 'running']);
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
    await store.replaceAtomically(initial, { chatIdentity: 'chat-a', taskId: initial.activeTask!.taskId, stageId: initial.activeTask!.activeStageId, revision: 1 });
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


  it('keeps a manual stop authoritative when an invalidated replan returns late', async () => {
    let resolveReplan: ((value: any) => void) | undefined;
    const planner = vi.fn()
      .mockResolvedValueOnce({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } })
      .mockImplementationOnce(() => new Promise(resolve => { resolveReplan = resolve; }));
    const { orchestrator, store } = createOrchestrator({ planner });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const replan = orchestrator.replanRemaining({ instruction: '改为收束冲突' });
    await Promise.resolve();
    await orchestrator.stopTask();
    resolveReplan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    await expectCode(() => replan, 'CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'manual' });
  });

  it('stops after the initial stage when the automatic stage limit is one', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, maxAutomaticStages: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a', taskId: persisted.activeTask!.taskId, stageId: persisted.activeTask!.activeStageId, revision: 1 });
    await orchestrator.continueTask();
    for (let index = 0; index < 6; index += 1) {
      const task = store.readPersisted()!.activeTask!;
      const stage = task.stages.find(item => item.stageId === task.activeStageId)!;
      const revision = stage.revisions.find(item => item.revision === stage.activeRevision)!;
      const node = revision.outline.nodes[stage.activeNodeIndex];
      const turn = node.turns[stage.activeTurnIndex];
      const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id, attemptId: `attempt-${index}` };
      await recordPendingHostTurn(orchestrator, identity);
      await orchestrator.confirmCurrentTurn(identity);
    }
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'stage_limit_reached', runStageCount: 1 });
    expect(planner).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before abandoning the current task', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await expectCode(() => orchestrator.abandonAndCreate({ originInstruction: '新任务' }), 'CONTINUATION_TASK_STATE_INVALID');
    expect(store.readPersisted()!.activeTask?.originInstruction).toBe('推进剧情');
  });


});

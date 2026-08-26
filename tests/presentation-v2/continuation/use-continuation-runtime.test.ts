/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  bridgeSend: vi.fn(async () => true),
  continueTask: vi.fn(),
  retryCurrentTurn: vi.fn(),
  createTask: vi.fn(),
  stopTask: vi.fn(),
  replanRemaining: vi.fn(),
  acceptOutline: vi.fn(),
  abandonAndCreate: vi.fn(),
  replaceSettings: vi.fn(),
  initialize: vi.fn(async () => null),
  read: vi.fn(() => null),
  toastError: vi.fn(),
}));

vi.mock('../../../src/service/continuation/continuation-runtime', () => ({
  getContinuationRuntime_ACU: () => ({
    bridge: { send: harness.bridgeSend },
    orchestrator: {
      continueTask: harness.continueTask,
      retryCurrentTurn: harness.retryCurrentTurn,
      createTask: harness.createTask,
      stopTask: harness.stopTask,
      replanRemaining: harness.replanRemaining,
      acceptOutline: harness.acceptOutline,
      abandonAndCreate: harness.abandonAndCreate,
      replaceSettings: harness.replaceSettings,
    },
    initialize: harness.initialize,
    read: harness.read,
  }),
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({ error: harness.toastError }),
}));

const envelope = { schemaVersion: 1, settings: {}, activeTask: null } as any;
const result = { envelope, task: { taskId: 'task-1' } } as any;
const preparedTurn = {
  identity: { chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 1, nodeId: 'node-1', turnId: 'turn-1', attemptId: 'attempt-1' },
  instruction: { instruction: '最终普通文本' },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  harness.read.mockReturnValue(envelope);
  harness.initialize.mockResolvedValue(null);
  harness.bridgeSend.mockResolvedValue(true);
  harness.continueTask.mockResolvedValue(result);
  harness.createTask.mockResolvedValue(result);
  harness.stopTask.mockResolvedValue(result);
  harness.replanRemaining.mockResolvedValue(result);
  harness.retryCurrentTurn.mockResolvedValue(result);
  harness.acceptOutline.mockResolvedValue(result);
  harness.abandonAndCreate.mockResolvedValue(result);
  harness.replaceSettings.mockResolvedValue(envelope);
});

describe('useContinuationRuntime', () => {
  it('仅将 orchestrator 返回的 preparedTurn 交给 runtime bridge', async () => {
    harness.continueTask.mockResolvedValue({ ...result, preparedTurn });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.continueTask();

    expect(harness.continueTask).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).toHaveBeenCalledWith(preparedTurn);
  });

  it('没有 preparedTurn 时不触发宿主发送', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.continueTask();

    expect(harness.bridgeSend).not.toHaveBeenCalled();
  });

  it('初始化完成后刷新首楼权威状态', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.initialize();

    expect(harness.initialize).toHaveBeenCalledOnce();
    expect(harness.read).toHaveBeenCalledOnce();
    expect(continuation.task.value).toBeNull();
  });

  it('创建任务成功后自动开始第一轮，创建失败则不继续', async () => {
    const pausedTask = { taskId: 'task-1', status: 'paused', stopReason: null, activeStageId: null, stages: [] };
    const createdEnvelope = { schemaVersion: 1, settings: {}, activeTask: pausedTask } as any;
    harness.createTask.mockResolvedValue({ envelope: createdEnvelope, task: pausedTask });
    harness.read.mockReturnValue(createdEnvelope);
    harness.continueTask.mockResolvedValue({ envelope: createdEnvelope, task: pausedTask });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    continuation.originInstruction.value = '推进剧情';

    await continuation.createTask();
    expect(harness.createTask).toHaveBeenCalledOnce();
    expect(harness.continueTask).toHaveBeenCalledOnce();

    harness.createTask.mockRejectedValue(new Error('创建失败'));
    harness.continueTask.mockClear();
    continuation.originInstruction.value = '再来一次';
    await continuation.createTask();
    expect(harness.continueTask).not.toHaveBeenCalled();
  });

  it('手动停止的任务允许继续，其余停止原因不允许', async () => {
    const stoppedTask = { taskId: 'task-1', status: 'paused', stopReason: 'manual', activeStageId: null, stages: [], pendingHostTurn: null };
    harness.read.mockReturnValue({ schemaVersion: 1, settings: {}, activeTask: stoppedTask } as any);
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    continuation.refresh();
    expect(continuation.canContinue.value).toBe(true);

    harness.read.mockReturnValue({ schemaVersion: 1, settings: {}, activeTask: { ...stoppedTask, stopReason: 'duration_reached' } } as any);
    continuation.refresh();
    expect(continuation.canContinue.value).toBe(false);
  });

  it('将设置保存和预览确认经由编排器处理，不直接发送宿主消息', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    const settings = { stageSize: 'standard' } as any;
    const outline = { schemaVersion: 1, title: '阶段', goal: '目标', totalTurns: 6, nodes: [] } as any;

    await continuation.saveSettings(settings);
    await continuation.acceptOutline(outline);

    expect(harness.replaceSettings).toHaveBeenCalledWith({ settings });
    expect(harness.acceptOutline).toHaveBeenCalledWith({ outline });
    expect(harness.bridgeSend).not.toHaveBeenCalled();
  });
});

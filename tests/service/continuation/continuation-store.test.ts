import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type ContinuationEnvelope_ACU } from '../../../src/service/continuation/model';
import {
  FirstFloorContinuationStore_ACU,
  buildMigratedContinuationEnvelope_ACU,
  buildLegacyContinuationMigration_ACU,
  stripLegacyContinuationLoopFields_ACU,
} from '../../../src/service/continuation/continuation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function buildEnvelope_ACU(): ContinuationEnvelope_ACU {
  return { schemaVersion: 1, settings: buildDefaultContinuationSettings_ACU(), activeTask: null };
}

function buildRunningEnvelope_ACU(): ContinuationEnvelope_ACU {
  const envelope = buildEnvelope_ACU();
  envelope.activeTask = {
    taskId: 'task-1',
    originInstruction: '推进剧情',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    runStartedAt: 1,
    deadlineAt: null,
    runStageCount: 1,
    activeStageId: 'stage-1',
    stages: [{
      stageId: 'stage-1',
      stageNumber: 1,
      status: 'running',
      chronicleStartCount: 0,
      chronicleEndCount: null,
      chronicleAddedCount: null,
      chronicleRange: null,
      activeRevision: 1,
      revisions: [{
        revision: 1,
        createdAt: 1,
        reason: 'initial',
        replanInstruction: '',
        frozen: true,
        outline: {
          schemaVersion: 1,
          title: '阶段',
          goal: '目标',
          totalTurns: 6,
          nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }],
        },
      }],
      activeNodeIndex: 0,
      activeTurnIndex: 0,
      completedTurns: 0,
    }],
    timeline: [],
    stopReason: null,
    lastError: null,
  };
  return envelope;
}

function expectCode_ACU(action: () => Promise<unknown>, code: string) {
  return expect(action()).rejects.toMatchObject({ error: { code } } satisfies Partial<ContinuationValidationError_ACU>);
}

describe('FirstFloorContinuationStore_ACU', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('persists only the first-floor continuation field after host save', async () => {
    const chat: any[] = [{}];
    const chatMetadata = { untouched: true };
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatMetadata, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const store = new FirstFloorContinuationStore_ACU();
    const candidate = buildEnvelope_ACU();
    await store.replaceAtomically(candidate);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[0]._qrf_continuation).toEqual(candidate);
    expect(chatMetadata).toEqual({ untouched: true });
    expect(store.read()).toEqual(candidate);
  });

  it('rejects corrupted raw snapshots without replacing them', () => {
    const chat: any[] = [{ _qrf_continuation: { schemaVersion: 1, settings: undefined, activeTask: null } }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const store = new FirstFloorContinuationStore_ACU();
    expect(() => store.read()).toThrow(ContinuationValidationError_ACU);
    try { store.read(); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_ENVELOPE_INVALID');
    }
    expect(chat[0]._qrf_continuation.settings).toBeUndefined();
  });

  it('fails closed on unknown persisted task states', () => {
    const invalid = buildRunningEnvelope_ACU() as any;
    invalid.activeTask.status = 'unknown_running_state';
    const chat: any[] = [{ _qrf_continuation: invalid }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
    try { new FirstFloorContinuationStore_ACU().read(); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_ENVELOPE_INVALID');
    }
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('unknown_running_state');
  });

  it('fails closed on persisted prompt segments with an unsupported role or empty content', () => {
    const invalidRole = buildEnvelope_ACU() as any;
    invalidRole.settings.outlinePrompt = [{ role: 'tool', content: 'invalid', deletable: true }];
    const invalidContent = buildEnvelope_ACU() as any;
    invalidContent.settings.turnInstructionPrompt = [{ role: 'user', content: '   ', deletable: true }];

    for (const envelope of [invalidRole, invalidContent]) {
      const chat: any[] = [{ _qrf_continuation: envelope }];
      _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
      expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
    }
  });

  it('restores in-memory first-floor data and attempts rollback persistence after a save failure', async () => {
    const original = buildEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: original }];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<required>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_PERSIST_FAILED');

    expect(chat[0]._qrf_continuation).toEqual(original);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('keeps the original first-floor value when both primary and rollback saves fail', async () => {
    const original = buildEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: original }];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary save failed')).mockRejectedValueOnce(new Error('rollback save failed'));
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<candidate>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_PERSIST_FAILED');

    expect(chat[0]._qrf_continuation).toEqual(original);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('rejects a late write when the active chat changes during persistence', async () => {
    const chatA: any[] = [{ _qrf_continuation: buildEnvelope_ACU() }];
    const chatB: any[] = [{}];
    let activeChat: any[] = chatA;
    let activeId = 'chat-a';
    const saveChat = vi.fn(async () => { activeChat = chatB; activeId = 'chat-b'; });
    _set_SillyTavern_API_ACU({ get chat() { return activeChat; }, get chatId() { return activeId; }, getCurrentChatId: () => activeId, saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<required>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_CHAT_CHANGED');

    expect(chatA[0]._qrf_continuation.settings.loopTags).toBe('');
    expect(chatB[0]._qrf_continuation).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('derives a persisted running task as paused without changing its confirmed first-floor snapshot', () => {
    const persisted = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const restored = new FirstFloorContinuationStore_ACU().read();

    expect(restored?.activeTask?.status).toBe('paused');
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('running');
  });

  it('rejects stale task, stage, and revision guards before writing', async () => {
    const current = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: current }];
    const saveChat = vi.fn();
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    await expectCode_ACU(
      () => new FirstFloorContinuationStore_ACU().replaceAtomically(buildRunningEnvelope_ACU(), { chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 2 }),
      'CONTINUATION_WRITE_GUARD_MISMATCH',
    );

    expect(saveChat).not.toHaveBeenCalled();
    expect(chat[0]._qrf_continuation).toEqual(current);
  });

  it('serializes writes across store instances for the same chat', async () => {
    const chat: any[] = [{}];
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>(resolve => { releaseFirstSave = resolve; });
    const saveChat = vi.fn()
      .mockImplementationOnce(() => firstSaveStarted)
      .mockResolvedValueOnce(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const first = buildEnvelope_ACU();
    first.settings.loopTags = '<first>';
    const second = buildEnvelope_ACU();
    second.settings.loopTags = '<second>';
    const firstWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(first);
    const secondWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(second);

    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    releaseFirstSave!();
    await Promise.all([firstWrite, secondWrite]);

    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(chat[0]._qrf_continuation.settings.loopTags).toBe('<second>');
  });

  it('rejects a queued write if its captured chat becomes inactive before execution', async () => {
    const chatA: any[] = [{}];
    const chatB: any[] = [{}];
    let activeChat: any[] = chatA;
    let activeId = 'chat-a';
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>(resolve => { releaseFirstSave = resolve; });
    const saveChat = vi.fn().mockImplementationOnce(() => firstSaveStarted);
    _set_SillyTavern_API_ACU({ get chat() { return activeChat; }, get chatId() { return activeId; }, getCurrentChatId: () => activeId, saveChat } as any);

    const first = buildEnvelope_ACU();
    first.settings.loopTags = '<first>';
    const second = buildEnvelope_ACU();
    second.settings.loopTags = '<second>';
    const firstWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(first);
    const secondWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(second);

    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    activeChat = chatB;
    activeId = 'chat-b';
    releaseFirstSave!();

    await expectCode_ACU(() => firstWrite, 'CONTINUATION_CHAT_CHANGED');
    await expectCode_ACU(() => secondWrite, 'CONTINUATION_CHAT_CHANGED');
    expect(chatA[0]._qrf_continuation).toBeUndefined();
    expect(chatB[0]._qrf_continuation).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('passes a reload-paused task into an atomic update', async () => {
    const persisted = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    let receivedStatus = '';
    await new FirstFloorContinuationStore_ACU().updateAtomically(current => {
      receivedStatus = current?.activeTask?.status || '';
      return current!;
    });

    expect(receivedStatus).toBe('paused');
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('paused');
  });

  it('derives an interrupted drafting or planning task as a paused failed stage after reload', () => {
    const persisted = buildRunningEnvelope_ACU();
    persisted.activeTask!.status = 'drafting';
    persisted.activeTask!.stages[0].status = 'planning';
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const restored = new FirstFloorContinuationStore_ACU().read();

    expect(restored?.activeTask).toMatchObject({ status: 'paused', lastError: { code: 'CONTINUATION_TASK_STATE_INVALID', phase: 'load' } });
    expect(restored?.activeTask?.stages[0].status).toBe('failed');
    expect(chat[0]._qrf_continuation.activeTask).toMatchObject({ status: 'drafting', stages: [{ status: 'planning' }] });
  });


  it('migrates only retained legacy settings and never assigns prompt-array semantics', () => {
    const legacy = {
      loopSettings: { quickReplyContent: ['do not migrate'], currentPromptIndex: 2, loopTags: '<tag>', loopDelay: 7, retryDelay: 4, loopTotalDuration: 9, maxRetries: 5 },
      contextTurnCount: 8,
      contextExtractRules: [{ start: '<a>', end: '</a>' }],
      contextExcludeRules: [{ start: '<b>', end: '</b>' }],
    };
    const migration = buildLegacyContinuationMigration_ACU(legacy);

    expect(migration.settings).toMatchObject({ loopTags: '<tag>', loopDelaySeconds: 7, retryDelaySeconds: 4, totalDurationMinutes: 9, generationRetryLimit: 5, contextTurnCount: 8 });
    expect(migration.settings).not.toHaveProperty('quickReplyContent');
    expect(stripLegacyContinuationLoopFields_ACU(legacy)).toEqual({ loopSettings: { loopTags: '<tag>', loopDelay: 7, retryDelay: 4, loopTotalDuration: 9, maxRetries: 5 }, contextTurnCount: 8, contextExtractRules: [{ start: '<a>', end: '</a>' }], contextExcludeRules: [{ start: '<b>', end: '</b>' }] });

    const migrated = buildMigratedContinuationEnvelope_ACU(legacy);
    expect(migrated).toMatchObject({ didMigrate: true, envelope: { schemaVersion: 1, activeTask: null } });
    expect(migrated.envelope.settings).not.toHaveProperty('quickReplyContent');
  });
});

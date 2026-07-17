import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  settings: { dataIsolationEnabled: false, dataIsolationCode: '' },
  collectSummary: vi.fn(() => ({ sheet_a: { lastFilledAiFloor: 7, lastChangedAiFloor: 6 } })),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn((message: any, isolationConfig: any) => {
    if (isolationConfig.enabled) {
      message.TavernDB_ACU_Identity = isolationConfig.code;
    } else {
      delete message.TavernDB_ACU_Identity;
    }
  }),
}));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mocks.settings,
}));
vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: vi.fn((tagData: any) => tagData?.storageFrame?.version === 2 && Array.isArray(tagData.storageFrame.logEntries)),
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  collectScheduleSummaryFromFramesV2_ACU: mocks.collectSummary,
}));

import { persistTableMutationLogV2_ACU, persistTableSheetCheckpointV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';

const sheetA = { uid: 'a', name: 'A', sourceData: {}, content: [['row_id', 'value'], ['1', 'new']], updateConfig: {}, exportConfig: {}, orderNo: 1 } as any;
const sheetB = { uid: 'b', name: 'B', sourceData: {}, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 2 } as any;

function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    seq: 1, entryId: 'entry-1', createdAt: 10, source: 'manual_fill', targetMessageIndex: 0, aiFloor: 1,
    filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [], ...overrides,
  };
}

function seedFrame(frameOverrides: Record<string, any> = {}): any {
  const frame = {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
    headRevision: '3:existing',
    manualRefillProgress: { kind: 'manual_refill', status: 'in_progress', selectedSheetKeys: ['sheet_b'] },
    logEntries: [makeEntry({ operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: sheetB, reason: 'system' }] })],
    perSheetCheckpoints: { sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB } },
    ...frameOverrides,
  };
  const message = { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame } } };
  mocks.chat.splice(0, mocks.chat.length, message);
  return message;
}

function makeTransaction(baseRevision: string | null = 'runtime-v1:test'): any {
  return {
    baseRevision,
    writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
    assertFresh: vi.fn(),
    runCommit: vi.fn(async (task: () => any) => task()),
  };
}

describe('persistTableSheetCheckpointV2_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.collectSummary.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });


  it('写入目标 shard 且保持根 checkpoint、revision、日志、进度和其他 shard 不变', async () => {
    const message = seedFrame();
    const beforeFrame = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));
    const transaction = makeTransaction();
    const event = { filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: ['sheet_a'] };

    const result = await persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 0, sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', createdAt: 20,
      event, baseRevision: 'base-20', transactionContext: transaction,
    });

    expect(result.saved).toBe(true);
    expect(transaction.runCommit).toHaveBeenCalledWith(expect.any(Function), []);
    expect(transaction.assertFresh).toHaveBeenCalledWith('persistTableSheetCheckpointV2:before_persist');
    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(mocks.collectSummary).toHaveBeenCalledWith(mocks.chat, '', { maxMessageIndex: 0 });
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints.sheet_a).toEqual({
      kind: 'sheet_full', createdAt: 20, reason: 'manual', sheetKey: 'sheet_a', data: sheetA,
      scheduleSummary: { lastFilledAiFloor: 7, lastChangedAiFloor: 6 }, event, baseRevision: 'base-20',
    });
    expect(frame.checkpoint).toEqual(beforeFrame.checkpoint);
    expect(frame.headRevision).toBe(beforeFrame.headRevision);
    expect(frame.logEntries).toEqual(beforeFrame.logEntries);
    expect(frame.manualRefillProgress).toEqual(beforeFrame.manualRefillProgress);
    expect(frame.perSheetCheckpoints.sheet_b).toEqual(beforeFrame.perSheetCheckpoints.sheet_b);

    sheetA.content[1][1] = 'caller-mutated';
    event.changedSheetKeys.push('sheet_b');
    expect(frame.perSheetCheckpoints.sheet_a.data.content[1][1]).toBe('new');
    expect(frame.perSheetCheckpoints.sheet_a.event.changedSheetKeys).toEqual(['sheet_a']);
    sheetA.content[1][1] = 'new';
  });

  it('宿主保存失败时恢复 isolated data 与 Identity，并继续抛出原错误', async () => {
    const message = seedFrame();
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    message.TavernDB_ACU_Identity = 'old-identity';
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    const saveError = new Error('host save failed');
    mocks.saveChat.mockRejectedValueOnce(saveError);

    await expect(persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 0,
      sheetKey: 'sheet_a',
      sheetData: sheetA,
      reason: 'manual',
      transactionContext: makeTransaction(),
    })).rejects.toBe(saveError);

    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });

  it('R1：没有 transactionContext 时拒绝直接写入', async () => {
    seedFrame();
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual' });
    expect(result).toEqual({ saved: false, error: expect.stringContaining('requires TableWriteTransactionContext') });
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each([
    ['R6 非 sheet_ key', { sheetKey: 'mate', sheetData: sheetA, reason: 'manual' }, 'sheetKey beginning'],
    ['R7 sheetData 缺失', { sheetKey: 'sheet_a', sheetData: undefined, reason: 'manual' }, 'object sheetData'],
    ['R7 sheetData 非对象', { sheetKey: 'sheet_a', sheetData: [], reason: 'manual' }, 'object sheetData'],
    ['R8 reason 缺失', { sheetKey: 'sheet_a', sheetData: sheetA }, 'explicit checkpoint reason'],
  ])('%s 时拒绝且不保存', async (_name, partial, errorText) => {
    seedFrame();
    const result = await persistTableSheetCheckpointV2_ACU({ ...partial, transactionContext: makeTransaction() } as any);
    expect(result.saved).toBe(false);
    expect(result.error).toContain(errorText);
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each([
    ['filledSheetKeys', makeEntry({ filledSheetKeys: ['sheet_a'] })],
    ['changedSheetKeys', makeEntry({ changedSheetKeys: ['sheet_a'] })],
    ['groupKeys', makeEntry({ groupKeys: ['sheet_a'] })],
    ['结构化 operation', makeEntry({ operations: [{ kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' }] })],
    ['legacy patch', makeEntry({ patches: [{ kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' }] })],
  ])('R9：目标 frame 已有目标表 %s 时拒绝', async (_name, entry) => {
    seedFrame({ logEntries: [entry] });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('existing target-sheet log entry');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each(['data_replace', 'sql_batch', 'table_edit_dsl'])('R9：存在无法证明不影响目标表的 %s 时拒绝', async kind => {
    const operation = kind === 'data_replace'
      ? { kind, data: { mate: {}, sheet_a: sheetA }, reason: 'system' }
      : kind === 'sql_batch'
        ? { kind, statements: ['UPDATE anything SET value = 1'] }
        : { kind, text: 'unknown edit' };
    seedFrame({ logEntries: [makeEntry({ operations: [operation] })] });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('R10：已有更新 createdAt 的同表 shard 时拒绝旧写覆盖', async () => {
    seedFrame({ perSheetCheckpoints: {
      sheet_a: { kind: 'sheet_full', createdAt: 30, reason: 'manual', sheetKey: 'sheet_a', data: sheetA },
      sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB },
    } });
    const result = await persistTableSheetCheckpointV2_ACU({
      sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', createdAt: 20, transactionContext: makeTransaction(),
    });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('cannot replace a newer checkpoint');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('目标 frame 早于最后一个 full checkpoint 时拒绝写入无效 shard', async () => {
    const earlyMessage = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
      logEntries: [],
    });
    const laterFullMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 10, reason: 'compaction', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [],
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, earlyMessage, laterFullMessage);

    const result = await persistTableSheetCheckpointV2_ACU({ targetMessageIndex: 0, sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('precedes the latest full checkpoint');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('没有根 full checkpoint 时拒绝仅写 shard', async () => {
    seedFrame({ checkpoint: undefined });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('existing full checkpoint anchor');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });
});

describe('persistTableMutationLogV2_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.collectSummary.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });

  it('宿主保存失败时恢复 mutation log 的 isolated data 与 Identity，并继续抛出原错误', async () => {
    const message = seedFrame();
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    message.TavernDB_ACU_Identity = 'old-identity';
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    const saveError = new Error('host mutation save failed');
    mocks.saveChat.mockRejectedValueOnce(saveError);

    await expect(persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'manual' }],
      candidateChangedSheetKeys: ['sheet_a'],
      transactionContext: makeTransaction(),
    })).rejects.toBe(saveError);

    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.headRevision).toBe('3:existing');
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });
});

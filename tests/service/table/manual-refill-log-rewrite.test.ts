import { describe, expect, it, vi } from 'vitest';

const { mockSaveChatToHost } = vi.hoisted(() => ({
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  saveChatToHost_ACU: mockSaveChatToHost,
}));

import { applyManualRefillLogRewriteInMemory_ACU, prepareManualRefillLogRewrite_ACU, rebuildManualRefillCheckpointsReady_ACU, saveManualRefillRewrite_ACU } from '../../../src/service/table/manual-refill-log-rewrite';
import { loadTableStateFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function makeData() {
  return {
    mate: { type: 'acu' },
    sheet_a: { uid: 'sheet_a', name: 'A', sourceData: { ddl: 'CREATE TABLE table_a (row_id INTEGER PRIMARY KEY, value TEXT);' }, content: [['row_id', 'value'], ['1', 'old-a']] },
    sheet_b: { uid: 'sheet_b', name: 'B', sourceData: { ddl: 'CREATE TABLE table_b (row_id INTEGER PRIMARY KEY, value TEXT);' }, content: [['row_id', 'value'], ['1', 'old-b']] },
  } as any;
}

function entry(sheetKey: string, statement: string, seq: number) {
  return {
    seq,
    entryId: `${sheetKey}_${seq}`,
    createdAt: seq,
    source: 'auto_fill',
    targetMessageIndex: 1,
    aiFloor: 1,
    filledSheetKeys: [sheetKey],
    changedSheetKeys: [sheetKey],
    groupKeys: [sheetKey],
    writeSet: [{ kind: 'sheet', sheetKey }],
    operations: [{ kind: 'sql_batch', statements: [statement] }],
  } as any;
}

function refillEntry(sheetKey: string, statement: string, seq: number, targetMessageIndex: number, refillId: string) {
  return {
    ...entry(sheetKey, statement, seq),
    targetMessageIndex,
    batchId: `manual_refill:${refillId}:${targetMessageIndex}`,
  } as any;
}

function makeChat() {
  return [
    {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeData() },
            headRevision: 'checkpoint:init',
            logEntries: [],
          },
        },
      },
    },
    { is_user: true },
    {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'periodic', data: makeData() },
            headRevision: 'checkpoint:periodic',
            logEntries: [
              entry('sheet_a', "UPDATE table_a SET value = 'old-a2' WHERE row_id = '1'", 1),
              entry('sheet_b', "UPDATE table_b SET value = 'old-b2' WHERE row_id = '1'", 2),
            ],
          },
        },
      },
    },
  ];
}

describe('manual-refill-log-rewrite', () => {
  it('清理范围内选中表旧 entry，保留非选中表', async () => {
    const chat = makeChat();
    const prepared = prepareManualRefillLogRewrite_ACU({ chat, isolationKey: '', startMessageIndex: 2, endMessageIndex: 2, selectedSheetKeys: ['sheet_a'], refillId: 'test', plannedSaveTargetIndices: [5] });
    expect(prepared.success).toBe(true);
    expect(prepared.removedEntries).toBe(1);
    expect(prepared.session?.chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(prepared.session?.chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].changedSheetKeys).toEqual(['sheet_b']);

    applyManualRefillLogRewriteInMemory_ACU(prepared.session!);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
  });

  it('成功保存当前内存聊天，不覆盖后续写新的 entry', async () => {
    const chat = makeChat();
    const prepared = prepareManualRefillLogRewrite_ACU({ chat, isolationKey: '', startMessageIndex: 2, endMessageIndex: 2, selectedSheetKeys: ['sheet_a'], refillId: 'test', plannedSaveTargetIndices: [5] });
    applyManualRefillLogRewriteInMemory_ACU(prepared.session!);
    chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push(entry('sheet_a', "UPDATE table_a SET value = 'new-a' WHERE row_id = '1'", 2));

    const result = await saveManualRefillRewrite_ACU();

    expect(result.success).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalled();
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.map((item: any) => item.changedSheetKeys[0])).toEqual(['sheet_b', 'sheet_a']);
  });

  it('无 saveTargetIndex <= checkpoint 时，清旧后即可重建 checkpoint', async () => {
    const chat = makeChat();
    const prepared = prepareManualRefillLogRewrite_ACU({ chat, isolationKey: '', startMessageIndex: 2, endMessageIndex: 2, selectedSheetKeys: ['sheet_a'], refillId: 'test', plannedSaveTargetIndices: [5] });
    applyManualRefillLogRewriteInMemory_ACU(prepared.session!);
    const checkpointResult = await rebuildManualRefillCheckpointsReady_ACU(prepared.session!, [], [5]);
    expect(checkpointResult.success).toBe(true);
    expect(checkpointResult.rebuilt).toEqual([2]);
    chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push(entry('sheet_a', "UPDATE table_a SET value = 'new-a' WHERE row_id = '1'", 2));

    const replayed = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(replayed?.sheet_a.content[1]).toEqual(['1', 'new-a']);
    expect(replayed?.sheet_b.content[1]).toEqual(['1', 'old-b2']);
  });

  it('存在 saveTargetIndex <= checkpoint 时，等该批完成后再重建 checkpoint', async () => {
    const chat = makeChat();
    const prepared = prepareManualRefillLogRewrite_ACU({ chat, isolationKey: '', startMessageIndex: 2, endMessageIndex: 2, selectedSheetKeys: ['sheet_a'], refillId: 'test', plannedSaveTargetIndices: [2, 5] });
    applyManualRefillLogRewriteInMemory_ACU(prepared.session!);

    const beforeBatch = await rebuildManualRefillCheckpointsReady_ACU(prepared.session!, [], [2, 5]);
    expect(beforeBatch.success).toBe(true);
    expect(beforeBatch.rebuilt).toEqual([]);

    chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push(entry('sheet_a', "UPDATE table_a SET value = 'new-a' WHERE row_id = '1'", 2));
    const afterBatch = await rebuildManualRefillCheckpointsReady_ACU(prepared.session!, [2], [2, 5]);
    expect(afterBatch.success).toBe(true);
    expect(afterBatch.rebuilt).toEqual([2]);

    const checkpointData = chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    expect(checkpointData.sheet_a.content[1]).toEqual(['1', 'new-a']);
  });

  it('续跑时保留同一手动重填已完成批次 entry，并返回 completedSaveTargetIndices', () => {
    const chat = makeChat();
    const refillId = 'range_2_2_sheets_sheet_a_batch_4';
    chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push(
      refillEntry('sheet_a', "UPDATE table_a SET value = 'new-a' WHERE row_id = '1'", 3, 2, refillId),
    );

    const prepared = prepareManualRefillLogRewrite_ACU({
      chat,
      isolationKey: '',
      startMessageIndex: 2,
      endMessageIndex: 2,
      selectedSheetKeys: ['sheet_a'],
      refillId,
      plannedSaveTargetIndices: [2],
    });

    expect(prepared.success).toBe(true);
    expect(prepared.session?.completedSaveTargetIndices).toEqual([2]);
    const entries = prepared.session?.chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries || [];
    expect(entries.map((item: any) => item.batchId).filter(Boolean)).toEqual([`manual_refill:${refillId}:2`]);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeV2OperationLogToSingleTableRecords_ACU } from '../../../src/service/table/storage-frame-v2-normalize';

function makeData() {
  return {
    mate: { type: 'acu' },
    sheet_a: { uid: 'sheet_a', name: 'A', sourceData: { ddl: 'CREATE TABLE table_a (row_id TEXT);' }, content: [['row_id']] },
    sheet_b: { uid: 'sheet_b', name: 'B', sourceData: { ddl: 'CREATE TABLE table_b (row_id TEXT);' }, content: [['row_id']] },
  } as any;
}

function makeChatWithEntry(entry: any) {
  return [{
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeData() },
          headRevision: 'checkpoint:init',
          logEntries: [entry],
        },
      },
    },
  }];
}

describe('normalizeV2OperationLogToSingleTableRecords_ACU', () => {
  it('拆分历史多表 SQL entry 并保持 params / 元信息 / seq / entryId', () => {
    const chat = makeChatWithEntry({
      seq: 9,
      entryId: 'old_shared',
      createdAt: 2,
      source: 'auto_fill',
      targetMessageIndex: 0,
      aiFloor: 1,
      filledSheetKeys: ['sheet_a', 'sheet_b'],
      changedSheetKeys: ['sheet_a', 'sheet_b'],
      groupKeys: ['sheet_a', 'sheet_b'],
      requestId: 'req1',
      batchId: 'batch1',
      error: 'warn',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }, { kind: 'sheet', sheetKey: 'sheet_b' }],
      operations: [{
        kind: 'sql_batch',
        statements: ['UPDATE table_a SET row_id = ?', 'UPDATE table_b SET row_id = ?'],
        params: [['a'], ['b']],
      }],
    });

    const result = normalizeV2OperationLogToSingleTableRecords_ACU({ chat, isolationKey: '', mode: 'repair' });

    expect(result).toEqual({ changed: true, errors: [] });
    const entries = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry: any) => entry.seq)).toEqual([1, 2]);
    expect(new Set(entries.map((entry: any) => entry.entryId)).size).toBe(2);
    expect(entries.every((entry: any) => entry.entryId !== 'old_shared')).toBe(true);
    expect(entries.map((entry: any) => entry.requestId)).toEqual(['req1', 'req1']);
    const entryA = entries.find((entry: any) => entry.changedSheetKeys[0] === 'sheet_a');
    expect(entryA.operations[0].statements).toEqual(['UPDATE table_a SET row_id = ?']);
    expect(entryA.operations[0].params).toEqual([['a']]);
    expect(entryA.filledSheetKeys).toEqual(['sheet_a']);
    expect(entryA.groupKeys).toEqual(['sheet_a']);
    expect(entryA.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_a' }]);
  });

  it('拆分历史 row/meta/sheet 动作并保留单表归属', () => {
    const chat = makeChatWithEntry({
      seq: 1,
      entryId: 'row_meta_old',
      createdAt: 2,
      source: 'manual_crud',
      targetMessageIndex: 0,
      aiFloor: 1,
      filledSheetKeys: [],
      changedSheetKeys: ['sheet_a', 'sheet_b'],
      groupKeys: [],
      operations: [
        { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1'] },
        { kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'B2' } },
      ],
    });

    const result = normalizeV2OperationLogToSingleTableRecords_ACU({ chat, isolationKey: '', mode: 'repair' });

    expect(result.errors).toEqual([]);
    const entries = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries;
    expect(entries.map((entry: any) => entry.changedSheetKeys[0]).sort()).toEqual(['sheet_a', 'sheet_b']);
  });

  it('无法识别 SQL 写入目标表时失败且不写 fallback', () => {
    const chat = makeChatWithEntry({
      seq: 1,
      entryId: 'bad_sql',
      createdAt: 2,
      source: 'auto_fill',
      targetMessageIndex: 0,
      aiFloor: 1,
      filledSheetKeys: [],
      changedSheetKeys: [],
      groupKeys: [],
      operations: [{ kind: 'sql_batch', statements: ['SELECT * FROM table_a'] }],
    });

    const before = JSON.stringify(chat);
    const result = normalizeV2OperationLogToSingleTableRecords_ACU({ chat, isolationKey: '', mode: 'repair' });

    expect(result.changed).toBe(false);
    expect(result.errors[0]).toContain('无法识别 SQL 写入目标表');
    expect(JSON.stringify(chat)).toBe(before);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  persistedData: null as any,
  providerData: null as any,
  persist: vi.fn(),
  reload: vi.fn(),
  setCurrentData: vi.fn(),
  ensureMigrated: vi.fn(),
  exportCanonicalData: vi.fn(),
  prepareReseed: vi.fn(),
  createSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  applyBatch: vi.fn(),
  replaceAllData: vi.fn(),
  clearRuntimeData: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentJsonTableData_ACU: h.setCurrentData,
}));

vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: h.ensureMigrated,
  persistTablesToChatMessage_ACU: h.persist,
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(async () => ({
    mode: 'sqlite',
    getCurrentData: vi.fn(() => clone(h.providerData)),
    exportCanonicalData: h.exportCanonicalData,
    prepareReseedPlanForEmptyTables: h.prepareReseed,
    createRuntimeSnapshot: h.createSnapshot,
    restoreRuntimeSnapshot: h.restoreSnapshot,
    applyEditsBatchWithSheetMetadata: h.applyBatch,
    replaceAllData: h.replaceAllData,
    clearRuntimeData: h.clearRuntimeData,
  })),
  reloadStorageProvider: h.reload,
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: h.runTransaction,
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import {
  replaceRuntimeDataStrict_ACU,
  runRuntimeDataReplaceCommit_ACU,
  runSqliteAtomicBatchCommit_ACU,
  runSqliteRuntimeMutationCommit_ACU,
} from '../../../src/service/table/table-update-commit';

const beforeData = {
  mate: { type: 'acu' },
  sheet_a: {
    uid: 'a', name: 'A', sourceData: { nextRowId: 2 },
    content: [['row_id', 'value'], ['1', 'before']],
    updateConfig: {}, exportConfig: {}, orderNo: 1,
  },
} as any;

const afterData = {
  ...beforeData,
  sheet_a: {
    ...beforeData.sheet_a,
    sourceData: { nextRowId: 3 },
    content: [['row_id', 'value'], ['1', 'before'], ['2', 'after']],
  },
} as any;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}


describe('table-update-commit SQLite persist failure compensation', () => {
  beforeEach(() => {
    h.persistedData = clone(beforeData);
    h.providerData = clone(beforeData);
    h.persist.mockReset().mockResolvedValue({ saved: false, error: 'host persist failed' });
    h.reload.mockReset().mockImplementation(async () => {
      h.providerData = clone(h.persistedData);
    });
    h.setCurrentData.mockReset();
    h.ensureMigrated.mockReset().mockResolvedValue({ success: true, migrated: false });
    h.exportCanonicalData.mockReset().mockImplementation(() => clone(h.providerData));
    h.prepareReseed.mockReset().mockReturnValue({ statements: [], paramsList: [], metadataUpdates: [] });
    h.createSnapshot.mockReset().mockImplementation(() => clone(h.providerData));
    h.restoreSnapshot.mockReset().mockImplementation(async (snapshot: any) => {
      h.providerData = clone(snapshot);
    });
    h.replaceAllData.mockReset().mockImplementation(async (data: any) => {
      h.providerData = clone(data);
      return { success: true, appliedEdits: 1, modifiedKeys: ['sheet_a'] };
    });
    h.clearRuntimeData.mockReset();
    h.applyBatch.mockReset().mockImplementation(() => {
      h.providerData = clone(afterData);
      return { success: true, appliedEdits: 1, changes: 1, statementChanges: [1] };
    });
    h.runTransaction.mockReset().mockImplementation(async (options: any, task: any) => {
      const context = {
        baseRevision: options.baseRevision ?? null,
        writeSet: options.writeSet,
        assertFresh: vi.fn(),
        runCommit: async (commitTask: any) => commitTask(),
      };
      return task(context, clone(options.initialData));
    });
  });

  it('单条 SQLite mutation 已更新 runtime 但持久化失败时 reload provider 且不更新 canonical JSON', async () => {
    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud',
      reason: 'single mutation rollback',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData),
      targetSheetKeys: ['sheet_a'],
      sql: 'INSERT INTO sheet_a (value) VALUES (?)',
      params: ['after'],
      mapValue: ({ mutationResult }) => mutationResult.changes,
    });

    expect(result).toEqual({ success: false, error: 'host persist failed' });
    expect(h.applyBatch).toHaveBeenCalledOnce();
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('单条 SQLite mutation 的持久化 Promise reject 时仍 reload provider', async () => {
    h.persist.mockRejectedValueOnce(new Error('strict host save rejected'));

    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud',
      reason: 'single mutation reject rollback',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData),
      targetSheetKeys: ['sheet_a'],
      sql: 'INSERT INTO sheet_a (value) VALUES (?)',
      params: ['after'],
      mapValue: ({ mutationResult }) => mutationResult.changes,
    });

    expect(result).toEqual({ success: false, error: 'strict host save rejected' });
    expect(h.applyBatch).toHaveBeenCalledOnce();
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('SQLite atomic batch 已推进业务行与 nextRowId 但持久化失败时整体 reload', async () => {
    const result = await runSqliteAtomicBatchCommit_ACU({
      source: 'manual_crud',
      reason: 'atomic batch rollback',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData),
      targetSheetKeys: ['sheet_a'],
      prepare: () => ({
        statements: ['INSERT INTO sheet_a (row_id, value) VALUES (?, ?)'],
        paramsList: [[2, 'after']],
        metadataUpdates: [{ sheetKey: 'sheet_a', sheet: clone(afterData.sheet_a) }],
        operations: [{ kind: 'sql_batch', statements: ['INSERT INTO sheet_a (row_id, value) VALUES (2, \'after\')'] }],
        mapValue: data => data.sheet_a.content.length,
      }),
    });

    expect(result).toEqual({ success: false, error: 'host persist failed' });
    expect(h.applyBatch).toHaveBeenCalledOnce();
    expect(h.applyBatch).toHaveBeenCalledWith(
      ['INSERT INTO sheet_a (row_id, value) VALUES (?, ?)'],
      [[2, 'after']],
      [{ sheetKey: 'sheet_a', sheet: clone(afterData.sheet_a) }],
      'atomic batch rollback',
      { includeImplicitReseed: false },
    );
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('SQLite atomic batch 的持久化 Promise reject 时仍整体 reload', async () => {
    h.persist.mockRejectedValueOnce(new Error('atomic strict save rejected'));

    const result = await runSqliteAtomicBatchCommit_ACU({
      source: 'manual_crud',
      reason: 'atomic batch reject rollback',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData),
      targetSheetKeys: ['sheet_a'],
      prepare: () => ({
        statements: ['INSERT INTO sheet_a (row_id, value) VALUES (?, ?)'],
        paramsList: [[2, 'after']],
        metadataUpdates: [{ sheetKey: 'sheet_a', sheet: clone(afterData.sheet_a) }],
        operations: [{ kind: 'sql_batch', statements: ['INSERT INTO sheet_a (row_id, value) VALUES (2, \'after\')'] }],
        mapValue: data => data.sheet_a.content.length,
      }),
    });

    expect(result).toEqual({ success: false, error: 'atomic strict save rejected' });
    expect(h.applyBatch).toHaveBeenCalledOnce();
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('持久化与 runtime reload 同时失败时保留两段错误诊断', async () => {
    h.persist.mockRejectedValueOnce(new Error('strict host save rejected'));
    h.reload.mockRejectedValueOnce(new Error('provider reload rejected'));

    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud',
      reason: 'double failure',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData),
      targetSheetKeys: ['sheet_a'],
      sql: 'INSERT INTO sheet_a (value) VALUES (?)',
      params: ['after'],
      mapValue: ({ mutationResult }) => mutationResult.changes,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('strict host save rejected');
    expect(result.error).toContain('provider reload rejected');
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('单条 mutation 将显式 reseed、业务 SQL、metadata 与 operations 同源提交', async () => {
    h.persist.mockResolvedValueOnce({ saved: true, messageIndex: 7 });
    const reseededSheet = { ...clone(beforeData.sheet_a), sourceData: { ...beforeData.sheet_a.sourceData, nextRowId: 2 } };
    h.prepareReseed.mockReturnValueOnce({
      statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'],
      paramsList: [[1, 'seed']],
      metadataUpdates: [{ sheetKey: 'sheet_a', sheet: reseededSheet }],
    });
    h.applyBatch.mockImplementationOnce(() => {
      h.providerData = clone(afterData);
      return { success: true, appliedEdits: 2, changes: 2, statementChanges: [1, 1] };
    });

    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud', reason: 'mutation reseed',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData), targetMessageIndex: 7, targetSheetKeys: ['sheet_a'],
      sql: 'UPDATE a SET value = ? WHERE row_id = ?', params: ['after', 1],
      mapValue: ({ mutationResult }) => mutationResult.changes,
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(1);
    expect(h.applyBatch).toHaveBeenCalledWith(
      ['INSERT INTO a (row_id, value) VALUES (?, ?)', 'UPDATE a SET value = ? WHERE row_id = ?'],
      [[1, 'seed'], ['after', 1]],
      [{ sheetKey: 'sheet_a', sheet: reseededSheet }],
      'mutation reseed',
      { includeImplicitReseed: false },
    );
    const operations = h.persist.mock.calls[0][0].operations;
    expect(operations).toEqual([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'], params: [[1, 'seed']], tableName: 'a', reason: 'system' },
      { kind: 'meta_update', sheetKey: 'sheet_a', meta: { sourceData: { nextRowId: 2 } } },
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['UPDATE a SET value = ? WHERE row_id = ?'], params: [['after', 1]], tableName: 'a', reason: 'system' },
    ]);
  });

  it('atomic batch 在 reseed metadata 上继续分配并持久化完整 operations', async () => {
    h.persist.mockResolvedValueOnce({ saved: true, messageIndex: 8 });
    const reseededSheet = { ...clone(beforeData.sheet_a), sourceData: { ...beforeData.sheet_a.sourceData, nextRowId: 3 } };
    h.prepareReseed.mockReturnValueOnce({
      statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'],
      paramsList: [[2, 'seed']],
      metadataUpdates: [{ sheetKey: 'sheet_a', sheet: reseededSheet }],
    });
    h.applyBatch.mockImplementationOnce(() => {
      h.providerData = clone(afterData);
      return { success: true, appliedEdits: 2, changes: 2, statementChanges: [1, 1] };
    });

    const result = await runSqliteAtomicBatchCommit_ACU({
      source: 'manual_crud', reason: 'atomic reseed',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData), targetMessageIndex: 8, targetSheetKeys: ['sheet_a'],
      prepare: ({ workingData }) => {
        expect(workingData?.sheet_a.sourceData.nextRowId).toBe(3);
        const businessSheet = { ...clone(workingData!.sheet_a), sourceData: { ...workingData!.sheet_a.sourceData, nextRowId: 4 } };
        return {
          statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'], paramsList: [[3, 'after']],
          metadataUpdates: [{ sheetKey: 'sheet_a', sheet: businessSheet }],
          operations: [
            { kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'], params: [[3, 'after']], tableName: 'a', reason: 'system' },
            { kind: 'meta_update', sheetKey: 'sheet_a', meta: { sourceData: { nextRowId: 4 } } },
          ],
          mapValue: () => true,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.mutationResult?.changes).toBe(1);
    expect(h.applyBatch.mock.calls[0][2][0].sheet.sourceData.nextRowId).toBe(4);
    expect(h.persist.mock.calls[0][0].operations).toHaveLength(4);
  });

  it('事务提交后严格 canonical 导出失败时恢复 runtime snapshot 且不持久化', async () => {
    h.persist.mockResolvedValueOnce({ saved: true, messageIndex: 9 });
    h.exportCanonicalData
      .mockImplementationOnce(() => clone(beforeData))
      .mockImplementationOnce(() => { throw new Error('canonical export failed after commit'); });

    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud', reason: 'post commit export failure',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData), targetMessageIndex: 9, targetSheetKeys: ['sheet_a'],
      sql: 'UPDATE a SET value = ? WHERE row_id = ?', params: ['after', 1],
      mapValue: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('canonical export failed after commit');
    expect(h.restoreSnapshot).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.setCurrentData).not.toHaveBeenCalled();
  });

  it('post-commit 导出与 snapshot 恢复同时失败时保留两段诊断', async () => {
    h.exportCanonicalData
      .mockImplementationOnce(() => clone(beforeData))
      .mockImplementationOnce(() => { throw new Error('canonical export failed after commit'); });
    h.restoreSnapshot.mockRejectedValueOnce(new Error('snapshot restore rejected'));

    const result = await runSqliteRuntimeMutationCommit_ACU({
      source: 'manual_crud', reason: 'post commit double failure',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      initialData: clone(beforeData), targetMessageIndex: 10, targetSheetKeys: ['sheet_a'],
      sql: 'UPDATE a SET value = ? WHERE row_id = ?', params: ['after', 1],
      mapValue: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('canonical export failed after commit');
    expect(result.error).toContain('snapshot restore rejected');
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('全量替换后 strict canonical 导出失败时恢复 SQLite snapshot', async () => {
    const provider = {
      mode: 'sqlite' as const,
      getCurrentData: vi.fn(() => clone(h.providerData)),
      exportCanonicalData: h.exportCanonicalData,
      createRuntimeSnapshot: h.createSnapshot,
      restoreRuntimeSnapshot: h.restoreSnapshot,
      replaceAllData: h.replaceAllData,
      clearRuntimeData: h.clearRuntimeData,
    } as any;
    h.exportCanonicalData.mockImplementationOnce(() => { throw new Error('replace canonical export failed'); });

    await expect(replaceRuntimeDataStrict_ACU(provider, clone(afterData))).rejects.toThrow('replace canonical export failed');

    expect(h.replaceAllData).toHaveBeenCalledWith(afterData);
    expect(h.restoreSnapshot).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
  });

  it('SQLite replaceAllData 返回失败时仍恢复 snapshot', async () => {
    const provider = {
      mode: 'sqlite' as const,
      getCurrentData: vi.fn(() => clone(h.providerData)),
      exportCanonicalData: h.exportCanonicalData,
      createRuntimeSnapshot: h.createSnapshot,
      restoreRuntimeSnapshot: h.restoreSnapshot,
      replaceAllData: h.replaceAllData,
      clearRuntimeData: h.clearRuntimeData,
    } as any;
    h.replaceAllData.mockImplementationOnce(async () => {
      h.providerData = null;
      return { success: false, appliedEdits: 0, modifiedKeys: [], error: 'hydrate rejected' };
    });

    await expect(replaceRuntimeDataStrict_ACU(provider, clone(afterData))).rejects.toThrow('hydrate rejected');

    expect(h.restoreSnapshot).toHaveBeenCalledOnce();
    expect(h.providerData).toEqual(beforeData);
  });

  it('全量替换提交持久化 strict canonical data 而不是原始输入快照', async () => {
    h.persist.mockResolvedValueOnce({ saved: true, messageIndex: 11 });
    const canonicalData = clone(afterData);
    canonicalData.sheet_a.name = 'Canonical A';
    h.exportCanonicalData.mockImplementationOnce(() => clone(canonicalData));

    const result = await runRuntimeDataReplaceCommit_ACU({
      source: 'import', reason: 'strict replace commit', writeSet: [{ kind: 'all' }],
      initialData: clone(beforeData), targetMessageIndex: 11, targetSheetKeys: ['sheet_a'],
      replacementData: clone(afterData), replacementReason: 'import', mapValue: data => data.sheet_a.name,
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe('Canonical A');
    expect(h.persist.mock.calls[0][0].tableData).toEqual(canonicalData);
    expect(h.persist.mock.calls[0][0].operations).toEqual([
      { kind: 'data_replace', data: canonicalData, reason: 'import' },
    ]);
  });

});

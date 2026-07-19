/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const runtimeMock = vi.hoisted(() => {
  let currentData: Record<string, any> = {};
  return {
    get currentJsonTableData_ACU() {
      return currentData;
    },
    getCurrentData: () => currentData,
    resetCurrentData: () => {
      currentData = {};
    },
    _set_currentJsonTableData_ACU: vi.fn((next: Record<string, any>) => {
      currentData = next;
    }),
    getCurrentIsolationKey_ACU: vi.fn(() => 'iso-test'),
    settings_ACU: {},
  };
});

const serviceMock = vi.hoisted(() => ({
  deleteLocalDataInChatCore_ACU: vi.fn(async () => 1),
  replayData: null as Record<string, any> | null,
  getChatArray_ACU: vi.fn(() => [{ mes: 'ai message' }]),
  saveChatToHost_ACU: vi.fn(async () => undefined),
  commitCurrentChatTemplateChangesAtomic_ACU: vi.fn(async () => ({
    success: true,
    changed: true,
    resetMessageCount: 0,
    purgedMessageCount: 0,
  })),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set<number>(), cols: new Set<number>(), cells: new Set<string>() })),
  saveTableLocksForSheet_ACU: vi.fn(),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  commitTableLockDraftsBatch_ACU: vi.fn(() => ({
    success: true, changed: true, warning: '',
    snapshot: { scopeKey: 'test::iso-test', hasTableLocks: false, tableLocks: null, hasSpecialIndexLocks: false, specialIndexLocks: null },
  })),
  restoreCurrentTableLocksSnapshot_ACU: vi.fn(() => ({ success: true, warning: '' })),
  getCurrentWorldbookConfig_ACU: vi.fn(() => ({ summaryVectorIndexModeEnabled: false })),
  saveIndependentTableToChatHistory_ACU: vi.fn(async () => undefined),
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn(async () => ({ success: true, migrated: false })),
  runTableUpdateCommit_ACU: vi.fn(async (options: any, apply: any) => {
    const workingData = options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : runtimeMock.getCurrentData();
    const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData });
    if (applied.tableData) runtimeMock._set_currentJsonTableData_ACU(applied.tableData);
    return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
  }),
  getLatestAiMessageIndexFromChat_ACU: vi.fn(() => 0),
  getLatestTableAppendMessageIndexFromChat_ACU: vi.fn(() => 0),
  getLatestV2FullCheckpointMessageIndex_ACU: vi.fn(() => 0),
  getLatestV2SheetReplayMessageIndex_ACU: vi.fn(() => -1),
  resolveTableHistoryStateFromChat_ACU: vi.fn(() => ({
    latestDataMessageIndex: -1,
    latestAiMessageIndex: 0,
    latestDataAiFloor: 0,
  })),
  isSqliteMode: vi.fn(() => false),
  runTableWriteTransaction_ACU: vi.fn(async (_options: any, task: any) => task({
    baseRevision: 'test', writeSet: [], assertFresh: vi.fn(), runCommit: async (commit: any) => commit(),
  }, runtimeMock.getCurrentData())),
  persistTableMutationLogBatchV2_ACU: vi.fn(async (options: any) => {
    serviceMock.replayData = options.afterData;
    return { saved: true, messageIndices: [0] };
  }),
  loadTableStateFromFramesV2_ACU: vi.fn(async () => serviceMock.replayData || runtimeMock.getCurrentData()),
  ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU: vi.fn(async () => ({ success: true, dataWasReset: false })),
  validateCurrentChatTableRecoveryWithGuide_ACU: vi.fn(async () => ({ success: true })),
  reloadStorageProvider: vi.fn(async () => undefined),
  applyTemplateScopeForCurrentChat_ACU: vi.fn(() => ({ mode: 'chat_override' })),
  buildChatSheetGuideDataFromData_ACU: vi.fn((data: Record<string, any>) => data),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => ({ templateObj: { mate: { type: 'chatSheets', version: 1 } } })),
  getSortedSheetKeys_ACU: vi.fn((data: Record<string, any>) =>
    Object.keys(data || {}).filter(key => key.startsWith('sheet_')),
  ),
  materializeDataFromSheetGuide_ACU: vi.fn((data: Record<string, any>) => data),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => ({ templateStr: '{"mate":{"type":"chatSheets","version":1}}' })),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  applyTemplatePresetToCurrent_ACU: vi.fn(async () => true),
  resolveActiveTemplatePresetName_ACU: vi.fn(() => '现有预设'),
  upsertTemplatePreset_ACU: vi.fn(() => true),
  getGlobalInjectionConfigFromData_ACU: vi.fn(() => ({})),
  purgeSheetKeysFromChatHistoryHard_ACU: vi.fn(async () => ({ changed: true })),
  refreshMergedDataAndNotify_ACU: vi.fn(async () => undefined),
  updateReadableLorebookEntry_ACU: vi.fn(async () => undefined),
  enqueueSummaryVectorIndexFlush_ACU: vi.fn(async () => undefined),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => runtimeMock);
vi.mock('../../../src/service/chat/chat-service', () => ({
  deleteLocalDataInChatCore_ACU: serviceMock.deleteLocalDataInChatCore_ACU,
  getChatArray_ACU: serviceMock.getChatArray_ACU,
  saveChatToHost_ACU: serviceMock.saveChatToHost_ACU,
  commitCurrentChatTemplateChangesAtomic_ACU: serviceMock.commitCurrentChatTemplateChangesAtomic_ACU,
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applySpecialIndexSequenceToSummaryTables_ACU: serviceMock.applySpecialIndexSequenceToSummaryTables_ACU,
  getTableLocksForSheet_ACU: serviceMock.getTableLocksForSheet_ACU,
  saveTableLocksForSheet_ACU: serviceMock.saveTableLocksForSheet_ACU,
  setSpecialIndexLockEnabled_ACU: serviceMock.setSpecialIndexLockEnabled_ACU,
  commitTableLockDraftsBatch_ACU: serviceMock.commitTableLockDraftsBatch_ACU,
  restoreCurrentTableLocksSnapshot_ACU: serviceMock.restoreCurrentTableLocksSnapshot_ACU,
}));
vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: serviceMock.getCurrentWorldbookConfig_ACU,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: serviceMock.saveIndependentTableToChatHistory_ACU,
  ensureLegacyStorageMigratedBeforeWrite_ACU: serviceMock.ensureLegacyStorageMigratedBeforeWrite_ACU,
}));
vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: serviceMock.runTableUpdateCommit_ACU,
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestAiMessageIndexFromChat_ACU: serviceMock.getLatestAiMessageIndexFromChat_ACU,
  getLatestTableAppendMessageIndexFromChat_ACU: serviceMock.getLatestTableAppendMessageIndexFromChat_ACU,
  getLatestV2FullCheckpointMessageIndex_ACU: serviceMock.getLatestV2FullCheckpointMessageIndex_ACU,
  getLatestV2SheetReplayMessageIndex_ACU: serviceMock.getLatestV2SheetReplayMessageIndex_ACU,
  resolveTableHistoryStateFromChat_ACU: serviceMock.resolveTableHistoryStateFromChat_ACU,
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: serviceMock.isSqliteMode,
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  validateCurrentChatTableRecoveryWithGuide_ACU: serviceMock.validateCurrentChatTableRecoveryWithGuide_ACU,
  loadTableStateFromFramesV2_ACU: serviceMock.loadTableStateFromFramesV2_ACU,
}));
vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistTableMutationLogBatchV2_ACU: serviceMock.persistTableMutationLogBatchV2_ACU,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: serviceMock.runTableWriteTransaction_ACU,
}));
vi.mock('../../../src/presentation-v2/composables/useTemplateRecoveryGuard', () => ({
  ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU: serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: serviceMock.applyTemplateScopeForCurrentChat_ACU,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: serviceMock.reloadStorageProvider,
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromData_ACU: serviceMock.buildChatSheetGuideDataFromData_ACU,
  getChatSheetGuideDataForIsolationKey_ACU: serviceMock.getChatSheetGuideDataForIsolationKey_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: serviceMock.getGlobalTemplateSnapshotForCurrentProfile_ACU,
  getSortedSheetKeys_ACU: serviceMock.getSortedSheetKeys_ACU,
  materializeDataFromSheetGuide_ACU: serviceMock.materializeDataFromSheetGuide_ACU,
  sanitizeTemplateSnapshotForChat_ACU: serviceMock.sanitizeTemplateSnapshotForChat_ACU,
  setChatSheetGuideDataForIsolationKey_ACU: serviceMock.setChatSheetGuideDataForIsolationKey_ACU,
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyTemplatePresetToCurrent_ACU: serviceMock.applyTemplatePresetToCurrent_ACU,
  resolveActiveTemplatePresetName_ACU: serviceMock.resolveActiveTemplatePresetName_ACU,
  upsertTemplatePreset_ACU: serviceMock.upsertTemplatePreset_ACU,
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getGlobalInjectionConfigFromData_ACU: serviceMock.getGlobalInjectionConfigFromData_ACU,
  purgeSheetKeysFromChatHistoryHard_ACU: serviceMock.purgeSheetKeysFromChatHistoryHard_ACU,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: serviceMock.refreshMergedDataAndNotify_ACU,
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  enqueueSummaryVectorIndexFlush_ACU: serviceMock.enqueueSummaryVectorIndexFlush_ACU,
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => toastMock,
}));

function sheet(name = '角色状态') {
  return {
    uid: 'sheet_test_vz2',
    name,
    orderNo: 0,
    content: [[null, '姓名', '数量'], ['1', 'A', '1']],
  };
}

describe('useVisualizerSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    runtimeMock.resetCurrentData();
    serviceMock.replayData = null;
    vi.clearAllMocks();
  });

  it('保存数据到当前消息会提交数据增量并清理 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();
    store.updateCell(0, 1, '2');

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(true);
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledTimes(1);
    expect(runtimeMock.getCurrentData().sheet_test_vz2.content[1][2]).toBe('2');
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual_crud',
      targets: [expect.objectContaining({ targetMessageIndex: 0, changedSheetKeys: ['sheet_test_vz2'] })],
    }));
    const persistOptions = serviceMock.persistTableMutationLogBatchV2_ACU.mock.calls[0][0];
    expect(persistOptions.targets[0].operations).toEqual([{
      kind: 'row_upsert', sheetKey: 'sheet_test_vz2', rowId: '1', cells: ['1', 'A', '2'],
    }]);
    expect(JSON.stringify(persistOptions.targets[0].operations)).not.toContain('sql_batch');
    expect(JSON.stringify(persistOptions.targets[0].operations)).not.toContain('UPDATE');
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('data');
  });

  it('纯锁草稿可独立保存，不要求存在数据增量', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.loadLockDrafts({ sheet_test_vz2: { rows: [], cols: [], cells: [], specialIndexLocked: true } });
    store.tableLockDrafts.sheet_test_vz2.specialIndexLocked = false;
    store.markLockDraftChanged();

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(true);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitTableLockDraftsBatch_ACU).toHaveBeenCalledOnce();
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('locks');
  });

  it('特殊索引锁与行数据混合保存时同时提交 V2 增量和锁设置', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = { mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.loadLockDrafts({ sheet_test_vz2: { rows: [], cols: [], cells: [], specialIndexLocked: false } });
    store.updateCell(0, 1, '2');
    store.tableLockDrafts.sheet_test_vz2.specialIndexLocked = true;
    store.markLockDraftChanged();

    expect(await useVisualizerSave().saveToChat()).toBe(true);

    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(serviceMock.commitTableLockDraftsBatch_ACU).toHaveBeenCalledOnce();
    expect(store.pendingDataOps?.committed).toBeUndefined();
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('data');
  });

  it('数据已持久化后锁保存失败，重试只恢复 replay 而不重复追加 V2 entry', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = { mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.loadLockDrafts({ sheet_test_vz2: { rows: [], cols: [], cells: [], specialIndexLocked: false } });
    store.updateCell(0, 1, '2');
    store.tableLockDrafts.sheet_test_vz2.specialIndexLocked = true;
    store.markLockDraftChanged();
    serviceMock.commitTableLockDraftsBatch_ACU.mockReturnValueOnce({
      success: false, changed: false, warning: 'settings failed',
      snapshot: { scopeKey: 'test::iso-test', hasTableLocks: false, tableLocks: null, hasSpecialIndexLocks: false, specialIndexLocks: null },
    });

    const save = useVisualizerSave();
    expect(await save.saveToChat()).toBe(false);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(store.pendingDataOps?.committed).toBeDefined();
    expect(store.lockDirty).toBe(true);
    expect(store.dirty).toBe(true);

    expect(await save.saveToChat()).toBe(true);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(serviceMock.loadTableStateFromFramesV2_ACU).toHaveBeenCalledTimes(2);
    expect(serviceMock.commitTableLockDraftsBatch_ACU).toHaveBeenCalledTimes(2);
    expect(store.pendingDataOps?.committed).toBeUndefined();
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it('模板恢复检查等待期间草稿变化时拒绝陈旧提交并保留新草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '待保存名称';
    store.templateDirty = true;
    store.setDirty(true);

    let resolveGuard!: (value: { success: boolean; dataWasReset: boolean }) => void;
    serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU.mockImplementationOnce(() => new Promise(resolve => {
      resolveGuard = resolve;
    }));
    const saving = useVisualizerSave().saveTemplateToCurrentChat();
    await Promise.resolve();
    store.currentSheet.name = '等待期间的新名称';
    store.setDirty(true);
    resolveGuard({ success: true, dataWasReset: false });

    expect(await saving).toBe(false);
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).not.toHaveBeenCalled();
    expect(store.currentSheet.name).toBe('等待期间的新名称');
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('保存期间草稿已发生变化'), expect.any(Object));
  });

  it('存在模板结构草稿时数据保存拒绝执行且不清理 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.addSheet('sheet_new', { uid: 'sheet_new', name: '新表', orderNo: 1, content: [[null, '字段']] });

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(false);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('数据保存不会持久化这些修改'),
      expect.any(Object),
    );
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
    expect(store.lastSavedTarget).toBeNull();
  });

  it('后置刷新失败后保留 committed，重试不重复持久化且禁止继续编辑', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.updateCell(0, 1, '2');
    serviceMock.refreshMergedDataAndNotify_ACU.mockRejectedValueOnce(new Error('merged refresh failed'));

    const firstSave = await useVisualizerSave().saveToChat();

    expect(firstSave).toBe(false);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(store.pendingDataOps?.committed).toBeDefined();
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('数据已持久化，但本地刷新失败：merged refresh failed'),
      expect.any(Object),
    );
    const beforeEdit = JSON.parse(JSON.stringify(store.tempData));
    expect(() => store.updateCell(0, 1, '3')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.addRow()).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.deleteRow(0)).toThrow('数据已持久化但本地刷新尚未完成');
    expect(store.tempData).toEqual(beforeEdit);

    const retrySave = await useVisualizerSave().saveToChat();

    expect(retrySave).toBe(true);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(serviceMock.loadTableStateFromFramesV2_ACU).toHaveBeenCalledTimes(2);
    expect(store.pendingDataOps?.committed).toBeUndefined();
    expect(store.dirty).toBe(false);
  });

  it('merged 刷新失败时保留临时 row_id，恢复成功后才同步正式 row_id', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = { mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    store.addRow();
    const temporaryId = String(store.currentSheet.content[2][0]);
    serviceMock.refreshMergedDataAndNotify_ACU.mockRejectedValueOnce(new Error('merged refresh failed'));

    expect(await useVisualizerSave().saveToChat()).toBe(false);
    expect(store.currentSheet.content[2][0]).toBe(temporaryId);
    expect(store.pendingDataOps?.committed?.insertedRowIds[temporaryId]).toBe('2');

    expect(await useVisualizerSave().saveToChat()).toBe(true);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledOnce();
    expect(store.currentSheet.content[2][0]).toBe('2');
  });

  it('保存到全局模板被取消时不写入聊天、不清理 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('取消测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => false),
    }).saveToGlobal();

    expect(saved).toBe(false);
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(serviceMock.upsertTemplatePreset_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveIndependentTableToChatHistory_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
    expect(store.lastSavedTarget).toBeNull();
  });

  it('保存模板到全局确认后会写入当前可视化草稿，不混入旧全局模板', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    serviceMock.getGlobalTemplateSnapshotForCurrentProfile_ACU.mockReturnValueOnce({
      templateStr: '{"mate":{"type":"chatSheets","version":1},"sheet_old":{"name":"旧表","content":[["row_id"]]}}',
      templateObj: { mate: { type: 'chatSheets', version: 1 }, sheet_old: { name: '旧表', content: [['row_id']] } },
    });
    serviceMock.sanitizeTemplateSnapshotForChat_ACU.mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    }));
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('确认测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => true),
    }).saveToGlobal();

    expect(saved).toBe(true);
    expect(serviceMock.upsertTemplatePreset_ACU).toHaveBeenCalledWith('现有预设', expect.any(String));
    const savedTemplate = JSON.parse(serviceMock.upsertTemplatePreset_ACU.mock.calls[0][1]);
    expect(savedTemplate.sheet_test_vz2.name).toBe('确认测试表');
    expect(savedTemplate.sheet_test_vz2.content).toEqual([[null, '姓名', '数量']]);
    expect(savedTemplate.sheet_old).toBeUndefined();
    expect(serviceMock.applyTemplatePresetToCurrent_ACU).toHaveBeenCalledWith('现有预设', expect.objectContaining({
      source: 'visualizer_v2_save_to_global',
      updateGlobal: true,
      save: true,
      persistChatScope: false,
    }));
    expect(serviceMock.runTableUpdateCommit_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('template-global');
  });

  it('保存独立导出位置时用本次草稿同步聊天指导表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: {
        ...sheet('独立导出表'),
        exportConfig: {
          enabled: true,
          entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        },
      },
    }, ['sheet_test_vz2']);
    store.currentSheet.exportConfig.entryPlacement = {
      position: 'at_depth_as_system',
      depth: 7,
      order: 12345,
    };
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(runtimeMock.getCurrentData().sheet_test_vz2.exportConfig.entryPlacement).toEqual({
      position: 'at_depth_as_system',
      depth: 7,
      order: 12345,
    });
    expect(serviceMock.buildChatSheetGuideDataFromData_ACU).toHaveBeenCalledWith(
      expect.objectContaining({
        sheet_test_vz2: expect.objectContaining({
          exportConfig: expect.objectContaining({
            entryPlacement: { position: 'at_depth_as_system', depth: 7, order: 12345 },
          }),
        }),
      }),
      expect.objectContaining({
        orderedKeys: ['sheet_test_vz2'],
      }),
    );
  });

  it('保存模板到当前聊天会写入聊天模板快照并刷新运行时结构', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU).toHaveBeenCalledWith(expect.any(Object), 'save-template');
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: 'iso-test',
      guideData: expect.any(Object),
      templateSource: expect.objectContaining({
        sheet_test_vz2: expect.objectContaining({ name: '新表名' }),
      }),
      presetName: '现有预设',
      deletedSheetKeys: [],
      resetCurrentIsolationData: false,
    }));
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheet_test_vz2: expect.objectContaining({ name: '新表名' }),
    }));
    expect(serviceMock.refreshMergedDataAndNotify_ACU).toHaveBeenCalled();
    expect(store.lastSavedTarget).toBe('template-chat');
  });

  it('保存聊天模板需要重置旧数据时，统一 guard 通过后继续保存', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('结构变更表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);
    serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU.mockResolvedValueOnce({ success: true, dataWasReset: true });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU).toHaveBeenCalledWith(expect.any(Object), 'save-template');
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).toHaveBeenCalledWith(expect.objectContaining({
      resetCurrentIsolationData: true,
    }));
    expect(store.lastSavedTarget).toBe('template-chat');
  });

  it('保存聊天模板被统一 guard 拦截时，不保存模板', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('结构变更表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);
    serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU.mockResolvedValueOnce({ success: false, dataWasReset: false });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).not.toHaveBeenCalled();
    expect(store.lastSavedTarget).toBeNull();
  });

  it('锁 settings 前置保存失败时不进入聊天模板事务且保留 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('锁失败表'),
    }, ['sheet_test_vz2']);
    store.queueLockChanges([{ sheetKey: 'sheet_test_vz2', rows: [{ rowIndex: 0, locked: true }] }]);
    serviceMock.commitTableLockDraftsBatch_ACU.mockReturnValueOnce({
      success: false,
      changed: true,
      warning: '设置仍在加载',
      snapshot: { scopeKey: 'test::iso-test', hasTableLocks: false, tableLocks: null, hasSpecialIndexLocks: false, specialIndexLocks: null },
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).not.toHaveBeenCalled();
    expect(serviceMock.restoreCurrentTableLocksSnapshot_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
    expect(store.pendingLockChanges).not.toEqual([]);
    expect(store.lastSavedTarget).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith('设置仍在加载', expect.any(Object));
  });

  it('聊天模板事务失败时补偿恢复已保存的锁且保留草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('事务失败表'),
    }, ['sheet_test_vz2']);
    store.queueLockChanges([{ sheetKey: 'sheet_test_vz2', rows: [{ rowIndex: 0, locked: true }] }]);
    const snapshot = {
      scopeKey: 'test::iso-test',
      hasTableLocks: true,
      tableLocks: { sheet_test_vz2: { rows: [], cols: [], cells: [] } },
      hasSpecialIndexLocks: true,
      specialIndexLocks: { sheet_test_vz2: true },
    };
    serviceMock.commitTableLockDraftsBatch_ACU.mockReturnValueOnce({ success: true, changed: true, warning: '', snapshot });
    serviceMock.commitCurrentChatTemplateChangesAtomic_ACU.mockResolvedValueOnce({
      success: false, changed: false, resetMessageCount: 0, purgedMessageCount: 0, error: 'strict save failed',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.restoreCurrentTableLocksSnapshot_ACU).toHaveBeenCalledWith(snapshot);
    expect(store.dirty).toBe(true);
    expect(store.pendingLockChanges).not.toEqual([]);
    expect(store.lastSavedTarget).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith('strict save failed', expect.any(Object));
  });

  it('保存时提交 AI 助手暂存的锁变化并在成功后清空队列', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.queueLockChanges([
      {
        sheetKey: 'sheet_test_vz2',
        rows: [{ rowIndex: 0, locked: true }],
        columns: [{ colIndex: 1, locked: true }],
        cells: [{ rowIndex: 0, colIndex: 1, locked: false }],
        specialIndexLocked: false,
      },
    ]);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitTableLockDraftsBatch_ACU).toHaveBeenCalledWith({
      deletedSheetKeys: [],
      drafts: expect.objectContaining({
        sheet_test_vz2: expect.objectContaining({ specialIndexLocked: false }),
      }),
    });
    expect(store.pendingLockChanges).toEqual([]);
  });

  it('删表后拒绝继续编辑行，保存层也拒绝外部注入的混合状态', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    };
    store.loadSnapshot(initialData, ['sheet_keep', 'sheet_delete']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();

    store.deleteSheet('sheet_delete');
    expect(() => store.updateCell(0, 1, '保留表更新')).toThrow('存在待保存的删表操作');
    store.pendingDataOps = {
      updatesByRow: {
        'sheet_keep::1': { kind: 'updateRow', sheetKey: 'sheet_keep', rowId: '1', data: { 数量: '保留表更新' } },
      },
      insertsByClientRowId: {},
      deletesByRow: {},
    };

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(false);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('数据保存不会持久化这些修改'), expect.any(Object));
    expect(store.deletedSheetKeys).toEqual(['sheet_delete']);
  });

  it('只删除整张表且没有行级增量时走当前聊天模板原子提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    };
    store.loadSnapshot(initialData, ['sheet_keep', 'sheet_delete']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();

    store.deleteSheet('sheet_delete');

    expect(await useVisualizerSave().saveToChat()).toBe(false);
    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.runTableUpdateCommit_ACU).not.toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentChatTemplateChangesAtomic_ACU).toHaveBeenCalledWith(expect.objectContaining({
      deletedSheetKeys: ['sheet_delete'],
    }));
    expect(serviceMock.commitTableLockDraftsBatch_ACU).toHaveBeenCalledWith(expect.objectContaining({
      deletedSheetKeys: ['sheet_delete'],
    }));
    expect(serviceMock.refreshMergedDataAndNotify_ACU).toHaveBeenCalled();
    expect(store.deletedSheetKeys).toEqual([]);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('template-chat');
  });
});

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`等待条件超时：${label}`);
}

async function importManualUpdate() {
  vi.resetModules();
  const settings: any = {
    autoUpdateThreshold: 3,
    updateBatchSize: 2,
    manualUpdateContextDepth: 3,
    manualUpdateBatchSize: 2,
    manualUpdateSkipFloors: 1,
    manualUpdateMaxConcurrentGroups: 2,
    manualSelectedTables: ['sheet_0'],
    hasManualSelection: true,
  };
  const currentJsonTableData: any = {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
  };
  const chat = [{ is_user: false, mes: 'AI 1' }];
  const orchestrateManualUpdate_ACU = vi.fn();
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const setWasStoppedByUser = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: currentJsonTableData,
    settings_ACU: settings,
    abortAllActiveRequests_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    _set_manualExtraHint_ACU: vi.fn(),
    _set_wasStoppedByUser_ACU: setWasStoppedByUser,
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: vi.fn(() => chat),
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: vi.fn(() => ({ summaryVectorIndexModeEnabled: false })),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (tables: Record<string, unknown>) => Object.keys(tables),
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: vi.fn(() => [{ messageIndex: 0, aiFloor: 1, reason: 'init' }]),
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    executeCardUpdateCore_ACU: vi.fn(),
    orchestrateManualUpdate_ACU,
    processUpdatesBatch_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    refreshMergedDataAndNotify_ACU,
  }));
  vi.doMock('../../../src/shared/env', () => ({
    topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } },
  }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useManualUpdate }, { useDialogStore }, { useToastStore, __resetToastStoreForTests }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useManualUpdate'),
    import('../../../src/presentation-v2/stores/dialog-store'),
    import('../../../src/presentation-v2/stores/toast-store'),
  ]);
  return {
    useManualUpdate,
    dialog: useDialogStore(),
    toast: useToastStore(),
    __resetToastStoreForTests,
    orchestrateManualUpdate_ACU,
    refreshMergedDataAndNotify_ACU,
    settings,
    setWasStoppedByUser,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useManualUpdate manual refill contract', () => {
  it('确认文案说明先清理且后续失败不回滚', async () => {
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');

    expect(dialog.active?.message).toContain('先原子清除本次范围内选中表的旧数据');
    expect(dialog.active?.message).toContain('已成功写入的批次也会保留');
    expect(dialog.active?.message).toContain('不会执行整会话回滚');
    expect(dialog.active?.message).not.toContain('第二次破坏性确认');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('一次确认后只调用一次 orchestrator，并传入独立手动参数', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, settings, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      contextDepth: 3,
      skipFloors: 1,
      batchSize: 2,
      maxConcurrentGroups: 2,
      onProgress: expect.any(Function),
    }));
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    __resetToastStoreForTests();
  });

  it('orchestrator 失败时直接展示错误，不发起二次确认', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: false, error: 'AI failed' });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(dialog.active).toBeNull();
    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('AI failed');
    __resetToastStoreForTests();
  });
});

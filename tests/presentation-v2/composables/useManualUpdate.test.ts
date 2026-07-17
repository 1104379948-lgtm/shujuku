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
    skipUpdateFloors: 0,
    maxConcurrentGroups: 1,
    manualSelectedTables: ['sheet_0'],
    hasManualSelection: true,
  };
  const currentJsonTableData: any = {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
  };
  const chat = [{ is_user: false, mes: 'AI 1' }];
  const orchestrateManualUpdate_ACU = vi.fn();
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const abortAllActiveRequests_ACU = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: currentJsonTableData,
    settings_ACU: settings,
    abortAllActiveRequests_ACU,
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    _set_manualExtraHint_ACU: vi.fn(),
    _set_wasStoppedByUser_ACU: vi.fn(),
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
    settings,
    toast: useToastStore(),
    __resetToastStoreForTests,
    orchestrateManualUpdate_ACU,
    refreshMergedDataAndNotify_ACU,
    abortAllActiveRequests_ACU,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useManualUpdate 单次确认与显式参数', () => {
  it('确认文案准确说明范围清理、逐批保存与中断保留', async () => {
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');

    expect(dialog.active?.message).toContain('原子清理本次范围内选中表的旧数据');
    expect(dialog.active?.message).toContain('每个已完成批次会立即保存并保留');
    expect(dialog.active?.message).toContain('不会自动续跑');
    expect(dialog.active?.message).not.toContain('第二次破坏性确认');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('只调用一次编排器，显式传递手动参数且不污染自动设置', async () => {
    const { useManualUpdate, dialog, settings, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    settings.autoUpdateThreshold = 9;
    settings.updateBatchSize = 8;
    settings.manualUpdateContextDepth = 4;
    settings.manualUpdateBatchSize = 5;
    settings.skipUpdateFloors = 2;
    settings.maxConcurrentGroups = 3;
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      clearBeforeUpdate: true,
      manualContextDepth: 4,
      manualBatchSize: 5,
      manualSkipFloors: 2,
      manualMaxConcurrentGroups: 3,
    }));
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).not.toHaveProperty('confirmBoundaryReset');
    expect(settings.autoUpdateThreshold).toBe(9);
    expect(settings.updateBatchSize).toBe(8);
    __resetToastStoreForTests();
  });

  it('终止按钮只中止本次手动任务 controller，不调用全局 abort', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, abortAllActiveRequests_ACU, __resetToastStoreForTests } = await importManualUpdate();
    let resolveOrchestration!: (value: { success: boolean; error?: string }) => void;
    orchestrateManualUpdate_ACU.mockImplementationOnce((_keys, _processBatch, _refresh, options) => new Promise(resolve => {
      expect(options.abortController).toBeInstanceOf(AbortController);
      resolveOrchestration = resolve;
    }));
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '手动编排器启动');

    const options = orchestrateManualUpdate_ACU.mock.calls[0][3];
    const taskController = options.abortController as AbortController;
    const stopAction = toast.items.find(item => item.action?.label === '终止')?.action;
    expect(stopAction).toBeDefined();
    await stopAction!.onClick();

    expect(taskController.signal.aborted).toBe(true);
    expect(abortAllActiveRequests_ACU).not.toHaveBeenCalled();
    resolveOrchestration({ success: false, error: '手动更新已终止，已完成批次已保留。' });
    await pending;
    __resetToastStoreForTests();
  });

  it('失败时显示错误，不尝试第二次危险确认', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: false, error: '第三批保存失败，前序批次已保留。' });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动填表确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('前序批次已保留');
    __resetToastStoreForTests();
  });
});

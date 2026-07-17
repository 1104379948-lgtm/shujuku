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
    manualSelectedTables: ['sheet_0'],
    hasManualSelection: true,
  };
  const currentJsonTableData: any = {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
    sheet_1: { name: '角色表', content: [['row_id', '名称']] },
  };
  const chat = [{ is_user: false, mes: 'AI 1' }];
  const orchestrateManualUpdate_ACU = vi.fn();
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const setWasStoppedByUser = vi.fn();
  const abortAllActiveRequests_ACU = vi.fn();
  const setIsAutoUpdatingCard = vi.fn();
  const resolveTableHistoryStateFromChat_ACU = vi.fn((_chat: any[], options: any) => ({
    latestAiMessageIndex: 0,
    latestDataMessageIndex: -1,
    lastTrackedUpdateMessageIndex: -1,
    latestDataAiFloor: 0,
    lastTrackedUpdateAiFloor: 0,
    hasAnyData: false,
    hasTrackedUpdate: false,
    sheetKey: options.sheetKey,
  }));

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: currentJsonTableData,
    settings_ACU: settings,
    abortAllActiveRequests_ACU,
    _set_isAutoUpdatingCard_ACU: setIsAutoUpdatingCard,
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
    resolveTableHistoryStateFromChat_ACU,
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
    settings,
    chat,
    currentJsonTableData,
    refreshMergedDataAndNotify_ACU,
    setWasStoppedByUser,
    abortAllActiveRequests_ACU,
    setIsAutoUpdatingCard,
    resolveTableHistoryStateFromChat_ACU,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useManualUpdate destructive boundary confirmation', () => {
  const requiresConfirmation = {
    success: false,
    requiresUserConfirmation: {
      reason: 'manual_refill_replace_sheet_baseline',
      replayErrorCode: 'no_full_checkpoint_replayable',
      message: '重填起点前没有可回放 checkpoint。',
      contextScopeIndices: [0],
      targetSheetKeys: ['sheet_0'],
    },
  };

  it('首次确认文案只说明边界检查，不承诺空基底或立即替换 checkpoint', async () => {
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');

    expect(dialog.active?.title).toBe('执行手动填表');
    expect(dialog.active?.message).toContain('先在 service 层做重填边界检查');
    expect(dialog.active?.message).toContain('第二次破坏性确认');
    expect(dialog.active?.message).not.toContain('从表头空基底开始');
    expect(dialog.active?.message).not.toContain('执行前会先删除');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('用户取消二次确认时不第二次调用 orchestrator，且不展示 error toast', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValueOnce(requiresConfirmation);
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '首次 orchestrator 调用完成');
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '破坏性二次确认弹窗出现');
    expect(dialog.active?.title).toBe('破坏性手动重填确认');
    expect(dialog.active?.message).toContain('高风险操作：确认后会在一次提交中删除本次重填范围内选中表的旧表基底');
    expect(dialog.active?.message).toContain('写入新的单表 checkpoint');
    expect(dialog.active?.message).toContain('范围外 checkpoint、范围外聊天记录表格数据和未选中的表不会被删除');
    expect(dialog.active?.dangerMessage).toContain('此操作不可撤销');
    expect(dialog.active?.dangerMessage).toContain('取消将不会执行基底替换');
    expect(dialog.active?.dangerMessage).toContain('不会写入新的单表 checkpoint');

    dialog.cancelActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.some(item => item.kind === 'error')).toBe(false);
    expect(toast.items.at(-1)?.kind).toBe('info');
    expect(toast.items.at(-1)?.text).toContain('已取消破坏性基底替换');
    __resetToastStoreForTests();
  });

  it('用户确认二次确认时第二次调用传入 confirmBoundaryReset=true', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU
      .mockResolvedValueOnce(requiresConfirmation)
      .mockResolvedValueOnce({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '首次 orchestrator 调用完成');
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '破坏性二次确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(2);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({ clearBeforeUpdate: true, confirmBoundaryReset: false }));
    expect(orchestrateManualUpdate_ACU.mock.calls[1][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][3]).toEqual(expect.objectContaining({ clearBeforeUpdate: true, confirmBoundaryReset: true }));
    __resetToastStoreForTests();
  });

  it('二次确认后的 orchestrator 失败时展示 error toast', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU
      .mockResolvedValueOnce(requiresConfirmation)
      .mockResolvedValueOnce({ success: false, error: '确认后替换失败' });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '首次 orchestrator 调用完成');
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '破坏性二次确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('确认后替换失败');
    __resetToastStoreForTests();
  });

  it('普通入口以手动参数桥接 service，并在成功后恢复自动设置', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, settings, __resetToastStoreForTests } = await importManualUpdate();
    settings.manualUpdateContextDepth = 4;
    settings.manualUpdateBatchSize = 5;
    orchestrateManualUpdate_ACU.mockImplementationOnce(async (...args: any[]) => {
      expect(settings.autoUpdateThreshold).toBe(4);
      expect(settings.updateBatchSize).toBe(5);
      expect(args[0]).toEqual(['sheet_0']);
      expect(Object.keys(args[3]).sort()).toEqual(['clearBeforeUpdate', 'confirmBoundaryReset', 'onProgress']);
      expect(args[3]).toEqual(expect.objectContaining({ clearBeforeUpdate: true, confirmBoundaryReset: false }));
      return { success: true };
    });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    __resetToastStoreForTests();
  });

  it('orchestrator 返回失败时恢复自动设置', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, settings, __resetToastStoreForTests } = await importManualUpdate();
    settings.manualUpdateContextDepth = 4;
    settings.manualUpdateBatchSize = 5;
    orchestrateManualUpdate_ACU.mockImplementationOnce(async () => {
      expect(settings.autoUpdateThreshold).toBe(4);
      expect(settings.updateBatchSize).toBe(5);
      return { success: false, error: '普通入口失败' };
    });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    __resetToastStoreForTests();
  });

  it('orchestrator 抛异常时恢复自动设置', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, settings, toast, __resetToastStoreForTests } = await importManualUpdate();
    settings.manualUpdateContextDepth = 4;
    settings.manualUpdateBatchSize = 5;
    orchestrateManualUpdate_ACU.mockImplementationOnce(async () => {
      expect(settings.autoUpdateThreshold).toBe(4);
      expect(settings.updateBatchSize).toBe(5);
      throw new Error('普通入口异常');
    });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '首次确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    expect(toast.items.at(-1)?.text).toContain('普通入口异常');
    __resetToastStoreForTests();
  });
});

describe('useManualUpdate auto catch-up scheduling', () => {
  async function confirmDialog(dialog: any, title: string): Promise<void> {
    await waitForCondition(() => dialog.active?.title === title, `${title}弹窗出现`);
    dialog.submitActive();
  }

  it('空数据自动追平与同深度普通手动入口使用完全相同的 service 契约', async () => {
    const {
      useManualUpdate,
      dialog,
      orchestrateManualUpdate_ACU,
      settings,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    const calls: Array<{ targetKeys: string[]; threshold: number; batchSize: number; options: any }> = [];
    orchestrateManualUpdate_ACU.mockImplementation(async (...args: any[]) => {
      calls.push({
        targetKeys: args[0].slice(),
        threshold: settings.autoUpdateThreshold,
        batchSize: settings.updateBatchSize,
        options: args[3],
      });
      return { success: true };
    });
    const manual = useManualUpdate();
    manual.setManualContextDepth(1);

    const manualPending = manual.runManualUpdate();
    await confirmDialog(dialog, '执行手动填表');
    await manualPending;

    const autoPending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await autoPending;

    expect(calls).toHaveLength(2);
    expect(calls[1].targetKeys).toEqual(calls[0].targetKeys);
    expect(calls[1].threshold).toBe(calls[0].threshold);
    expect(calls[1].batchSize).toBe(calls[0].batchSize);
    expect(Object.keys(calls[0].options).sort()).toEqual(['clearBeforeUpdate', 'confirmBoundaryReset', 'onProgress']);
    expect(Object.keys(calls[1].options).sort()).toEqual(['clearBeforeUpdate', 'confirmBoundaryReset', 'onProgress']);
    expect(calls[1].options).toEqual(expect.objectContaining({ clearBeforeUpdate: true, confirmBoundaryReset: false }));
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    __resetToastStoreForTests();
  });

  it('不同断点范围组严格串行，并在每组使用对应 context depth 后恢复设置', async () => {
    const {
      useManualUpdate,
      dialog,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      settings,
      chat,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push(
      { is_user: false, mes: 'AI 2' },
      { is_user: false, mes: 'AI 3' },
      { is_user: false, mes: 'AI 4' },
      { is_user: false, mes: 'AI 5' },
    );
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 1 : 3,
    }));
    let resolveFirst!: (value: any) => void;
    const firstPending = new Promise(resolve => { resolveFirst = resolve; });
    orchestrateManualUpdate_ACU
      .mockImplementationOnce(async (...args: any[]) => {
        expect(args[0]).toEqual(['sheet_0']);
        expect(settings.autoUpdateThreshold).toBe(4);
        expect(settings.updateBatchSize).toBe(2);
        return firstPending;
      })
      .mockImplementationOnce(async (...args: any[]) => {
        expect(args[0]).toEqual(['sheet_1']);
        expect(settings.autoUpdateThreshold).toBe(2);
        expect(settings.updateBatchSize).toBe(2);
        return { success: true };
      });
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '第一组开始');
    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    resolveFirst({ success: true });
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(2);
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    __resetToastStoreForTests();
  });

  it('第一组返回失败时停止后续范围组并保留原始错误', async () => {
    const {
      useManualUpdate,
      dialog,
      toast,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      chat,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push({ is_user: false, mes: 'AI 2' }, { is_user: false, mes: 'AI 3' });
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 0 : 2,
    }));
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: false, error: '宿主原始写入错误' });
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('自动追平第 1/2 组');
    expect(toast.items.at(-1)?.text).toContain('首次 orchestrator阶段失败');
    expect(toast.items.at(-1)?.text).toContain('宿主原始写入错误');
    __resetToastStoreForTests();
  });

  it('组间聊天结构变化时停止并要求重新规划', async () => {
    const {
      useManualUpdate,
      dialog,
      toast,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      chat,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push({ is_user: false, mes: 'AI 2' }, { is_user: false, mes: 'AI 3' });
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 0 : 2,
    }));
    orchestrateManualUpdate_ACU.mockImplementationOnce(async () => {
      chat.push({ is_user: false, mes: '外部新增 AI' });
      return { success: true };
    });
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.kind).toBe('warning');
    expect(toast.items.at(-1)?.text).toContain('聊天或隔离范围已变化');
    __resetToastStoreForTests();
  });

  it('破坏性确认取消时停止后续范围组', async () => {
    const {
      useManualUpdate,
      dialog,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      chat,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push({ is_user: false, mes: 'AI 2' }, { is_user: false, mes: 'AI 3' });
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 0 : 2,
    }));
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({
      success: false,
      requiresUserConfirmation: {
        reason: 'manual_refill_replace_sheet_baseline',
        replayErrorCode: 'no_full_checkpoint_replayable',
        message: '需要替换基底。',
        contextScopeIndices: [0],
        targetSheetKeys: ['sheet_0'],
      },
    });
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '破坏性确认弹窗出现');
    dialog.cancelActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    __resetToastStoreForTests();
  });

  it('破坏性确认重入仅切换确认参数，并标记重入阶段的原始错误', async () => {
    const {
      useManualUpdate,
      dialog,
      toast,
      orchestrateManualUpdate_ACU,
      settings,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    orchestrateManualUpdate_ACU
      .mockImplementationOnce(async (...args: any[]) => {
        expect(settings.autoUpdateThreshold).toBe(1);
        return {
          success: false,
          requiresUserConfirmation: {
            reason: 'manual_refill_replace_sheet_baseline',
            replayErrorCode: 'no_full_checkpoint_replayable',
            message: '需要替换基底。',
            contextScopeIndices: [0],
            targetSheetKeys: ['sheet_0'],
          },
          firstArgs: args,
        };
      })
      .mockImplementationOnce(async (...args: any[]) => {
        expect(settings.autoUpdateThreshold).toBe(1);
        return { success: false, error: '确认重入写入失败', secondArgs: args };
      });
    const manual = useManualUpdate();

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '破坏性确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(2);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][0]).toEqual(['sheet_0']);
    expect(Object.keys(orchestrateManualUpdate_ACU.mock.calls[0][3]).sort())
      .toEqual(['clearBeforeUpdate', 'confirmBoundaryReset', 'onProgress']);
    expect(Object.keys(orchestrateManualUpdate_ACU.mock.calls[1][3]).sort())
      .toEqual(['clearBeforeUpdate', 'confirmBoundaryReset', 'onProgress']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3].confirmBoundaryReset).toBe(false);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][3].confirmBoundaryReset).toBe(true);
    expect(settings.autoUpdateThreshold).toBe(3);
    expect(settings.updateBatchSize).toBe(2);
    expect(toast.items.at(-1)?.text).toContain('破坏性确认重入阶段失败');
    expect(toast.items.at(-1)?.text).toContain('确认重入写入失败');
    __resetToastStoreForTests();
  });

  it('第一组抛异常时停止后续范围组并保留异常文本', async () => {
    const {
      useManualUpdate,
      dialog,
      toast,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      chat,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push({ is_user: false, mes: 'AI 2' }, { is_user: false, mes: 'AI 3' });
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 0 : 2,
    }));
    orchestrateManualUpdate_ACU.mockRejectedValueOnce(new Error('宿主抛出的写入异常'));
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.text).toContain('首次 orchestrator阶段失败');
    expect(toast.items.at(-1)?.text).toContain('宿主抛出的写入异常');
    __resetToastStoreForTests();
  });

  it('用户终止自动追平时中止当前请求且不启动后续组', async () => {
    const {
      useManualUpdate,
      dialog,
      toast,
      orchestrateManualUpdate_ACU,
      resolveTableHistoryStateFromChat_ACU,
      chat,
      abortAllActiveRequests_ACU,
      setWasStoppedByUser,
      setIsAutoUpdatingCard,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    chat.push({ is_user: false, mes: 'AI 2' }, { is_user: false, mes: 'AI 3' });
    resolveTableHistoryStateFromChat_ACU.mockImplementation((_chat: any[], options: any) => ({
      hasAnyData: true,
      hasTrackedUpdate: true,
      lastTrackedUpdateAiFloor: options.sheetKey === 'sheet_0' ? 0 : 2,
    }));
    let releaseFirst!: () => void;
    orchestrateManualUpdate_ACU.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseFirst = resolve; });
      return { success: true };
    });
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0', 'sheet_1']);

    const pending = manual.runAutoCatchUp();
    await confirmDialog(dialog, '执行自动追平');
    await waitForCondition(() => typeof releaseFirst === 'function', '第一组进入执行');
    expect(manual.autoCatchUpBusy.value).toBe(true);
    void manual.runManualUpdate();
    expect(dialog.active).toBeNull();
    await toast.items[0]?.action?.onClick();
    expect(toast.items[0]?.text).toContain('自动追平已终止');
    releaseFirst();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(abortAllActiveRequests_ACU).toHaveBeenCalledTimes(1);
    expect(setWasStoppedByUser).toHaveBeenCalledWith(true);
    expect(setIsAutoUpdatingCard).toHaveBeenCalledWith(false);
    expect(manual.autoCatchUpBusy.value).toBe(false);
    __resetToastStoreForTests();
  });

  it('首次确认悬挂期间阻止另一入口创建竞争确认', async () => {
    const {
      useManualUpdate,
      dialog,
      orchestrateManualUpdate_ACU,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    const manual = useManualUpdate();

    const manualPending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '手动确认弹窗出现');
    await manual.runAutoCatchUp();
    expect(dialog.active?.title).toBe('执行手动填表');
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    dialog.cancelActive();
    await manualPending;

    const autoPending = manual.runAutoCatchUp();
    await waitForCondition(() => dialog.active?.title === '执行自动追平', '自动确认弹窗出现');
    await manual.runManualUpdate();
    expect(dialog.active?.title).toBe('执行自动追平');
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    dialog.cancelActive();
    await autoPending;

    __resetToastStoreForTests();
  });
});

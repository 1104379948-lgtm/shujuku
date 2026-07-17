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

interface ImportManualUpdateOptions {
  settings?: Record<string, unknown>;
  currentJsonTableData?: Record<string, any>;
  chat?: any[];
  lastFilledFloors?: Record<string, number>;
}

async function importManualUpdate(options: ImportManualUpdateOptions = {}) {
  vi.resetModules();
  const settings: any = {
    autoUpdateThreshold: 3,
    updateBatchSize: 2,
    skipUpdateFloors: 0,
    manualUpdateContextDepth: 3,
    manualUpdateBatchSize: 2,
    manualSelectedTables: ['sheet_0'],
    hasManualSelection: true,
    ...options.settings,
  };
  const currentJsonTableData: any = options.currentJsonTableData || {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
  };
  const chat = options.chat || [{ is_user: false, mes: 'AI 1' }];
  const lastFilledFloors = options.lastFilledFloors || {};
  const orchestrateManualUpdate_ACU = vi.fn();
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const setWasStoppedByUser = vi.fn();
  const abortAllActiveRequests = vi.fn();
  const resolveTableHistoryStateFromChat_ACU = vi.fn((_chat: any[], historyOptions: { sheetKey: string }) => ({
    latestAiMessageIndex: chat.length - 1,
    latestDataMessageIndex: -1,
    lastTrackedUpdateMessageIndex: -1,
    latestDataAiFloor: 0,
    lastTrackedUpdateAiFloor: lastFilledFloors[historyOptions.sheetKey] || 0,
    hasAnyData: false,
    hasTrackedUpdate: (lastFilledFloors[historyOptions.sheetKey] || 0) > 0,
  }));

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: currentJsonTableData,
    settings_ACU: settings,
    abortAllActiveRequests_ACU: abortAllActiveRequests,
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
    resolveTableHistoryStateFromChat_ACU,
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', async () => {
    const actual = await vi.importActual<typeof import('../../../src/service/table/update-orchestrator')>('../../../src/service/table/update-orchestrator');
    return {
      ...actual,
      executeCardUpdateCore_ACU: vi.fn(),
      orchestrateManualUpdate_ACU,
      processUpdatesBatch_ACU: vi.fn(),
    };
  });
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
    setWasStoppedByUser,
    abortAllActiveRequests,
    resolveTableHistoryStateFromChat_ACU,
    settings,
    currentJsonTableData,
    chat,
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
});

describe('useManualUpdate automatic resume fill', () => {
  it('未选择表时警告且不调用 orchestrator', async () => {
    const { useManualUpdate, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: [], hasManualSelection: true },
    });
    const manual = useManualUpdate();

    await manual.runAutoResumeFill();

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.at(-1)?.kind).toBe('warning');
    expect(toast.items.at(-1)?.text).toContain('未选择');
    __resetToastStoreForTests();
  });

  it('所选表已追平时提示且不调用 orchestrator', async () => {
    const { useManualUpdate, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      chat: [
        { is_user: false, mes: 'AI 1' },
        { is_user: true, mes: '用户' },
        { is_user: false, mes: 'AI 2' },
      ],
      lastFilledFloors: { sheet_0: 2 },
    });
    const manual = useManualUpdate();

    await manual.runAutoResumeFill();

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.at(-1)?.kind).toBe('info');
    expect(toast.items.at(-1)?.text).toContain('已追平');
    __resetToastStoreForTests();
  });

  it('取消整体确认时不调用 orchestrator，确认摘要包含范围组', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      chat: [
        { is_user: false, mes: 'AI 1' },
        { is_user: false, mes: 'AI 2' },
      ],
    });
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    expect(dialog.active?.message).toContain('有效末层：AI 第 2 层');
    expect(dialog.active?.message).toContain('范围组数量：1');
    expect(dialog.active?.message).toContain('AI 第 1~2 层');
    dialog.cancelActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    __resetToastStoreForTests();
  });

  it('相同范围合并为一次调用，自动入口仅额外传入范围 override', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: ['sheet_0', 'sheet_1'] },
      currentJsonTableData: {
        sheet_0: { name: '物品表', content: [['row_id', '名称']] },
        sheet_1: { name: '角色表', content: [['row_id', '名称']] },
      },
      chat: [
        { is_user: false, mes: 'AI 1' },
        { is_user: true, mes: '用户' },
        { is_user: false, mes: 'AI 2' },
      ],
    });
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0', 'sheet_1']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      clearBeforeUpdate: true,
      confirmBoundaryReset: false,
      contextScopeIndicesOverride: [0, 2],
    }));
    __resetToastStoreForTests();
  });

  it('不同范围组严格串行，第一组完成前不发起第二组', async () => {
    let resolveFirst!: (value: { success: true }) => void;
    const firstResult = new Promise<{ success: true }>(resolve => { resolveFirst = resolve; });
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: ['sheet_0', 'sheet_1'] },
      currentJsonTableData: {
        sheet_0: { name: '物品表', content: [['row_id', '名称']] },
        sheet_1: { name: '角色表', content: [['row_id', '名称']] },
      },
      chat: [
        { is_user: false, mes: 'AI 1' },
        { is_user: false, mes: 'AI 2' },
        { is_user: false, mes: 'AI 3' },
      ],
      lastFilledFloors: { sheet_0: 0, sheet_1: 1 },
    });
    orchestrateManualUpdate_ACU
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValueOnce({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '第一范围组开始');
    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3].contextScopeIndicesOverride).toEqual([0, 1, 2]);

    resolveFirst({ success: true });
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(2);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][3].contextScopeIndicesOverride).toEqual([1, 2]);
    __resetToastStoreForTests();
  });

  it('危险确认取消后停止后续范围组并复位 busy', async () => {
    const requiresConfirmation = {
      success: false,
      requiresUserConfirmation: {
        reason: 'manual_refill_replace_sheet_baseline',
        replayErrorCode: 'no_full_checkpoint_replayable',
        message: '重填起点前没有可回放 checkpoint。',
        contextScopeIndices: [0, 1],
        targetSheetKeys: ['sheet_0'],
      },
    };
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: ['sheet_0', 'sheet_1'] },
      currentJsonTableData: {
        sheet_0: { name: '物品表', content: [['row_id', '名称']] },
        sheet_1: { name: '角色表', content: [['row_id', '名称']] },
      },
      chat: [{ is_user: false }, { is_user: false }],
      lastFilledFloors: { sheet_0: 0, sheet_1: 1 },
    });
    orchestrateManualUpdate_ACU.mockResolvedValueOnce(requiresConfirmation);
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '危险确认出现');
    expect(manual.autoResumeBusy.value).toBe(true);
    dialog.cancelActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(manual.autoResumeBusy.value).toBe(false);
    __resetToastStoreForTests();
  });

  it('危险确认通过后以同组同 override 重入', async () => {
    const requiresConfirmation = {
      success: false,
      requiresUserConfirmation: {
        reason: 'manual_refill_replace_sheet_baseline',
        replayErrorCode: 'no_full_checkpoint_replayable',
        message: '重填起点前没有可回放 checkpoint。',
        contextScopeIndices: [0, 1],
        targetSheetKeys: ['sheet_0'],
      },
    };
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      chat: [{ is_user: false }, { is_user: false }],
    });
    orchestrateManualUpdate_ACU
      .mockResolvedValueOnce(requiresConfirmation)
      .mockResolvedValueOnce({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await waitForCondition(() => dialog.active?.title === '破坏性手动重填确认', '危险确认出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(2);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(orchestrateManualUpdate_ACU.mock.calls[1][0]);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3].contextScopeIndicesOverride).toEqual([0, 1]);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][3].contextScopeIndicesOverride).toEqual([0, 1]);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3].confirmBoundaryReset).toBe(false);
    expect(orchestrateManualUpdate_ACU.mock.calls[1][3].confirmBoundaryReset).toBe(true);
    __resetToastStoreForTests();
  });

  it('第一组失败后不执行后续组并复位 busy', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: ['sheet_0', 'sheet_1'] },
      currentJsonTableData: {
        sheet_0: { name: '物品表', content: [['row_id', '名称']] },
        sheet_1: { name: '角色表', content: [['row_id', '名称']] },
      },
      chat: [{ is_user: false }, { is_user: false }],
      lastFilledFloors: { sheet_0: 0, sheet_1: 1 },
    });
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: false, error: '第一组失败' });
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('第一组失败');
    expect(manual.autoResumeBusy.value).toBe(false);
    __resetToastStoreForTests();
  });

  it('用户终止当前组后不执行后续组', async () => {
    let resolveFirst!: (value: { success: false; error: string }) => void;
    const firstResult = new Promise<{ success: false; error: string }>(resolve => { resolveFirst = resolve; });
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, abortAllActiveRequests, __resetToastStoreForTests } = await importManualUpdate({
      settings: { manualSelectedTables: ['sheet_0', 'sheet_1'] },
      currentJsonTableData: {
        sheet_0: { name: '物品表', content: [['row_id', '名称']] },
        sheet_1: { name: '角色表', content: [['row_id', '名称']] },
      },
      chat: [{ is_user: false }, { is_user: false }],
      lastFilledFloors: { sheet_0: 0, sheet_1: 1 },
    });
    orchestrateManualUpdate_ACU.mockImplementationOnce(() => firstResult);
    const manual = useManualUpdate();

    const pending = manual.runAutoResumeFill();
    await waitForCondition(() => dialog.active?.title === '执行自动断点续填', '自动续填整体确认出现');
    dialog.submitActive();
    await waitForCondition(() => orchestrateManualUpdate_ACU.mock.calls.length === 1, '第一范围组开始');
    await toast.items.at(-1)?.action?.onClick();
    resolveFirst({ success: false, error: '任务已终止' });
    await pending;

    expect(abortAllActiveRequests).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(toast.items.at(-1)?.kind).toBe('warning');
    expect(manual.autoResumeBusy.value).toBe(false);
    __resetToastStoreForTests();
  });
});

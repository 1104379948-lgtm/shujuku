// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importTrigger() {
  vi.resetModules();
  const showCustomConfirm_ACU = vi.fn();
  const showToastr_ACU = vi.fn(() => ({ find: vi.fn(() => ({ text: vi.fn() })) }));
  const orchestrateManualUpdate_ACU = vi.fn();
  const bindTableFillStopButton_ACU = vi.fn();
  const abortAllActiveRequests_ACU = vi.fn();
  const resetManualUpdateButton_ACU = vi.fn();
  const clear = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: { manualUpdateContextDepth: 3, skipUpdateFloors: 0 },
    currentJsonTableData_ACU: { sheet_0: { name: '物品表' } },
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
    _set_wasStoppedByUser_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    abortAllActiveRequests_ACU,
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: vi.fn(() => [{ is_user: false, mes: 'AI 1' }]),
    saveCurrentDataForTable_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/presentation/components/table-selector', () => ({
    getManualSelectionFromUI_ACU: vi.fn(() => ['sheet_0']),
  }));
  vi.doMock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU }));
  vi.doMock('../../../src/presentation/theme/custom-confirm', () => ({ showCustomConfirm_ACU }));
  vi.doMock('../../../src/shared/constants', () => ({ ACU_TOAST_CATEGORY_ACU: { MANUAL_TABLE: 'manual' } }));
  vi.doMock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
  vi.doMock('../../../src/shared/host-api', () => ({ toastr_API_ACU: { clear } }));
  vi.doMock('../../../src/presentation/state/ui-refs', () => ({ $statusMessageSpan_ACU: null }));
  vi.doMock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableFillStart: vi.fn(), _notifyTableUpdate: vi.fn() } } }));
  vi.doMock('../../../src/shared/html-helpers', () => ({ renderStopButton_ACU: vi.fn(() => '<button>stop</button>') }));
  vi.doMock('../../../src/presentation/components/status-display', () => ({
    bindTableFillStopButton_ACU,
    resetManualUpdateButton_ACU,
    shouldShowVectorMemoryManualUpdateWarning_ACU: vi.fn(() => false),
    syncManualUpdateButtonAvailability_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));

  vi.doMock('../../../src/presentation/triggers/settings-ui-sync', () => ({ collectManualExtraHint_ACU: vi.fn() }));
  vi.doMock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: vi.fn(async () => undefined) }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    processUpdatesBatch_ACU: vi.fn(),
    executeCardUpdateCore_ACU: vi.fn(),
    orchestrateManualUpdate_ACU,
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: vi.fn(() => [{ messageIndex: 0, aiFloor: 1, reason: 'init' }]),
  }));

  const { handleManualUpdate_ACU } = await import('../../../src/presentation/triggers/update-process');
  return {
    handleManualUpdate_ACU,
    showCustomConfirm_ACU,
    showToastr_ACU,
    orchestrateManualUpdate_ACU,
    bindTableFillStopButton_ACU,
    abortAllActiveRequests_ACU,
    clear,
    resetManualUpdateButton_ACU,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


describe('handleManualUpdate_ACU 单次确认与显式参数', () => {
  it('确认文案说明范围清理、逐批保存和中断保留', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(false);

    await handleManualUpdate_ACU();

    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(showCustomConfirm_ACU.mock.calls[0][0]).toBe('手动填表确认');
    const message = showCustomConfirm_ACU.mock.calls[0][1];
    expect(message).toContain('原子清理本次范围内选中表的旧数据');
    expect(message).toContain('每个已完成批次会立即保存并保留');
    expect(message).toContain('不会自动续跑');
    expect(message).not.toContain('第二次破坏性确认');
  });

  it('确认后只调用一次编排器并传递显式手动参数', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: true });

    await handleManualUpdate_ACU();

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      clearBeforeUpdate: true,
      manualContextDepth: 3,
      manualBatchSize: 3,
      manualSkipFloors: 0,
      manualMaxConcurrentGroups: 1,
    }));
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).not.toHaveProperty('confirmBoundaryReset');
  });

  it('终止按钮只中止本次手动任务 controller，不调用全局 abort', async () => {
    const {
      handleManualUpdate_ACU,
      showCustomConfirm_ACU,
      showToastr_ACU,
      orchestrateManualUpdate_ACU,
      bindTableFillStopButton_ACU,
      abortAllActiveRequests_ACU,
    } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    let resolveOrchestration!: (value: { success: boolean; error?: string }) => void;
    orchestrateManualUpdate_ACU.mockImplementationOnce((_keys, _processBatch, _refresh, options) => new Promise(resolve => {
      expect(options.abortController).toBeInstanceOf(AbortController);
      resolveOrchestration = resolve;
    }));
    showToastr_ACU.mockImplementation((_kind, _message, options) => {
      options?.onShown?.();
      return { find: vi.fn(() => ({ text: vi.fn() })) };
    });

    const pending = handleManualUpdate_ACU();
    await Promise.resolve();
    expect(bindTableFillStopButton_ACU).toHaveBeenCalledTimes(1);
    const taskController = orchestrateManualUpdate_ACU.mock.calls[0][3].abortController as AbortController;
    bindTableFillStopButton_ACU.mock.calls[0][1]();

    expect(taskController.signal.aborted).toBe(true);
    expect(abortAllActiveRequests_ACU).not.toHaveBeenCalled();
    resolveOrchestration({ success: false, error: '手动更新已终止，已完成批次已保留。' });
    await pending;
  });

  it('编排失败时展示原错误，不发起第二次确认', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, showToastr_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: false, error: '后续批次失败，已完成批次已保留。' });

    await handleManualUpdate_ACU();

    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(showToastr_ACU).toHaveBeenCalledWith('error', '后续批次失败，已完成批次已保留。');
  });
});
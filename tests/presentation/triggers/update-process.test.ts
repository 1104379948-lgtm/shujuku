// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importTrigger(settingsOverrides: Record<string, unknown> = {}) {
  vi.resetModules();
  const showCustomConfirm_ACU = vi.fn();
  const showToastr_ACU = vi.fn(() => ({ find: vi.fn(() => ({ text: vi.fn() })) }));
  const orchestrateManualUpdate_ACU = vi.fn();
  const resetManualUpdateButton_ACU = vi.fn();
  const clear = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: {
      autoUpdateThreshold: 8,
      updateBatchSize: 9,
      maxConcurrentGroups: 7,
      skipUpdateFloors: 6,
      manualUpdateContextDepth: 3,
      manualUpdateBatchSize: 2,
      manualUpdateSkipFloors: 1,
      manualUpdateMaxConcurrentGroups: 2,
      ...settingsOverrides,
    },
    currentJsonTableData_ACU: { sheet_0: { name: '物品表' } },
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
    _set_wasStoppedByUser_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    abortAllActiveRequests_ACU: vi.fn(),
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
    bindTableFillStopButton_ACU: vi.fn(),
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
  return { handleManualUpdate_ACU, showCustomConfirm_ACU, showToastr_ACU, orchestrateManualUpdate_ACU, clear, resetManualUpdateButton_ACU };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleManualUpdate_ACU manual refill contract', () => {
  it('首次确认明确先清理，且没有二次确认状态机', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(false);

    await handleManualUpdate_ACU();

    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    const message = showCustomConfirm_ACU.mock.calls[0][1];
    expect(message).toContain('先原子清除本次范围内选中表的旧数据');
    expect(message).toContain('已成功写入的批次也会保留');
    expect(message).toContain('不会执行整会话回滚');
    expect(message).not.toContain('第二次破坏性确认');
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
  });

  it('一次确认后只调用一次 orchestrator，并传入独立手动参数', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: true });

    await handleManualUpdate_ACU();

    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      contextDepth: 3,
      skipFloors: 1,
      batchSize: 2,
      maxConcurrentGroups: 2,
      onProgress: expect.any(Function),
    }));
  });

  it('历史空值使用手动默认参数，不读取自动更新参数', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, orchestrateManualUpdate_ACU } = await importTrigger({
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,
      manualUpdateSkipFloors: null,
      manualUpdateMaxConcurrentGroups: null,
    });
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: true });

    await handleManualUpdate_ACU();

    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({
      contextDepth: 3,
      skipFloors: 0,
      batchSize: 3,
      maxConcurrentGroups: 1,
    }));
  });

  it('orchestrator 失败时直接展示错误，不发起第二次确认', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, showToastr_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(true);
    orchestrateManualUpdate_ACU.mockResolvedValueOnce({ success: false, error: 'AI failed' });

    await handleManualUpdate_ACU();

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(showToastr_ACU).toHaveBeenCalledWith('error', 'AI failed');
  });
});

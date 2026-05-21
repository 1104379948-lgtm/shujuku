import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToastr_ACU = vi.hoisted(() => vi.fn());
const mockToastrClear_ACU = vi.hoisted(() => vi.fn());
const mockExecuteCardUpdateCore_ACU = vi.hoisted(() => vi.fn());
const mockProcessUpdatesBatch_ACU = vi.hoisted(() => vi.fn());
const mockOrchestrateManualUpdate_ACU = vi.hoisted(() => vi.fn());
const mockBindTableFillStopButton_ACU = vi.hoisted(() => vi.fn());
const mockAbortAllActiveRequests_ACU = vi.hoisted(() => vi.fn());
const mockSetIsAutoUpdating_ACU = vi.hoisted(() => vi.fn());
const mockSetWasStopped_ACU = vi.hoisted(() => vi.fn());
const mockStatusText_ACU = vi.hoisted(() => vi.fn());
const mockNotifyFillStart_ACU = vi.hoisted(() => vi.fn());
const mockNotifyTableUpdate_ACU = vi.hoisted(() => vi.fn());
const mockGetManualSelectionFromUI_ACU = vi.hoisted(() => vi.fn(() => []));
const mockShowCustomConfirm_ACU = vi.hoisted(() => vi.fn());
const mockRefreshMergedData_ACU = vi.hoisted(() => vi.fn());

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: mockShowToastr_ACU,
}));

vi.mock('../../src/shared/host-api', () => ({
  toastr_API_ACU: {
    clear: mockToastrClear_ACU,
  },
}));

vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/constants')>()),
  ACU_TOAST_CATEGORY_ACU: {
    ERROR: 'error',
    MANUAL_TABLE: 'manual_table',
  },
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  _set_isAutoUpdatingCard_ACU: mockSetIsAutoUpdating_ACU,
  _set_wasStoppedByUser_ACU: mockSetWasStopped_ACU,
  abortAllActiveRequests_ACU: mockAbortAllActiveRequests_ACU,
}));

vi.mock('../../src/presentation/components/table-selector', () => ({
  getManualSelectionFromUI_ACU: mockGetManualSelectionFromUI_ACU,
}));

vi.mock('../../src/presentation/theme/custom-confirm', () => ({
  showCustomConfirm_ACU: mockShowCustomConfirm_ACU,
}));

vi.mock('../../src/presentation/state/ui-refs', () => ({
  $statusMessageSpan_ACU: {
    text: mockStatusText_ACU,
  },
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: {
    AutoCardUpdaterAPI: {
      _notifyTableFillStart: mockNotifyFillStart_ACU,
      _notifyTableUpdate: mockNotifyTableUpdate_ACU,
    },
  },
}));

vi.mock('../../src/shared/html-helpers', () => ({
  renderStopButton_ACU: (buttonId: string, label: string) => `<button id="${buttonId}" class="qrf-abort-btn">${label}</button>`,
}));

vi.mock('../../src/presentation/components/status-display', () => ({
  bindTableFillStopButton_ACU: mockBindTableFillStopButton_ACU,
  resetManualUpdateButton_ACU: vi.fn(),
  shouldShowVectorMemoryManualUpdateWarning_ACU: vi.fn(() => false),
  syncManualUpdateButtonAvailability_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/update-status-display', () => ({
  updateCardUpdateStatusDisplay_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/settings-ui-sync', () => ({
  collectManualExtraHint_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: mockRefreshMergedData_ACU,
}));

vi.mock('../../src/service/table/update-orchestrator', () => ({
  processUpdatesBatch_ACU: mockProcessUpdatesBatch_ACU,
  executeCardUpdateCore_ACU: mockExecuteCardUpdateCore_ACU,
  orchestrateManualUpdate_ACU: mockOrchestrateManualUpdate_ACU,
}));

function createToastStub(label: string) {
  const text = vi.fn();
  return {
    label,
    text,
    find: vi.fn(() => ({ text })),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('presentation/update-process loading toast lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetManualSelectionFromUI_ACU.mockReturnValue([]);
    mockShowCustomConfirm_ACU.mockResolvedValue(true);
    mockRefreshMergedData_ACU.mockResolvedValue(undefined);
  });

  it('replaces the previous table-fill loading toast when a new visible batch starts', async () => {
    const firstToast = createToastStub('first');
    const secondToast = createToastStub('second');
    const firstResult = createDeferred<any>();
    const secondResult = createDeferred<any>();

    mockShowToastr_ACU
      .mockReturnValueOnce(firstToast)
      .mockReturnValueOnce(secondToast);
    mockExecuteCardUpdateCore_ACU
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);

    const { proceedWithCardUpdate_ACU } = await import('../../src/presentation/triggers/update-process');

    const firstRun = proceedWithCardUpdate_ACU([], '', 1, false, 'manual_independent', false, ['sheet_0'], null, { currentBatch: 1, totalBatches: 2 });
    expect(mockShowToastr_ACU).toHaveBeenCalledTimes(1);
    expect(mockToastrClear_ACU).not.toHaveBeenCalled();

    const secondRun = proceedWithCardUpdate_ACU([], '', 2, false, 'manual_independent', false, ['sheet_0'], null, { currentBatch: 2, totalBatches: 2 });
    expect(mockShowToastr_ACU).toHaveBeenCalledTimes(2);
    expect(mockToastrClear_ACU).toHaveBeenCalledTimes(1);
    expect(mockToastrClear_ACU).toHaveBeenNthCalledWith(1, firstToast);

    firstResult.resolve({ success: true, modifiedKeys: [] });
    await firstRun;
    expect(mockToastrClear_ACU).toHaveBeenCalledTimes(1);

    secondResult.resolve({ success: true, modifiedKeys: [] });
    await secondRun;
    expect(mockToastrClear_ACU).toHaveBeenCalledTimes(2);
    expect(mockToastrClear_ACU).toHaveBeenNthCalledWith(2, secondToast);
  });

  it('does not create or clear loading toast in silent mode', async () => {
    mockExecuteCardUpdateCore_ACU.mockResolvedValueOnce({ success: true, modifiedKeys: [] });

    const { proceedWithCardUpdate_ACU } = await import('../../src/presentation/triggers/update-process');

    await proceedWithCardUpdate_ACU([], '', 1, false, 'auto', true, ['sheet_0'], null, { currentBatch: 1, totalBatches: 1 });

    expect(mockShowToastr_ACU).not.toHaveBeenCalled();
    expect(mockToastrClear_ACU).not.toHaveBeenCalled();
    expect(mockNotifyFillStart_ACU).not.toHaveBeenCalled();
  });

  it('updates the manual-update loading toast with batch progress and retry attempts', async () => {
    const manualToast = createToastStub('manual');
    mockShowToastr_ACU.mockReturnValue(manualToast);
    mockGetManualSelectionFromUI_ACU.mockReturnValue(['sheet_0']);
    mockShowCustomConfirm_ACU.mockResolvedValue(true);
    mockOrchestrateManualUpdate_ACU.mockImplementation(async (_targetKeys, _processBatch, _refreshData, _options, onProgress) => {
      onProgress({ phase: 'calling_ai', currentBatch: 2, totalBatches: 5, activeGroups: 3, stageLabel: 'AI生成', attempt: 1, maxRetries: 3 });
      onProgress({ phase: 'retry', currentBatch: 2, totalBatches: 5, currentGroupKey: 'group-a:2:7', stageLabel: 'AI生成', attempt: 1, maxRetries: 3, retryDelayMs: 5000, message: '临时失败' });
      return { success: true };
    });

    const { handleManualUpdate_ACU } = await import('../../src/presentation/triggers/update-process');

    await handleManualUpdate_ACU();

    expect(mockShowToastr_ACU).toHaveBeenCalledWith('info', expect.stringContaining('正在准备手动填表批次'), expect.objectContaining({ timeOut: 0 }));
    expect(manualToast.text).toHaveBeenCalledWith('第 2/5 批（并发分组 3）：AI生成，第 1/3 次调用AI进行增量更新...');
    expect(manualToast.text).toHaveBeenCalledWith('第 2/5 批：AI生成，第 1/3 次尝试失败，5秒后重试... (临时失败)');
    const renderedMessages = manualToast.text.mock.calls.map((call: any[]) => String(call[0]));
    for (const message of renderedMessages) {
      expect(message).not.toContain('group-a:2:7');
      expect(message).not.toContain('当前 group-a');
    }
    expect(mockToastrClear_ACU).toHaveBeenCalledWith(manualToast);
  });
});

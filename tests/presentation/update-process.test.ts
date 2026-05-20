import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToastr_ACU = vi.hoisted(() => vi.fn());
const mockToastrClear_ACU = vi.hoisted(() => vi.fn());
const mockExecuteCardUpdateCore_ACU = vi.hoisted(() => vi.fn());
const mockBindTableFillStopButton_ACU = vi.hoisted(() => vi.fn());
const mockAbortAllActiveRequests_ACU = vi.hoisted(() => vi.fn());
const mockSetIsAutoUpdating_ACU = vi.hoisted(() => vi.fn());
const mockSetWasStopped_ACU = vi.hoisted(() => vi.fn());
const mockStatusText_ACU = vi.hoisted(() => vi.fn());
const mockNotifyFillStart_ACU = vi.hoisted(() => vi.fn());
const mockNotifyTableUpdate_ACU = vi.hoisted(() => vi.fn());

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
  getManualSelectionFromUI_ACU: vi.fn(() => []),
}));

vi.mock('../../src/presentation/theme/custom-confirm', () => ({
  showCustomConfirm_ACU: vi.fn(),
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
  refreshMergedDataAndNotifyWithUI_ACU: vi.fn(),
}));

vi.mock('../../src/service/table/update-orchestrator', () => ({
  processUpdatesBatch_ACU: vi.fn(),
  executeCardUpdateCore_ACU: mockExecuteCardUpdateCore_ACU,
  orchestrateManualUpdate_ACU: vi.fn(),
}));

function createToastStub(label: string) {
  return {
    label,
    find: vi.fn(() => ({ text: vi.fn() })),
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
});

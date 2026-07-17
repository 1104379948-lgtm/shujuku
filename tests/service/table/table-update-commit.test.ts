import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  reload: vi.fn(),
  ensureMigration: vi.fn(),
  setCurrent: vi.fn(),
  currentData: { sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'initial']] } } as any,
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.currentData; },
  getCurrentIsolationKey_ACU: vi.fn(() => 'isolation-test'),
  _set_currentJsonTableData_ACU: (value: any) => {
    mocks.currentData = value;
    mocks.setCurrent(value);
  },
}));

vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: (...args: any[]) => mocks.ensureMigration(...args),
  persistTablesToChatMessage_ACU: (...args: any[]) => mocks.persist(...args),
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(),
  reloadStorageProvider: (...args: any[]) => mocks.reload(...args),
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: vi.fn(async (options: any, task: any) => {
    const workingData = JSON.parse(JSON.stringify(options.initialData));
    const transactionContext = {
      transactionId: 'tx-test',
      runCommit: async (commit: any) => commit(),
    };
    return task(transactionContext, workingData);
  }),
}));

import { runTableUpdateCommit_ACU } from '../../../src/service/table/table-update-commit';

const baseOptions = {
  source: 'group_fill' as const,
  reason: 'commit test',
  writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_0' }],
  targetMessageIndex: 1,
  targetSheetKeys: ['sheet_0'],
};

function appliedData(value: string) {
  return {
    success: true as const,
    tableData: { sheet_0: { name: '表A', content: [['row_id', '值'], ['1', value]] } },
    value,
  };
}

describe('runTableUpdateCommit_ACU 持久化失败安全', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentData = { sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'initial']] } };
    mocks.ensureMigration.mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockResolvedValue(undefined);
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });
  });

  it('persist 返回 saved=false 时 reload 且不更新 currentJsonTableData', async () => {
    const before = JSON.parse(JSON.stringify(mocks.currentData));
    mocks.persist.mockResolvedValueOnce({ saved: false, error: 'host save rejected' });

    const result = await runTableUpdateCommit_ACU(baseOptions, () => appliedData('failed'));

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('host save rejected') }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.setCurrent).not.toHaveBeenCalled();
    expect(mocks.currentData).toEqual(before);
  });

  it('persist reject 时 reload 且保留原 runtime', async () => {
    const before = JSON.parse(JSON.stringify(mocks.currentData));
    mocks.persist.mockRejectedValueOnce(new Error('host transport failed'));

    const result = await runTableUpdateCommit_ACU(baseOptions, () => appliedData('failed'));

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('host transport failed') }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.setCurrent).not.toHaveBeenCalled();
    expect(mocks.currentData).toEqual(before);
  });

  it('persist 与 reload 同时失败时返回两段错误上下文', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('host transport failed'));
    mocks.reload.mockRejectedValueOnce(new Error('provider reload failed'));

    const result = await runTableUpdateCommit_ACU(baseOptions, () => appliedData('failed'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('host transport failed');
    expect(result.error).toContain('provider reload failed');
    expect(mocks.setCurrent).not.toHaveBeenCalled();
  });

  it('后一失败 transaction 不覆盖前一成功 transaction', async () => {
    const first = await runTableUpdateCommit_ACU(baseOptions, () => appliedData('committed'));
    expect(first.success).toBe(true);
    expect(mocks.currentData.sheet_0.content[1][1]).toBe('committed');

    mocks.persist.mockRejectedValueOnce(new Error('second save failed'));
    const second = await runTableUpdateCommit_ACU(baseOptions, () => appliedData('should-not-publish'));

    expect(second.success).toBe(false);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.currentData.sheet_0.content[1][1]).toBe('committed');
    expect(mocks.setCurrent).toHaveBeenCalledTimes(1);
  });


});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  migration: vi.fn(),
  reload: vi.fn(),
  transaction: vi.fn(),
  persist: vi.fn(),
  ensureProvider: vi.fn(),
  setCurrentData: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  getCurrentIsolationKey_ACU: () => '',
  _set_currentJsonTableData_ACU: mocks.setCurrentData,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: mocks.migration,
  persistTablesToChatMessage_ACU: mocks.persist,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: mocks.ensureProvider,
  reloadStorageProvider: mocks.reload,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mocks.transaction,
}));

import { runSqliteRuntimeMutationCommit_ACU, runTableUpdateCommit_ACU } from '../../../src/service/table/table-update-commit';

function options(reason: string) {
  return {
    source: 'system' as const,
    reason,
    writeSet: [{ kind: 'all' as const }],
    targetMessageIndex: -1,
    targetSheetKeys: null,
  };
}

describe('runTableUpdateCommit_ACU migration gate', () => {
  beforeEach(() => {
    mocks.migration.mockReset().mockResolvedValue({ success: false, error: 'mixed storage evidence insufficient' });
    mocks.reload.mockReset();
    mocks.transaction.mockReset();
    mocks.persist.mockReset();
    mocks.ensureProvider.mockReset();
    mocks.setCurrentData.mockReset();
  });

  it('mixed/legacy 迁移失败时不执行 apply、事务或持久化', async () => {
    const apply = vi.fn();

    const result = await runTableUpdateCommit_ACU(options('test_mixed_gate'), apply);

    expect(result).toEqual({ success: false, error: 'mixed storage evidence insufficient' });
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('SQLite mutation 同样在 provider 写入前被 migration gate 拦截', async () => {
    const result = await runSqliteRuntimeMutationCommit_ACU({
      ...options('test_sqlite_mixed_gate'),
      sql: 'UPDATE sheet_0 SET value = ?',
      params: ['changed'],
      mapValue: () => 'unreachable',
    });

    expect(result).toEqual({ success: false, error: 'mixed storage evidence insufficient' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.ensureProvider).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});

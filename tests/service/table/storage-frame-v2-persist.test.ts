import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockChat: any[] = [];
const mockSaveChatToHost = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mockChat,
  saveChatToHost_ACU: (...args: any[]) => mockSaveChatToHost(...args),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: (message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {})),
  readIsolatedTagData_ACU: (message: any, isolationKey: string) => message?.TavernDB_ACU_IsolatedData?.[isolationKey],
  writeMessageIdentity_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    checkpointMaxEntriesAfterCheckpoint: 99,
    checkpointMaxOperationKbAfterCheckpoint: 9999,
    checkpointMaxOperationCountAfterCheckpoint: 9999,
    checkpointCumulativeOperationRatioPercent: 100,
    checkpointSingleOperationRatioPercent: 100,
  },
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', async () => {
  const actual = await vi.importActual<any>('../../../src/service/table/storage-strategy-resolver');
  return {
    ...actual,
    isV2TagData_ACU: (value: any) => value?._acu_storage_version === 2 && value?.storageFrame?.version === 2,
  };
});

import { persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import type { ManualRefillChainV2_ACU } from '../../../src/service/table/storage-frame-v2-types';

function transactionContext() {
  return {
    baseRevision: null,
    writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_0' }],
    assertFresh: vi.fn(),
    runCommit: async (fn: any) => fn(),
  };
}

function makeChain(): ManualRefillChainV2_ACU {
  return {
    kind: 'manual_refill_chain',
    version: 1,
    status: 'complete',
    selectedSheetKeys: ['sheet_0'],
    contextMessageIndices: [1],
    originalStartMessageIndex: 1,
    targetMessageIndex: 1,
    batchSize: 1,
    baseCheckpoint: { sheet_0: { name: 'A', content: [['row_id', '值']] } } as any,
    chunks: [{ chunkIndex: 0, groupKeys: ['g'], buckets: [] }],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('persistTableMutationLogV2_ACU manualRefillChain', () => {
  beforeEach(() => {
    mockSaveChatToHost.mockClear();
    mockChat = [
      { is_user: false, mes: 'AI 1', TavernDB_ACU_IsolatedData: {} },
      {
        is_user: false,
        mes: 'AI 2',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: { sheet_0: { name: 'A', content: [['row_id', '值']] } },
              },
              logEntries: [],
            },
          },
        },
      },
    ];
  });

  it('force checkpoint 时写入 manualRefillChain', async () => {
    const chain = makeChain();
    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { sheet_0: { name: 'A', content: [['row_id', '值'], ['1', '新']] } } as any,
      operations: [{ kind: 'table_edit_dsl', text: 'insertRow(0,{"0":"新"})' }],
      filledSheetKeys: ['sheet_0'],
      candidateChangedSheetKeys: ['sheet_0'],
      forceCheckpoint: true,
      checkpointReason: 'manual',
      manualRefillChain: chain,
      transactionContext: transactionContext(),
    });

    expect(result.saved).toBe(true);
    const checkpoint = mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint;
    expect(checkpoint.manualRefillChain).toEqual(chain);
  });

  it('非 checkpoint incremental log 不写 manualRefillChain', async () => {
    const chain = makeChain();
    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 1,
      source: 'group_fill',
      afterData: { sheet_0: { name: 'A', content: [['row_id', '值'], ['1', '新']] } } as any,
      operations: [{ kind: 'table_edit_dsl', text: 'insertRow(0,{"0":"新"})' }],
      filledSheetKeys: ['sheet_0'],
      candidateChangedSheetKeys: ['sheet_0'],
      manualRefillChain: chain,
      transactionContext: transactionContext(),
    });

    expect(result.saved).toBe(true);
    const frame = mockChat[1].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint.manualRefillChain).toBeUndefined();
    expect(frame.logEntries[0]).not.toHaveProperty('manualRefillChain');
  });
});

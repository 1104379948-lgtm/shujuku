import { describe, expect, it, vi } from 'vitest';

const { mockSettings, mockIsolationKey } = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '', updateBatchSize: 3 },
  mockIsolationKey: '',
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  getCurrentIsolationKey_ACU: () => mockIsolationKey,
  _set_currentJsonTableData_ACU: vi.fn(),
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => [],
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn().mockReturnValue([]),
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn().mockResolvedValue({ success: true, migrated: false }),
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: vi.fn().mockResolvedValue(undefined),
}));

import { createManualRefillSessionMarker_ACU } from '../../../src/service/table/manual-refill-session';
import { isManualRefillAlreadyComplete_ACU, prepareManualRefillRun_ACU } from '../../../src/service/table/manual-refill-orchestrator';

function makeV2Message(marker?: any) {
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' } } },
          logEntries: [],
          ...(marker ? { manualRefillSession: marker } : {}),
        },
      },
    },
  };
}

describe('manual-refill-orchestrator', () => {
  it('complete marker is historical and starts a new session', async () => {
    const marker = {
      ...createManualRefillSessionMarker_ACU({
        selectedSheetKeys: ['sheet_a'],
        startMessageIndex: 0,
        endMessageIndex: 0,
        batchSize: 3,
        plannedSaveTargetIndices: [0],
      }),
      status: 'complete',
    };

    const result = await prepareManualRefillRun_ACU({
      enabled: true,
      liveChat: [makeV2Message(marker)],
      targetKeys: ['sheet_a'],
      contextScopeIndices: [0],
      batchSize: 3,
      updateGroups: {
        group: { indices: [0], batchSize: 3 },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(isManualRefillAlreadyComplete_ACU(result.context)).toBe(false);
    expect(result.context.session).not.toBeNull();
    expect(result.context.marker?.sessionId).not.toBe(marker.sessionId);
    expect(result.context.marker?.status).toBe('cleaned');
  });
});

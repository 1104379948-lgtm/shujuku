import { describe, expect, it } from 'vitest';

import { markManualRefillBatchesCompleted_ACU } from '../../../src/service/table/manual-refill-batch-runner';
import {
  createManualRefillSessionMarker_ACU,
  prepareManualRefillSession_ACU,
  transitionManualRefillSession_ACU,
} from '../../../src/service/table/manual-refill-session';

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

const baseConfig = {
  selectedSheetKeys: ['sheet_b', 'sheet_a'],
  startMessageIndex: 2,
  endMessageIndex: 8,
  batchSize: 3,
  plannedSaveTargetIndices: [4, 7, 8],
};

describe('manual-refill-session', () => {
  it('无 active session 时创建 cleaning session', () => {
    const prepared = prepareManualRefillSession_ACU([makeV2Message()], '', baseConfig);

    expect(prepared.command.type).toBe('start');
    expect(prepared.marker.status).toBe('cleaning');
    expect(prepared.marker.selectedSheetKeys).toEqual(['sheet_a', 'sheet_b']);
    expect(prepared.marker.plannedSaveTargetIndices).toEqual([4, 7, 8]);
  });

  it('同配置 active session 走 resume', () => {
    const marker = createManualRefillSessionMarker_ACU(baseConfig);
    const prepared = prepareManualRefillSession_ACU([makeV2Message(marker)], '', {
      ...baseConfig,
      selectedSheetKeys: ['sheet_a', 'sheet_b'],
    });

    expect(prepared.command).toEqual({ type: 'resume', sessionId: marker.sessionId });
    expect(prepared.marker.sessionId).toBe(marker.sessionId);
  });

  it('不同配置 active session 走 replace', () => {
    const marker = createManualRefillSessionMarker_ACU(baseConfig);
    const prepared = prepareManualRefillSession_ACU([makeV2Message(marker)], '', {
      ...baseConfig,
      selectedSheetKeys: ['sheet_a'],
    });

    expect(prepared.command.type).toBe('replace');
    expect(prepared.replacing?.sessionId).toBe(marker.sessionId);
    expect(prepared.marker.sessionId).not.toBe(marker.sessionId);
  });

  it('只允许合法状态转移', () => {
    const marker = createManualRefillSessionMarker_ACU(baseConfig);
    const cleaned = transitionManualRefillSession_ACU(marker, 'cleaned');
    expect(cleaned.success).toBe(true);

    const illegal = transitionManualRefillSession_ACU(marker, 'complete');
    expect(illegal.success).toBe(false);
  });

  it('批次完成记录按 session 幂等去重', () => {
    const marker = createManualRefillSessionMarker_ACU(baseConfig);
    const next = markManualRefillBatchesCompleted_ACU(marker, [7, 4, 7]);

    expect(next.status).toBe('cleaned');
    expect(next.completedSaveTargetIndices).toEqual([4, 7]);
  });
});

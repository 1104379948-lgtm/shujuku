import { describe, expect, it, vi, beforeEach } from 'vitest';
import { finalizeTablePersistenceAfterUpdate_ACU } from '../../../src/service/table/table-persistence-finalizer';
import { reconstructTablesFromChatDeltas_ACU } from '../../../src/service/table/table-delta-reconstruct';
import type { TableDataObject_ACU } from '../../../src/shared/models/table-data';
import type { TableLayerDeltaV2_ACU, TablePersistenceLayerV2_ACU } from '../../../src/service/table/table-delta-types';

const mockSaveChatToHost = vi.fn();

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  saveChatToHost_ACU: (...args: any[]) => mockSaveChatToHost(...args),
}));

vi.mock('../../../src/shared/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    logWarn_ACU: vi.fn(),
    parseTableTemplateJson_ACU: vi.fn(() => ({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '物品表', uid: 'sheet_0', content: [['row_id', '物品名']] },
    })),
  };
});

function makeData(rows: (string | null)[][], sheetName = '物品表'): TableDataObject_ACU {
  return {
    mate: { type: 'chatSheets', version: 1 } as any,
    sheet_0: { name: sheetName, uid: 'sheet_0', content: rows } as any,
  } as any;
}

function checkpointLayer(data: TableDataObject_ACU, id: string, source: any = 'legacy-migration'): TablePersistenceLayerV2_ACU {
  return {
    version: 2,
    checkpoint: {
      kind: 'checkpoint',
      version: 2,
      checkpointId: id,
      createdAt: '2026-05-22T00:00:00.000Z',
      source,
      isolationKey: '',
      data,
    },
  };
}

function upsertDelta(row: (string | null)[], id: string): TableLayerDeltaV2_ACU {
  return {
    kind: 'delta',
    version: 2,
    deltaId: id,
    createdAt: '2026-05-22T00:00:01.000Z',
    isolationKey: '',
    changedSheets: ['sheet_0'],
    modifiedKeys: ['sheet_0'],
    updateGroupKeys: ['sheet_0'],
    changesBySheet: {
      sheet_0: {
        sheetKey: 'sheet_0',
        rowChanges: [{ op: 'upsert', rowId: String(row[0]), row }],
      },
    },
  };
}

function aiMessage(layer?: TablePersistenceLayerV2_ACU, extraTagData: Record<string, any> = {}): any {
  const msg: any = { is_user: false, mes: 'AI' };
  if (layer || Object.keys(extraTagData).length > 0) {
    msg.TavernDB_ACU_IsolatedData = {
      '': {
        independentData: {},
        modifiedKeys: [],
        updateGroupKeys: [],
        ...extraTagData,
      },
    };
    if (layer) msg.TavernDB_ACU_IsolatedData[''].tablePersistenceV2 = layer;
  }
  return msg;
}

function deltaMessage(delta: TableLayerDeltaV2_ACU, extraTagData: Record<string, any> = {}): any {
  return aiMessage({ version: 2, delta, deltas: [delta] }, extraTagData);
}

const context = {
  isolationKey: '',
  isolationConfig: { enabled: false, code: '' },
  retainRecentLayers: 2,
  templateSheetKeys: ['sheet_0'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveChatToHost.mockResolvedValue(undefined);
});

describe('finalizeTablePersistenceAfterUpdate_ACU', () => {
  it('在保留窗口 boundary 写 retention-rollup checkpoint，并清理窗口外当前隔离表格贡献', async () => {
    const chat = [
      aiMessage(checkpointLayer(makeData([['row_id', '物品名'], ['1', '剑']]), 'checkpoint-0')),
      deltaMessage(upsertDelta(['2', '盾'], 'delta-1')),
      deltaMessage(upsertDelta(['3', '弓'], 'delta-2')),
      deltaMessage(upsertDelta(['4', '杖'], 'delta-3')),
    ];

    const before = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false }).data;
    const result = await finalizeTablePersistenceAfterUpdate_ACU({ ...context, chat });
    const after = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false }).data;

    expect(result.changed).toBe(true);
    expect(result.boundaryMessageIndex).toBe(2);
    expect(result.purgedMessageIndices).toEqual([0, 1]);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.source).toBe('retention-rollup');
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[1].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(after?.sheet_0?.content).toEqual(before?.sheet_0?.content);
    expect(result.reconstructedData?.sheet_0?.content).toEqual(before?.sheet_0?.content);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('清理窗口外当前隔离贡献时保留非当前隔离与向量状态', async () => {
    const manifest = { file: 'summary-index.json' };
    const chat = [
      aiMessage(checkpointLayer(makeData([['row_id'], ['1']]), 'checkpoint-0'), {
        summaryVectorIndexManifest: manifest,
        summaryVectorIndexState: { manifest },
        vectorMemoryState: { preserved: true },
        _acu_base_state: 'seeded',
      }),
      deltaMessage(upsertDelta(['2'], 'delta-1')),
      deltaMessage(upsertDelta(['3'], 'delta-2')),
    ];
    chat[0].TavernDB_ACU_IsolatedData.other = {
      independentData: { sheet_9: { name: '其他表', content: [['row_id'], ['x']] } },
      modifiedKeys: ['sheet_9'],
      updateGroupKeys: ['sheet_9'],
    };

    await finalizeTablePersistenceAfterUpdate_ACU({ ...context, chat, retainRecentLayers: 1 });

    expect(chat[0].TavernDB_ACU_IsolatedData[''].summaryVectorIndexManifest).toEqual(manifest);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].summaryVectorIndexState).toEqual({ manifest });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].vectorMemoryState).toEqual({ preserved: true });
    expect(chat[0].TavernDB_ACU_IsolatedData['']._acu_base_state).toBe('seeded');
    expect(chat[0].TavernDB_ACU_IsolatedData.other.independentData.sheet_9).toBeDefined();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2).toBeUndefined();
  });

  it('不从 legacy fallback 重建；legacy-only 数据需由 bootstrap 转成 checkpoint 后才参与 finalizer', async () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: { name: '物品表', uid: 'sheet_0', content: [['row_id', '物品名'], ['legacy', '旧物']] },
        },
      },
      deltaMessage(upsertDelta(['2', '盾'], 'delta-1')),
    ];

    const result = await finalizeTablePersistenceAfterUpdate_ACU({ ...context, chat, retainRecentLayers: 1 });
    const reconstructed = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false }).data;

    expect(result.bootstrapChanged).toBe(true);
    expect(result.reconstructedData?.sheet_0?.content).toContainEqual(['legacy', '旧物']);
    expect(reconstructed?.sheet_0?.content).toEqual(result.reconstructedData?.sheet_0?.content);
    expect(chat[0].TavernDB_ACU_IndependentData).toBeUndefined();
  });
});

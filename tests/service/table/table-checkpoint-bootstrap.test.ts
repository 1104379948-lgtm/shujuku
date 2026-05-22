import { describe, expect, it, vi } from 'vitest';
import type { Sheet_ACU, TableDataObject_ACU } from '../../../src/shared/models/table-data';
import { ensureChatOpenCheckpoint_ACU } from '../../../src/service/table/table-checkpoint-bootstrap';
import { reconstructTablesFromChatDeltas_ACU } from '../../../src/service/table/table-delta-reconstruct';
import type { TableCheckpointV2_ACU, TableLayerDeltaV2_ACU } from '../../../src/service/table/table-delta-types';

function makeSheet(content: (string | null)[][], overrides: Partial<Sheet_ACU> = {}): Sheet_ACU {
  return {
    uid: 'sheet_0',
    name: '测试表',
    sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
    content,
    updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1 },
    exportConfig: {
      enabled: false,
      splitByRow: false,
      entryName: '',
      entryType: '',
      keywords: '',
      preventRecursion: false,
      injectionTemplate: '',
      extraIndexEnabled: false,
      extraIndexEntryName: '',
      extraIndexColumns: [],
      extraIndexColumnModes: {},
      extraIndexInjectionTemplate: '',
      entryPlacement: { position: '', depth: 0, order: 0 },
      extraIndexPlacement: { position: '', depth: 0, order: 0 },
      fixedEntryPlacement: { position: '', depth: 0, order: 0 },
      fixedIndexPlacement: { position: '', depth: 0, order: 0 },
    },
    orderNo: 0,
    ...overrides,
  };
}

function makeData(sheets: Record<string, Sheet_ACU> = {}): TableDataObject_ACU {
  return {
    mate: {
      type: 'chatSheets',
      version: 1,
      updateConfigUiSentinel: -1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: '', depth: 0, order: 0 },
        wrapperPlacement: { position: '', depth: 0, order: 0 },
      },
    },
    ...sheets,
  };
}

const templateData = makeData({
  sheet_0: makeSheet([['row_id', '名称'], ['seed', '模板种子']]),
});

vi.mock('../../../src/shared/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    parseTableTemplateJson_ACU: vi.fn(() => JSON.parse(JSON.stringify(templateData))),
  };
});

function checkpoint(data: TableDataObject_ACU): TableCheckpointV2_ACU {
  return {
    kind: 'checkpoint',
    version: 2,
    checkpointId: 'checkpoint-existing',
    createdAt: '2026-05-22T00:00:00.000Z',
    source: 'legacy-migration',
    isolationKey: '',
    data,
  };
}

function delta(
  rowChanges: TableLayerDeltaV2_ACU['changesBySheet']['sheet_0']['rowChanges'],
  deltaId = 'delta-test',
): TableLayerDeltaV2_ACU {
  return {
    kind: 'delta',
    version: 2,
    deltaId,
    createdAt: '2026-05-22T00:00:00.000Z',
    isolationKey: '',
    changedSheets: ['sheet_0'],
    modifiedKeys: ['sheet_0'],
    updateGroupKeys: ['sheet_0'],
    changesBySheet: {
      sheet_0: {
        sheetKey: 'sheet_0',
        rowChanges,
      },
    },
  };
}

function aiMessage(layer: any = null): any {
  const msg: any = { is_user: false };
  if (layer) {
    msg.TavernDB_ACU_IsolatedData = {
      '': {
        independentData: {},
        modifiedKeys: [],
        updateGroupKeys: [],
        tablePersistenceV2: layer,
      },
    };
  }
  return msg;
}

const context = {
  isolationKey: '',
  isolationConfig: { enabled: false, code: '' },
  templateSheetKeys: ['sheet_0'],
};

describe('ensureChatOpenCheckpoint_ACU', () => {
  it('已有 checkpoint 时不读取 legacy、不覆盖 checkpoint', async () => {
    const existingData = makeData({ sheet_0: makeSheet([['row_id', '名称'], ['1', 'checkpoint 数据']]) });
    const chat = [
      aiMessage({ version: 2, checkpoint: checkpoint(existingData) }),
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['legacy', '不应覆盖']]),
        },
      },
    ];

    const result = await ensureChatOpenCheckpoint_ACU({ ...context, chat, save: false });

    expect(result.changed).toBe(false);
    expect(result.source).toBe('existing-checkpoint');
    expect(result.checkpointMessageIndex).toBe(0);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.checkpointId).toBe('checkpoint-existing');
    expect(chat[1].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
  });

  it('legacy-only 聊天合成完整快照，写入最新可写 AI 楼层并清理 legacy', async () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '旧层铁剑']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_1: makeSheet([['row_id', '名称'], ['2', '最新层木盾']], { uid: 'sheet_1', name: '装备表' }),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_1'],
      },
    ];

    const result = await ensureChatOpenCheckpoint_ACU({ ...context, chat, templateSheetKeys: ['sheet_0', 'sheet_1'], save: false });

    expect(result.changed).toBe(true);
    expect(result.source).toBe('legacy-migration');
    expect(result.checkpointMessageIndex).toBe(2);
    const writtenCheckpoint = chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint;
    expect(writtenCheckpoint.kind).toBe('checkpoint');
    expect(writtenCheckpoint.data.sheet_0.content).toEqual([['row_id', '名称'], ['1', '旧层铁剑']]);
    expect(writtenCheckpoint.data.sheet_1.content).toEqual([['row_id', '名称'], ['2', '最新层木盾']]);
    expect(chat[0].TavernDB_ACU_IndependentData).toBeUndefined();
    expect(chat[2].TavernDB_ACU_IndependentData).toBeUndefined();
  });

  it('empty 新对话使用模板建立 checkpoint', async () => {
    const chat = [aiMessage(), { is_user: true }];

    const result = await ensureChatOpenCheckpoint_ACU({ ...context, chat, save: false });

    expect(result.changed).toBe(true);
    expect(result.source).toBe('template-seed');
    expect(result.checkpointMessageIndex).toBe(0);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.source).toBe('template-seed');
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['seed', '模板种子'],
    ]);
  });

  it('orphan delta 前有可写 AI 锚点时，在最早 delta 前补 checkpoint 并保留 delta 回放', async () => {
    const firstDelta = delta([{ op: 'upsert', rowId: '2', rowIndexHint: 2, row: ['2', '木盾'] }], 'delta-first');
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '铁剑']]),
        },
      },
      aiMessage({ version: 2, delta: firstDelta }),
    ];

    const result = await ensureChatOpenCheckpoint_ACU({ ...context, chat, save: false });
    const reconstructed = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect(result.changed).toBe(true);
    expect(result.source).toBe('legacy-orphan-delta-repair');
    expect(result.checkpointMessageIndex).toBe(0);
    expect(result.earliestDeltaIndex).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
    ]);
    expect(chat[1].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.delta.deltaId).toBe('delta-first');
    expect((reconstructed.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
      ['2', '木盾'],
    ]);
  });

  it('orphan delta 无前置 AI 锚点时，同层合并模板和 delta 为 checkpoint 并删除同层 delta', async () => {
    const firstDelta = delta([{ op: 'upsert', rowId: '2', rowIndexHint: 2, row: ['2', '木盾'] }], 'delta-first');
    const chat = [aiMessage({ version: 2, deltas: [firstDelta], delta: firstDelta })];

    const result = await ensureChatOpenCheckpoint_ACU({ ...context, chat, save: false });
    const layer = chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2;
    const reconstructed = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect(result.changed).toBe(true);
    expect(result.source).toBe('template-orphan-delta-repair');
    expect(result.checkpointMessageIndex).toBe(0);
    expect(result.sameLayerDeltaRolledIntoCheckpoint).toBe(true);
    expect(layer.checkpoint.source).toBe('template-orphan-delta-repair');
    expect(layer.delta).toBeUndefined();
    expect(layer.deltas).toBeUndefined();
    expect((reconstructed.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['seed', '模板种子'],
      ['2', '木盾'],
    ]);
  });
});

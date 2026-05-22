import { describe, expect, it, vi } from 'vitest';
import type { Sheet_ACU, TableDataObject_ACU } from '../../../src/shared/models/table-data';
import { reconstructTablesFromChatDeltas_ACU } from '../../../src/service/table/table-delta-reconstruct';
import type { TableCheckpointV2_ACU, TableLayerDeltaV2_ACU } from '../../../src/service/table/table-delta-types';

vi.mock('../../../src/shared/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    logWarn_ACU: vi.fn(),
  };
});

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

function makeData(sheet?: Sheet_ACU): TableDataObject_ACU {
  const data: TableDataObject_ACU = {
    mate: {
      type: 'chatSheets',
      version: 1,
      updateConfigUiSentinel: -1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: '', depth: 0, order: 0 },
        wrapperPlacement: { position: '', depth: 0, order: 0 },
      },
    },
  };
  if (sheet) data.sheet_0 = sheet;
  return data;
}

function checkpoint(data: TableDataObject_ACU): TableCheckpointV2_ACU {
  return {
    kind: 'checkpoint',
    version: 2,
    checkpointId: 'checkpoint-test',
    createdAt: '2026-05-08T00:00:00.000Z',
    source: 'legacy-migration',
    isolationKey: '',
    data,
  };
}

function delta(rowChanges: TableLayerDeltaV2_ACU['changesBySheet']['sheet_0']['rowChanges']): TableLayerDeltaV2_ACU {
  return {
    kind: 'delta',
    version: 2,
    deltaId: 'delta-test',
    createdAt: '2026-05-08T00:00:00.000Z',
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

describe('reconstructTablesFromChatDeltas_ACU', () => {
  const context = {
    isolationKey: '',
    isolationConfig: { enabled: false, code: '' },
    templateSheetKeys: ['sheet_0'],
  };

  it('从 checkpoint 后正序回放 delta', () => {
    const chat = [
      aiMessage({ version: 2, checkpoint: checkpoint(makeData(makeSheet([['row_id', '名称'], ['1', '铁剑']]))) }),
      { is_user: true },
      aiMessage({ version: 2, delta: delta([{ op: 'upsert', rowId: '1', rowIndexHint: 1, row: ['1', '银剑'] }]) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect(result.usedLegacyMigration).toBe(false);
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '银剑'],
    ]);
  });

  it('重建 checkpoint 数据时补齐缺失 row_id，避免脏行继续进入运行时', () => {
    const chat = [
      aiMessage({ version: 2, checkpoint: checkpoint(makeData(makeSheet([['规则'], [null, '禁止越权修改系统规则']]))) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id'],
      ['1', '禁止越权修改系统规则'],
    ]);
  });

  it('同一消息同时存在 checkpoint 和 delta 时先 checkpoint 后 delta', () => {
    const chat = [
      aiMessage({
        version: 2,
        checkpoint: checkpoint(makeData(makeSheet([['row_id', '名称'], ['1', '铁剑']]))),
        delta: delta([{ op: 'upsert', rowId: '2', rowIndexHint: 2, row: ['2', '木盾'] }]),
      }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
      ['2', '木盾'],
    ]);
  });

  it('同一消息的 deltas 按 sequence 顺序累计回放，并保留 delta 最新镜像兼容', () => {
    const firstDelta = {
      ...delta([{ op: 'upsert', rowId: '1', rowIndexHint: 1, row: ['1', '银剑'] }]),
      deltaId: 'delta-first',
      sequence: 0,
    };
    const secondDelta = {
      ...delta([{ op: 'upsert', rowId: '2', rowIndexHint: 2, row: ['2', '木盾'] }]),
      deltaId: 'delta-second',
      sequence: 1,
    };
    const chat = [
      aiMessage({
        version: 2,
        checkpoint: checkpoint(makeData(makeSheet([['row_id', '名称'], ['base', '铁剑']]))),
        deltas: [secondDelta, firstDelta],
        delta: secondDelta,
      }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '银剑'],
      ['2', '木盾'],
      ['base', '铁剑'],
    ]);
  });

  it('存在 deltas 时不重复应用 delta 最新镜像', () => {
    const mirroredDelta = delta([{ op: 'upsert', rowId: '1', rowIndexHint: 1, row: ['1', '银剑'] }]);
    const chat = [aiMessage({ version: 2, deltas: [mirroredDelta], delta: mirroredDelta })];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { allowLegacyMigration: false });

    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([['row_id'], ['1', '银剑']]);
  });

  it('targetMessageIndexExclusive 会排除目标层之后的 delta', () => {
    const chat = [
      aiMessage({ version: 2, checkpoint: checkpoint(makeData(makeSheet([['row_id', '名称'], ['1', '铁剑']]))) }),
      aiMessage({ version: 2, delta: delta([{ op: 'upsert', rowId: '1', rowIndexHint: 1, row: ['1', '银剑'] }]) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, {
      allowLegacyMigration: false,
      targetMessageIndexExclusive: 1,
    });

    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
    ]);
  });

  it('无 V2 但存在 legacy 快照时懒迁移为最新 legacy AI 楼层 checkpoint 且不删除 legacy 源', () => {
    const chat: any[] = [
      aiMessage(),
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '旧层铁剑']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
        TavernDB_ACU_UpdateGroupKeys: ['sheet_0'],
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_1: makeSheet([['row_id', '名称'], ['2', '最新层木盾']], { uid: 'sheet_1', name: '装备表' }),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_1'],
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(2);
    expect(result.checkpoint?.messageIndexHint).toBe(2);
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '旧层铁剑'],
    ]);
    expect((result.data?.sheet_1 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['2', '最新层木盾'],
    ]);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.kind).toBe('checkpoint');
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.messageIndexHint).toBe(2);
    expect(chat[1].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[1].TavernDB_ACU_ModifiedKeys).toEqual(['sheet_0']);
    expect(chat[1].TavernDB_ACU_UpdateGroupKeys).toEqual(['sheet_0']);
    expect(chat[2].TavernDB_ACU_IndependentData.sheet_1).toBeDefined();
  });

  it('只有 V2 delta 没有 checkpoint 时先从 latest legacy 楼层建立 checkpoint 再回放 delta', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '铁剑']]),
        },
      },
      aiMessage({ version: 2, delta: delta([{ op: 'upsert', rowId: '2', rowIndexHint: 1, row: ['2', '木盾'] }]) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(0);
    expect(result.checkpoint?.messageIndexHint).toBe(0);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.source).toBe('legacy-migration');
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.messageIndexHint).toBe(0);
    expect(chat[0].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['2', '木盾'],
      ['1', '铁剑'],
    ]);
  });

  it('legacy 快照不在首楼时迁移到最新 legacy 楼层 checkpoint 并保留原 legacy 源', () => {
    const chat: any[] = [
      aiMessage(),
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '后置旧快照']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(2);
    expect(result.checkpoint?.messageIndexHint).toBe(2);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['1', '后置旧快照'],
    ]);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.messageIndexHint).toBe(2);
    expect(chat[2].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[2].TavernDB_ACU_ModifiedKeys).toEqual(['sheet_0']);
  });

  it('legacy 数据层超过保留数量时 bootstrap 仍写最新参与 legacy 合并的楼层', () => {
    const chat: any[] = [
      aiMessage(),
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '旧层1']]),
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['2', '旧层2']]),
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['3', '最新旧快照']]),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, {
      saveChatAfterMigration: true,
      retainRecentLayers: 2,
    });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(3);
    expect(result.checkpoint?.messageIndexHint).toBe(3);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[3].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.source).toBe('legacy-migration');
    expect(chat[3].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.messageIndexHint).toBe(3);
    expect(chat[1].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[2].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[3].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
  });

  it('legacy 数据层未超过保留数量时迁移到最新 legacy AI 楼层 checkpoint', () => {
    const chat: any[] = [
      aiMessage(),
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '旧层1']]),
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['2', '旧层2']]),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, {
      saveChatAfterMigration: true,
      retainRecentLayers: 5,
    });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(2);
    expect(result.checkpoint?.messageIndexHint).toBe(2);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.source).toBe('legacy-migration');
    expect(chat[1].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[2].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
  });

  it('已有 V2 checkpoint 时不再用更早 legacy 快照污染 V2 链', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['legacy', '旧剑']]),
        },
      },
      aiMessage({ version: 2, checkpoint: checkpoint(makeData(makeSheet([['row_id', '名称'], ['1', '铁剑']]))) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(false);
    expect(result.changed).toBe(false);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
    ]);
  });

  it('saveChatAfterMigration=false 时可读取 legacy 但不写回 checkpoint', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '铁剑']]),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: false });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(false);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '铁剑'],
    ]);
  });

  it('不按模板 key 过滤 legacy 旧表，避免旧 uid/sheet_key 变更导致丢表', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_Data: {
          mate: { type: 'chatSheets', version: 1 },
          sheet_0: makeSheet([['row_id', '名称'], ['1', '命中模板表']]),
          sheet_old_uid: makeSheet(
            [['row_id', '名称'], ['legacy', '旧 uid 表数据']],
            { uid: 'sheet_old_uid', name: '旧 uid 表' },
          ),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_0', 'sheet_old_uid'],
        TavernDB_ACU_UpdateGroupKeys: ['sheet_0', 'sheet_old_uid'],
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '命中模板表'],
    ]);
    expect((result.data?.sheet_old_uid as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['legacy', '旧 uid 表数据'],
    ]);
    const checkpointData = chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data;
    expect(checkpointData.sheet_0).toBeDefined();
    expect(checkpointData.sheet_old_uid).toBeDefined();
  });

  it('模板 key 不匹配时仍从 legacy 标准表生成 checkpoint，避免旧聊天被显示为空', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_Data: {
          mate: { type: 'chatSheets', version: 1 },
          sheet_0: makeSheet([['row_id', '名称'], ['1', '旧聊天铁剑']]),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, {
      ...context,
      templateSheetKeys: ['sheet_9'],
    }, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(0);
    expect(result.checkpoint?.messageIndexHint).toBe(0);
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '旧聊天铁剑'],
    ]);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.kind).toBe('checkpoint');
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['1', '旧聊天铁剑'],
    ]);
    expect(chat[0].TavernDB_ACU_Data.sheet_0).toBeDefined();
  });

  it('隔离开启且旧根字段缺少 Identity 时仍迁移当前聊天楼层 legacy 数据', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '无 Identity 旧表']]),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, {
      isolationKey: 'role-a',
      isolationConfig: { enabled: true, code: 'role-a' },
      templateSheetKeys: ['sheet_9'],
    }, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.checkpointMessageIndex).toBe(0);
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['1', '无 Identity 旧表'],
    ]);
    expect(chat[0].TavernDB_ACU_IndependentData.sheet_0).toBeDefined();
    expect(chat[0].TavernDB_ACU_IsolatedData['role-a'].tablePersistenceV2.checkpoint.data.sheet_0).toBeDefined();
  });

  it('Data 与 SummaryData 不按摘要表名过滤，旧版本放错容器也不丢表', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_Data: {
          sheet_summary_in_data: makeSheet(
            [['row_id', '内容'], ['s1', '摘要容器错放 Data']],
            { uid: 'sheet_summary_in_data', name: '剧情摘要表' },
          ),
        },
        TavernDB_ACU_SummaryData: {
          sheet_normal_in_summary: makeSheet(
            [['row_id', '内容'], ['n1', '普通表错放 SummaryData']],
            { uid: 'sheet_normal_in_summary', name: '普通物品表' },
          ),
        },
      },
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, {
      ...context,
      templateSheetKeys: ['sheet_9'],
    }, { saveChatAfterMigration: true });

    expect(result.usedLegacyMigration).toBe(true);
    expect((result.data?.sheet_summary_in_data as Sheet_ACU).content).toEqual([
      ['row_id', '内容'],
      ['s1', '摘要容器错放 Data'],
    ]);
    expect((result.data?.sheet_normal_in_summary as Sheet_ACU).content).toEqual([
      ['row_id', '内容'],
      ['n1', '普通表错放 SummaryData'],
    ]);
    const checkpointData = chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.data;
    expect(checkpointData.sheet_summary_in_data).toBeDefined();
    expect(checkpointData.sheet_normal_in_summary).toBeDefined();
  });

  it('legacy 后存在 delta-only 兼容层时 checkpoint 不写到 delta 后面，避免吞掉后续 delta', () => {
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: makeSheet([['row_id', '名称'], ['1', '铁剑']]),
        },
      },
      aiMessage({ version: 2, delta: delta([{ op: 'upsert', rowId: '2', rowIndexHint: 1, row: ['2', '木盾'] }]) }),
    ];

    const result = reconstructTablesFromChatDeltas_ACU(chat, context, { saveChatAfterMigration: true });

    expect(result.checkpointMessageIndex).toBe(0);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint.messageIndexHint).toBe(0);
    expect(chat[1].TavernDB_ACU_IsolatedData[''].tablePersistenceV2.checkpoint).toBeUndefined();
    expect((result.data?.sheet_0 as Sheet_ACU).content).toEqual([
      ['row_id', '名称'],
      ['2', '木盾'],
      ['1', '铁剑'],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { loadTableStateFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function makeCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_0: {
      uid: 'inventory',
      name: '背包',
      content: [
        ['row_id', 'name'],
        ['1', '铁剑'],
      ],
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);',
      },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  } as any;
}

function makeDslCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_a: {
      uid: 'global_state',
      name: '全局数据表',
      content: [['row_id', '地点'], ['1', '起点']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
    sheet_b: {
      uid: 'chronicle',
      name: '纪要表',
      content: [['row_id', '时间跨度', '地点', '纪要', '概要']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    },
  } as any;
}

describe('loadTableStateFromFramesV2_ACU', () => {
  it('从最后 checkpoint 开始，在同一个恢复 runtime 上顺序回放 sql_batch', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [
                {
                  seq: 1,
                  entryId: 'v2_sql_1',
                  createdAt: 2,
                  source: 'auto_fill',
                  targetMessageIndex: 0,
                  aiFloor: 1,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [
                    { kind: 'sql_batch', statements: ["UPDATE inventory SET name = '钢剑' WHERE row_id = 1"] },
                  ],
                },
                {
                  seq: 2,
                  entryId: 'v2_sql_2',
                  createdAt: 3,
                  source: 'auto_fill',
                  targetMessageIndex: 0,
                  aiFloor: 1,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [
                    { kind: 'sql_batch', statements: ["INSERT INTO inventory VALUES (2, '药水')"] },
                  ],
                },
              ],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '钢剑'],
      ['2', '药水'],
    ]);
  });

  it('回放带参数绑定的 sql_batch', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_sql_params_1',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: [],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_batch',
                  statements: ['UPDATE inventory SET name = ? WHERE row_id = ?'],
                  params: [['钢剑', 1]],
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content[1]).toEqual(['1', '钢剑']);
  });

  it('回放带 sheetKey 的 sql_sheet_batch，并保留 SQL runtime 语义', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_sql_sheet_batch_1',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch',
                  sheetKey: 'sheet_0',
                  statements: ['UPDATE inventory SET name = ? WHERE row_id = ?', 'INSERT INTO inventory VALUES (?, ?)'],
                  params: [['钢剑', 1], [2, '药水']],
                  tableName: 'inventory',
                  reason: 'system',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '钢剑'],
      ['2', '药水'],
    ]);
  });

  it('回放缺少 DDL 且首列表头为 null 的历史中文表', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: {
                mate: { type: 'acu', version: 1 },
                sheet_dCudvUnH: {
                  uid: 'sheet_dCudvUnH',
                  name: '全局数据表',
                  content: [
                    [null, '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
                    ['1', '起点', '2026-01-01 11:00', null, '0分钟'],
                  ],
                  sourceData: {},
                  updateConfig: {},
                  exportConfig: {},
                  orderNo: 0,
                },
              },
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1,
              entryId: 'v2_sql_legacy_chinese_headers',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_dCudvUnH'],
              groupKeys: [],
              operations: [{
                kind: 'sql_batch',
                statements: ["UPDATE sheet_dCudvUnH SET col_1 = '城镇' WHERE row_id = 1"],
              }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_dCudvUnH.content).toEqual([
      ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
      ['1', '城镇', '2026-01-01 11:00', null, '0分钟'],
    ]);
  });

  it('回放 sql_batch 前先套用当前聊天 guide 的新 DDL/CHECK', async () => {
    const oldData = {
      mate: { type: 'acu', version: 1 },
      sheet_MapElements: {
        uid: 'sheet_MapElements',
        name: '地图元素表',
        content: [['row_id', '元素名称', '元素类型'], ['1', '旧点', '地标']],
        sourceData: {
          ddl: `CREATE TABLE map_elements (
            row_id INTEGER PRIMARY KEY,
            element_name TEXT NOT NULL, -- 元素名称
            element_type TEXT NOT NULL CHECK(element_type IN ('地标')) -- 元素类型
          );`,
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const newGuide = {
      version: 2,
      tags: {
        '': {
          data: {
            mate: { type: 'chatSheets', version: 2 },
            sheet_MapElements: {
              uid: 'sheet_MapElements',
              name: '地图元素表',
              content: [['row_id', '元素名称', '元素类型']],
              sourceData: {
                ddl: `CREATE TABLE map_elements (
                  row_id INTEGER PRIMARY KEY,
                  element_name TEXT NOT NULL, -- 元素名称
                  element_type TEXT NOT NULL CHECK(element_type IN ('地标','地形')) -- 元素类型
                );`,
              },
              updateConfig: {},
              exportConfig: {},
              orderNo: 0,
            },
          },
          templateScopeMode: 'chat_override',
        },
      },
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_InternalSheetGuide: newGuide,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: oldData,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1,
              entryId: 'v2_sql_terrain',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_MapElements'],
              groupKeys: [],
              operations: [{
                kind: 'sql_batch',
                statements: ["INSERT INTO map_elements (row_id, element_name, element_type) VALUES (2, '废弃集装箱', '地形')"],
              }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_MapElements.sourceData.ddl).toContain("'地形'");
    expect(result?.sheet_MapElements.content).toEqual([
      ['row_id', '元素名称', '元素类型'],
      ['1', '旧点', '地标'],
      ['2', '废弃集装箱', '地形'],
    ]);
  });

  it('回放无分号分隔且含前置文本的 table_edit_dsl', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeDslCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_dsl_1',
                createdAt: 2,
                source: 'auto_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'table_edit_dsl',
                  text: '说明文字 updateRow(0, 0, {"0":"城镇(北区)"}) insertRow(1, {"0":"第一天","1":"城镇(北区)","2":"记录包含括号(测试)，不应破坏命令切分。","3":"抵达城镇"})',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_a.content[1]).toEqual(['1', '城镇(北区)']);
    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['1', '第一天', '城镇(北区)', '记录包含括号(测试)，不应破坏命令切分。', '抵达城镇'],
    ]);
  });

  it('无 full checkpoint 时拒绝从 data_replace/log-only 恢复不完整数据', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1,
                entryId: 'v2_import_data_replace',
                createdAt: 1,
                source: 'import',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{ kind: 'data_replace', data: makeDslCheckpointData(), reason: 'import' }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result).toBeNull();
  });

  it('按日志顺序混合回放旧 data_replace、新 sheet_replace 与 row_upsert', async () => {
    const checkpointData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '表A',
        content: [['row_id', '值'], ['1', 'checkpoint-a']],
      },
      sheet_1: {
        name: '表B',
        content: [['row_id', '值'], ['1', 'checkpoint-b']],
      },
    } as any;
    const legacyDataReplace = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '表A',
        content: [['row_id', '值'], ['1', 'legacy-a']],
      },
      sheet_1: {
        name: '表B',
        content: [['row_id', '值'], ['1', 'legacy-b']],
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: checkpointData,
            },
            logEntries: [
              {
                seq: 1,
                entryId: 'legacy-data-replace',
                createdAt: 2,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0', 'sheet_1'],
                changedSheetKeys: ['sheet_0', 'sheet_1'],
                groupKeys: [],
                operations: [{ kind: 'data_replace', data: legacyDataReplace, reason: 'system' }],
              },
              {
                seq: 2,
                entryId: 'single-sheet-replace',
                createdAt: 3,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: { name: '表A', content: [['row_id', '值'], ['1', 'sheet-replace-a']] }, reason: 'system' }],
              },
              {
                seq: 3,
                entryId: 'row-upsert-after-replace',
                createdAt: 4,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_1'],
                changedSheetKeys: ['sheet_1'],
                groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_1', rowId: '2', cells: ['2', 'row-upsert-b'] }],
              },
            ],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([['row_id', '值'], ['1', 'sheet-replace-a']]);
    expect(result?.sheet_1.content).toEqual([['row_id', '值'], ['1', 'legacy-b'], ['2', 'row-upsert-b']]);
  });

  it('按跨 frame 时间线回放旧 SQL、单表 checkpoint、新 SQL 与后续替换操作', async () => {
    const rootData = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: {
        uid: 'inventory',
        name: '背包',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
      sheet_equipment: {
        uid: 'equipment',
        name: '装备',
        content: [['row_id', 'name'], ['1', '布甲']],
        sourceData: { ddl: 'CREATE TABLE equipment (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 1,
      },
    } as any;
    const shardData = {
      ...rootData.sheet_inventory,
      content: [['row_id', 'name'], ['1', '分片剑']],
    };
    const replacementData = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: {
        ...rootData.sheet_inventory,
        content: [['row_id', 'name'], ['1', '替换前剑']],
      },
      sheet_equipment: {
        ...rootData.sheet_equipment,
        content: [['row_id', 'name'], ['1', '替换后布甲']],
      },
    } as any;
    const entry = (seq: number, entryId: string, operations: any[]) => ({
      seq,
      entryId,
      createdAt: seq + 1,
      source: 'manual_crud',
      targetMessageIndex: 0,
      aiFloor: 1,
      filledSheetKeys: [],
      changedSheetKeys: [],
      groupKeys: [],
      operations,
    });
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [entry(1, 'legacy-cross-sheet-sql', [{
                kind: 'sql_batch',
                statements: [
                  "UPDATE inventory SET name = '旧 SQL 剑' WHERE row_id = 1",
                  "UPDATE equipment SET name = '旧 SQL 甲' WHERE row_id = 1",
                ],
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_inventory: {
                  kind: 'sheet_full',
                  createdAt: 3,
                  reason: 'manual',
                  sheetKey: 'sheet_inventory',
                  data: shardData,
                },
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [entry(2, 'sheet-sql-after-shard', [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_inventory',
                tableName: 'inventory',
                statements: ["UPDATE inventory SET name = '分片后 SQL 剑' WHERE row_id = 1"],
                reason: 'manual',
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [entry(3, 'whole-state-replace', [{
                kind: 'data_replace',
                data: replacementData,
                reason: 'checkpoint_fallback',
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                entry(4, 'sheet-replace-after-data-replace', [{
                  kind: 'sheet_replace',
                  sheetKey: 'sheet_inventory',
                  sheet: {
                    ...rootData.sheet_inventory,
                    content: [['row_id', 'name'], ['1', 'sheet_replace 剑']],
                  },
                  reason: 'manual',
                }]),
                entry(5, 'row-upsert-after-sheet-replace', [{
                  kind: 'row_upsert',
                  sheetKey: 'sheet_inventory',
                  rowId: '1',
                  cells: ['1', '最终剑'],
                }]),
              ],
            },
          },
        },
      },
    ];

    const afterShardAndSql = await loadTableStateFromFramesV2_ACU(chat.slice(0, 3), '');
    expect(afterShardAndSql?.sheet_inventory.content).toEqual([['row_id', 'name'], ['1', '分片后 SQL 剑']]);
    expect(afterShardAndSql?.sheet_equipment.content).toEqual([['row_id', 'name'], ['1', '旧 SQL 甲']]);

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_inventory.content).toEqual([['row_id', 'name'], ['1', '最终剑']]);
    expect(result?.sheet_equipment.content).toEqual([['row_id', 'name'], ['1', '替换后布甲']]);
  });

  it('从 boundary compaction checkpoint 开始回放降级旧 full 的 data_replace 与后续日志', async () => {
    const boundaryData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '剑']],
      },
    } as any;
    const downgradedManualSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '盾']],
      },
    } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: {
                  mate: { type: 'acu', version: 1 },
                  sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '旧剑']] },
                },
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 2,
                reason: 'compaction',
                data: boundaryData,
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 0,
                  entryId: 'downgraded-checkpoint-2',
                  createdAt: 3,
                  source: 'system',
                  targetMessageIndex: 2,
                  aiFloor: 3,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [{ kind: 'data_replace', data: downgradedManualSnapshot, reason: 'checkpoint_fallback' }],
                  writeSet: [{ kind: 'all' }],
                },
                {
                  seq: 1,
                  entryId: 'after-downgrade-update',
                  createdAt: 4,
                  source: 'auto_fill',
                  targetMessageIndex: 2,
                  aiFloor: 3,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '药水'] }],
                },
              ],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', '物品名'],
      ['1', '盾'],
      ['2', '药水'],
    ]);
  });

  it('手动重填 retain=10/30 层后删除第 30 层时，可从第 29 层安全 full baseline 恢复纪要表', async () => {
    const staleBoundaryData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [['row_id', '事件'], ['20', '边界旧事件']],
      },
    } as any;
    const fullRefillData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [
          ['row_id', '事件'],
          ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `第${index + 1}层事件`]),
        ],
      },
      sheet_outline: {
        name: '总体大纲',
        content: [
          ['row_id', '大纲'],
          ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `第${index + 1}层大纲`]),
        ],
      },
    } as any;
    const chat = Array.from({ length: 30 }, (_, index) => ({ is_user: false } as any));
    chat[20].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 20,
            reason: 'compaction',
            data: staleBoundaryData,
          },
          logEntries: [],
        },
      },
    };
    chat[28].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 29,
            reason: 'manual',
            data: fullRefillData,
          },
          logEntries: [],
        },
      },
    };
    chat[29].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          logEntries: [{
            seq: 1,
            entryId: 'manual-refill-progress-final',
            createdAt: 30,
            source: 'group_fill',
            targetMessageIndex: 29,
            aiFloor: 30,
            filledSheetKeys: ['sheet_summary', 'sheet_outline'],
            changedSheetKeys: ['sheet_summary', 'sheet_outline'],
            groupKeys: [],
            operations: [{ kind: 'data_replace', data: fullRefillData, reason: 'checkpoint_fallback' }],
          }],
        },
      },
    };
    chat.splice(29, 1);

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_summary.content).toHaveLength(31);
    expect(result?.sheet_summary.content[30]).toEqual(['30', '第30层事件']);
    expect(result?.sheet_outline.content[30]).toEqual(['30', '第30层大纲']);
  });

  it('跨第20层边界重填纪要表1-30后，重入从既有 full checkpoint 的单表快照恢复全部楼层且不污染非目标表', async () => {
    const boundaryData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [['row_id', '事件'], ['20', '旧边界事件']],
      },
      sheet_outline: {
        name: '总体大纲',
        content: [['row_id', '大纲'], ['20', '保留的大纲']],
      },
    } as any;
    const refilledSummary = {
      name: '纪要表',
      content: [
        ['row_id', '事件'],
        ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `重填第${index + 1}层事件`]),
      ],
    } as any;
    const chat = Array.from({ length: 30 }, () => ({ is_user: false } as any));
    chat[20].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 20,
            reason: 'compaction',
            data: {
              ...boundaryData,
              sheet_summary: undefined,
            },
          },
          perSheetCheckpoints: {
            sheet_summary: {
              kind: 'sheet_full',
              createdAt: 30,
              reason: 'manual',
              sheetKey: 'sheet_summary',
              data: refilledSummary,
            },
          },
          logEntries: [],
        },
      },
    };

    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_summary).toEqual(expect.objectContaining({ kind: 'sheet_full', data: refilledSummary }));
    expect(chat[29].TavernDB_ACU_IsolatedData).toBeUndefined();
    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_summary.content).toHaveLength(31);
    expect(result?.sheet_summary.content[1]).toEqual(['1', '重填第1层事件']);
    expect(result?.sheet_summary.content[30]).toEqual(['30', '重填第30层事件']);
    expect(result?.sheet_outline).toEqual(boundaryData.sheet_outline);
  });

  it('按消息时间线用单表 checkpoint 覆盖旧 full 中的目标表，同时保留根数据与非目标表', async () => {
    const rootData = makeDslCheckpointData();
    const rebuiltSummarySheet = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '新 1-20 层纪要']],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: rebuiltSummarySheet,
                },
              },
              logEntries: [],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.mate).toEqual(rootData.mate);
    expect(result?.sheet_a).toEqual(rootData.sheet_a);
    expect(result?.sheet_b).toEqual(rebuiltSummarySheet);
  });

  it('同一 frame 内先应用单表 checkpoint，再按 seq 回放该 frame 的日志', async () => {
    const rootData = makeDslCheckpointData();
    const rebuiltSummarySheet = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '新 1-20 层纪要']],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: rebuiltSummarySheet,
                },
              },
              logEntries: [{
                seq: 1,
                entryId: 'after-sheet-checkpoint',
                createdAt: 3,
                source: 'manual_fill',
                targetMessageIndex: 1,
                aiFloor: 2,
                filledSheetKeys: ['sheet_b'],
                changedSheetKeys: ['sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'row_upsert',
                  sheetKey: 'sheet_b',
                  rowId: '21',
                  cells: ['21', '21-30', '新地点', '新第21层纪要', '新概要'],
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['20', '新 1-20 层纪要'],
      ['21', '21-30', '新地点', '新第21层纪要', '新概要'],
    ]);
  });

  it('同一 frame 内 data_replace 会整体替换先应用的单表 checkpoint', async () => {
    const rootData = makeDslCheckpointData();
    const shardData = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '分片纪要']],
    };
    const replacementData = {
      mate: { type: 'acu', version: 2 },
      sheet_a: {
        ...rootData.sheet_a,
        content: [['row_id', '地点'], ['1', '全量替换地点']],
      },
      sheet_b: {
        ...rootData.sheet_b,
        content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '全量替换纪要']],
      },
    } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: shardData,
                },
              },
              logEntries: [{
                seq: 1,
                entryId: 'same-frame-whole-state-replace',
                createdAt: 3,
                source: 'manual_fill',
                targetMessageIndex: 1,
                aiFloor: 2,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'data_replace',
                  data: replacementData,
                  reason: 'checkpoint_fallback',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['20', '全量替换纪要'],
    ]);
    expect(result?.sheet_a.content).toEqual([
      ['row_id', '地点'],
      ['1', '全量替换地点'],
    ]);
    expect(result?.sheet_b.content.flat()).not.toContain('分片纪要');
  });

  it('只有单表 checkpoint 而没有整库 full 时拒绝恢复', async () => {
    const rootData = makeDslCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            perSheetCheckpoints: {
              sheet_b: {
                kind: 'sheet_full',
                createdAt: 1,
                reason: 'manual',
                sheetKey: 'sheet_b',
                data: rootData.sheet_b,
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toBeNull();
  });

});

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const runtimeMock = vi.hoisted(() => ({
  settings_ACU: {
    apiPresets: [{ name: 'alpha' }, { name: 'beta' }],
    tableApiPresetOverridesByName: {} as Record<string, string>,
  },
}));

const saveSettingsMock = vi.hoisted(() => ({
  saveSettings_ACU: vi.fn(() => ({ saved: true, storageType: 'memory' })),
}));

const helperMock = vi.hoisted(() => ({
  applySummaryIndexSequenceToTable_ACU: vi.fn((table: any, colIndex: number) => {
    if (!Array.isArray(table?.content)) return;
    for (let rowIndex = 1; rowIndex < table.content.length; rowIndex += 1) {
      if (Array.isArray(table.content[rowIndex])) {
        table.content[rowIndex][colIndex + 1] = `AM${String(rowIndex).padStart(4, '0')}`;
      }
    }
  }),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => 0),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => true),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => runtimeMock);
vi.mock('../../../src/service/settings/settings-service', () => saveSettingsMock);
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: () => true,
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => helperMock);
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useVisualizerConfigEditing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    runtimeMock.settings_ACU.apiPresets = [{ name: 'alpha' }, { name: 'beta' }];
    runtimeMock.settings_ACU.tableApiPresetOverridesByName = {};
    vi.clearAllMocks();
  });

  async function loadSheet() {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '背包表',
        orderNo: 0,
        content: [[null, '旧物品', '数量'], ['1', '苹果', '2']],
        sourceData: {
          note: '背包',
          ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT, -- 旧物品
  quantity INTEGER -- 数量
);`,
        },
        updateConfig: {},
        exportConfig: {},
      },
    }, ['sheet_a']);
    return store;
  }

  it('编辑列名会同步 SQLite DDL 注释并标记 dirty', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.updateHeader(0, '物品名');

    expect(store.currentSheet.content[0][1]).toBe('物品名');
    expect(store.currentSheet.sourceData.ddl).toContain('item_name TEXT, -- 物品名');
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('新增和删除列会同步所有数据行', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.addColumn('品质');
    expect(store.currentSheet.content[0]).toEqual([null, '旧物品', '数量', '品质']);
    expect(store.currentSheet.content[1]).toEqual(['1', '苹果', '2', '']);

    config.deleteColumn(1);
    expect(store.currentSheet.content[0]).toEqual([null, '旧物品', '品质']);
    expect(store.currentSheet.content[1]).toEqual(['1', '苹果', '']);
  });

  it('全局注入配置作为模板级草稿写入 mate.globalInjectionConfig', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.updateGlobalPlacement('wrapperPlacement', 'order', 90001);

    expect(store.tempData?.mate.globalInjectionConfig.wrapperPlacement.order).toBe(90001);
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('存在未保存的行数据增量时拒绝配置和全局模板修改', async () => {
    const store = await loadSheet();
    store.updateCell(0, 1, '3');
    const beforeData = JSON.parse(JSON.stringify(store.tempData));
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    expect(() => config.renameSheet('新名称')).toThrow('存在未保存的行数据增量');
    expect(() => config.addColumn('品质')).toThrow('存在未保存的行数据增量');
    expect(() => config.updateGlobalPlacement('wrapperPlacement', 'order', 90001)).toThrow('存在未保存的行数据增量');
    expect(store.tempData).toEqual(beforeData);
    expect(store.templateDirty).toBe(false);
  });

  it('表级 API 预设覆盖写入设置而不标记模板 dirty', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.setTableApiPreset('beta');

    expect(runtimeMock.settings_ACU.tableApiPresetOverridesByName['背包表']).toBe('beta');
    expect(saveSettingsMock.saveSettings_ACU).toHaveBeenCalledTimes(1);
    expect(store.dirty).toBe(false);
  });

  it('编码索引自动编号开关写入锁草稿，开启时立即重排当前表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        uid: 'sheet_summary',
        name: '总结表',
        orderNo: 0,
        content: [[null, '事件', '编码索引'], [null, '初遇', '手写编号']],
        sourceData: {},
        updateConfig: {},
        exportConfig: {},
      },
    }, ['sheet_summary']);
    store.loadLockDrafts({
      sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: false },
    });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    expect(config.specialIndex.value.locked).toBe(false);

    config.setSpecialIndexLock(true);

    expect(store.tableLockDrafts.sheet_summary.specialIndexLocked).toBe(true);
    expect(store.currentSheet.content[1][2]).toBe('AM0001');
    expect(store.lockDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('关闭特殊索引锁且无需重排行数据时仍登记锁草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        uid: 'sheet_summary',
        name: '总结表',
        orderNo: 0,
        content: [[null, '事件', '编码索引'], ['1', '初遇', 'AM0001']],
        sourceData: {}, updateConfig: {}, exportConfig: {},
      },
    }, ['sheet_summary']);
    store.loadLockDrafts({ sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: true } });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');

    useVisualizerConfigEditing().setSpecialIndexLock(false);

    expect(store.tableLockDrafts.sheet_summary.specialIndexLocked).toBe(false);
    expect(store.pendingDataOps?.updatesByRow).toEqual({});
    expect(store.lockDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('committed 状态拒绝配置、全局配置和特殊索引锁改写', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: { uid: 'sheet_summary', name: '总结表', orderNo: 0, content: [[null, '事件', '编码索引'], ['1', '初遇', '手写编号']] },
    }, ['sheet_summary']);
    store.loadLockDrafts({ sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: false } });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    const beforeData = JSON.parse(JSON.stringify(store.tempData));
    const beforeLocks = JSON.parse(JSON.stringify(store.tableLockDrafts));
    store.pendingDataOps = {
      updatesByRow: {}, insertsByClientRowId: {}, deletesByRow: {},
      committed: { afterData: beforeData, insertedRowIds: {} },
    };

    expect(() => config.renameSheet('新名称')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => config.updateHeader(0, '新物品')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => config.updateGlobalPlacement('wrapperPlacement', 'order', 90001)).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => config.setSpecialIndexLock(true)).toThrow('数据已持久化但本地刷新尚未完成');
    expect(store.tempData).toEqual(beforeData);
    expect(store.tableLockDrafts).toEqual(beforeLocks);
  });

  it('开启特殊索引锁时只为实际重排的既有行登记 V2 更新', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: { uid: 'sheet_summary', name: '总结表', orderNo: 0, content: [[null, '事件', '编码索引'], ['1', '初遇', '旧值'], ['2', '再会', 'AM0002']] },
    }, ['sheet_summary']);
    store.loadLockDrafts({ sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: false } });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');

    useVisualizerConfigEditing().setSpecialIndexLock(true);

    expect(store.currentSheet.content.slice(1).map((row: any[]) => row[2])).toEqual(['AM0001', 'AM0002']);
    expect(store.lockDirty).toBe(true);
    expect(store.pendingDataOps?.updatesByRow['sheet_summary::1']?.data).toEqual({ '编码索引': 'AM0001' });
    expect(store.pendingDataOps?.updatesByRow['sheet_summary::2']).toBeUndefined();
  });

  it('世界书关键词条目类型沿用旧 service 识别的 keyword 枚举', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    expect(config.entryTypeOptions).toContainEqual({
      value: 'keyword',
      label: '关键词触发条目',
    });

    config.updateExportConfig('entryType', 'keyword');

    expect(store.currentSheet.exportConfig.entryType).toBe('keyword');
    expect(store.dirty).toBe(true);
  });
});

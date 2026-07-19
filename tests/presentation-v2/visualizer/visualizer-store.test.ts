import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useVisualizerStore } from '../../../src/presentation-v2/stores/visualizer-store';

describe('visualizer-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('记录进入来源并在关闭时返回 shell 处理信息', () => {
    const store = useVisualizerStore();

    store.open({
      source: 'external-api',
      wasShellOpen: false,
      previousPageId: 'form-fill',
    });

    expect(store.isActive).toBe(true);
    expect(store.mode).toBe('data');
    expect(store.openTick).toBe(1);

    const result = store.closeSurface();

    expect(result).toEqual({
      shouldCloseShell: true,
      previousPageId: 'form-fill',
    });
    expect(store.isActive).toBe(false);
  });

  it('重复打开复用现有 surface，干净状态下记录一次刷新请求', () => {
    const store = useVisualizerStore();

    store.open({
      source: 'external-api',
      wasShellOpen: true,
      previousPageId: 'dashboard',
    });
    store.open({
      source: 'external-api',
      wasShellOpen: false,
      previousPageId: null,
    });

    expect(store.openTick).toBe(1);
    expect(store.focusTick).toBe(2);
    expect(store.externalRefreshTick).toBe(1);
  });

  it('外部刷新在 dirty 状态下转为冲突标记', () => {
    const store = useVisualizerStore();
    store.open({
      source: 'external-api',
      wasShellOpen: true,
      previousPageId: 'dashboard',
    });
    store.setDirty(true);

    expect(store.requestExternalRefresh()).toBe('conflicted');
    expect(store.externalRevisionChanged).toBe(true);
    expect(store.externalRefreshTick).toBe(0);
  });

  it('载入工作副本后支持切表、编辑单元格和 dirty 标记', () => {
    const store = useVisualizerStore();

    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_b: { name: '事件记录', orderNo: 1, content: [[null, '事项'], [null, '旧值']] },
      sheet_a: { name: '角色状态', orderNo: 0, content: [[null, '姓名', '状态'], [null, 'A', '平静']] },
    }, ['sheet_a', 'sheet_b']);

    expect(store.sheetItems.map(item => item.name)).toEqual(['角色状态', '事件记录']);
    expect(store.currentSheetKey).toBe('sheet_a');
    expect(store.dirty).toBe(false);

    store.updateCell(0, 1, '紧张');

    expect(store.currentSheet.content[1][2]).toBe('紧张');
    expect(store.dirty).toBe(true);
    expect(store.draftRevision).toBe(1);
  });

  it('新增和排序表格会维护模板顺序并标记模板草稿', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1']] },
    }, ['sheet_a', 'sheet_b']);

    store.addSheet('sheet_c', { name: 'C', content: [[null, '列1']] });
    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_b', 'sheet_c']);
    expect(store.currentSheetKey).toBe('sheet_c');

    store.moveSheet('sheet_c', 'up');
    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_c', 'sheet_b']);
    expect(store.tempData?.sheet_c.orderNo).toBe(1);
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('删除既有表会维护删除队列，且拒绝与模板或行草稿混合', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1'], ['1', 'A']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1'], ['1', 'B']] },
    }, ['sheet_a', 'sheet_b']);

    store.deleteSheet('sheet_b');
    expect(store.sheetOrder).toEqual(['sheet_a']);
    expect(store.deletedSheetKeys).toEqual(['sheet_b']);
    expect(store.tableLockDrafts.sheet_b).toBeUndefined();
    expect(store.pendingLockChanges).toEqual([]);
    expect(() => store.updateCell(0, 0, 'A2')).toThrow('存在待保存的删表操作');
    expect(store.dirty).toBe(true);
  });

  it('data 保存不清删表队列，模板聊天保存才清理模板状态', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({ sheet_a: { name: 'A', content: [[null, '列1']] } }, ['sheet_a']);
    store.deletedSheetKeys = ['sheet_deleted'];
    store.templateDirty = true;
    store.setDirty(true);
    store.markSaved('data');
    expect(store.deletedSheetKeys).toEqual(['sheet_deleted']);
    expect(store.templateDirty).toBe(true);
    expect(store.dirty).toBe(true);
    store.markSaved('template-chat');
    expect(store.deletedSheetKeys).toEqual([]);
    expect(store.templateDirty).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it('纯锁草稿单独结算，且保存期间拒绝继续编辑', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({ sheet_a: { name: 'A', content: [[null, '列1'], ['1', 'A']] } }, ['sheet_a']);

    store.toggleRowLock('sheet_a', 0);
    expect(store.lockDirty).toBe(true);
    expect(store.draftRevision).toBe(1);
    store.markSaved('locks');
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);

    store.setSaving(true);
    expect(() => store.updateCell(0, 0, 'B')).toThrow('保存正在进行中');
    expect(() => store.toggleRowLock('sheet_a', 0)).toThrow('保存正在进行中');
    expect(store.currentSheet.content[1][1]).toBe('A');
  });

  it('模板草稿与行数据草稿双向互斥', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({ sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1'], ['1', 'A']] } }, ['sheet_a']);
    store.updateCell(0, 0, 'A2');
    expect(() => store.addSheet('sheet_b', { name: 'B', content: [[null, '列1']] })).toThrow('存在未保存的行数据增量');

    store.loadSnapshot({ sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1'], ['1', 'A']] } }, ['sheet_a']);
    store.addSheet('sheet_b', { name: 'B', content: [[null, '列1']] });
    expect(() => store.updateCell(0, 0, 'A2')).toThrow('存在未保存的模板/结构修改');
  });

  it('锁状态作为 visualizer 草稿维护，AI lockChanges 会合并到同一份草稿', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      sheet_a: { name: '总结表', orderNo: 0, content: [[null, '事件', '编码索引'], [null, '旧值', 'AM0001']] },
    }, ['sheet_a']);
    store.loadLockDrafts({
      sheet_a: {
        rows: [],
        cols: [1],
        cells: [],
        specialIndexLocked: true,
      },
    });

    store.toggleRowLock('sheet_a', 0);
    store.toggleCellLock('sheet_a', 0, 0);
    store.applyLockChangesToDraft([
      {
        sheetKey: 'sheet_a',
        columns: [{ colIndex: 1, locked: false }],
        cells: [{ rowIndex: 0, colIndex: 0, locked: false }],
        specialIndexLocked: false,
      },
    ]);

    expect(store.isRowLocked('sheet_a', 0)).toBe(true);
    expect(store.isColumnLocked('sheet_a', 1)).toBe(false);
    expect(store.isCellLocked('sheet_a', 0, 0)).toBe(false);
    expect(store.isSpecialIndexLocked('sheet_a')).toBe(false);
    expect(store.dirty).toBe(true);
  });

  it('已持久化但本地恢复未完成时拒绝行编辑且不改草稿', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { name: '角色状态', orderNo: 0, content: [[null, '姓名'], ['1', 'A']] },
    }, ['sheet_a']);
    const beforeData = JSON.parse(JSON.stringify(store.tempData));
    store.pendingDataOps = {
      updatesByRow: {},
      insertsByClientRowId: {},
      deletesByRow: {},
      committed: { afterData: beforeData, insertedRowIds: {} },
    };

    expect(() => store.updateCell(0, 0, 'B')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.addRow()).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.deleteRow(0)).toThrow('数据已持久化但本地刷新尚未完成');
    expect(store.tempData).toEqual(beforeData);
    expect(store.dirty).toBe(false);
  });

  it('已持久化但本地恢复未完成时拒绝表管理和锁草稿修改', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '姓名'], ['1', 'A']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '姓名'], ['2', 'B']] },
    }, ['sheet_a', 'sheet_b']);
    store.loadLockDrafts({ sheet_a: { rows: [], cols: [], cells: [], specialIndexLocked: true } });
    const beforeData = JSON.parse(JSON.stringify(store.tempData));
    const beforeOrder = [...store.sheetOrder];
    const beforeLocks = JSON.parse(JSON.stringify(store.tableLockDrafts));
    store.pendingDataOps = {
      updatesByRow: {}, insertsByClientRowId: {}, deletesByRow: {},
      committed: { afterData: beforeData, insertedRowIds: {} },
    };

    expect(() => store.addSheet('sheet_c', { name: 'C', content: [[null, '姓名']] })).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.deleteSheet('sheet_a')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.moveSheet('sheet_b', 'up')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.toggleRowLock('sheet_a', 0)).toThrow('数据已持久化但本地刷新尚未完成');
    expect(() => store.queueLockChanges([{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }])).toThrow('数据已持久化但本地刷新尚未完成');
    expect(store.tempData).toEqual(beforeData);
    expect(store.sheetOrder).toEqual(beforeOrder);
    expect(store.tableLockDrafts).toEqual(beforeLocks);
    expect(store.pendingLockChanges).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let currentData: Record<string, any> | null = null;
  let persistedData: Record<string, any> | null = null;
  return {
    get currentData() { return currentData; },
    setCurrentData: (data: Record<string, any> | null) => { currentData = data; },
    get persistedData() { return persistedData; },
    setPersistedData: (data: Record<string, any> | null) => { persistedData = data; },
    persist: vi.fn(async (options: any) => {
      persistedData = options.afterData;
      return { saved: true, messageIndices: [0] };
    }),
    reload: vi.fn(async () => undefined),
  };
});

vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: vi.fn(() => []) }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.currentData; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentJsonTableData_ACU: vi.fn((data: Record<string, any>) => mocks.setCurrentData(data)),
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestV2FullCheckpointMessageIndex_ACU: vi.fn(() => 0),
  getLatestV2SheetReplayMessageIndex_ACU: vi.fn(() => -1),
}));
vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn(async () => ({ success: true, migrated: false })),
}));
vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({ persistTableMutationLogBatchV2_ACU: mocks.persist }));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({ loadTableStateFromFramesV2_ACU: vi.fn(async () => mocks.persistedData) }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: mocks.reload }));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: vi.fn(async (_options: any, task: any) => task({ baseRevision: 'test', writeSet: [], assertFresh: vi.fn(), runCommit: async (commit: any) => commit() }, JSON.parse(JSON.stringify(mocks.currentData)))),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => false) }));

import {
  applyVisualizerPendingDataOps_ACU,
  createVisualizerTempRowId_ACU,
  recordVisualizerCellUpdate_ACU,
  recordVisualizerDraftDataDiff_ACU,
  recordVisualizerRowDelete_ACU,
  recordVisualizerRowInsert_ACU,
  resetVisualizerPendingDataOps_ACU,
} from '../../../src/service/visualizer/visualizer-data-ops';

function sheet(content: any[][]) {
  return { uid: 'sheet_a', name: '测试表', orderNo: 0, content };
}

function stateWith(data: Record<string, any>) {
  const state: any = { tempData: JSON.parse(JSON.stringify(data)), pendingDataOps: null };
  resetVisualizerPendingDataOps_ACU(state);
  return state;
}

beforeEach(() => {
  mocks.setCurrentData(null);
  mocks.setPersistedData(null);
  mocks.persist.mockClear();
  mocks.reload.mockClear();
});

describe('visualizer-data-ops', () => {
  it.each([
    ['行长度不一致', [[null, '姓名', '数量'], ['1', 'A']], '行 1 与表头长度不一致'],
  ])('更新遇到%s时 fail-fast 且不持久化', async (_name, content, errorText) => {
    const data = { mate: {}, sheet_a: sheet(content) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    recordVisualizerCellUpdate_ACU(state, 'sheet_a', '1', '姓名', 'B');

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining(errorText) }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('待更新行在运行时消失时 fail-fast 且不持久化', async () => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名'], ['other', 'A']]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    recordVisualizerCellUpdate_ACU(state, 'sheet_a', 'other', '姓名', 'B');
    mocks.currentData!.sheet_a.content[1][0] = '2';

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('行 other 不存在') }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    ['空表头', [[]], '表头无效'],
    ['空列名', [[null, '姓名', '']], '空列名'],
    ['重复列名', [[null, '姓名', '姓名']], '重复列名'],
  ])('新增遇到%s时 fail-fast 且不持久化', async (_name, content, errorText) => {
    const data = { mate: {}, sheet_a: sheet(content) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    const temporaryId = createVisualizerTempRowId_ACU();
    state.tempData.sheet_a.content.push([temporaryId, 'B', '2']);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', temporaryId);

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining(errorText) }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });


  it('新增临时行长度不一致时 fail-fast 且不持久化', async () => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名', '数量'], ['1', 'A', '1']]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    const temporaryId = createVisualizerTempRowId_ACU();
    state.tempData.sheet_a.content.push([temporaryId, 'B']);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', temporaryId);

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('临时行与表头长度不一致') }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('两个新增行获得不同稳定 row_id，并写入完整 row_upsert', async () => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名', '数量'], ['1', 'A', '1']]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    const firstTemporaryId = createVisualizerTempRowId_ACU();
    const secondTemporaryId = createVisualizerTempRowId_ACU();
    state.tempData.sheet_a.content.push([firstTemporaryId, 'B', '2'], [secondTemporaryId, 'C', '3']);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', firstTemporaryId);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', secondTemporaryId);

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual({
      success: true,
      changed: true,
      insertedRowIds: { [firstTemporaryId]: '2', [secondTemporaryId]: '3' },
    });
    const operations = mocks.persist.mock.calls[0][0].targets[0].operations;
    expect(operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', 'B', '2'] },
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '3', cells: ['3', 'C', '3'] },
    ]);
    expect(state.tempData.sheet_a.content.slice(2).map((row: any[]) => row[0])).toEqual([firstTemporaryId, secondTemporaryId]);
    expect(state.pendingDataOps.committed?.insertedRowIds).toEqual(result.insertedRowIds);
  });

  it.each([
    ['重复', [['1', 'A'], ['1', 'B']], '行标识 1 重复'],
    ['零', [['0', 'A']], '行标识 0 必须是正安全整数'],
    ['负数', [['-1', 'A']], '行标识 -1 必须是正安全整数'],
    ['小数', [['1.5', 'A']], '行标识 1.5 必须是正安全整数'],
    ['非数值', [['row-a', 'A']], '行标识 row-a 必须是正安全整数'],
    ['不安全整数', [['9007199254740992', 'A']], '行标识 9007199254740992 必须是正安全整数'],
  ])('已有行标识%s时 fail-fast 且不持久化', async (_name, rows, errorText) => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名'], ...rows]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    recordVisualizerCellUpdate_ACU(state, 'sheet_a', String(rows[0][0]), '姓名', 'B');

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining(errorText) }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('新增行在 row_id 达到安全整数上限时 fail-fast 且不持久化', async () => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名'], [String(Number.MAX_SAFE_INTEGER), 'A']]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    const temporaryId = createVisualizerTempRowId_ACU();
    state.tempData.sheet_a.content.push([temporaryId, 'B']);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', temporaryId);

    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('行标识已达到安全整数上限') }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('临时 insert 后 delete 不生成操作，已有行 update 后 delete 只生成 row_delete', async () => {
    const data = { mate: {}, sheet_a: sheet([[null, '姓名'], ['1', 'A']]) };
    mocks.setCurrentData(data);
    const state = stateWith(data);
    const temporaryId = createVisualizerTempRowId_ACU();
    state.tempData.sheet_a.content.push([temporaryId, 'B']);
    recordVisualizerRowInsert_ACU(state, 'sheet_a', temporaryId);
    recordVisualizerRowDelete_ACU(state, 'sheet_a', temporaryId);

    expect(await applyVisualizerPendingDataOps_ACU(state)).toEqual({ success: true, changed: false });
    expect(mocks.persist).not.toHaveBeenCalled();

    recordVisualizerCellUpdate_ACU(state, 'sheet_a', '1', '姓名', 'B');
    recordVisualizerRowDelete_ACU(state, 'sheet_a', '1');
    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual({ success: true, changed: true });
    expect(mocks.persist.mock.calls[0][0].targets[0].operations).toEqual([
      { kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' },
    ]);
  });

  it('AI 草稿差异精确合并 update、insert、delete 且保留既有 pending', () => {
    const previous = {
      mate: {},
      sheet_a: sheet([[null, '姓名', '状态'], ['1', 'A', '旧'], ['2', 'B', '保留']]),
    };
    const next = {
      mate: {},
      sheet_a: sheet([[null, '姓名', '状态'], ['1', 'A', '新'], [null, 'C', '新增']]),
    };
    const state = stateWith(previous);
    recordVisualizerCellUpdate_ACU(state, 'sheet_a', '2', '状态', '手工修改');

    recordVisualizerDraftDataDiff_ACU(state, previous, next);

    expect(state.pendingDataOps.updatesByRow).toEqual({
      'sheet_a::1': { kind: 'updateRow', sheetKey: 'sheet_a', rowId: '1', data: { 状态: '新' } },
    });
    expect(state.pendingDataOps.deletesByRow).toEqual({
      'sheet_a::2': { kind: 'deleteRow', sheetKey: 'sheet_a', rowId: '2' },
    });
    const insertedIds = Object.keys(state.pendingDataOps.insertsByClientRowId);
    expect(insertedIds).toHaveLength(1);
    expect(insertedIds[0]).toMatch(/^__acu_vis_tmp_row_/);
    expect(next.sheet_a.content[2][0]).toBe(insertedIds[0]);
  });

  it('AI 草稿 pending 可转换为按 sheet 路由的 V2 row operations', async () => {
    const previous = {
      mate: {},
      sheet_a: sheet([[null, '姓名', '状态'], ['1', 'A', '旧'], ['2', 'B', '删除']]),
    };
    const next = {
      mate: {},
      sheet_a: sheet([[null, '姓名', '状态'], ['1', 'A', '新'], [null, 'C', '新增']]),
    };
    mocks.setCurrentData(JSON.parse(JSON.stringify(previous)));
    const state = stateWith(previous);

    recordVisualizerDraftDataDiff_ACU(state, previous, next);
    state.tempData = next;
    const result = await applyVisualizerPendingDataOps_ACU(state);

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true }));
    const target = mocks.persist.mock.calls[0][0].targets[0];
    expect(target.changedSheetKeys).toEqual(['sheet_a']);
    expect(target.operations).toEqual([
      { kind: 'row_delete', sheetKey: 'sheet_a', rowId: '2' },
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'A', '新'] },
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', 'C', '新增'] },
    ]);
    const temporaryId = String(next.sheet_a.content[2][0]);
    expect(result.insertedRowIds).toEqual({ [temporaryId]: '2' });
    expect(state.pendingDataOps.committed?.insertedRowIds).toEqual(result.insertedRowIds);
  });

  it('AI 候选新增行的伪造、空和重复 ID 都改写为不同临时 ID', () => {
    const previous = { mate: {}, sheet_a: sheet([[null, '姓名'], ['1', 'A']]) };
    const next = {
      mate: {},
      sheet_a: sheet([[null, '姓名'], ['1', 'A'], ['99', 'B'], [null, 'C'], ['99', 'D']]),
    };
    const state = stateWith(previous);

    recordVisualizerDraftDataDiff_ACU(state, previous, next);

    const ids = next.sheet_a.content.slice(2).map((row: any[]) => row[0]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id: string) => id.startsWith('__acu_vis_tmp_row_'))).toBe(true);
    expect(Object.keys(state.pendingDataOps.insertsByClientRowId).sort()).toEqual([...ids].sort());
  });

  it('AI 纯数据草稿跨表记录精确差异', () => {
    const previous = {
      mate: {},
      sheet_a: { ...sheet([[null, '姓名'], ['1', 'A']]), uid: 'sheet_a' },
      sheet_b: { ...sheet([[null, '姓名'], ['1', 'B']]), uid: 'sheet_b' },
    };
    const next = {
      mate: {},
      sheet_a: { ...sheet([[null, '姓名'], ['1', 'A2']]), uid: 'sheet_a' },
      sheet_b: { ...sheet([[null, '姓名'], ['1', 'B2']]), uid: 'sheet_b' },
    };
    const state = stateWith(previous);

    recordVisualizerDraftDataDiff_ACU(state, previous, next);

    expect(state.pendingDataOps.updatesByRow['sheet_a::1'].data).toEqual({ 姓名: 'A2' });
    expect(state.pendingDataOps.updatesByRow['sheet_b::1'].data).toEqual({ 姓名: 'B2' });
    expect(state.pendingDataOps.insertsByClientRowId).toEqual({});
  });

  it('AI 结构变化与行数据增量混合时原子拒绝', () => {
    const previous = {
      mate: {},
      sheet_a: { ...sheet([[null, '姓名'], ['1', 'A']]), uid: 'sheet_a' },
    };
    const next = {
      mate: {},
      sheet_a: { ...sheet([[null, '姓名'], ['1', 'A2']]), uid: 'sheet_a' },
      sheet_b: { ...sheet([[null, '字段'], ['99', '新增表行']]), uid: 'sheet_b' },
    };
    const state = stateWith(previous);

    expect(() => recordVisualizerDraftDataDiff_ACU(state, previous, next)).toThrow(
      '结构变化不能与未保存的行数据增量混合',
    );
    expect(state.pendingDataOps).toEqual({
      updatesByRow: {}, insertsByClientRowId: {}, deletesByRow: {},
    });
    expect(next.sheet_b.content[1][0]).toBe('99');
  });

  it('AI 列重命名同时修改既有值时原子拒绝', () => {
    const previous = {
      mate: {},
      sheet_a: sheet([[null, '姓名'], ['1', 'A']]),
    };
    const next = {
      mate: {},
      sheet_a: sheet([[null, '角色名'], ['1', 'B']]),
    };
    const state = stateWith(previous);

    expect(() => recordVisualizerDraftDataDiff_ACU(state, previous, next)).toThrow(
      '同时修改了列结构和既有行数据',
    );
    expect(state.pendingDataOps).toEqual({ updatesByRow: {}, insertsByClientRowId: {}, deletesByRow: {} });
    expect(next.sheet_a.content[1]).toEqual(['1', 'B']);
  });

  it('AI 纯既有行重排时拒绝应用', () => {
    const previous = {
      mate: {},
      sheet_a: sheet([[null, '姓名'], ['1', 'A'], ['2', 'B']]),
    };
    const next = {
      mate: {},
      sheet_a: sheet([[null, '姓名'], ['2', 'B'], ['1', 'A']]),
    };
    const state = stateWith(previous);

    expect(() => recordVisualizerDraftDataDiff_ACU(state, previous, next)).toThrow(
      '当前 V2 row operation 不支持持久化行重排',
    );
    expect(state.pendingDataOps).toEqual({ updatesByRow: {}, insertsByClientRowId: {}, deletesByRow: {} });
  });
});

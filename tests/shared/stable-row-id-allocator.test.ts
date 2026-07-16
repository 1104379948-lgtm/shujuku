import { describe, expect, it } from 'vitest';
import {
  allocateStableRowIdForSheet_ACU,
  allocateStableRowId_ACU,
  createStableRowIdReservation_ACU,
  materializeStableSeedRowsForSheet_ACU,
  replaceSheetSourceDataPreservingNextRowId_ACU,
  reserveStableRowIdsForSheet_ACU,
  resolveStableNextRowId_ACU,
} from '../../src/shared/stable-row-id-allocator';

describe('stable-row-id-allocator', () => {
  const makeSheet = (rows: unknown[][], nextRowId?: number) => ({
    uid: 'sheet_test',
    name: '测试表',
    sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ...(nextRowId === undefined ? {} : { nextRowId }) },
    content: [['row_id', 'value'], ...rows],
    updateConfig: {} as any,
    exportConfig: {} as any,
    orderNo: 0,
  } as any);

  it('保留 legacy Set helper 的既有最小空洞行为，但生产写入不再使用它', () => {
    const reserved = createStableRowIdReservation_ACU([
      ['1', '铁剑'],
      ['3', '盾牌'],
      ['alpha', '标记'],
      [' ', '不占用'],
      { malformed: true },
    ]);

    expect(allocateStableRowId_ACU(reserved)).toBe('2');
  });

  it('旧数据缺少高水位时从当前最大合法正整数初始化，不填补中间空洞', () => {
    const sheet = makeSheet([['1'], ['3'], ['alpha'], [' ']]);

    expect(resolveStableNextRowId_ACU(sheet)).toBe(4);
    expect(allocateStableRowIdForSheet_ACU(sheet)).toBe('4');
    expect(sheet.sourceData.nextRowId).toBe(5);
  });

  it('删除中间 ID 或当前最大 ID 后仍沿用持久高水位', () => {
    const middleDeleted = makeSheet([['1'], ['3'], ['4']], 5);
    const maxDeleted = makeSheet([['1'], ['2'], ['3']], 5);

    expect(allocateStableRowIdForSheet_ACU(middleDeleted)).toBe('5');
    expect(allocateStableRowIdForSheet_ACU(maxDeleted)).toBe('5');
    expect(middleDeleted.sourceData.nextRowId).toBe(6);
    expect(maxDeleted.sourceData.nextRowId).toBe(6);
  });

  it('过低或非法高水位不会覆盖当前数据推导出的安全下界', () => {
    expect(resolveStableNextRowId_ACU(makeSheet([['7']], 3))).toBe(8);
    expect(resolveStableNextRowId_ACU(makeSheet([['7']], Number.NaN))).toBe(8);
    expect(resolveStableNextRowId_ACU(makeSheet([['7']], 100))).toBe(100);
  });

  it('批量预留连续 ID 并一次推进高水位', () => {
    const sheet = makeSheet([['1'], ['3']], 10);

    expect(reserveStableRowIdsForSheet_ACU(sheet, 3)).toEqual(['10', '11', '12']);
    expect(sheet.sourceData.nextRowId).toBe(13);
    expect(reserveStableRowIdsForSheet_ACU(sheet, 0)).toEqual([]);
    expect(sheet.sourceData.nextRowId).toBe(13);
  });

  it('物化 seedRows 时覆盖模板旧 ID，按 Sheet 高水位连续分配且不修改输入', () => {
    const sheet = makeSheet([['1'], ['3']], 10);
    const seedRows = [['1', '模板甲'], [null, '模板乙'], []] as unknown[][];
    const original = JSON.parse(JSON.stringify(seedRows));

    const materialized = materializeStableSeedRowsForSheet_ACU(sheet, seedRows);

    expect(materialized).toEqual([
      ['10', '模板甲'],
      ['11', '模板乙'],
      ['12'],
    ]);
    expect(sheet.sourceData.nextRowId).toBe(13);
    expect(seedRows).toEqual(original);
  });

  it('替换模板 sourceData 时保留较高运行时高水位，并允许模板高水位向前推进', () => {
    const runtimeAhead = makeSheet([['1'], ['3']], 10);
    replaceSheetSourceDataPreservingNextRowId_ACU(runtimeAhead, { note: '新说明', nextRowId: 4 });
    expect(runtimeAhead.sourceData).toEqual({ note: '新说明', nextRowId: 10 });

    const templateAhead = makeSheet([['1'], ['3']], 5);
    replaceSheetSourceDataPreservingNextRowId_ACU(templateAhead, { note: '新说明', nextRowId: 12 });
    expect(templateAhead.sourceData).toEqual({ note: '新说明', nextRowId: 12 });

    const templateWithoutMark = makeSheet([['1'], ['3']], 10);
    replaceSheetSourceDataPreservingNextRowId_ACU(templateWithoutMark, { note: '新说明' });
    expect(templateWithoutMark.sourceData).toEqual({ note: '新说明', nextRowId: 10 });
  });

  it('非法数量或安全整数溢出时不产生部分高水位更新', () => {
    const invalidCountSheet = makeSheet([['1']], 2);
    expect(() => reserveStableRowIdsForSheet_ACU(invalidCountSheet, -1)).toThrow(/count/i);
    expect(invalidCountSheet.sourceData.nextRowId).toBe(2);

    const overflowSheet = makeSheet([], Number.MAX_SAFE_INTEGER);
    expect(() => reserveStableRowIdsForSheet_ACU(overflowSheet, 1)).toThrow(/safe integer/i);
    expect(overflowSheet.sourceData.nextRowId).toBe(Number.MAX_SAFE_INTEGER);
  });
});

import { describe, expect, it } from 'vitest';
import { auditTableDataForUpgrade_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU } from '../../src/service/table/table-data-repair';

function data(content: unknown[][], seedRows?: unknown[][], ddl?: string) {
  return { mate: { type: 'chatSheets', version: 1 }, sheet_0: { content, seedRows, sourceData: { ddl } } };
}
function nonEmptyCells(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce<number>((total, item) => total + (Array.isArray(item) ? nonEmptyCells(item) : item === null || item === undefined || item === '' ? 0 : 1), 0);
}

describe('table-data-upgrade-audit', () => {
  it('接受已满足 canonical 契约的基线数据', () => {
    const audit = auditTableDataForUpgrade_ACU(data([['row_id', 'name'], ['1', '铁剑']]));
    expect(audit.status).toBe('clean');
    expect(audit.issues).toEqual([]);
  });

  it('将可识别身份列表头改名为 row_id 并保留行', () => {
    const source = data([['rowId', 'name'], ['1', '铁剑']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
    expect(source.sheet_0.content[0][0]).toBe('rowId');
  });

  it('仅在 DDL 可证明业务表头完整时插入 row_id', () => {
    const source = data([['物品名'], ['铁剑']], undefined, 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名\n)');
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', '物品名'], ['1', '铁剑']]);
  });

  it('为数值/字符串重复 ID 与空 ID 分配稳定新 ID，保留所有业务单元格', () => {
    const source = data([['row_id', 'name'], [1, '铁剑'], ['1', '盾牌'], [' ', '药水']]);
    const audit = auditTableDataForUpgrade_ACU(source);
    const result = repairTableDataFromAudit_ACU(audit);
    expect(audit.issues.map(item => item.code)).toContain('upgrade_duplicate_row_id');
    expect(audit.issues.map(item => item.code)).toContain('upgrade_empty_row_id');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '盾牌'], ['3', '药水']]);
    expect(result.idRemap).toHaveLength(2);
  });

  it('补齐短行，但保留长行原值并要求确认', () => {
    const source = data([['row_id', 'name'], ['1'], ['2', '盾牌', '不可丢失']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.requiresConfirmation).toBe(true);
    expect((result.candidateData as any).sheet_0.content[1]).toEqual(['1', null]);
    expect((result.candidateData as any).sheet_0.content[2]).toEqual(['2', '盾牌', '不可丢失']);
    expect(result.overflowCells).toEqual([{ sheetKey: 'sheet_0', rowPool: 'content', rowIndex: 2, cells: ['不可丢失'] }]);
  });

  it('检测 content 与 seedRows 的跨池 row_id 冲突并重映射 seedRows', () => {
    const source = data([['row_id', 'name'], ['1', '铁剑']], [['1', '预置盾牌']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.seedRows[0][0]).toBe('2');
  });

  it('对同一输入生成确定性候选结果，且不减少行或非空业务单元格', () => {
    const source = data([['id', 'name'], ['1'], ['1', '盾牌', '保留']]);
    const first = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    const second = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(first).toEqual(second);
    expect((first.candidateData as any).sheet_0.content).toHaveLength(source.sheet_0.content.length);
    expect(nonEmptyCells(first.candidateData)).toBeGreaterThanOrEqual(nonEmptyCells(source));
  });
});
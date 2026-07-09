import { describe, expect, it } from 'vitest';
import { groupSqlBatchOperationsBySheet_ACU, groupTableEditDslBySheet_ACU, validateSingleTableLogEntryDraft_ACU } from '../../../src/service/table/storage-frame-v2-log-utils';

const tableData: any = {
  mate: { type: 'acu' },
  sheet_a: { uid: 'sheet_a', name: '表A', sourceData: { ddl: 'CREATE TABLE table_a (row_id TEXT);' }, content: [['row_id']] },
  sheet_b: { uid: 'sheet_b', name: '表B', sourceData: { ddl: 'CREATE TABLE table_b (row_id TEXT);' }, content: [['row_id']] },
};

describe('storage-frame-v2-log-utils', () => {
  it('按 SQL statement 目标表分组并保持 params 对齐', () => {
    const result = groupSqlBatchOperationsBySheet_ACU([{
      kind: 'sql_batch',
      statements: ['UPDATE table_a SET row_id = ?', 'UPDATE table_b SET row_id = ?', 'DELETE FROM table_a WHERE row_id = ?'],
      params: [['a1'], ['b1'], ['a2']],
    }], tableData);

    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.entries).toHaveLength(2);
    const entryA = result.entries.find(entry => entry.changedSheetKeys?.[0] === 'sheet_a')!;
    const entryB = result.entries.find(entry => entry.changedSheetKeys?.[0] === 'sheet_b')!;
    expect((entryA.operations[0] as any).statements).toEqual(['UPDATE table_a SET row_id = ?', 'DELETE FROM table_a WHERE row_id = ?']);
    expect((entryA.operations[0] as any).params).toEqual([['a1'], ['a2']]);
    expect((entryB.operations[0] as any).statements).toEqual(['UPDATE table_b SET row_id = ?']);
    expect((entryB.operations[0] as any).params).toEqual([['b1']]);
  });

  it('SQL 无法识别唯一目标表时失败', () => {
    const result = groupSqlBatchOperationsBySheet_ACU([{ kind: 'sql_batch', statements: ['SELECT * FROM table_a'] }], tableData);
    expect(result.ok).toBe(false);
  });

  it('按 DSL 命令 table index 分组', () => {
    const result = groupTableEditDslBySheet_ACU({
      kind: 'table_edit_dsl',
      updateMode: 'manual_unified',
      text: 'insertRow(0, {"0":"a"});\nupdateRow(1, 0, {"0":"b"});',
    }, tableData);

    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.entries.map(entry => entry.changedSheetKeys?.[0]).sort()).toEqual(['sheet_a', 'sheet_b']);
  });

  it('校验多表混合 entry 失败', () => {
    const result = validateSingleTableLogEntryDraft_ACU({
      operations: [{ kind: 'sql_batch', statements: ['UPDATE table_a SET row_id = ?', 'UPDATE table_b SET row_id = ?'] }],
      changedSheetKeys: ['sheet_a', 'sheet_b'],
    }, tableData);
    expect(result.ok).toBe(false);
  });
});

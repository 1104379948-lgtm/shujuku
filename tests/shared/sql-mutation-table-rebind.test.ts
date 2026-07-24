import { describe, expect, it } from 'vitest';
import { decodeSqlIdentifier_ACU, rebindSqlMutationTableReferences_ACU } from '../../src/shared/sql-mutation-table-rebind';

describe('sql mutation table rebind', () => {
  it('只重绑定表引用，保持字符串和注释原样', () => {
    const [result] = rebindSqlMutationTableReferences_ACU([
      "UPDATE global_state SET note = 'global_state literal' /* global_state comment */ WHERE row_id = 1",
    ], new Map([['global_state', 'quanjushujubiao']]));

    expect(result).toBe("UPDATE quanjushujubiao SET note = 'global_state literal' /* global_state comment */ WHERE row_id = 1");
  });

  it('不会把普通、递归、列名列表或多 CTE 名称重绑定为表', () => {
    const aliases = new Map([['global_state', 'runtime_global'], ['sheet_global', 'runtime_global'], ['old_target', 'runtime_target']]);
    const [recursive] = rebindSqlMutationTableReferences_ACU([
      'WITH RECURSIVE global_state(row_id) AS (SELECT 1) UPDATE sheet_global SET row_id = row_id WHERE row_id IN (SELECT row_id FROM global_state)',
    ], aliases);
    const [multiple] = rebindSqlMutationTableReferences_ACU([
      'WITH global_state AS (SELECT 1 AS row_id), sheet_global AS (SELECT row_id FROM global_state) UPDATE old_target SET row_id = row_id WHERE row_id IN (SELECT row_id FROM sheet_global)',
    ], aliases);

    expect(recursive).toContain('FROM global_state');
    expect(recursive).toContain('UPDATE runtime_global');
    expect(multiple).toContain('FROM global_state');
    expect(multiple).toContain('FROM sheet_global');
    expect(multiple).toContain('UPDATE runtime_target');
  });

  it('不会把嵌套 WITH 作用域内与 alias 同名的 CTE 引用重绑定为物理表', () => {
    const [result] = rebindSqlMutationTableReferences_ACU([
      'UPDATE old_table SET value = 1 WHERE EXISTS (WITH RECURSIVE old_table(row_id) AS (SELECT 1) SELECT 1 FROM old_table WHERE row_id = 1)',
    ], new Map([['old_table', 'runtime_table']]));

    expect(result).toBe(
      'UPDATE runtime_table SET value = 1 WHERE EXISTS (WITH RECURSIVE old_table(row_id) AS (SELECT 1) SELECT 1 FROM old_table WHERE row_id = 1)',
    );
  });

  it('重绑定 target、self-reference、JOIN 与 FROM 多表中的已知表，未知引用保持原文', () => {
    const aliases = new Map([
      ['old_global', 'runtime_global'],
      ['old_auxiliary', 'runtime_auxiliary'],
    ]);
    const [insert] = rebindSqlMutationTableReferences_ACU([
      'INSERT INTO old_global (row_id) SELECT source.row_id FROM old_global AS source JOIN old_auxiliary AS auxiliary ON source.row_id = auxiliary.row_id',
    ], aliases);
    const [unknown] = rebindSqlMutationTableReferences_ACU([
      'UPDATE old_global SET row_id = row_id WHERE EXISTS (SELECT 1 FROM missing_table)',
    ], aliases);

    expect(insert).toBe('INSERT INTO runtime_global (row_id) SELECT source.row_id FROM runtime_global AS source JOIN runtime_auxiliary AS auxiliary ON source.row_id = auxiliary.row_id');
    expect(unknown).toContain('UPDATE runtime_global');
    expect(unknown).toContain('FROM missing_table');
  });

  it('解码 DDL 引号标识符，并在 SQL 中保留原始引号风格', () => {
    expect(decodeSqlIdentifier_ACU('"global_state"')).toBe('global_state');
    expect(decodeSqlIdentifier_ACU('`global_state`')).toBe('global_state');
    expect(decodeSqlIdentifier_ACU('[global_state]')).toBe('global_state');
    const [result] = rebindSqlMutationTableReferences_ACU([
      'INSERT INTO [global_state] (row_id) SELECT row_id FROM `global_state`',
    ], new Map([['"global_state"', 'runtime_global']]));

    expect(result).toBe('INSERT INTO [runtime_global] (row_id) SELECT row_id FROM `runtime_global`');
  });

  it('目标表未知时原样返回，宽松模式也不接管 SQLite 语法错误', () => {
    const [result] = rebindSqlMutationTableReferences_ACU(['INSERT INTO missing_table VALUES (1)'], new Map([['known', 'runtime_known']]), { lenient: true });
    expect(result).toBe('INSERT INTO missing_table VALUES (1)');
  });
});

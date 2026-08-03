import { describe, expect, it } from 'vitest';
import { decodeSqlIdentifier_ACU, rebindSqlMutationTableReferences_ACU, rebindSqlReadIdentifiers_ACU } from '../../src/shared/sql-mutation-table-rebind';

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

  it('严格写入模式在执行前拒绝未知目标表与关联表', () => {
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO missing_table VALUES (1)'],
      new Map([['known', 'runtime_known']]),
      { requireKnownTables: true },
    )).toThrow('无法识别的目标表「missing_table」');
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['UPDATE known SET row_id = row_id WHERE EXISTS (SELECT 1 FROM missing_table)'],
      new Map([['known', 'runtime_known']]),
      { requireKnownTables: true },
    )).toThrow('无法识别的关联表「missing_table」');
  });

  it('严格写入模式仍允许已知表的 CTE，并重绑定真实表引用', () => {
    const [result] = rebindSqlMutationTableReferences_ACU(
      ['WITH known AS (SELECT 1 AS row_id) UPDATE old_target SET row_id = row_id WHERE row_id IN (SELECT row_id FROM known)'],
      new Map([['old_target', 'runtime_target']]),
      { requireKnownTables: true },
    );
    expect(result).toContain('UPDATE runtime_target');
    expect(result).toContain('FROM known');
  });

  it('只读查询重绑定表和单表列名，且不触碰字面量与注释', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      "SELECT item_name, inventory_count, 'inventory' /* inventory */ FROM inventory WHERE item_name = '铁剑' -- inventory",
      new Map([['inventory', 'beibaowupinbiao']]),
      new Map([['beibaowupinbiao', new Map([['item_name', 'wupinmingcheng']])]]),
    );

    expect(result).toEqual({
      sql: "SELECT wupinmingcheng, inventory_count, 'inventory' /* inventory */ FROM beibaowupinbiao WHERE wupinmingcheng = '铁剑' -- inventory",
      tableRebindCount: 1,
      columnRebindCount: 2,
    });
  });

  it('保留 SELECT AS 输出别名', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT item_name AS item_name FROM inventory',
      new Map([['inventory', 'beibaowupinbiao']]),
      new Map([['beibaowupinbiao', new Map([['item_name', 'wupinmingcheng']])]]),
    );

    expect(result.sql).toBe('SELECT wupinmingcheng AS item_name FROM beibaowupinbiao');
  });

  it('只读查询在多表中遇到歧义列时不猜测', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT name FROM old_a JOIN old_b ON old_a.row_id = old_b.row_id',
      new Map([['old_a', 'runtime_a'], ['old_b', 'runtime_b']]),
      new Map([
        ['runtime_a', new Map([['name', 'name_a']])],
        ['runtime_b', new Map([['name', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT name FROM runtime_a JOIN runtime_b ON runtime_a.row_id = runtime_b.row_id');
    expect(result.columnRebindCount).toBe(0);
  });

  it('使用 JOIN 别名确定限定列归属，且不重写别名', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT a.name, b.name FROM old_a AS a JOIN old_b AS b ON a.row_id = b.row_id',
      new Map([['old_a', 'runtime_a'], ['old_b', 'runtime_b']]),
      new Map([
        ['runtime_a', new Map([['name', 'name_a']])],
        ['runtime_b', new Map([['name', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT a.name_a, b.name_b FROM runtime_a AS a JOIN runtime_b AS b ON a.row_id = b.row_id');
    expect(result.columnRebindCount).toBe(2);
  });

  it('隔离 CTE 与派生表作用域，保留它们的输出别名', () => {
    const aliases = new Map([['inventory', 'runtime_inventory'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_inventory', new Map([['item_name', 'physical_item']])],
      ['runtime_other', new Map([['item_name', 'other_item']])],
    ]);
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH items AS (SELECT item_name AS item_name FROM inventory) SELECT item_name FROM items',
      aliases,
      columns,
    );
    const derived = rebindSqlReadIdentifiers_ACU(
      'SELECT sub.item_name FROM other JOIN (SELECT item_name AS item_name FROM inventory) AS sub ON 1 = 1',
      aliases,
      columns,
    );

    expect(cte.sql).toBe('WITH items AS (SELECT physical_item AS item_name FROM runtime_inventory) SELECT item_name FROM items');
    expect(derived.sql).toBe('SELECT sub.item_name FROM runtime_other JOIN (SELECT physical_item AS item_name FROM runtime_inventory) AS sub ON 1 = 1');
  });

  it('将派生表和 CTE 输出视为虚拟列，而不是实体列别名', () => {
    const aliases = new Map([['people', 'runtime_people'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_people', new Map([['姓名', 'physical_name']])],
      ['runtime_other', new Map([['姓名', 'other_name']])],
    ]);
    const derived = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名, d.姓名 FROM other JOIN (SELECT physical_name AS 姓名 FROM people) AS d ON 1 = 1 ORDER BY 姓名',
      aliases,
      columns,
    );
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH people_view(姓名) AS (SELECT physical_name FROM people) SELECT 姓名 FROM people_view ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(derived.sql).toBe('SELECT 姓名, d.姓名 FROM runtime_other JOIN (SELECT physical_name AS 姓名 FROM runtime_people) AS d ON 1 = 1 ORDER BY 姓名');
    expect(cte.sql).toBe('WITH people_view(姓名) AS (SELECT physical_name FROM runtime_people) SELECT 姓名 FROM people_view ORDER BY 姓名');
  });

  it('以 UNION 第一分支的输出别名保护派生表外层引用', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT d.姓名 FROM (SELECT name_a AS 姓名 FROM first_source UNION ALL SELECT name_b AS 别名 FROM second_source) AS d ORDER BY d.姓名',
      new Map([['first_source', 'runtime_first'], ['second_source', 'runtime_second']]),
      new Map([
        ['runtime_first', new Map([['姓名', 'name_a']])],
        ['runtime_second', new Map([['别名', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT d.姓名 FROM (SELECT name_a AS 姓名 FROM runtime_first UNION ALL SELECT name_b AS 别名 FROM runtime_second) AS d ORDER BY d.姓名');
  });

  it('在输出别名排序及未知派生输出场景保守地保留列标识符', () => {
    const aliases = new Map([['people', 'runtime_people'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_people', new Map([['姓名', 'physical_name']])],
      ['runtime_other', new Map([['姓名', 'other_name']])],
    ]);
    const outputAlias = rebindSqlReadIdentifiers_ACU(
      'SELECT physical_name AS 姓名 FROM people ORDER BY 姓名',
      aliases,
      columns,
    );
    const unknownDerived = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名, d.姓名 FROM other JOIN (SELECT * FROM people) AS d ON 1 = 1',
      aliases,
      columns,
    );

    expect(outputAlias.sql).toBe('SELECT physical_name AS 姓名 FROM runtime_people ORDER BY 姓名');
    expect(unknownDerived.sql).toBe('SELECT 姓名, d.姓名 FROM runtime_other JOIN (SELECT * FROM runtime_people) AS d ON 1 = 1');
  });

  it('无别名派生表的 SELECT * 不得被当作已知中文输出列', () => {
    // 内层 SELECT * 导出物理列名；外层展示列名仍须交由 legacy 翻译层处理。
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT * FROM people) ORDER BY 姓名',
      new Map([['people', 'runtime_people']]),
      new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]),
    );

    expect(result.sql).toBe('SELECT 姓名 FROM (SELECT * FROM runtime_people) ORDER BY 姓名');
    expect(result.columnRebindCount).toBe(0);
  });

  it('无别名派生表的显式输出列在 ORDER BY、GROUP BY 与 HAVING 中保持虚拟列语义', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]);
    const ordered = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );
    const grouped = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM people) GROUP BY 姓名 HAVING 姓名 IS NOT NULL',
      aliases,
      columns,
    );

    expect(ordered.sql).toBe('SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM runtime_people) ORDER BY 姓名');
    expect(grouped.sql).toBe('SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM runtime_people) GROUP BY 姓名 HAVING 姓名 IS NOT NULL');
  });

  it('无别名 UNION 派生表沿用第一分支的显式输出，并在实体列同名时不猜测', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM other JOIN (SELECT name_a AS 姓名 FROM first_source UNION ALL SELECT name_b AS 别名 FROM second_source) ON 1 = 1 ORDER BY 姓名',
      new Map([
        ['other', 'runtime_other'],
        ['first_source', 'runtime_first'],
        ['second_source', 'runtime_second'],
      ]),
      new Map([
        ['runtime_other', new Map([['姓名', 'other_name']])],
        ['runtime_first', new Map([['姓名', 'name_a']])],
        ['runtime_second', new Map([['别名', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe(
      'SELECT 姓名 FROM runtime_other JOIN (SELECT name_a AS 姓名 FROM runtime_first UNION ALL SELECT name_b AS 别名 FROM runtime_second) ON 1 = 1 ORDER BY 姓名',
    );
    expect(result.columnRebindCount).toBe(0);
  });

  it('无别名派生表的隐式输出列保持虚拟列语义，但不改变有别名派生表或 CTE', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]);
    const aliasless = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name 姓名 FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );
    const named = rebindSqlReadIdentifiers_ACU(
      'SELECT d.姓名 FROM (SELECT physical_name 姓名 FROM people) AS d ORDER BY d.姓名',
      aliases,
      columns,
    );
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH d AS (SELECT physical_name 姓名 FROM people) SELECT 姓名 FROM d ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(aliasless.sql).toBe('SELECT 姓名 FROM (SELECT physical_name 姓名 FROM runtime_people) ORDER BY 姓名');
    // P2 is deliberately limited to alias-less derived sources; preserve their existing output.
    expect(named.sql).toBe('SELECT d.姓名 FROM (SELECT physical_name physical_name FROM runtime_people) AS d ORDER BY d.姓名');
    expect(cte.sql).toBe('WITH d AS (SELECT physical_name physical_name FROM runtime_people) SELECT 姓名 FROM d ORDER BY 姓名');
  });

  it('仅识别有效隐式别名，不将 CASE 终止词、排序词或 SELECT * 误认为输出列', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name'], ['状态值', 'state_value']])]]);
    const caseResult = rebindSqlReadIdentifiers_ACU(
      'SELECT 状态值 FROM (SELECT CASE WHEN physical_name IS NOT NULL THEN 1 ELSE 0 END 状态值 FROM people) ORDER BY 状态值',
      aliases,
      columns,
    );
    const starResult = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT * FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(caseResult.sql).toBe('SELECT 状态值 FROM (SELECT CASE WHEN physical_name IS NOT NULL THEN 1 ELSE 0 END 状态值 FROM runtime_people) ORDER BY 状态值');
    expect(starResult.sql).toBe('SELECT 姓名 FROM (SELECT * FROM runtime_people) ORDER BY 姓名');
  });

  it('识别运算式和函数式的无别名派生输出别名', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['数量', 'physical_amount'], ['总数', 'total_count']])]]);
    const arithmetic = rebindSqlReadIdentifiers_ACU(
      'SELECT 数量 FROM (SELECT physical_amount + 1 数量 FROM people) ORDER BY 数量',
      aliases,
      columns,
    );
    const aggregate = rebindSqlReadIdentifiers_ACU(
      'SELECT 总数 FROM (SELECT count(physical_amount) 总数 FROM people) ORDER BY 总数',
      aliases,
      columns,
    );

    expect(arithmetic.sql).toBe('SELECT 数量 FROM (SELECT physical_amount + 1 数量 FROM runtime_people) ORDER BY 数量');
    expect(aggregate.sql).toBe('SELECT 总数 FROM (SELECT count(physical_amount) 总数 FROM runtime_people) ORDER BY 总数');
  });

  it('不将函数名视为列标识符', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT count(*) FROM inventory',
      new Map([['inventory', 'runtime_inventory']]),
      new Map([['runtime_inventory', new Map([['count', 'physical_count']])]]),
    );

    expect(result.sql).toBe('SELECT count(*) FROM runtime_inventory');
  });


  it('歧义别名（ambiguousAliases）结构化拒绝，不当作未知表放行也不随机选择', () => {
    // 两个物理表共用英文名 shared_legacy：registry 将其移入 conflicts，rebind 必须 fail-loud。
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO shared_legacy (row_id) VALUES (1)'],
      new Map([['jiabiao', 'jiabiao'], ['yibiao', 'yibiao']]),
      { requireKnownTables: true, ambiguousAliases: new Set(['shared_legacy']) },
    )).toThrow('SQL 写入引用了歧义表名「shared_legacy」：该名称同时指向多张物理表，无法安全路由');

    // 关联表位置同样拒绝。
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['UPDATE jiabiao SET row_id = row_id WHERE EXISTS (SELECT 1 FROM shared_legacy)'],
      new Map([['jiabiao', 'jiabiao']]),
      { requireKnownTables: true, ambiguousAliases: new Set(['shared_legacy']) },
    )).toThrow('SQL 写入引用了歧义表名「shared_legacy」');
  });

  it('唯一英文名与当前物理名都正确定位；重复英文 DDL 名不污染物理名的唯一映射', () => {
    // 两个物理表 jiabiao/yibiao 各自物理名唯一；shared_legacy 是它们的公共英文名。
    const aliases = new Map([
      ['jiabiao', 'jiabiao'],
      ['yibiao', 'yibiao'],
    ]);
    const [insertA] = rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO jiabiao (row_id) VALUES (1)'],
      aliases,
      { requireKnownTables: true },
    );
    const [insertB] = rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO yibiao (row_id) VALUES (1)'],
      aliases,
      { requireKnownTables: true },
    );
    expect(insertA).toBe('INSERT INTO jiabiao (row_id) VALUES (1)');
    expect(insertB).toBe('INSERT INTO yibiao (row_id) VALUES (1)');
  });

  it('唯一英文名 SQL 重绑定到当前物理名（改名后每次重算，不缓存旧物理名）', () => {
    // 改名后旧英文名仍唯一，映射必须指向新物理名。
    const aliasesAfterRename = new Map([
      ['characters', 'juesebiao'],
      ['juesebiao', 'juesebiao'],
    ]);
    const [result] = rebindSqlMutationTableReferences_ACU(
      ['UPDATE characters SET row_id = row_id WHERE row_id = 1'],
      aliasesAfterRename,
      { requireKnownTables: true },
    );
    expect(result).toBe('UPDATE juesebiao SET row_id = row_id WHERE row_id = 1');
  });
});

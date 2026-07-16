/**
 * tests/service/table/sql-table-service.test.ts
 * SqlTableService 单元测试
 *
 * 策略：
 * - splitSqlStatements / extractTableNamesFromStatements 是纯函数，直接测试
 * - SqlTableService 类方法需要 mock 外部依赖（state-manager/table-service/helpers-data-merge/name-mapper）
 *   但使用真实 SqliteEngine + SyncBridge 作为后端
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置（必须在 import 被测模块之前）
// ═══════════════════════════════════════════════════════════════

// mock log 函数
const mockParseTableTemplateJson = vi.hoisted(() => vi.fn(() => null as any));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
  stripSeedRowsFromTemplate_ACU: vi.fn((obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    Object.keys(obj).forEach(k => {
      if (!k.startsWith('sheet_')) return;
      const table = obj[k];
      if (!table || !Array.isArray(table.content) || table.content.length === 0) return;
      table.content = [table.content[0]];
    });
    return obj;
  }),
}));

// mock state-manager
let mockCurrentJsonTableData: any = null;
let mockCurrentJsonTableDataOwner: object | null = null;
let currentJsonPublicationShouldThrow: Error | null = null;
let capturedJsonPublication: { data: any; owner: object | null } | null = null;
const stateManagerMocks = vi.hoisted(() => ({
  publish: vi.fn(),
  release: vi.fn(() => false),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  _set_currentJsonTableData_ACU: vi.fn((v: any) => {
    mockCurrentJsonTableData = v;
    mockCurrentJsonTableDataOwner = null;
  }),
  captureCurrentJsonTablePublication_ACU: () => {
    capturedJsonPublication = { data: mockCurrentJsonTableData, owner: mockCurrentJsonTableDataOwner };
    return capturedJsonPublication;
  },
  restoreCurrentJsonTablePublication_ACU: (snapshot: { data: any; owner: object | null }) => {
    mockCurrentJsonTableData = snapshot.data;
    mockCurrentJsonTableDataOwner = snapshot.owner;
  },
  publishCurrentJsonTableDataForOwner_ACU: (owner: object, data: any) => {
    if (currentJsonPublicationShouldThrow) {
      throw currentJsonPublicationShouldThrow;
    }
    mockCurrentJsonTableData = data;
    mockCurrentJsonTableDataOwner = owner;
    stateManagerMocks.publish(owner, data);
  },
  releaseCurrentJsonTableDataForOwner_ACU: (owner: object) => {
    const released = mockCurrentJsonTableDataOwner === owner;
    if (released) {
      mockCurrentJsonTableData = null;
      mockCurrentJsonTableDataOwner = null;
    }
    stateManagerMocks.release(owner);
    return released;
  },
}));

// mock table-service
const mockSaveIndependentTable = vi.fn().mockResolvedValue({ saved: true, messageIndex: 5 });
const mockBuildInitialTableRuntimeSnapshot = vi.fn(() => {
  const data = mockParseTableTemplateJson({ stripSeedRows: !mockShouldUseInitialSeedRows() });
  return data
    ? { data: JSON.parse(JSON.stringify(data)) }
    : { data: null, error: '没有可用初始化模板' };
});
vi.mock('../../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: (...args: any[]) => mockSaveIndependentTable(...args),
  buildInitialTableRuntimeSnapshot_ACU: (...args: any[]) => mockBuildInitialTableRuntimeSnapshot(...args),
}));

// mock helpers-data-merge
const mockMergeAll = vi.fn();
const mockSeedGreetingLocalData = vi.fn().mockResolvedValue(false);
vi.mock('../../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: (...args: any[]) => mockMergeAll(...args),
  seedGreetingLocalDataFromTemplate_ACU: (...args: any[]) => mockSeedGreetingLocalData(...args),
}));

// mock name-mapper
let mockGlobalNameMapper: any = null;
let mockGlobalNameMapperOwner: object | null = null;
const nameMapperMocks = vi.hoisted(() => {
  class MockNameMapper {
    static fromDDLs = vi.fn(() => new MockNameMapper());
    tableCount = 1;
  }
  return {
    MockNameMapper,
    publish: vi.fn(),
    release: vi.fn(() => true),
  };
});
vi.mock('../../../src/service/runtime/template-vars/name-mapper', () => ({
  NameMapper: nameMapperMocks.MockNameMapper,
  captureGlobalNameMapperPublication_ACU: () => ({ mapper: mockGlobalNameMapper, owner: mockGlobalNameMapperOwner }),
  restoreGlobalNameMapperPublication_ACU: (snapshot: { mapper: any; owner: object | null }) => {
    mockGlobalNameMapper = snapshot.mapper;
    mockGlobalNameMapperOwner = snapshot.owner;
  },
  publishGlobalNameMapperForOwner_ACU: (owner: object, mapper: any) => {
    nameMapperMocks.publish(owner, mapper);
    mockGlobalNameMapper = mapper;
    mockGlobalNameMapperOwner = mapper ? owner : null;
  },
  releaseGlobalNameMapperForOwner_ACU: (owner: object) => {
    nameMapperMocks.release(owner);
    if (mockGlobalNameMapperOwner !== owner) return false;
    mockGlobalNameMapper = null;
    mockGlobalNameMapperOwner = null;
    return true;
  },
}));

// mock chat-scope（getEffectiveSeedRowsForSheet_ACU + getCurrentChatTemplateScopeState_ACU）
const mockGetEffectiveSeedRows = vi.fn().mockReturnValue([]);
const mockGetCurrentChatTemplateScopeState = vi.fn().mockReturnValue(null);
const mockShouldUseInitialSeedRows = vi.fn().mockReturnValue(false);
vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: (...args: any[]) => mockGetEffectiveSeedRows(...args),
  getCurrentChatTemplateScopeState_ACU: (...args: any[]) => mockGetCurrentChatTemplateScopeState(...args),
  shouldUseInitialSeedRows_ACU: (...args: any[]) => mockShouldUseInitialSeedRows(...args),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => {
    if (!Array.isArray(content) || content.length === 0) return [];
    const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
    const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
    let nextId = 1;
    return [header, ...rows.map((row: any) => {
      const normalized = row[0] == null || String(row[0]).trim() === '' ? '' : String(row[0]).trim();
      const value = normalized || String(nextId++);
      if (row.length === 0) return [value];
      row[0] = value;
      return row;
    })];
  }),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn((source: any) => {
    if (!source) return null;
    return { templateStr: typeof source === 'string' ? source : JSON.stringify(source), templateObj: typeof source === 'string' ? JSON.parse(source) : source };
  }),
}));

// mock template-preset-service
const mockGetTemplatePreset = vi.fn().mockReturnValue(null);
vi.mock('../../../src/service/template/template-preset-service', () => ({
  getTemplatePreset_ACU: (...args: any[]) => mockGetTemplatePreset(...args),
}));

// mock json-helpers
vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: vi.fn((str: string, fallback: any) => {
    try { return JSON.parse(str); } catch { return fallback; }
  }),
}));

// 现在 import 被测模块
import {
  applySqlEditsToTableDataSnapshot_ACU,
  buildSqlSheetBatchOperations_ACU,
  SqlTableService,
  splitSqlStatements,
  extractTableNamesFromStatements,
} from '../../../src/service/table/sql-table-service';
import { parseTableTemplateJson_ACU } from '../../../src/shared/utils';

// ═══════════════════════════════════════════════════════════════
// 纯函数测试：splitSqlStatements
// ═══════════════════════════════════════════════════════════════
describe('splitSqlStatements', () => {
  it('按分号拆分多条语句', () => {
    const sql = "INSERT INTO t VALUES (1, 'a'); UPDATE t SET x = 1; DELETE FROM t WHERE id = 1;";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'a')");
    expect(result[1]).toBe('UPDATE t SET x = 1');
    expect(result[2]).toBe('DELETE FROM t WHERE id = 1');
  });

  it('跳过字符串内的分号（单引号）', () => {
    const sql = "INSERT INTO t VALUES (1, 'hello; world'); INSERT INTO t VALUES (2, 'foo');";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'hello; world')");
    expect(result[1]).toBe("INSERT INTO t VALUES (2, 'foo')");
  });

  it('跳过字符串内的分号（双引号）', () => {
    const sql = 'INSERT INTO t VALUES (1, "hello; world"); INSERT INTO t VALUES (2, "foo");';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('INSERT INTO t VALUES (1, "hello; world")');
    expect(result[1]).toBe('INSERT INTO t VALUES (2, "foo")');
  });

  it('处理转义的单引号（SQL 风格 \'\'）', () => {
    const sql = "INSERT INTO t VALUES (1, 'it''s a test'); INSERT INTO t VALUES (2, 'ok');";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'it''s a test')");
    expect(result[1]).toBe("INSERT INTO t VALUES (2, 'ok')");
  });

  it('最后一条语句没有分号结尾', () => {
    const sql = 'INSERT INTO t VALUES (1); UPDATE t SET x = 2';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe('UPDATE t SET x = 2');
  });

  it('空字符串返回空数组', () => {
    expect(splitSqlStatements('')).toEqual([]);
  });

  it('纯空白返回空数组', () => {
    expect(splitSqlStatements('   \n\t  ')).toEqual([]);
  });

  it('单条语句无分号', () => {
    const result = splitSqlStatements('SELECT * FROM t');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('SELECT * FROM t');
  });

  it('连续分号产生空语句被过滤', () => {
    const sql = 'INSERT INTO t VALUES (1);;; UPDATE t SET x = 2;;';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
  });

  it('多行 SQL 语句', () => {
    const sql = `INSERT INTO inventory
      VALUES (1, '铁剑', 3);
    UPDATE inventory
      SET quantity = 5
      WHERE item_name = '铁剑';`;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('INSERT INTO inventory');
    expect(result[1]).toContain('UPDATE inventory');
  });

  it('字符串中包含转义双引号', () => {
    const sql = 'INSERT INTO t VALUES (1, "he said ""hello"""); INSERT INTO t VALUES (2, "ok");';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
  });

  it('移除行注释与块注释，注释中的分号不拆分语句', () => {
    const sql = `-- leading; comment
      INSERT INTO inventory (item_name) VALUES ('药水'); /* trailing; comment */
      UPDATE inventory SET item_name = '魔法书' WHERE row_id = 1;`;
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO inventory (item_name) VALUES ('药水')",
      "UPDATE inventory SET item_name = '魔法书' WHERE row_id = 1",
    ]);
  });

  it('保留字符串与 quoted identifier 内的注释符和分号', () => {
    const sql = "INSERT INTO `table--name` (`value/*x*/`) VALUES ('-- text; /* value */'); SELECT [semi;--col] FROM `table--name`;";
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO `table--name` (`value/*x*/`) VALUES ('-- text; /* value */')",
      'SELECT [semi;--col] FROM `table--name`',
    ]);
  });

  it('未闭合块注释明确失败', () => {
    expect(() => splitSqlStatements('SELECT 1; /* unfinished')).toThrow('SQL 块注释未闭合');
  });

});

// ═══════════════════════════════════════════════════════════════
// 纯函数测试：extractTableNamesFromStatements
// ═══════════════════════════════════════════════════════════════
describe('extractTableNamesFromStatements', () => {
  it('提取 INSERT INTO 的表名', () => {
    const result = extractTableNamesFromStatements(["INSERT INTO inventory VALUES (1, '铁剑', 3)"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 INSERT OR REPLACE INTO 的表名', () => {
    const result = extractTableNamesFromStatements(["INSERT OR REPLACE INTO inventory VALUES (1, '铁剑', 3)"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 UPDATE 的表名', () => {
    const result = extractTableNamesFromStatements(["UPDATE inventory SET quantity = 5 WHERE row_id = 1"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 UPDATE OR IGNORE 的表名', () => {
    const result = extractTableNamesFromStatements(["UPDATE OR IGNORE inventory SET quantity = 5"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 DELETE FROM 的表名', () => {
    const result = extractTableNamesFromStatements(["DELETE FROM inventory WHERE row_id = 1"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 ALTER TABLE 的表名', () => {
    const result = extractTableNamesFromStatements(["ALTER TABLE inventory ADD COLUMN description TEXT"]);
    expect(result).toEqual(['inventory']);
  });

  it('多条语句提取多个表名（去重）', () => {
    const result = extractTableNamesFromStatements([
      "INSERT INTO inventory VALUES (1, '铁剑', 3)",
      "UPDATE inventory SET quantity = 5",
      "INSERT INTO characters VALUES (1, '角色A', 25)",
    ]);
    expect(result).toContain('inventory');
    expect(result).toContain('characters');
    expect(result).toHaveLength(2); // inventory 去重
  });

  it('SELECT 语句不提取表名', () => {
    const result = extractTableNamesFromStatements(["SELECT * FROM inventory"]);
    expect(result).toEqual([]);
  });

  it('CREATE TABLE 语句不提取表名', () => {
    const result = extractTableNamesFromStatements(["CREATE TABLE new_table (id INTEGER)"]);
    expect(result).toEqual([]);
  });

  it('空数组返回空数组', () => {
    expect(extractTableNamesFromStatements([])).toEqual([]);
  });

  it('空字符串语句不提取', () => {
    expect(extractTableNamesFromStatements(['', '  '])).toEqual([]);
  });

  it('大小写不敏感', () => {
    const result = extractTableNamesFromStatements(["insert into MyTable values (1)"]);
    expect(result).toEqual(['MyTable']);
  });
});

// ═══════════════════════════════════════════════════════════════
// SqlTableService 类测试
// ═══════════════════════════════════════════════════════════════
describe('applySqlEditsToTableDataSnapshot_ACU', () => {
  const TEST_DDL = `CREATE TABLE inventory (
    row_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1
  );`;

  const snapshotTableData: any = {
    mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
    sheet_0: {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
      content: [
        ['row_id', 'item_name', 'quantity'],
        ['1', '铁剑', '3'],
      ],
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentJsonTableData = null;
  });

  it('基于显式快照应用 SQL，返回 workingData 且不污染输入快照与全局状态', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU("UPDATE inventory SET quantity = 9 WHERE row_id = 1; INSERT INTO inventory VALUES (2, '治疗药水', 5);", inputSnapshot);

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(result.appliedEdits).toBe(2);
    expect(result.workingData?.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '9'], ['2', '治疗药水', '5']]);
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
    expect(mockCurrentJsonTableData).toBeNull();
  });

  it('AI SQL 省略 row_id 时按持久化高水位分配并将重写语句写入 operation', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.nextRowId = 7;
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory (item_name, quantity) VALUES ('治疗药水', 5), ('魔法书(精装,新版)', 1);",
      inputSnapshot,
      'auto_standard',
      {
        targetSheetKeys: ['sheet_0'],
        requireSheetScopedOperations: true,
        allowSingleTargetFallback: true,
        systemAllocateRowIds: true,
      },
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'quantity'],
      ['1', '铁剑', '3'],
      ['7', '治疗药水', '5'],
      ['8', '魔法书(精装,新版)', '1'],
    ]);
    expect(result.workingData?.sheet_0.sourceData.nextRowId).toBe(9);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: ["INSERT INTO inventory (row_id, item_name, quantity) VALUES (7, '治疗药水', 5), (8, '魔法书(精装,新版)', 1)"],
      tableName: 'inventory',
      reason: 'system',
    }]);
    expect(inputSnapshot.sheet_0.sourceData.nextRowId).toBe(7);
  });

  it('AI SQL 显式提供 row_id 时忽略模型值并使用系统高水位', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.nextRowId = 10;
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory (row_id, item_name, quantity) VALUES (1, '治疗药水', 5);",
      inputSnapshot,
      'auto_standard',
      { systemAllocateRowIds: true },
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content.at(-1)).toEqual(['10', '治疗药水', '5']);
    expect(result.workingData?.sheet_0.sourceData.nextRowId).toBe(11);
    expect((result.operations?.[0] as any)?.statements).toEqual([
      "INSERT INTO inventory (row_id, item_name, quantity) VALUES (10, '治疗药水', 5)",
    ]);
  });

  it('AI SQL 分配模式拒绝无列清单 INSERT，避免 SQLite 临时 rowid 绕过高水位', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory VALUES (2, '治疗药水', 5);",
      inputSnapshot,
      'auto_standard',
      { systemAllocateRowIds: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('AI INSERT 必须使用');
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('AI SQL 分配模式支持前置和尾随注释，字符串内注释符保持原值', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.nextRowId = 4;
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "-- fill inventory;\n/* controlled insert */ INSERT INTO inventory (item_name, quantity) VALUES ('--药水;/*原值*/', 5); -- done",
      inputSnapshot,
      'auto_standard',
      { systemAllocateRowIds: true },
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content.at(-1)).toEqual(['4', '--药水;/*原值*/', '5']);
    expect((result.operations?.[0] as any)?.statements).toEqual([
      "INSERT INTO inventory (row_id, item_name, quantity) VALUES (4, '--药水;/*原值*/', 5)",
    ]);
  });

  it.each([
    [
      'INSERT SELECT',
      "INSERT INTO inventory (item_name, quantity) SELECT '药水', 5",
    ],
    [
      'RETURNING',
      "INSERT INTO inventory (item_name, quantity) VALUES ('药水', 5) RETURNING row_id",
    ],
    [
      'UPSERT',
      "INSERT INTO inventory (item_name, quantity) VALUES ('药水', 5) ON CONFLICT(row_id) DO NOTHING",
    ],
    [
      'CTE INSERT',
      "WITH payload(name, quantity) AS (VALUES ('药水', 5)) INSERT INTO inventory (item_name, quantity) SELECT name, quantity FROM payload",
    ],
    [
      'schema-qualified INSERT',
      "INSERT INTO main.inventory (item_name, quantity) VALUES ('药水', 5)",
    ],
    [
      'INSERT OR IGNORE',
      "INSERT OR IGNORE INTO inventory (item_name, quantity) VALUES ('药水', 5)",
    ],
  ])('AI SQL 分配模式对不受控语法 %s 明确拒绝', async (_label, sql) => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.nextRowId = 4;

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      sql,
      inputSnapshot,
      'auto_standard',
      { systemAllocateRowIds: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/AI INSERT|不支持 CTE/);
    expect(inputSnapshot.sheet_0.sourceData.nextRowId).toBe(4);
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('AI SQL 后续语句失败时不泄漏已预留的 nextRowId', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.nextRowId = 6;
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory (item_name, quantity) VALUES ('治疗药水', 5); UPDATE inventory SET missing_col = 1 WHERE row_id = 1;",
      inputSnapshot,
      'auto_standard',
      { systemAllocateRowIds: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing_col');
    expect(inputSnapshot.sheet_0.sourceData.nextRowId).toBe(6);
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('SQL 失败时返回错误且不污染输入快照与全局状态', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU('UPDATE inventory SET missing_col = 1 WHERE row_id = 1;', inputSnapshot);

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing_col');
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
    expect(mockCurrentJsonTableData).toBeNull();
  });

  it('严格单表日志模式下返回 sql_sheet_batch 而不是旧 sql_batch', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "UPDATE inventory SET quantity = 9 WHERE row_id = 1; INSERT INTO inventory VALUES (2, '治疗药水', 5);",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(true);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: [
        'UPDATE inventory SET quantity = 9 WHERE row_id = 1',
        "INSERT INTO inventory VALUES (2, '治疗药水', 5)",
      ],
      tableName: 'inventory',
      reason: 'system',
    }]);
  });

  it('严格单表日志模式下拒绝无法归属到单表的 SQL', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      'CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY);',
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: false },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('SQL 语句无法归属到单表日志');
  });
});

describe('buildSqlSheetBatchOperations_ACU', () => {
  const tableData: any = {
    sheet_0: { uid: 'inventory', name: '背包表', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT);' } },
    sheet_1: { uid: 'quest_log', name: '任务表', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT);' } },
  };

  it('按 SQL 表名归类为单表 sql_sheet_batch，并按相邻同表合并', () => {
    const result = buildSqlSheetBatchOperations_ACU([
      "INSERT INTO inventory VALUES (1, 'a')",
      "UPDATE inventory SET value = 'b' WHERE row_id = 1",
      "INSERT INTO quest_log VALUES (1, 'q')",
    ], tableData, { reason: 'system' });

    expect(result.operations).toEqual([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ["INSERT INTO inventory VALUES (1, 'a')", "UPDATE inventory SET value = 'b' WHERE row_id = 1"], tableName: 'inventory', reason: 'system' },
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_1', statements: ["INSERT INTO quest_log VALUES (1, 'q')"], tableName: 'quest_log', reason: 'system' },
    ]);
    expect(result.unknownStatements).toEqual([]);
    expect(result.ambiguousStatements).toEqual([]);
  });

  it('单目标 fallback 只在显式允许时把未知 SQL 归入目标 sheet', () => {
    const result = buildSqlSheetBatchOperations_ACU(
      ['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)'],
      tableData,
      { fallbackTargetSheetKeys: ['sheet_0'], allowSingleTargetFallback: true, reason: 'system' },
    );

    expect(result.operations).toEqual([{ kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)'], reason: 'system' }]);
    expect(result.unknownStatements).toEqual(['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)']);
  });
});

// ═══════════════════════════════════════════════════════════════
// SqlTableService 类测试
// ═══════════════════════════════════════════════════════════════
describe('SqlTableService', () => {
  let service: SqlTableService;

  // 构造测试用的 TableDataObject
  const TEST_DDL = `CREATE TABLE inventory (
    row_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1
  );`;

  const testTableData: any = {
    mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
    sheet_0: {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
      content: [
        ['row_id', 'item_name', 'quantity'],
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ],
      updateConfig: { uiSentinel: 0, contextDepth: 0, updateFrequency: 0, batchSize: 0, skipFloors: 0 },
      exportConfig: {},
      orderNo: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentJsonTableData = null;
    mockCurrentJsonTableDataOwner = null;
    currentJsonPublicationShouldThrow = null;
    capturedJsonPublication = null;
    mockGlobalNameMapper = null;
    mockGlobalNameMapperOwner = null;
    stateManagerMocks.release.mockReturnValue(false);
    nameMapperMocks.release.mockReturnValue(true);
    nameMapperMocks.MockNameMapper.fromDDLs.mockClear();
    // 重置 mock 返回值，防止测试之间的状态泄漏
    mockGetEffectiveSeedRows.mockReturnValue([]);
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockShouldUseInitialSeedRows.mockReturnValue(false);
    mockSeedGreetingLocalData.mockResolvedValue(false);
    mockGetTemplatePreset.mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(null);
    service = new SqlTableService();
  });

  afterAll(() => {
    // 确保清理
    try { service?.dispose(); } catch (_) {}
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureInitialized（通过公开方法间接测试）
  // ═══════════════════════════════════════════════════════════════
  describe('未初始化时的行为', () => {
    it('applyEdits 未初始化时抛出错误', () => {
      expect(() => service.applyEdits('INSERT INTO t VALUES (1)')).toThrow('SQLite 引擎未初始化');
    });

    it('executeQuery 未初始化时抛出错误', () => {
      expect(() => service.executeQuery('SELECT 1')).toThrow('SQLite 引擎未初始化');
    });

    it('executeMutation 未初始化时抛出错误', () => {
      expect(() => service.executeMutation('INSERT INTO t VALUES (1)')).toThrow('SQLite 引擎未初始化');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // loadFromChat
  // ═══════════════════════════════════════════════════════════════
  describe('loadFromChat', () => {
    it('无数据且无可解析模板时返回 empty', async () => {
      mockMergeAll.mockResolvedValue(null);
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(false);
      expect(result.source).toBe('empty');
    });

    it('首个用户消息后、首个真实 AI 回复前将模板 seedRows 写入运行时 SQLite，支持首次 SQL 读取', async () => {
      mockShouldUseInitialSeedRows.mockReturnValue(true);
      mockMergeAll.mockResolvedValue(null);
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [
            ['row_id', 'item_name', 'quantity'],
            ['1', '铁剑', '3'],
            ['2', '治疗药水', '5'],
          ],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      const result = await service.loadFromChat();
      expect(mockSeedGreetingLocalData).not.toHaveBeenCalled();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('initialized');
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toContain('铁剑');
    });

    it('仅有基底状态数据时也写入运行时 SQLite，但不保留内部标记', async () => {
      const baseStateData = JSON.parse(JSON.stringify(testTableData));
      baseStateData.sheet_0._acu_from_base_state = true;
      mockMergeAll.mockResolvedValue(baseStateData);

      const result = await service.loadFromChat();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('initialized');
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect((mockCurrentJsonTableData as any).sheet_0._acu_from_base_state).toBeUndefined();
    });

    it('有数据时成功加载', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('merged');
    });

    it('从显式 canonical 快照 hydrate 时不再次回放聊天，且 SQL 基底与快照一致', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));
      mockMergeAll.mockResolvedValue(null);

      const result = await service.loadFromData(canonicalData);

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(mockMergeAll).not.toHaveBeenCalled();
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT * FROM inventory ORDER BY row_id').rowCount).toBe(2);
      service.applyEdits("UPDATE inventory SET quantity = 9 WHERE row_id = 1;");
      expect(service.executeQuery('SELECT quantity FROM inventory WHERE row_id = 1').values).toEqual([[9]]);
      expect(canonicalData.sheet_0.content[1]).toEqual(['1', '铁剑', '3']);
    });

    it('明确仅表头 snapshot 原样 hydrate，不读取模板或补 seedRows', async () => {
      const persistedEmptyData = JSON.parse(JSON.stringify(testTableData));
      persistedEmptyData.sheet_0.name = '历史空表';
      persistedEmptyData.sheet_0.sourceData.ddl = TEST_DDL;
      persistedEmptyData.sheet_0.content = [['row_id', 'item_name', 'quantity']];
      persistedEmptyData.sheet_0.seedRows = [['99', '历史元数据也不应复活', '1']];
      mockGetEffectiveSeedRows.mockReturnValue([['99', '不应复活', '1']]);
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          sheet_0: {
            name: '当前模板表',
            sourceData: { ddl: 'CREATE TABLE wrong_table (row_id INTEGER PRIMARY KEY);' },
            content: [['row_id'], ['1']],
          },
          sheet_new: {
            name: '当前新增模板表',
            sourceData: { ddl: 'CREATE TABLE new_table (row_id INTEGER PRIMARY KEY);' },
            content: [['row_id'], ['1']],
          },
        }),
      });
      mockParseTableTemplateJson.mockReturnValue({
        sheet_0: { sourceData: { ddl: 'CREATE TABLE wrong_global (row_id INTEGER PRIMARY KEY);' } },
      });

      const result = await service.loadFromData(persistedEmptyData, { source: 'merged' });

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(service.executeQuery('SELECT * FROM inventory').rowCount).toBe(0);
      expect(service.getCurrentData()?.sheet_0.name).toBe('历史空表');
      expect(service.getCurrentData()?.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity']]);
      const mutation = service.executeMutation("INSERT INTO inventory VALUES (100, '历史后续写入', 2)");
      expect(mutation.errors).toEqual([]);
      expect(service.executeQuery('SELECT item_name FROM inventory ORDER BY row_id').values).toEqual([['历史后续写入']]);
      expect(service.getCurrentData()?.sheet_new).toBeUndefined();
      expect(mockGetEffectiveSeedRows).not.toHaveBeenCalled();
      expect(mockGetCurrentChatTemplateScopeState).not.toHaveBeenCalled();
      expect(mockParseTableTemplateJson).not.toHaveBeenCalled();
    });

    it('null candidate hydrate 不读取模板、guide 或发布 mapper', async () => {
      const result = await service.loadFromData(null, { source: 'merged' });
      expect(result).toEqual({ loaded: false, source: 'empty' });
      expect(mockGetEffectiveSeedRows).not.toHaveBeenCalled();
      expect(mockGetCurrentChatTemplateScopeState).not.toHaveBeenCalled();
      expect(mockParseTableTemplateJson).not.toHaveBeenCalled();
      expect(nameMapperMocks.publish).not.toHaveBeenCalled();
    });

    it('候选 hydrate 仅更新实例快照，激活后才以 owner 发布 JSON 视图', async () => {
      const activeView = { mate: { type: 'acu', version: 1 }, sheet_active: { content: [['row_id'], ['1']] } };
      mockCurrentJsonTableData = activeView;
      const canonicalData = JSON.parse(JSON.stringify(testTableData));

      service.beginRuntimeCandidate_ACU();
      await service.loadFromData(canonicalData);

      expect(mockCurrentJsonTableData).toBe(activeView);
      expect(stateManagerMocks.publish).not.toHaveBeenCalled();

      service.activateRuntimeStatePublication_ACU();

      expect(mockCurrentJsonTableData).toEqual(expect.objectContaining({ sheet_0: expect.any(Object) }));
      expect(mockCurrentJsonTableData).not.toBe(activeView);
      expect(stateManagerMocks.publish).toHaveBeenCalledWith(service, mockCurrentJsonTableData);
    });

    it('JSON owner publish 失败时不提前发布 mapper，也不覆盖旧 JSON 视图', async () => {
      const activeView = { mate: { type: 'acu', version: 1 }, sheet_active: { content: [['row_id'], ['1']] } };
      mockCurrentJsonTableData = activeView;
      service.beginRuntimeCandidate_ACU();
      await service.loadFromData(JSON.parse(JSON.stringify(testTableData)));
      currentJsonPublicationShouldThrow = new Error('JSON publication failed');

      expect(() => service.activateRuntimeStatePublication_ACU()).toThrow('JSON publication failed');

      expect(nameMapperMocks.publish).not.toHaveBeenCalled();
      expect(mockCurrentJsonTableData).toBe(activeView);
      expect(stateManagerMocks.publish).not.toHaveBeenCalled();
    });

    it('mapper publish 失败时恢复旧 JSON 与旧 mapper publication', async () => {
      const oldJsonOwner = {};
      const oldMapperOwner = {};
      const activeView = { mate: { type: 'acu', version: 1 }, sheet_active: { content: [['row_id'], ['1']] } };
      const activeMapper = { tableCount: 7 };
      mockCurrentJsonTableData = activeView;
      mockCurrentJsonTableDataOwner = oldJsonOwner;
      mockGlobalNameMapper = activeMapper;
      mockGlobalNameMapperOwner = oldMapperOwner;
      service.beginRuntimeCandidate_ACU();
      await service.loadFromData(JSON.parse(JSON.stringify(testTableData)));
      nameMapperMocks.publish.mockImplementationOnce(() => { throw new Error('mapper publication failed'); });

      expect(() => service.activateRuntimeStatePublication_ACU()).toThrow('mapper publication failed');

      expect(mockCurrentJsonTableData).toBe(activeView);
      expect(mockCurrentJsonTableDataOwner).toBe(oldJsonOwner);
      expect(mockGlobalNameMapper).toBe(activeMapper);
      expect(mockGlobalNameMapperOwner).toBe(oldMapperOwner);
    });

    it('候选 hydrate 不发布 mapper，只有策略层激活后才发布', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));

      await service.loadFromData(canonicalData);

      expect(nameMapperMocks.MockNameMapper.fromDDLs).toHaveBeenCalledOnce();
      expect(nameMapperMocks.publish).not.toHaveBeenCalled();

      service.activateRuntimeStatePublication_ACU();

      expect(nameMapperMocks.publish).toHaveBeenCalledOnce();
      expect(nameMapperMocks.publish).toHaveBeenCalledWith(service, expect.any(nameMapperMocks.MockNameMapper));
    });

    it('未发布候选 dispose 不得撤销其他实例的 mapper', async () => {
      await service.loadFromData(JSON.parse(JSON.stringify(testTableData)));

      service.dispose();

      expect(nameMapperMocks.release).toHaveBeenCalledWith(service);
      expect(nameMapperMocks.publish).not.toHaveBeenCalled();
    });

    it('从错序旧 chronicle snapshot hydrate 后保持 SQLite ready 与字段语义', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));
      canonicalData.sheet_0.uid = 'chronicle';
      canonicalData.sheet_0.name = '纪要表';
      canonicalData.sheet_0.sourceData.ddl = `CREATE TABLE chronicle (
  row_id INTEGER PRIMARY KEY, -- 行号
  code_index TEXT NOT NULL, -- 编码索引
  chronicle_text TEXT NOT NULL -- 纪要
);`;
      canonicalData.sheet_0.content = [
        ['row_id', '纪要', '编码索引'],
        ['1', '完整纪要正文', 'AM0001'],
      ];

      const result = await service.loadFromData(canonicalData);

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT code_index, chronicle_text FROM chronicle WHERE row_id = 1').values).toEqual([
        ['AM0001', '完整纪要正文'],
      ]);
      expect(canonicalData.sheet_0.content[1]).toEqual(['1', '完整纪要正文', 'AM0001']);
    });

    it('strict hydrate 遇到非空未映射旧字段时清理 runtime 并保持 not ready', async () => {
      const invalidData = JSON.parse(JSON.stringify(testTableData));
      invalidData.sheet_0.content = [
        ['row_id', 'item_name', 'quantity', '旧字段'],
        ['1', '铁剑', '3', '不能丢失'],
      ];

      const result = await service.loadFromData(invalidData);

      expect(result.loaded).toBe(false);
      expect(result.error).toContain('sqlite_hydrate_failed');
      expect(service.isReady()).toBe(false);
      expect(invalidData.sheet_0.content[1]).toEqual(['1', '铁剑', '3', '不能丢失']);
    });

    it('strict hydrate 失败时清理部分 runtime，且不修改调用方快照', async () => {
      const invalidData = JSON.parse(JSON.stringify(testTableData));
      invalidData.sheet_0.sourceData.ddl = 'CREATE TABLE broken (';

      const result = await service.loadFromData(invalidData);

      expect(result.loaded).toBe(false);
      expect(result.error).toContain('sqlite_hydrate_failed');
      expect(service.isReady()).toBe(false);
      expect(() => service.executeQuery('SELECT 1')).toThrow('SQLite 引擎未初始化');
      expect(invalidData.sheet_0.sourceData.ddl).toBe('CREATE TABLE broken (');
    });

    it('加载后可以执行查询', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.columns).toContain('item_name');
    });

    it('加载失败时返回错误信息', async () => {
      mockMergeAll.mockRejectedValue(new Error('网络错误'));
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(false);
      expect(result.error).toContain('网络错误');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // applyEdits
  // ═══════════════════════════════════════════════════════════════
  describe('applyEdits', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行单条 INSERT 语句', () => {
      const result = service.applyEdits("INSERT INTO inventory VALUES (3, '魔法书', 1);");
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
      // 验证数据确实插入了
      const query = service.executeQuery('SELECT * FROM inventory WHERE row_id = 3');
      expect(query.rowCount).toBe(1);
    });

    it('执行多条语句', () => {
      const sql = "INSERT INTO inventory VALUES (3, '魔法书', 1); UPDATE inventory SET quantity = 10 WHERE row_id = 1;";
      const result = service.applyEdits(sql);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
    });

    it('同一组 SQL 修改多张表时，后续表失败会回滚前面表的写入', async () => {
      const weaponDDL = `CREATE TABLE weapon_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
      const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
      const data = {
        mate: { type: 'acu', version: 1 },
        sheet_0: { uid: 'inventory', name: '背包', sourceData: { ddl: TEST_DDL }, content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
        sheet_1: { uid: 'weapon_log', name: '武器记录', sourceData: { ddl: weaponDDL }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
        sheet_2: { uid: 'quest_log', name: '任务记录', sourceData: { ddl: questDDL }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 2 },
      };
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(data)));
      await service.loadFromChat();

      expect(() => service.applyEdits([
        "INSERT INTO weapon_log VALUES (1, 'A表已写');",
        "INSERT INTO quest_log VALUES (1, 'B表已写');",
        "INSERT INTO inventory (missing_col) VALUES ('C表报错');",
      ].join('\n'))).toThrow();

      expect(service.executeQuery('SELECT COUNT(*) FROM weapon_log').values[0][0]).toBe(0);
      expect(service.executeQuery('SELECT COUNT(*) FROM quest_log').values[0][0]).toBe(0);
    });

    it('空字符串返回成功（无操作）', () => {
      const result = service.applyEdits('');
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(0);
    });

    it('纯空白返回成功（无操作）', () => {
      const result = service.applyEdits('   \n\t  ');
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(0);
    });

    it('去除 HTML 注释标记', () => {
      const sql = "<!-- INSERT INTO inventory VALUES (3, '魔法书', 1); -->";
      const result = service.applyEdits(sql);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
    });

    it('SQL 语法错误时抛出异常', () => {
      expect(() => service.applyEdits('INVALID SQL SYNTAX HERE;')).toThrow();
    });

    it('返回受影响的 modifiedKeys', () => {
      // 设置 currentJsonTableData 以便 _tableNamesToSheetKeys 能工作
      mockCurrentJsonTableData = JSON.parse(JSON.stringify(testTableData));
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.modifiedKeys).toContain('sheet_0');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 删除全表后 seedRows 自动回灌（applyEdits）
  // ═══════════════════════════════════════════════════════════════
  describe('删除全表后 applyEdits 自动回灌 seedRows', () => {
    beforeEach(async () => {
      const initializedData = JSON.parse(JSON.stringify(testTableData));
      initializedData.sheet_0.seedRows = [['1', '铁剑', '3'], ['2', '治疗药水', '5']];
      await service.loadFromData(initializedData, { source: 'initialized' });
    });

    it('DELETE 全表后 UPDATE 自动回灌 seedRows 并命中', () => {
      // 先删除所有数据
      const deleteResult = service.applyEdits('DELETE FROM inventory;');
      expect(deleteResult.success).toBe(true);

      // 验证表已空
      const emptyQuery = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(emptyQuery.values[0][0]).toBe(0);

      // 执行 UPDATE（应自动回灌 seedRows 后命中，同一事务）
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      // 删除前高水位为 3；模板旧 ID 不得复用，reseed 分配 3、4 后推进到 5。
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values.map((row: any) => row[0])).toEqual([3, 4]);
      expect(queryResult.values[0]).toContain('铁剑');
      expect(queryResult.values[0]).toContain(10);
      expect(queryResult.values[1]).toContain('治疗药水');
      expect(service.getCurrentData()?.sheet_0.sourceData.nextRowId).toBe(5);
    });

    it('显式 prepare 的 reseed batch 可由调用方原样执行，且禁用 provider 隐式追加', () => {
      service.applyEdits('DELETE FROM inventory;');

      const canonical = service.getCurrentData()!;
      const plan = service.prepareReseedPlanForEmptyTables(canonical, ['sheet_0']);

      expect(plan.statements).toHaveLength(2);
      expect(plan.paramsList).toEqual([[], []]);
      expect(plan.metadataUpdates[0].sheet.sourceData.nextRowId).toBe(5);
      expect(service.executeQuery('SELECT COUNT(*) FROM inventory').values[0][0]).toBe(0);

      const statements = [...plan.statements, "UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑'"];
      const result = service.applyEditsBatchWithSheetMetadata(
        statements,
        [...plan.paramsList, []],
        plan.metadataUpdates,
        'auto_standard',
        { includeImplicitReseed: false },
      );

      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(3);
      expect(service.executeQuery('SELECT row_id, item_name, quantity FROM inventory ORDER BY row_id').values).toEqual([
        [3, '铁剑', 10],
        [4, '治疗药水', 5],
      ]);
      expect(service.getCurrentData()?.sheet_0.sourceData.nextRowId).toBe(5);
    });

    it('受控 batch 关闭隐式 reseed 后不会执行未由调用方传入的 seedRows SQL', () => {
      service.applyEdits('DELETE FROM inventory;');

      const result = service.applyEditsBatchWithSheetMetadata(
        ["UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑'"],
        [[]],
        [],
        'auto_standard',
        { includeImplicitReseed: false },
      );

      expect(result.success).toBe(true);
      expect(service.executeQuery('SELECT COUNT(*) FROM inventory').values[0][0]).toBe(0);
    });

    it('非空表不触发 reseed', () => {
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      const allItems = queryResult.values.map((r: any) => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });

    it('无 seedRows 的表不触发 reseed', () => {
      delete service.getCurrentData()!.sheet_0.seedRows;
      service.applyEdits('DELETE FROM inventory;');

      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);
    });

    it('reseed INSERT 与用户 SQL 在同一事务，失败一起回滚', () => {
      service.applyEdits('DELETE FROM inventory;');
      // 删除前高水位为 3，因此首条 reseed 行会获得 row_id=3。

      // 用户 SQL 包含与 reseed 后 row_id 冲突的 INSERT
      expect(() => service.applyEdits(
        "INSERT INTO inventory VALUES (3, '冲突物品', 1);"
      )).toThrow();

      // 验证回滚：表仍为空（reseed 被回滚）
      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // executeQuery
  // ═══════════════════════════════════════════════════════════════
  describe('executeQuery', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行 SELECT 查询', () => {
      const result = service.executeQuery('SELECT item_name, quantity FROM inventory');
      expect(result.columns).toEqual(['item_name', 'quantity']);
      expect(result.rowCount).toBe(2);
      expect(result.values[0]).toEqual(['铁剑', 3]);
    });

    it('带参数的查询', () => {
      const result = service.executeQuery('SELECT * FROM inventory WHERE item_name = ?', ['铁剑']);
      expect(result.rowCount).toBe(1);
    });

    it('无结果的查询', () => {
      const result = service.executeQuery("SELECT * FROM inventory WHERE item_name = '不存在'");
      expect(result.rowCount).toBe(0);
      expect(result.values).toEqual([]);
    });

    it.each([
      'DELETE FROM inventory',
      'SELECT 1; UPDATE inventory SET quantity = 0',
      'PRAGMA user_version = 7',
      'EXPLAIN UPDATE inventory SET quantity = 0',
      'WITH changed AS (DELETE FROM inventory RETURNING *) SELECT * FROM changed',
    ])('拒绝通过 executeQuery 执行非只读 SQL: %s', sql => {
      expect(() => service.executeQuery(sql)).toThrow('executeQuery 仅允许单条只读 SQL');
      expect(service.executeQuery('SELECT quantity FROM inventory WHERE row_id = 1').values).toEqual([[3]]);
    });

    it('允许只读 CTE 与白名单 PRAGMA', () => {
      expect(service.executeQuery('WITH rows AS (SELECT 1 AS value) SELECT value FROM rows').values).toEqual([[1]]);
      expect(service.executeQuery('PRAGMA table_info(inventory)').rowCount).toBeGreaterThan(0);
    });

    it('已存在空表 + 有 seedRows 时 executeQuery 不触发 reseed', () => {
      // 先加载有数据的表
      service.applyEdits('DELETE FROM inventory;');
      // 验证表已空
      const emptyCheck = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(emptyCheck.values[0][0]).toBe(0);

      // mock seedRows 返回数据（如果 reseed 被错误触发，查询后表会有数据）
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
      ]);

      // 执行查询（不应触发 reseed）
      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);

      // 再次确认表仍为空（executeQuery 不应有写副作用）
      const finalCheck = service.executeQuery('SELECT * FROM inventory');
      expect(finalCheck.rowCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 新开卡场景：executeQuery 不触发建表
  // ═══════════════════════════════════════════════════════════════
  describe('新开卡场景下 executeQuery 不触发建表', () => {
    it('新开卡后 executeQuery 查询不存在的表应抛出错误，而非静默建表', async () => {
      // 模拟新开卡：mergeAll 返回 null
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // executeQuery 不应触发建表，查询不存在的表应抛出错误
      expect(() => service.executeQuery('SELECT * FROM inventory')).toThrow();
    });

    it('新开卡后 applyEdits 才触发建表', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置模板数据，让 _ensureTablesFromTemplate 能找到模板
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 应触发建表并成功执行
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);

      // 建表后 executeQuery 应正常工作
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureTablesFromTemplate + seedRows 写入
  // ═══════════════════════════════════════════════════════════════
  describe('建表时 seedRows 写入 SQLite', () => {
    const TEST_DDL_WITH_SEED = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1
    );`;

    it('有 seedRows 的表建表后数据被写入 SQLite', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置模板（stripSeedRows=true 后只有表头）
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED },
          content: [['row_id', 'item_name', 'quantity']], // 只有表头
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // mock seedRows 返回初始数据
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ]);

      // applyEdits 触发建表 + seedRows 写入
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      // 验证 seedRows 已写入 SQLite
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toContain('铁剑');
      // 验证 UPDATE 确实生效了（quantity 从 3 变为 10）
      expect(queryResult.values[0]).toContain(10);
      expect(queryResult.values[1]).toContain('治疗药水');
    });

    it('缺失表物化 seedRows 时覆盖模板 ID 并沿用既有高水位', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED, nextRowId: 10 },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ]);

      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT row_id, item_name, quantity FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toEqual([10, '铁剑', 10]);
      expect(queryResult.values[1]).toEqual([11, '治疗药水', 5]);
      expect(mockCurrentJsonTableData.sheet_0.content.map((row: any[]) => row[0])).toEqual(['row_id', '10', '11']);
      expect(mockCurrentJsonTableData.sheet_0.sourceData.nextRowId).toBe(12);
    });

    it('没有 seedRows 的表建表后仍为空表', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // mock seedRows 返回空
      mockGetEffectiveSeedRows.mockReturnValue([]);

      // applyEdits 触发建表（无 seedRows）
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '魔法书', 1);");
      expect(result.success).toBe(true);

      // 验证只有刚 INSERT 的那一行
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
      expect(queryResult.values[0]).toContain('魔法书');
    });

    it('已存在的表不会被重复写入 seedRows', async () => {
      // 先加载有数据的表
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();

      // 设置 seedRows（即使有也不应写入，因为表已存在）
      mockGetEffectiveSeedRows.mockReturnValue([
        ['99', '不应出现的物品', '999'],
      ]);

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发 _ensureTablesFromTemplate，但表已存在，不应重建
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      // 验证原始数据未被 seedRows 覆盖
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2); // 原始 2 行
      expect(queryResult.values[0]).toContain('铁剑');
      // 不应出现 seedRows 中的数据
      const allItems = queryResult.values.map(r => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureTablesFromTemplate 模板来源优先级
  // ═══════════════════════════════════════════════════════════════
  describe('建表时只使用当前聊天模板预设', () => {
    const CHAT_TEMPLATE_DDL = `CREATE TABLE chat_table (
      row_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );`;

    const GLOBAL_TEMPLATE_DDL = `CREATE TABLE global_table (
      row_id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );`;

    it('chat_override 模式下只建聊天级模板中的表，不建全局模板的表', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置当前聊天模板为 chat_override（只有 chat_table）
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'chat_table',
            name: '聊天专属表',
            sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: CHAT_TEMPLATE_DDL },
            content: [['row_id', 'name']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
        presetName: '聊天预设',
      });

      // 全局模板有 global_table（不应该被建出来）
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'global_table',
          name: '全局表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: GLOBAL_TEMPLATE_DDL },
          content: [['row_id', 'value']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发建表
      const result = service.applyEdits("INSERT INTO chat_table VALUES (1, '测试');");
      expect(result.success).toBe(true);

      // 验证 chat_table 被建出来了
      const chatQuery = service.executeQuery('SELECT * FROM chat_table');
      expect(chatQuery.rowCount).toBe(1);

      // 验证 global_table 没有被建出来
      expect(() => service.executeQuery('SELECT * FROM global_table')).toThrow();
    });

    it('chat_override 建表时不能被旧 currentJsonTableData 的 CHECK 覆盖', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const oldDDL = `CREATE TABLE chat_table (
        row_id INTEGER PRIMARY KEY,
        status TEXT CHECK(status IN ('old')) -- 状态
      );`;
      const newDDL = `CREATE TABLE chat_table (
        row_id INTEGER PRIMARY KEY,
        status TEXT CHECK(status IN ('new')) -- 状态
      );`;
      mockCurrentJsonTableData = {
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'chat_table',
          name: '旧运行时表',
          sourceData: { ddl: oldDDL, nextRowId: 10 },
          content: [['row_id', '状态']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      };
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'chat_table',
            name: '聊天专属表',
            sourceData: { ddl: newDDL, nextRowId: 3 },
            content: [['row_id', '状态']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
        presetName: '聊天预设',
      });

      const result = service.executeMutation("INSERT INTO chat_table VALUES (1, 'new');");

      expect(result.errors).toEqual([]);
      expect(service.executeQuery('SELECT status FROM chat_table').values[0][0]).toBe('new');
      expect(mockCurrentJsonTableData.sheet_0.sourceData.ddl).toBe(newDDL);
      expect(mockCurrentJsonTableData.sheet_0.sourceData.nextRowId).toBe(10);
    });

    it('inherit_global 模式下 fallback 到全局模板', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 当前聊天没有聊天级模板（inherit_global）
      mockGetCurrentChatTemplateScopeState.mockReturnValue(null);

      // 全局模板有 inventory 表
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发建表（应使用全局模板）
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
    });

    it('preset_link 模式下使用链接的全局预设', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 当前聊天链接了全局预设
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'preset_link',
        presetName: '战斗模板',
        templateStr: '',
      });

      // mock 全局预设返回
      mockGetTemplatePreset.mockReturnValue({
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'inventory',
            name: '背包物品表',
            sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
            content: [['row_id', 'item_name', 'quantity']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
      });

      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
      expect(mockGetTemplatePreset).toHaveBeenCalledWith('战斗模板');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // executeMutation
  // ═══════════════════════════════════════════════════════════════
  describe('executeMutation', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行 INSERT 并返回 changes', () => {
      const result = service.executeMutation("INSERT INTO inventory VALUES (3, '魔法书', 1)");
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('执行 UPDATE 并返回 changes', () => {
      const result = service.executeMutation('UPDATE inventory SET quantity = 10 WHERE row_id = 1');
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('执行 DELETE 并返回 changes', () => {
      const result = service.executeMutation('DELETE FROM inventory WHERE row_id = 1');
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('SQL 错误时返回 errors 而不抛出', () => {
      const result = service.executeMutation('INSERT INTO nonexistent_table VALUES (1)');
      expect(result.changes).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 删除全表后 executeMutation 自动回灌 seedRows
  // ═══════════════════════════════════════════════════════════════
  describe('删除全表后 executeMutation 自动回灌 seedRows', () => {
    beforeEach(async () => {
      const initializedData = JSON.parse(JSON.stringify(testTableData));
      initializedData.sheet_0.seedRows = [['1', '铁剑', '3'], ['2', '治疗药水', '5']];
      await service.loadFromData(initializedData, { source: 'initialized' });
    });

    it('DELETE 全表后 executeMutation UPDATE 自动回灌 seedRows 并命中', () => {
      service.applyEdits('DELETE FROM inventory;');

      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑'");
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values.map((row: any) => row[0])).toEqual([3, 4]);
      expect(queryResult.values[0]).toContain(10);
      expect(service.getCurrentData()?.sheet_0.sourceData.nextRowId).toBe(5);
    });

    it('非空表不触发 reseed', () => {
      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE row_id = 1");
      expect(result.changes).toBe(1);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      const allItems = queryResult.values.map((r: any) => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });

    it('无 seedRows 的表不触发 reseed', () => {
      delete service.getCurrentData()!.sheet_0.seedRows;
      service.applyEdits('DELETE FROM inventory;');

      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE row_id = 1");
      expect(result.changes).toBe(0);

      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);
    });

    it('用户 SQL 失败时 reseed 行与高水位在同一事务回滚', () => {
      service.applyEdits('DELETE FROM inventory;');
      const beforeFailure = service.getCurrentData();
      expect(beforeFailure?.sheet_0.sourceData.nextRowId).toBe(3);

      // 用户 SQL 故意写错列名使其失败
      const result = service.executeMutation("UPDATE inventory SET nonexistent_col = 1 WHERE row_id = 1");
      expect(result.changes).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);

      // 整批事务失败：reseed 业务行没有落库。
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(0);
      const afterFailure = service.getCurrentData();
      expect(afterFailure?.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity']]);
      expect(afterFailure?.sheet_0.sourceData.nextRowId).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentData
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentData', () => {
    it('未初始化时返回 currentJsonTableData_ACU', () => {
      mockCurrentJsonTableData = { test: true };
      const result = service.getCurrentData();
      expect(result).toEqual({ test: true });
    });

    it('初始化后返回导出的数据', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      const result = service.getCurrentData();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('sheet_0');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // clearRuntimeData
  // ═══════════════════════════════════════════════════════════════
  describe('clearRuntimeData', () => {
    it('释放已初始化引擎并清空 JSON 视图', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.clearRuntimeData();
      expect(service.isReady()).toBe(false);
      expect(service.getCurrentData()).toBeNull();
      expect(() => service.executeQuery('SELECT 1')).toThrow('SQLite 引擎未初始化');
      const replaced = await service.replaceAllData(JSON.parse(JSON.stringify(testTableData)));
      expect(replaced.success).toBe(true);
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT * FROM inventory').rowCount).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // saveToChat
  // ═══════════════════════════════════════════════════════════════
  describe('saveToChat', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('拒绝 provider 直接保存，要求走公共提交模型', async () => {
      const result = await service.saveToChat();
      expect(result.saved).toBe(false);
      expect(result.error).toContain('table update commit model');
      expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // dispose
  // ═══════════════════════════════════════════════════════════════
  describe('dispose', () => {
    it('销毁后无法执行查询', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.dispose();
      expect(() => service.executeQuery('SELECT 1')).toThrow();
    });

    it('多次 dispose 不抛出', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });
  });
});

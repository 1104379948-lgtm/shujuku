/**
 * tests/service/ai/prompt-prepare.test.ts
 * formatTableForSqliteMode 纯函数单元测试
 *
 * 策略：mock getEffectiveSeedRowsForSheet_ACU，直接测试格式化输出
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

const mockGetEffectiveSeedRows = vi.fn(() => []);
vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: (...args: any[]) => mockGetEffectiveSeedRows(...args),
  ensureChatSheetGuideSeeded_ACU: vi.fn().mockResolvedValue(null),
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  normalizeExtractRules_ACU: vi.fn(() => []),
  normalizeExcludeRules_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  manualExtraHint_ACU: '',
  currentJsonTableData_ACU: null,
  settings_ACU: {},
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getUserName_ACU: vi.fn(() => '用户'),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getCombinedWorldbookContent_ACU: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applyContextTagFilters_ACU: vi.fn((c: string) => c),
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
}));

import { formatTableForSqliteMode } from '../../../src/service/ai/prompt-builder/prompt-prepare';

describe('formatTableForSqliteMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveSeedRows.mockReturnValue([]);
  });

  // ═══════════════════════════════════════════════════════════════
  // DDL 输出
  // ═══════════════════════════════════════════════════════════════
  it('输出 DDL', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER);',
        note: '',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
      },
      content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('CREATE TABLE inventory');
  });

  // ═══════════════════════════════════════════════════════════════
  // Note 和 Trigger 注释
  // ═══════════════════════════════════════════════════════════════
  it('输出 Note 注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '记录角色背包中的物品',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- Note: 记录角色背包中的物品');
  });

  it('输出 INSERT/UPDATE/DELETE Trigger 注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '',
        insertNode: '获得新物品时插入',
        updateNode: '物品数量变化时更新',
        deleteNode: '丢弃物品时删除',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- INSERT: 获得新物品时插入');
    expect(result).toContain('-- UPDATE: 物品数量变化时更新');
    expect(result).toContain('-- DELETE: 丢弃物品时删除');
  });

  // ═══════════════════════════════════════════════════════════════
  // 数据输出
  // ═══════════════════════════════════════════════════════════════
  it('输出当前数据（注释格式的表格）', () => {
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
      content: [['row_id', 'item_name'], ['1', '铁剑'], ['2', '药水']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- 当前数据 (2 rows)');
    expect(result).toContain('-- | row_id | item_name |');
    expect(result).toContain('-- | 1 | 铁剑 |');
    expect(result).toContain('-- | 2 | 药水 |');
  });

  // ═══════════════════════════════════════════════════════════════
  // 空表
  // ═══════════════════════════════════════════════════════════════
  it('空表输出初始化提示', () => {
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);' },
      content: [['row_id']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('该表格为空，请进行初始化');
  });

  // ═══════════════════════════════════════════════════════════════
  // seedRows
  // ═══════════════════════════════════════════════════════════════
  it('使用 seedRows 时输出提示', () => {
    mockGetEffectiveSeedRows.mockReturnValue([['1', '铁剑'], ['2', '药水']]);
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
      content: [['row_id', 'item_name']], // 无数据行
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('SeedRows');
    expect(result).toContain('-- 当前数据 (2 rows)');
  });

  // ═══════════════════════════════════════════════════════════════
  // 行数限制
  // ═══════════════════════════════════════════════════════════════
  it('总结表超过10行时只显示最后10行', () => {
    const rows: any[][] = [['row_id', 'content']];
    for (let i = 1; i <= 15; i++) {
      rows.push([String(i), `内容${i}`]);
    }
    const table = {
      name: '总结表',
      sourceData: { ddl: 'CREATE TABLE summary (row_id INTEGER PRIMARY KEY, content TEXT);' },
      content: rows,
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('Showing last 10 of 15');
  });

  it('sendLatestRows 限制行数', () => {
    const rows: any[][] = [['row_id', 'item']];
    for (let i = 1; i <= 20; i++) {
      rows.push([String(i), `物品${i}`]);
    }
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
      content: rows,
      updateConfig: { sendLatestRows: 5 },
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('Showing last 5 of 20');
  });

  // ═══════════════════════════════════════════════════════════════
  // 多行 Note
  // ═══════════════════════════════════════════════════════════════
  it('多行 Note 正确转为注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '第一行说明\n第二行说明',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- Note: 第一行说明\n-- 第二行说明');
  });
});

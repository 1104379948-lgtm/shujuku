/**
 * tests/service/ai/table-edit-parser.test.ts
 * AI 响应表格编辑解析器单元测试
 *
 * 策略：
 * - extractTableEditInner_ACU 是纯函数（只依赖 settings_ACU），mock settings 后直接测试
 * - isSqlContent 是纯函数，直接测试
 * - parseAndApplyTableEdits_ACU 的 SQL 分支通过 mock isSqliteMode + getStorageProvider 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

let mockSettings: any = { tableEditLastPairOnly: false };
let mockCurrentJsonTableData: any = null;

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

let mockIsSqliteMode = false;
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const mockApplyEdits = vi.fn().mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 });
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({
    applyEdits: mockApplyEdits,
  })),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  formatSummaryIndexCode_ACU: vi.fn(() => '001'),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set(), cols: new Set(), cells: new Set() })),
}));

vi.mock('../../../src/service/ai/prompt-builder/json-sanitizer', () => ({
  sanitizeJsonPipeline_ACU: vi.fn(() => ({ success: false, result: '', layersApplied: [], error: 'mock' })),
  coerceLooseRowObject_ACU: vi.fn(() => ({ success: false, error: 'mock' })),
}));

import {
  extractTableEditInner_ACU,
  parseAndApplyTableEdits_ACU,
  parseAndApplyTableEditsToData_ACU,
  isSqlContent,
} from '../../../src/service/ai/prompt-builder/table-edit-parser';

// ═══════════════════════════════════════════════════════════════
// isSqlContent
// ═══════════════════════════════════════════════════════════════
describe('isSqlContent', () => {
  it('INSERT 开头返回 true', () => {
    expect(isSqlContent("INSERT INTO inventory VALUES (1, '铁剑', 3);")).toBe(true);
  });

  it('UPDATE 开头返回 true', () => {
    expect(isSqlContent('UPDATE inventory SET quantity = 5 WHERE row_id = 1;')).toBe(true);
  });

  it('DELETE 开头返回 true', () => {
    expect(isSqlContent('DELETE FROM inventory WHERE row_id = 1;')).toBe(true);
  });

  it('ALTER 开头返回 true', () => {
    expect(isSqlContent('ALTER TABLE inventory ADD COLUMN desc TEXT;')).toBe(true);
  });

  it('BEGIN 开头返回 true', () => {
    expect(isSqlContent('BEGIN TRANSACTION;')).toBe(true);
  });

  it('CREATE 开头返回 true', () => {
    expect(isSqlContent('CREATE TABLE new_table (id INTEGER);')).toBe(true);
  });

  it('DROP 开头返回 true', () => {
    expect(isSqlContent('DROP TABLE old_table;')).toBe(true);
  });

  it('REPLACE 开头返回 true', () => {
    expect(isSqlContent("REPLACE INTO inventory VALUES (1, '铁剑', 3);")).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isSqlContent("insert into inventory values (1, '铁剑', 3);")).toBe(true);
  });

  it('跳过空行后检测', () => {
    expect(isSqlContent("\n\n  INSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('跳过 SQL 注释行后检测', () => {
    expect(isSqlContent("-- 这是注释\nINSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('跳过 HTML 注释残留后检测', () => {
    expect(isSqlContent("<!--\n-->\nINSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('insertRow 指令不是 SQL', () => {
    expect(isSqlContent("insertRow(0, {0: '铁剑', 1: '3'})")).toBe(false);
  });

  it('updateRow 指令不是 SQL', () => {
    expect(isSqlContent("updateRow(0, 1, {0: '铁剑'})")).toBe(false);
  });

  it('deleteRow 指令不是 SQL', () => {
    expect(isSqlContent('deleteRow(0, 1)')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isSqlContent('')).toBe(false);
  });

  it('纯注释返回 false', () => {
    expect(isSqlContent('-- 只有注释\n-- 没有语句')).toBe(false);
  });

  it('纯空白返回 false', () => {
    expect(isSqlContent('   \n\t  ')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// extractTableEditInner_ACU
// ═══════════════════════════════════════════════════════════════
describe('extractTableEditInner_ACU', () => {
  beforeEach(() => {
    mockSettings = { tableEditLastPairOnly: false };
  });

  it('提取完整 <tableEdit> 标签内容', () => {
    const text = '一些文字 <tableEdit>insertRow(0, {0: "铁剑"})</tableEdit> 更多文字';
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
    expect(result!.inner).toBe('insertRow(0, {0: "铁剑"})');
    expect(result!.mode).toBe('full');
  });

  it('大小写不敏感', () => {
    const text = '<TABLEEDIT>insertRow(0, {})</TABLEEDIT>';
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
    expect(result!.inner).toContain('insertRow');
  });

  it('useLastPairOnly 模式取最后一对', () => {
    mockSettings = { tableEditLastPairOnly: true };
    const text = '<tableEdit>第一个</tableEdit> 中间文字 <tableEdit>第二个</tableEdit>';
    const result = extractTableEditInner_ACU(text, { useLastPairOnly: true });
    expect(result).not.toBeNull();
    expect(result!.inner).toBe('第二个');
    expect(result!.mode).toBe('full_last');
  });

  it('HTML 注释中的指令（comment_fallback）', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('comment_fallback');
  });

  it('只有开标签时从注释中提取', () => {
    const text = '<tableEdit> <!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.hasOpen).toBe(true);
  });

  it('只有闭标签时从注释中提取', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) --> </tableEdit>';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.hasClose).toBe(true);
  });

  it('空字符串返回 null', () => {
    expect(extractTableEditInner_ACU('')).toBeNull();
  });

  it('无任何指令返回 null', () => {
    expect(extractTableEditInner_ACU('这是一段普通文字，没有任何指令')).toBeNull();
  });

  it('allowNoTableEditTags=false 且无标签时返回 null', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: false });
    expect(result).toBeNull();
  });

  it('处理 AI 响应中的转义字符', () => {
    const text = "'<tableEdit>insertRow(0, {0: \"铁剑\"})</tableEdit>'";
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
  });

  it('处理字符串拼接残留', () => {
    const text = "' + '<tableEdit>insertRow(0, {})</tableEdit>' + '";
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
  });
});

describe('strict JSON parseAndApplyTableEditsToData_ACU', () => {
  beforeEach(() => {
    mockSettings = { tableEditLastPairOnly: false, strictJsonTableFillEnabled: true };
    mockIsSqliteMode = false;
  });

  it('直接解析并应用 table_edit_ops_v1', () => {
    const data = {
      sheet_0: {
        uid: 'sheet_0',
        name: '角色状态',
        content: [
          ['row_id', '姓名', '状态'],
          ['1', '小玉', '正常'],
        ],
      },
    };
    const response = JSON.stringify({
      format: 'table_edit_ops_v1',
      ops: [{ op: 'update', sheet: '角色状态', where: { 姓名: '小玉' }, set: { 状态: '疲惫' } }],
    });
    const result: any = parseAndApplyTableEditsToData_ACU(response, data);
    expect(result.success).toBe(true);
    expect(data.sheet_0.content[1][2]).toBe('疲惫');
  });

  it('strict 开启时 legacy 裸响应解析失败', () => {
    const data = { sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '字段']] } };
    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow(0,{"0":"x"})</tableEdit>', data);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseAndApplyTableEdits_ACU — SQL 分支
// ═══════════════════════════════════════════════════════════════
describe('parseAndApplyTableEdits_ACU — SQL 分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = true;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
        updateConfig: {},
      },
    };
  });

  it('SQLite 模式下 SQL 内容不能由解析器直接执行', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('SQLite 模式下非 SQL 内容走原生解析路径', () => {
    const aiResponse = "<tableEdit>insertRow(0, {0: '药水', 1: '5'})</tableEdit>";
    mockApplyEdits.mockClear();

    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 非 SQL 内容不应调用 provider.applyEdits
    expect(mockApplyEdits).not.toHaveBeenCalled();
    // 应该走原生解析路径
    expect(result).toHaveProperty('success');
  });

  it('非 SQLite 模式下 SQL 内容走原生解析路径', () => {
    mockIsSqliteMode = false;
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockClear();

    parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('SQLite SQL 内容在解析器阶段直接拒绝，不调用 provider', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockImplementation(() => { throw new Error('SQL 语法错误'); });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('currentJsonTableData 为 null 时返回 false', () => {
    mockCurrentJsonTableData = null;
    const result = parseAndApplyTableEdits_ACU("<tableEdit>INSERT INTO t VALUES (1);</tableEdit>");
    expect(result).toBe(false);
  });

  it('空 <tableEdit> 块返回 true', () => {
    const result = parseAndApplyTableEdits_ACU('<tableEdit></tableEdit>');
    expect(result).toBe(true);
  });

  it('SQLite SQL 内容不会把 updateMode 传给 provider 直写', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockReturnValue({ success: true, modifiedKeys: [], appliedEdits: 1 });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'auto_standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// parseAndApplyTableEdits_ACU — DSL 分支（insertRow/updateRow/deleteRow）
// ═══════════════════════════════════════════════════════════════
describe('parseAndApplyTableEdits_ACU — DSL 分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        content: [
          ['row_id', 'item_name', 'quantity'],
          ['1', '铁剑', '3'],
          ['2', '药水', '5'],
        ],
        updateConfig: {},
      },
    };
  });

  it('insertRow 指令正确插入新行', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "盾牌", "1": "1"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // 验证表格数据被修改（新行被插入）
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4); // 表头 + 原2行 + 新1行
  });

  it('删除中间行后插入使用删除前高水位，并保留 0 和 false 单元格', () => {
    mockCurrentJsonTableData.sheet_0.content = [
      ['row_id', 'item_name', 'quantity'],
      ['1', '铁剑', '3'],
      ['2', '药水', '5'],
      ['3', '盾牌', '1'],
    ];

    const result = parseAndApplyTableEdits_ACU(
      '<tableEdit>deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})</tableEdit>',
      'standard',
    );

    expect(result).toHaveProperty('success');
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'quantity'],
      ['1', '铁剑', '3'],
      ['3', '盾牌', '1'],
      ['4', 0, false],
    ]);
    expect(mockCurrentJsonTableData.sheet_0.sourceData.nextRowId).toBe(5);
  });

  it('insertRow 指令中的 URL 不会被行尾注释逻辑截断', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "https://example.com/a//b?x=1#hash", "1": "1"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4);
    expect(content[3][1]).toBe('https://example.com/a//b?x=1#hash');
  });

  it('命令闭合后的真实行尾注释会被剥离且不影响 URL 字符串值', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "https://example.com/a//b", "1": "2"}) // 模型追加说明</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4);
    expect(content[3][1]).toBe('https://example.com/a//b');
    expect(content[3][2]).toBe('2');
  });

  it('deleteRow 指令正确删除行', () => {
    const aiResponse = '<tableEdit>deleteRow(0, 1)</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // 验证行被删除
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(2); // 表头 + 剩余1行
  });

  it('updateRow 指令正确更新行', () => {
    const aiResponse = '<tableEdit>updateRow(0, 1, {"1": "10"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // updateRow(0, 1, {"1": "10"}) → content[rowIndex+1][colIndex+1] = content[2][2]
    // rowIndex=1 对应第2行数据行（content[2]），colIndex=1 对应第2列数据列（content[][2]）
    expect(mockCurrentJsonTableData.sheet_0.content[2][2]).toBe('10');
  });

  it('多条指令按顺序执行', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "盾牌", "1": "1"})\ninsertRow(0, {"0": "头盔", "1": "2"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(5); // 表头 + 原2行 + 新2行
  });

  it('无法识别的指令不报错', () => {
    const aiResponse = '<tableEdit>unknownCommand(0, 1)</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 无法识别的指令应被跳过，不影响整体结果
    expect(result).toHaveProperty('success');
  });

  it('非 SQLite 模式下 SQL 内容走 DSL 解析路径', () => {
    mockIsSqliteMode = false;
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockClear();
    parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 非 SQLite 模式不应调用 provider.applyEdits
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });
});

describe('parseAndApplyTableEditsToData_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '全局表',
        content: [
          ['row_id', 'item_name', 'quantity'],
          ['1', '全局铁剑', '3'],
        ],
        updateConfig: {},
      },
    };
  });

  it('显式 tableData 修改只作用于传入对象，不污染全局 currentJsonTableData_ACU', () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'item_name', 'quantity'], ['1', '显式铁剑', '3']],
        updateConfig: {},
      },
    };

    const result = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow(0, {"0": "显式药水", "1": "5"})</tableEdit>', explicitTableData, 'standard');
    expect(result).toHaveProperty('success');
    expect(explicitTableData.sheet_0.content).toHaveLength(3);
    expect(explicitTableData.sheet_0.content[2][1]).toBe('显式药水');
    expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(2);
    expect(mockCurrentJsonTableData.sheet_0.content[1][1]).toBe('全局铁剑');
  });

  it('与 V2 replay DSL 对同一删除和连续插入序列产生完全一致的 content', async () => {
    const parserData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '显式表', updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0,
        content: [['row_id', 'item_name', 'enabled'], ['1', '铁剑', true], ['3', '药水', true], ['alpha', '护符', true]],
      },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const text = '<tableEdit>deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})</tableEdit>';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult = parseAndApplyTableEditsToData_ACU(text, parserData, 'standard');
    await applyTableOperationV2_ACU(replayData, {
      kind: 'table_edit_dsl',
      text: 'deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})',
    } as any);

    expect(parserResult).toHaveProperty('success');
    expect(parserData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'enabled'],
      ['1', '铁剑', true],
      ['alpha', '护符', true],
      ['4', 0, false],
      ['5', '卷轴', true],
    ]);
    expect(parserData.sheet_0.sourceData.nextRowId).toBe(6);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
    expect(replayData.sheet_0.sourceData.nextRowId).toBe(6);
  });

  it('与 V2 replay DSL 对 header-only seedRows 的删除、更新和插入产生完全一致的 content', async () => {
    const parserData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0', name: '带预置行的表', updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0,
        content: [['row_id', 'item_name', 'enabled']],
        seedRows: [['1', '铁剑', true], ['3', '药水', true]],
      },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const text = '<tableEdit>deleteRow(0, 1)\nupdateRow(0, 0, {"0": "钢剑", "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})</tableEdit>';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult = parseAndApplyTableEditsToData_ACU(text, parserData, 'standard');
    await applyTableOperationV2_ACU(replayData, {
      kind: 'table_edit_dsl',
      text: 'deleteRow(0, 1)\nupdateRow(0, 0, {"0": "钢剑", "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})',
    } as any);

    expect(parserResult).toHaveProperty('success');
    expect(parserData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'enabled'],
      ['1', '钢剑', false],
      ['4', '卷轴', true],
    ]);
    expect(parserData.sheet_0.sourceData.nextRowId).toBe(5);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
    expect(replayData.sheet_0.sourceData.nextRowId).toBe(5);
  });

  it('支持通过 uid、DDL 物理表名、sheetKey 和显示名定位当前快照内的表格', () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: {
        uid: 'inventory', name: '背包', content: [['row_id', '物品'], ['1', '铁剑']],
        sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
      sheet_state: {
        uid: 'state_uid', name: '全局数据表', content: [['row_id', '地点'], ['1', '起点']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, location TEXT);' }, updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;

    const result: any = parseAndApplyTableEditsToData_ACU(
      '<tableEdit>insertRow("inventory", {"0":"药水"})\nupdateRow("global_state", 0, {"0":"城镇"})\nupdateRow("sheet_inventory", 0, {"0":"钢剑"})\ninsertRow("全局数据表", {"0":"终点"})</tableEdit>',
      data,
      'full',
    );

    expect(result).toMatchObject({ success: true, appliedEdits: 4, modifiedKeys: expect.arrayContaining(['sheet_inventory', 'sheet_state']) });
    expect(data.sheet_inventory.content).toEqual([['row_id', '物品'], ['1', '钢剑'], ['2', '药水']]);
    expect(data.sheet_state.content).toEqual([['row_id', '地点'], ['1', '城镇'], ['2', '终点']]);
  });

  it('未知或歧义表目标会失败且不提交同批次已应用的修改', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '物品'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'inventory_2', name: '背包', content: [['row_id', '物品'], ['1', '药水']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU(
      '<tableEdit>insertRow("inventory", {"0":"卷轴"})\nupdateRow("背包", 0, {"0":"不应写入"})\ninsertRow("index_options", {"0":"也不应写入"})</tableEdit>',
      data,
      'full',
    );

    expect(result.success).toBe(false);
    expect(result.appliedEdits).toBe(0);
    expect(result.error).toContain('ambiguous_table_target');
    expect(result.error).toContain('missing_table_target');
    expect(data).toEqual(before);
  });

  it('目标行不存在时失败且不修改当前快照', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '物品'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>updateRow("inventory", 9, {"0":"药水"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain('invalid_row_target');
    expect(data.sheet_0.content).toEqual([['row_id', '物品'], ['1', '铁剑']]);
  });

  it('字符串数字索引按 snapshot orderNo 解析且不依赖对象键顺序', () => {
    const data = {
      sheet_late: { uid: 'late', name: '后表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
      sheet_early: { uid: 'early', name: '前表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow("0", {"0":"命中前表"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: true, appliedEdits: 1, modifiedKeys: ['sheet_early'] });
    expect(data.sheet_early.content[1]).toEqual(['1', '命中前表']);
    expect(data.sheet_late.content).toEqual([['row_id', '值']]);
  });

  it('重复显示名下通过唯一 uid 修改时按 canonical sheetKey 记录统计', () => {
    const data = {
      sheet_a: { uid: 'first', name: '重复名', content: [['row_id', '值'], ['1', 'A']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_b: { uid: 'second', name: '重复名', content: [['row_id', '值'], ['1', 'B']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>updateRow("second", 0, {"0":"B2"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: true, appliedEdits: 1, modifiedKeys: ['sheet_b'] });
    expect(data.sheet_a).not.toHaveProperty('_lastUpdateStats');
    expect(data.sheet_b._lastUpdateStats.changes).toBe(1);
    expect(data.sheet_b.content[1]).toEqual(['1', 'B2']);
  });

  it.each([
    ['负数行号', '<tableEdit>deleteRow("inventory", -1)</tableEdit>', 'invalid_row_target'],
    ['小数行号', '<tableEdit>updateRow("inventory", 0.5, {"0":"坏值"})</tableEdit>', 'invalid_row_target'],
    ['空更新数据', '<tableEdit>updateRow("inventory", 0, null)</tableEdit>', 'invalid_row_data'],
  ])('%s 会 fail-closed 且不修改表头或数据', (_name, response, errorCode) => {
    const data = {
      sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '物品'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU(response, data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain(errorCode);
    expect(data).toEqual(before);
  });

  it('目标表结构无效时返回 invalid_table_structure 而不是伪成功', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '背包', sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow("inventory", {"0":"药水"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain('invalid_table_structure');
    expect(data).toEqual(before);
  });

  it('parser 与 replay 只物化 snapshot 自带 seedRows，不读取外部模板诱饵', async () => {
    const { getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockReturnValue([['99', '外部诱饵']] as any);
    const parserData = {
      sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult: any = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow(0, {"0":"canonical"})</tableEdit>', parserData, 'full');
    await applyTableOperationV2_ACU(replayData, { kind: 'table_edit_dsl', text: 'insertRow(0, {"0":"canonical"})' } as any);

    expect(parserResult).toMatchObject({ success: true, appliedEdits: 1 });
    expect(parserData.sheet_0.content).toEqual([['row_id', '值'], ['1', 'canonical']]);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
    expect(getEffectiveSeedRowsForSheet_ACU).not.toHaveBeenCalled();
  });

  it('parser 与 replay 对非法列键使用同一严格规则', async () => {
    const parserData = {
      sheet_0: { uid: 'inventory', name: '表', content: [['row_id', '值A', '值B'], ['1', 'A', 'B']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const parserBefore = JSON.parse(JSON.stringify(parserData));
    const replayBefore = JSON.parse(JSON.stringify(replayData));
    const text = 'updateRow(0, 0, {"0":"A2","1x":"不应写入","01":"也不应写入"})';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult: any = parseAndApplyTableEditsToData_ACU(`<tableEdit>${text}</tableEdit>`, parserData, 'full');
    await expect(applyTableOperationV2_ACU(replayData, { kind: 'table_edit_dsl', text } as any)).rejects.toThrow('invalid_column_target');

    expect(parserResult).toMatchObject({ success: false, appliedEdits: 0 });
    expect(parserResult.error).toContain('invalid_column_target');
    expect(parserData).toEqual(parserBefore);
    expect(replayData).toEqual(replayBefore);
  });

  it('updateRow 目标数据行不是数组时 fail-closed 且不伪计数', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '表', content: [['row_id', '值'], { bad: true }], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>updateRow(0, 0, {"0":"x"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain('invalid_table_structure');
    expect(data).toEqual(before);
  });

  it.each([
    ['空 update 对象', 'updateRow(0, 0, {})', 'invalid_row_data'],
    ['insertRow 非规范列键', 'insertRow(0, {"01":"x"})', 'invalid_column_target'],
    ['insertRow 越界列键', 'insertRow(0, {"1":"x"})', 'invalid_column_target'],
    ['updateRow 越界列键', 'updateRow(0, 0, {"1":"x"})', 'invalid_column_target'],
  ])('%s 会整批失败且不提交修改', (_name, command, errorCode) => {
    const data = {
      sheet_0: { uid: 'inventory', name: '表', content: [['row_id', '值'], ['1', 'A']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU(`<tableEdit>${command}</tableEdit>`, data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain(errorCode);
    expect(data).toEqual(before);
  });

  it('deleteRow 目标业务行不是数组时返回 invalid_table_structure', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '表', content: [['row_id', '值'], { bad: true }], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = JSON.parse(JSON.stringify(data));

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>deleteRow(0, 0)</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain('invalid_table_structure');
    expect(data).toEqual(before);
  });

  it.each([
    'CREATE TABLE "inventory" (row_id INTEGER PRIMARY KEY, value TEXT);',
    'CREATE TABLE `inventory` (row_id INTEGER PRIMARY KEY, value TEXT);',
    'CREATE TABLE [inventory] (row_id INTEGER PRIMARY KEY, value TEXT);',
  ])('普通目标名可命中 quoted DDL identifier: %s', ddl => {
    const data = {
      sheet_0: { uid: '_uid', name: '不同名称', content: [['row_id', '值'], ['1', 'A']], sourceData: { ddl }, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>updateRow("inventory", 0, {"0":"B"})</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: true, appliedEdits: 1, modifiedKeys: ['sheet_0'] });
    expect(data.sheet_0.content[1]).toEqual(['1', 'B']);
  });

  it('说明文字前缀与无分号多命令在 parser 和 replay 中保持一致', async () => {
    const parserData = {
      sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '值'], ['1', 'A']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const replayData = structuredClone(parserData);
    const text = '说明文字 updateRow(0, 0, {"0":"B(北区)"}) insertRow(0, {"0":"C"})';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult: any = parseAndApplyTableEditsToData_ACU(`<tableEdit>${text}</tableEdit>`, parserData, 'full');
    await applyTableOperationV2_ACU(replayData, { kind: 'table_edit_dsl', text } as any);

    expect(parserResult).toMatchObject({ success: true, appliedEdits: 2, modifiedKeys: ['sheet_0'] });
    expect(parserData.sheet_0.content).toEqual([['row_id', '值'], ['1', 'B(北区)'], ['2', 'C']]);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
    expect(replayData.sheet_0.sourceData.nextRowId).toBe(parserData.sheet_0.sourceData.nextRowId);
  });

  it('仅有说明文字但没有 DSL 指令时返回 malformed_command', () => {
    const data = {
      sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '值'], ['1', 'A']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const before = structuredClone(data);

    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>这里只是说明文字</tableEdit>', data, 'full');

    expect(result).toMatchObject({ success: false, appliedEdits: 0 });
    expect(result.error).toContain('malformed_command');
    expect(data).toEqual(before);
  });





});

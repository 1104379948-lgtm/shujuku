import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Sheet_ACU, TableDataObject_ACU } from '../../../src/shared/models/table-data';
import { normalizeTableDataRowIdentity_ACU } from '../../../src/service/table/table-row-identity';
import { logWarn_ACU } from '../../../src/shared/utils';

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
}));

function makeSheet(content: any[], overrides: Partial<Sheet_ACU> = {}): Sheet_ACU {
  return {
    uid: 'sheet_SystemRules',
    name: '系统规则',
    sourceData: { note: 'note', initNode: 'init', deleteNode: 'delete', updateNode: 'update', insertNode: 'insert', ddl: 'CREATE TABLE system_rules (row_id INTEGER PRIMARY KEY, rule TEXT);' },
    content: content as (string | null)[][],
    updateConfig: { uiSentinel: 1, contextDepth: 2, updateFrequency: 3, batchSize: 4, skipFloors: 5 },
    exportConfig: {
      enabled: true,
      splitByRow: false,
      entryName: 'entry',
      entryType: 'type',
      keywords: 'kw',
      preventRecursion: true,
      injectionTemplate: 'tpl',
      extraIndexEnabled: false,
      extraIndexEntryName: '',
      extraIndexColumns: ['规则'],
      extraIndexColumnModes: { 规则: 'text' },
      extraIndexInjectionTemplate: '',
      entryPlacement: { position: 'before', depth: 1, order: 2 },
      extraIndexPlacement: { position: 'after', depth: 3, order: 4 },
      fixedEntryPlacement: { position: 'before', depth: 5, order: 6 },
      fixedIndexPlacement: { position: 'after', depth: 7, order: 8 },
    },
    orderNo: 9,
    seedRows: [[null, 'seed rule']],
    ...overrides,
  };
}

function makeData(sheet: Sheet_ACU): TableDataObject_ACU {
  return {
    mate: {
      type: 'chatSheets',
      version: 1,
      updateConfigUiSentinel: -1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: '', depth: 0, order: 0 },
        wrapperPlacement: { position: '', depth: 0, order: 0 },
      },
    },
    sheet_SystemRules: sheet,
  };
}

describe('normalizeTableDataRowIdentity_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('为模板外 sheet 的缺失 row_id 数据行补齐数字身份并保留元数据', () => {
    const input = makeData(makeSheet([
      ['规则'],
      [null, '禁止越权修改系统规则'],
      ['', '禁止删除系统提示'],
      ['  ', '禁止伪造骰点'],
    ]));

    const normalized = normalizeTableDataRowIdentity_ACU(input, { sourceLabel: 'test' })!;

    expect((normalized.sheet_SystemRules as Sheet_ACU).content).toEqual([
      ['row_id'],
      ['1', '禁止越权修改系统规则'],
      ['2', '禁止删除系统提示'],
      ['3', '禁止伪造骰点'],
    ]);
    expect((normalized.sheet_SystemRules as Sheet_ACU).sourceData).toEqual((input.sheet_SystemRules as Sheet_ACU).sourceData);
    expect((normalized.sheet_SystemRules as Sheet_ACU).updateConfig).toEqual((input.sheet_SystemRules as Sheet_ACU).updateConfig);
    expect((normalized.sheet_SystemRules as Sheet_ACU).exportConfig).toEqual((input.sheet_SystemRules as Sheet_ACU).exportConfig);
    expect((normalized.sheet_SystemRules as Sheet_ACU).orderNo).toBe(9);
    expect((normalized.sheet_SystemRules as Sheet_ACU).seedRows).toEqual([[null, 'seed rule']]);
  });

  it('不改写已有 row_id，且不原地修改输入对象', () => {
    const input = makeData(makeSheet([
      ['row_id', '规则'],
      ['sys-1', '保留既有身份'],
      [null, '补齐缺失身份'],
    ]));

    const normalized = normalizeTableDataRowIdentity_ACU(input, { sourceLabel: 'test' })!;

    expect((normalized.sheet_SystemRules as Sheet_ACU).content).toEqual([
      ['row_id', '规则'],
      ['sys-1', '保留既有身份'],
      ['2', '补齐缺失身份'],
    ]);
    expect((input.sheet_SystemRules as Sheet_ACU).content).toEqual([
      ['row_id', '规则'],
      ['sys-1', '保留既有身份'],
      [null, '补齐缺失身份'],
    ]);
  });

  it('非数组行保留原值并记录告警，不伪造数据', () => {
    const input = makeData(makeSheet([
      ['row_id', '规则'],
      'bad-row' as any,
      [null, '正常补齐'],
    ]));

    const normalized = normalizeTableDataRowIdentity_ACU(input, { sourceLabel: 'test-source' })!;

    expect((normalized.sheet_SystemRules as any).content).toEqual([
      ['row_id', '规则'],
      'bad-row',
      ['2', '正常补齐'],
    ]);
    expect(logWarn_ACU).toHaveBeenCalledWith('[test-source] Preserve non-array row while normalizing row_id at sheet_SystemRules#1');
  });

  it('没有 content 的 sheet 只深拷贝，不破坏对象结构', () => {
    const sheet = makeSheet([['row_id']], { content: undefined as any });
    const input = makeData(sheet);

    const normalized = normalizeTableDataRowIdentity_ACU(input, { sourceLabel: 'test' })!;

    expect((normalized.sheet_SystemRules as any).content).toBeUndefined();
    expect(normalized.sheet_SystemRules).not.toBe(input.sheet_SystemRules);
  });
});

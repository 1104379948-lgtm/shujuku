import { describe, expect, it } from 'vitest';
import { reconcileChatTemplate_ACU } from '../../../src/service/template/chat-template-reconciler';

function sheet(key: string, name: string, headers: string[], ddlColumns: string, rows: Array<Array<string | null>> = [['1', '铁剑']]): any {
  return {
    uid: key, name, orderNo: 0, content: [headers, ...rows],
    sourceData: { ddl: `CREATE TABLE inventory (\n  ${ddlColumns.replace(/ -- ([^,\n]+), /g, ', -- $1\n  ')}\n);` }, updateConfig: {}, exportConfig: {},
  };
}

function state(sheets: Record<string, any>): any {
  return { mate: { type: 'chatSheets', version: 1 }, ...sheets };
}

describe('reconcileChatTemplate_ACU', () => {
  it('按 canonical 表名复用旧 key，按 canonical 列名继承数据并为空新增列生成 V2 contract', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', ' 背包 ', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质'),
    });
    const original = structuredClone({ baseline, template });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.uid).toBe('sheet_legacy');
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
    expect(plan.candidateData.sheet_imported).toBeUndefined();
    expect(plan.sheetChanges).toEqual([expect.objectContaining({
      kind: 'operations', sheetKey: 'sheet_legacy', operations: expect.arrayContaining([expect.objectContaining({ contractVersion: 2, fills: expect.objectContaining({ quality: expect.objectContaining({ kind: 'literal' }) }) })]),
    })]);
    expect({ baseline, template }).toEqual(original);
  });

  it('新增表只产生 header-only introduction，旧表删除需要确认', async () => {
    const baseline = state({ sheet_old: sheet('sheet_old', '旧表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const template = state({ sheet_new: sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', [['9', '示例']]) });

    const rejected = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });
    expect(rejected.blockers.join('\n')).toContain('删除表');
    expect(rejected.sheetChanges).toEqual([]);

    const accepted = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });
    expect(accepted.blockers).toEqual([]);
    expect(accepted.deletedSheetKeys).toEqual(['sheet_old']);
    expect(accepted.candidateData.sheet_new.content).toEqual([['row_id', 'value']]);
    expect(accepted.sheetChanges).toEqual([expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_new' })]);
  });

  it('删列和新增 NOT NULL 无 literal default 时 fail closed', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称', '备注'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称, note TEXT -- 备注', [['1', '铁剑', '旧备注']]),
    });
    const dropTemplate = state({
      sheet_new: sheet('sheet_new', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称'),
    });
    const unconfirmed = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: dropTemplate, destructiveChangeConfirmed: false });
    expect(unconfirmed.blockers.join('\n')).toContain('删除列');

    const baselineWithoutDrop = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const requiredTemplate = state({
      sheet_new: sheet('sheet_new', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称, quality TEXT NOT NULL -- 品质'),
    });
    const invalidDefault = await reconcileChatTemplate_ACU({ baselineData: baselineWithoutDrop, templateData: requiredTemplate, destructiveChangeConfirmed: false });
    expect(invalidDefault.blockers.join('\n')).toContain('DEFAULT');
  });

  it('拒绝新表占用当前聊天已有不同表的 key', async () => {
    const baseline = state({ sheet_taken: sheet('sheet_taken', '旧表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const template = state({ sheet_taken: sheet('sheet_taken', '新表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });
    expect(plan.blockers.join('\n')).toContain('已被当前聊天占用');
  });

  it('以 V2 replay 作为 candidate 事实来源，BOOLEAN DEFAULT TRUE 使用 SQLite 单元格表示', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'equipped'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, equipped BOOLEAN NOT NULL DEFAULT TRUE'),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', 'item_name', 'equipped'], ['1', '铁剑', '1']]);
    expect((plan.sheetChanges[0] as any).targetSheetData.content).toEqual(plan.candidateData.sheet_legacy.content);
    expect(plan.audit[0]).toMatchObject({ affectedRowCount: 1, fills: [{ physicalName: 'equipped', kind: 'ddl_literal_default' }] });
  });

  it.each([
    { label: '非数组行', rows: [['1', '铁剑'], 'bad-row' as any], expected: '不是数组' },
    { label: '短行', rows: [['1']], expected: '宽度' },
    { label: '超宽行', rows: [['1', '铁剑', '多余']], expected: '宽度' },
    { label: '空 row_id', rows: [['', '铁剑']], expected: 'row_id 为空' },
    { label: '重复 row_id', rows: [['1', '铁剑'], ['1', '木剑']], expected: 'row_id 重复' },
  ])('历史基线存在$label时 fail closed', async ({ rows, expected }) => {
    const baseline = state({ sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称', rows as any) });
    const template = state({ sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称') });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain(expected);
    expect(plan.sheetChanges).toEqual([]);
  });

  it('删除列并新增不同 physical 列时保留继承列，并以 null 填充新列', async () => {
    const baseline = state({ sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', 'item_name', 'note'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, note TEXT', [['1', '铁剑', '旧备注']]) });
    const template = state({ sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []) });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', 'item_name', 'quality'], ['1', '铁剑', null]]);
    expect((plan.sheetChanges[0] as any).operations[0]).toMatchObject({
      contractVersion: 2,
      migrationPolicy: { destructiveChangeConfirmed: true },
      fills: { quality: { kind: 'literal' } },
    });
  });

  it('新增表 introduction 隔离模板 seedRows', async () => {
    const templateSheet = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', [['9', '示例']]);
    templateSheet.seedRows = [['9', 'seed']];
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_new).toMatchObject({ content: [['row_id', 'value']] });
    expect(plan.candidateData.sheet_new.seedRows).toBeUndefined();
  });

  it('拒绝 meta_update 无法表达的 sourceData 删除', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称');
    baselineSheet.sourceData.note = '旧说明';
    const templateSheet = sheet('sheet_imported', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称');
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_legacy: baselineSheet }), templateData: state({ sheet_imported: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('无法安全表达删除');
  });

  it('合法 physical rename 可与独立删除和新增列一起回放', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称', '备注'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  note TEXT -- 备注', [['1', '铁剑', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY,\n  item_title TEXT, -- 名称\n  quality TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
    expect((plan.sheetChanges[0] as any).operations[0].physicalColumnMappings).toEqual([{ fromPhysicalName: 'item_name', toPhysicalName: 'item_title' }]);
  });

  it('删列与新增列复用同一 physical 名称时仍 fail closed，不能把旧值改解释为新字段', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '备注'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 备注', [['1', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '品质'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers.join('\n')).toContain('无法安全重解释历史数据');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.deletedSheetKeys).toEqual([]);
  });

  it('匹配表的最终 replay candidate 不携带 baseline seedRows', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]);
    baselineSheet.seedRows = [['seed', '种子']];
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_legacy: baselineSheet }), templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.seedRows).toBeUndefined();
    expect((plan.sheetChanges[0] as any).targetSheetData.seedRows).toBeUndefined();
  });

  it('blocker 结果返回已剥离运行时字段的 baseline，而非半构造候选', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称', [['1'] as any]);
    baselineSheet.seedRows = [['seed', '种子']];
    const baseline = state({ sheet_legacy: baselineSheet });
    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: state({}), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('宽度');
    expect(plan.candidateData.sheet_legacy.content).toEqual(baselineSheet.content);
    expect(plan.candidateData.sheet_legacy.seedRows).toBeUndefined();
  });


  it('仅 introduction 的 DDL 与表头不一致时，完整 replay candidate hydrate 必须阻断', async () => {
    const invalidTemplate = sheet('sheet_new', '新表', ['row_id', '显示名称'], 'row_id INTEGER PRIMARY KEY, physical_name TEXT', []);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: invalidTemplate }), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('完整 replay candidate SQLite hydrate 失败');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.candidateData.sheet_new).toBeUndefined();
    expect(plan.audit.every(item => item.operations.length === 0)).toBe(true);
  });

  it('audit 与实际 change set 对账，包含 schema、metadata、introduction 和 delete 摘要', async () => {
    const baselineSheet = sheet('sheet_old', '旧表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    baselineSheet.sourceData.ddl = 'CREATE TABLE old_table (row_id INTEGER PRIMARY KEY, value TEXT);';
    const matchedBaseline = sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]);
    matchedBaseline.orderNo = 3;
    const templateMatched = sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []);
    templateMatched.orderNo = 4;
    const templateNew = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    templateNew.sourceData.ddl = 'CREATE TABLE new_table (row_id INTEGER PRIMARY KEY, value TEXT);';

    const plan = await reconcileChatTemplate_ACU({
      baselineData: state({ sheet_old: baselineSheet, sheet_legacy: matchedBaseline }),
      templateData: state({ sheet_imported: templateMatched, sheet_new: templateNew }),
      destructiveChangeConfirmed: true,
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_old).toBeUndefined();
    const matchedAudit = plan.audit.find(item => item.sheetKey === 'sheet_legacy');
    expect(matchedAudit).toMatchObject({
      baselineSheetKey: 'sheet_legacy', templateSheetKey: 'sheet_imported', canonicalName: '背包', metadataChangedFields: ['orderNo'],
    });
    expect(matchedAudit?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sheet_schema_migrate', contractVersion: 2 }),
      { kind: 'meta_update' },
    ]));
    expect(plan.audit.find(item => item.sheetKey === 'sheet_new')?.operations).toEqual([{ kind: 'introduction' }]);
    expect(plan.audit.find(item => item.sheetKey === 'sheet_old')?.operations).toEqual([{ kind: 'delete' }]);
  });


});

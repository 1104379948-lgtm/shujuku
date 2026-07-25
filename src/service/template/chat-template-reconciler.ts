import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { canonicalizeDisplayName_ACU } from '../../shared/sheet-identity';
import { getSheetColumnProjection_ACU, parseDDLColumnInfos_ACU, parseDDLTableConstraints_ACU, parseDDLTableName, parseDDLTableSuffix_ACU, parseDDLSafeDefaultLiteral_ACU, validateDDLTextAgainstHeaders_ACU } from '../../shared/ddl-utils';
import type { TemplateSheetChange_ACU } from '../table/storage-frame-v2-persist';
import { hydrateTableDataStrict_ACU } from '../table/sqlite-template-validation';

export interface ChatTemplateReconcileInput_ACU {
  baselineData: TableDataObject_ACU;
  templateData: TableDataObject_ACU;
  destructiveChangeConfirmed: boolean;
  /**
   * 目标模板缺失的既有表如何处理：
   * false（默认，语义1）= 隐藏保留（产出 hide change，数据不删）；
   * true = 彻底硬删除（进 deletedSheetKeys，需 destructiveChangeConfirmed）。
   */
  hardDeleteMissingSheets?: boolean;
}

export interface ChatTemplateReconcileAudit_ACU {
  sheetKey: string;
  match: 'matched' | 'introduced' | 'deleted';
  baselineSheetKey?: string;
  templateSheetKey?: string;
  baselineName?: string;
  templateName?: string;
  canonicalName?: string;
  inheritedColumns: string[];
  addedColumns: string[];
  deletedColumns: string[];
  hiddenColumns: string[];
  physicalColumnMappings: Array<{ fromPhysicalName: string; toPhysicalName: string }>;
  fills: Array<{ physicalName: string; kind: string; literal: unknown }>;
  affectedRowCount: number;
  metadataChanged: boolean;
  metadataChangedFields: string[];
  destructiveChangeConfirmed: boolean;
  operations: Array<{ kind: string; contractVersion?: number; beforeSchemaDigest?: string; targetSchemaDigest?: string }>;
}

export interface ChatTemplateReconcilePlan_ACU {
  candidateData: TableDataObject_ACU;
  sheetChanges: TemplateSheetChange_ACU[];
  deletedSheetKeys: string[];
  hiddenSheetKeys: string[];
  audit: ChatTemplateReconcileAudit_ACU[];
  blockers: string[];
}

/**
 * Builds a read-only V2 change plan. Runtime writes, guide persistence and locking remain
 * owned by commitCurrentFloorTemplateChanges_ACU; this function deliberately has no I/O.
 */
export async function reconcileChatTemplate_ACU(input: ChatTemplateReconcileInput_ACU): Promise<ChatTemplateReconcilePlan_ACU> {
  const baselineData = clone_ACU(input.baselineData);
  const templateData = clone_ACU(input.templateData);
  const blockers: string[] = [];
  const deletedSheetKeys: string[] = [];
  const hiddenSheetKeys: string[] = [];
  const audit: ChatTemplateReconcileAudit_ACU[] = [];
  const candidateData = stripRuntimeSeedRows_ACU(baselineData);
  candidateData.mate = clone_ACU(templateData.mate || baselineData.mate);
  for (const [key, sheet] of listSheets_ACU(templateData)) normalizeTemplateSheetRowIdColumn_ACU(sheet, key, blockers);
  if (blockers.length > 0) return emptyPlan_ACU(baselineData, audit, blockers);
  for (const [key, sheet] of listSheets_ACU(baselineData)) {
    try { validateBaselineSheetRows_ACU(sheet); } catch (error: any) { blockers.push(`当前聊天表「${sheet.name || key}」历史数据无效：${error?.message || String(error)}`); }
  }
  const baselineByName = indexSheetsByName_ACU(baselineData, '当前聊天', blockers);
  const templateByName = indexSheetsByName_ACU(templateData, '导入模板', blockers);
  if (blockers.length > 0) return emptyPlan_ACU(baselineData, audit, blockers);

  const matchedKeys = new Set<string>();
  const rebaseKeys = new Set<string>();
  for (const [canonicalName, templateEntry] of templateByName) {
    const matchedByName = baselineByName.get(canonicalName);
    const occupiedByKey = baselineData[templateEntry.key] as Sheet_ACU | undefined;
    if (matchedByName && occupiedByKey && matchedByName.key !== templateEntry.key) {
      blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」的名称匹配当前聊天 key「${matchedByName.key}」，但模板 key「${templateEntry.key}」已被表「${occupiedByKey.name || templateEntry.key}」占用，无法唯一协调。`);
      continue;
    }
    let previous = matchedByName;
    // 早期内置模板曾在保持稳定 key 的同时混用“主角信息”与“主角信息表”。
    // 兼容范围绑定已知稳定 key 与明确名称对，禁止把任意“名称/名称表”推断成同一张用户表。
    if (!previous && occupiedByKey && areLegacyEquivalentSheetNames_ACU(templateEntry.key, occupiedByKey.name, templateEntry.sheet.name)) {
      previous = { key: templateEntry.key, sheet: occupiedByKey };
    }
    if (!previous) {
      if (occupiedByKey) {
        blockers.push(`新增表「${templateEntry.sheet.name || templateEntry.key}」的 key「${templateEntry.key}」已被当前聊天占用。`);
        continue;
      }
      try {
        const introduced = asIntroducedSheet_ACU(templateEntry.sheet, templateEntry.key);
        candidateData[templateEntry.key] = introduced;
        audit.push({ sheetKey: templateEntry.key, match: 'introduced', templateSheetKey: templateEntry.key, templateName: templateEntry.sheet.name, canonicalName, inheritedColumns: [], addedColumns: headers_ACU(introduced).slice(1), deletedColumns: [], hiddenColumns: [], physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, introduced.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: false, operations: [] });
      } catch (error: any) {
        blockers.push(`新增表「${templateEntry.sheet.name || templateEntry.key}」(${templateEntry.key}) 无法引入：${error?.message || String(error)}`);
      }
      continue;
    }
    if (matchedKeys.has(previous.key)) {
      blockers.push(`导入模板中的多个表同时匹配当前聊天表「${previous.sheet.name || previous.key}」（key=${previous.key}），无法唯一协调。`);
      continue;
    }
    matchedKeys.add(previous.key);
    try {
      const reconciled = reconcileMatchedSheet_ACU(previous.sheet, templateEntry.sheet, previous.key, templateEntry.key);
      candidateData[previous.key] = reconciled.sheet;
      if (reconciled.changed) rebaseKeys.add(previous.key);
      audit.push(reconciled.audit);
    } catch (error: any) {
      blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」无法协调：${error?.message || String(error)}`);
    }
  }
  for (const [key, sheet] of listSheets_ACU(baselineData)) {
    if (matchedKeys.has(key)) continue;
    // 目标模板缺失的既有表：默认隐藏保留（语义1），仅在显式硬删除时才进 deletedSheetKeys。
    if (input.hardDeleteMissingSheets === true) {
      if (!input.destructiveChangeConfirmed) blockers.push(`删除表「${sheet.name || key}」需要显式确认。`);
      deletedSheetKeys.push(key);
      delete (candidateData as any)[key];
      audit.push({ sheetKey: key, match: 'deleted', baselineSheetKey: key, baselineName: sheet.name, canonicalName: canonicalizeDisplayName_ACU(sheet.name), inheritedColumns: [], addedColumns: [], deletedColumns: headers_ACU(sheet).slice(1), hiddenColumns: [], physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, sheet.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: input.destructiveChangeConfirmed, operations: [] });
    } else {
      hiddenSheetKeys.push(key);
      delete (candidateData as any)[key];
      audit.push({ sheetKey: key, match: 'deleted', baselineSheetKey: key, baselineName: sheet.name, canonicalName: canonicalizeDisplayName_ACU(sheet.name), inheritedColumns: [], addedColumns: [], deletedColumns: [], hiddenColumns: headers_ACU(sheet).slice(1), physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, sheet.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: input.destructiveChangeConfirmed, operations: [] });
    }
  }
  if (blockers.length > 0) return emptyPlan_ACU(baselineData, audit, blockers);

  // checkpoint.data 就是协调器算好的目标全量；结构变更统一表达为数据边界上的 per-sheet checkpoint。
  const sheetChanges: TemplateSheetChange_ACU[] = [];
  for (const [key, sheet] of listSheets_ACU(candidateData)) {
    if (!baselineData[key]) {
      sheetChanges.push({ kind: 'introduction', sheetKey: key, sheetData: sheet });
      audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'introduction' });
    } else if (rebaseKeys.has(key)) {
      sheetChanges.push({ kind: 'rebase', sheetKey: key, sheetData: sheet });
      audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'rebase' });
    }
  }
  // 隐藏表：产出 hide change（sheetData 携带 baseline 结构，persist 层据此定位并保留数据）。
  for (const key of hiddenSheetKeys) {
    sheetChanges.push({ kind: 'hide', sheetKey: key, sheetData: clone_ACU(baselineData[key]) as Sheet_ACU });
    audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'hide' });
  }
  candidateData.mate = clone_ACU(candidateData.mate);
  try {
    for (const [key, sheet] of listSheets_ACU(candidateData)) {
      const validation = validateDDLTextAgainstHeaders_ACU(String(sheet.sourceData?.ddl || ''), headers_ACU(sheet));
      if (!validation.valid) throw new Error(`${key}: ${validation.message}`);
      getSheetColumnProjection_ACU(sheet);
    }
    await hydrateTableDataStrict_ACU(candidateData);
  } catch (error: any) {
    return emptyPlan_ACU(baselineData, audit, [`完整 replay candidate SQLite hydrate 失败: ${error?.message || String(error)}`]);
  }
  for (const key of deletedSheetKeys) audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'delete' });
  return { candidateData, sheetChanges, deletedSheetKeys, hiddenSheetKeys, audit, blockers: [] };
}


interface SheetEntry_ACU { key: string; sheet: Sheet_ACU; }

function stripRuntimeSeedRows_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  const clone = clone_ACU(data);
  for (const [, sheet] of listSheets_ACU(clone)) delete sheet.seedRows;
  return clone;
}

function emptyPlan_ACU(candidateData: TableDataObject_ACU, audit: ChatTemplateReconcileAudit_ACU[], blockers: string[]): ChatTemplateReconcilePlan_ACU {
  return {
    candidateData: stripRuntimeSeedRows_ACU(candidateData),
    sheetChanges: [],
    deletedSheetKeys: [],
    hiddenSheetKeys: [],
    audit: audit.map(item => ({ ...item, operations: [] as ChatTemplateReconcileAudit_ACU['operations'] })),
    blockers,
  };
}

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function listSheets_ACU(data: TableDataObject_ACU): Array<[string, Sheet_ACU]> {
  return Object.keys(data || {}).filter(key => key.startsWith('sheet_'))
    .map(key => [key, (data as any)[key]] as [string, Sheet_ACU])
    .filter(([, sheet]) => !!sheet && typeof sheet === 'object' && !Array.isArray(sheet));
}

function indexSheetsByName_ACU(data: TableDataObject_ACU, label: string, blockers: string[]): Map<string, SheetEntry_ACU> {
  const entries = new Map<string, SheetEntry_ACU>();
  for (const [key, sheet] of listSheets_ACU(data)) {
    const canonicalName = canonicalizeDisplayName_ACU(sheet.name);
    if (!canonicalName) {
      blockers.push(`${label}存在空表名：${key}。`);
      continue;
    }
    const existing = entries.get(canonicalName);
    if (existing) {
      blockers.push(`${label}表名规范化重复：「${existing.sheet.name}」与「${sheet.name}」。`);
      continue;
    }
    entries.set(canonicalName, { key, sheet });
  }
  return entries;
}

function areLegacyEquivalentSheetNames_ACU(sheetKey: string, left: unknown, right: unknown): boolean {
  const knownAliases = new Map<string, ReadonlySet<string>>([
    ['sheet_DpKcVGqg', new Set(['主角信息', '主角信息表'])],
  ]);
  const aliases = knownAliases.get(sheetKey);
  if (!aliases) return false;
  const leftName = canonicalizeDisplayName_ACU(left);
  const rightName = canonicalizeDisplayName_ACU(right);
  return leftName !== rightName && aliases.has(leftName) && aliases.has(rightName);
}

function headers_ACU(sheet: Sheet_ACU): string[] {
  const headers = sheet?.content?.[0];
  if (!Array.isArray(headers) || headers[0] !== 'row_id') throw new Error('缺少 row_id 首列表头。');
  return headers.map(value => String(value ?? ''));
}

/**
 * 仅作用于模板侧 sheet：缺失 row_id 首列时自动注入（表头 + 顺序行号 + row_id PRIMARY KEY DDL 兜底）；
 * row_id 错位（出现在非首列）或 content 结构非法则记录带表名/key 的 blocker，绝不裸抛。
 */
function normalizeTemplateSheetRowIdColumn_ACU(sheet: Sheet_ACU, sheetKey: string, blockers: string[]): void {
  const label = `表「${sheet?.name || sheetKey}」(${sheetKey})`;
  const content = sheet?.content;
  if (!Array.isArray(content) || !Array.isArray(content[0])) {
    blockers.push(`${label} content 结构非法，无法解析表头。`);
    return;
  }
  const headers = content[0];
  if (headers[0] === 'row_id') return;
  if (headers.some(name => String(name ?? '') === 'row_id')) {
    blockers.push(`${label} 的 row_id 列不在首列，无法自动修复，请调整模板列顺序。`);
    return;
  }
  content[0] = ['row_id', ...headers.map(value => String(value ?? ''))];
  for (let index = 1; index < content.length; index += 1) {
    if (!Array.isArray(content[index])) { blockers.push(`${label} 第 ${index + 1} 行不是数组。`); return; }
    content[index] = [String(index), ...content[index].map((value: any) => (value === null ? null : String(value ?? '')))];
  }
  const ddl = String(sheet.sourceData?.ddl || '').trim();
  if (ddl) {
    const tableName = parseDDLTableName(ddl);
    if (tableName && !/\brow_id\b/i.test(ddl)) {
      if (!sheet.sourceData || typeof sheet.sourceData !== 'object') sheet.sourceData = {} as any;
      sheet.sourceData.ddl = ddl.replace(/\(/, '(\n  row_id INTEGER PRIMARY KEY,');
    }
  }
}

/**
 * 新增表的引入形态按“模板是否自带数据”分流：
 * - 自带数据：作者已定义初始格式，原样保留数据行，引入时即落盘建表。
 * - 不带数据：保持 header-only 空壳，保留“首次填表前可自由修改表结构”的能力。
 * 两种形态都要求 uid 等于 key，且 seedRows 不随 sheet 落盘（数据已在 content 中）。
 */
function asIntroducedSheet_ACU(sheet: Sheet_ACU, sheetKey: string): Sheet_ACU {
  const clone = clone_ACU(sheet);
  if (clone.uid !== sheetKey) throw new Error(`新增表 uid 必须等于 key：${sheetKey}。`);
  const headers = headers_ACU(clone);
  const templateRows = Array.isArray(clone.content) ? clone.content.slice(1) : [];
  const seedRows = Array.isArray(clone.seedRows) ? clone.seedRows : [];
  // content 数据行优先；仅 seedRows 提供数据时也视为“自带数据”。
  const dataRows = templateRows.length > 0 ? templateRows : seedRows;
  clone.content = dataRows.length > 0
    ? [headers, ...dataRows.map(row => (Array.isArray(row) ? [...row] : [row]))]
    : [headers];
  delete clone.seedRows;
  if (dataRows.length > 0) validateBaselineSheetRows_ACU(clone);
  return clone;
}

function validateBaselineSheetRows_ACU(sheet: Sheet_ACU): void {
  const headers = headers_ACU(sheet);
  const rowIds = new Set<string>();
  for (let index = 1; index < sheet.content.length; index += 1) {
    const row = sheet.content[index];
    if (!Array.isArray(row)) throw new Error(`第 ${index + 1} 行不是数组。`);
    if (row.length !== headers.length) throw new Error(`第 ${index + 1} 行宽度为 ${row.length}，应为 ${headers.length}。`);
    const rowId = String(row[0] ?? '').trim();
    if (!rowId) throw new Error(`第 ${index + 1} 行 row_id 为空。`);
    if (rowIds.has(rowId)) throw new Error(`row_id 重复：${rowId}。`);
    rowIds.add(rowId);
  }
}

function reconcileMatchedSheet_ACU(before: Sheet_ACU, template: Sheet_ACU, sheetKey: string, templateSheetKey: string): {
  sheet: Sheet_ACU;
  changed: boolean;
  audit: ChatTemplateReconcileAudit_ACU;
  meta?: Record<string, any>;
} {
  const beforeHeaders = headers_ACU(before);
  const targetHeaders = headers_ACU(template);
  const beforeColumns = parseDDLColumnInfos_ACU(String(before.sourceData?.ddl || ''));
  const targetColumns = parseDDLColumnInfos_ACU(String(template.sourceData?.ddl || ''));
  if (beforeColumns.length !== beforeHeaders.length || targetColumns.length !== targetHeaders.length) throw new Error('DDL 与表头列数不一致。');
  const beforeEntries = beforeHeaders.slice(1).map((name, index) => ({
    canonical: canonicalizeDisplayName_ACU(name), index: index + 1, physical: beforeColumns[index + 1].sqlName, header: name,
  }));
  const targetEntries = targetHeaders.slice(1).map((name, index) => ({
    canonical: canonicalizeDisplayName_ACU(name), index: index + 1, physical: targetColumns[index + 1].sqlName, header: name, column: targetColumns[index + 1],
  }));
  const beforeByCanonical = new Map(beforeEntries.map(column => [column.canonical, column]));
  const targetByCanonical = new Map(targetEntries.map(column => [column.canonical, column]));
  if (beforeByCanonical.size !== beforeHeaders.length - 1 || targetByCanonical.size !== targetHeaders.length - 1) throw new Error('存在空列或规范化重复列。');
  const beforeByPhysical = new Map(beforeEntries.map(column => [column.physical.toLowerCase(), column]));
  const targetByPhysical = new Map(targetEntries.map(column => [column.physical.toLowerCase(), column]));
  if (beforeByPhysical.size !== beforeEntries.length || targetByPhysical.size !== targetEntries.length) throw new Error('DDL 存在重复 physical column。');

  const matchedBeforeCanonical = new Set<string>();
  const matchedTargetCanonical = new Set<string>();
  const targetSourceByCanonical = new Map<string, typeof beforeEntries[number]>();
  const mappings: Array<{ fromPhysicalName: string; toPhysicalName: string }> = [];
  const inheritedColumns: string[] = [];
  for (const [canonicalName, target] of targetByCanonical) {
    const source = beforeByCanonical.get(canonicalName);
    if (!source) continue;
    matchedBeforeCanonical.add(source.canonical);
    matchedTargetCanonical.add(target.canonical);
    targetSourceByCanonical.set(target.canonical, source);
    inheritedColumns.push(target.header);
    if (source.physical !== target.physical) mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
  }

  // 同一稳定 Sheet key 下，physical column 才是持久化数据身份；表头只是可变显示名。
  // 不同 key 的导入模板仍禁止依赖 physical 同名推断，以免把无关字段重新解释为旧数据。
  if (sheetKey === templateSheetKey) {
    for (const target of targetEntries) {
      if (matchedTargetCanonical.has(target.canonical)) continue;
      const source = beforeByPhysical.get(target.physical.toLowerCase());
      if (!source || matchedBeforeCanonical.has(source.canonical)) continue;
      matchedBeforeCanonical.add(source.canonical);
      matchedTargetCanonical.add(target.canonical);
      targetSourceByCanonical.set(target.canonical, source);
      inheritedColumns.push(target.header);
      if (source.physical !== target.physical) {
        mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
      }
    }
  }

  const hiddenEntries = beforeEntries.filter(column => !matchedBeforeCanonical.has(column.canonical));
  const hiddenColumns = hiddenEntries.map(column => column.header);
  const addedColumns = targetEntries.filter(column => !matchedTargetCanonical.has(column.canonical)).map(column => column.header);
  const hiddenPhysicalNames = new Set(hiddenEntries.map(column => column.physical.toLowerCase()));
  const reusedPhysicalNames = targetEntries
    .filter(column => !matchedTargetCanonical.has(column.canonical) && hiddenPhysicalNames.has(column.physical.toLowerCase()))
    .map(column => column.physical);
  if (reusedPhysicalNames.length > 0) {
    throw new Error(`新增列复用了无法证明同一身份的历史 physical column「${reusedPhysicalNames.join('、')}」，无法安全重解释历史数据。`);
  }
  // 新列填充决策（替代 fills 静态契约）：可解析 literal DEFAULT → 该值；NOT NULL 无 DEFAULT → 空串；nullable → null。
  const fillAudit: Array<{ physicalName: string; kind: string; literal: unknown }> = [];
  const fillByTargetCanonical = new Map<string, string | null>();
  for (const target of targetEntries) {
    if (matchedTargetCanonical.has(target.canonical)) continue;
    const literal = parseDDLSafeDefaultLiteral_ACU(target.column.defaultExpression);
    let value: string | null;
    let kind: string;
    if (literal) { value = literalToCellValue_ACU(literal); kind = 'literal_default'; }
    else if (target.column.isNotNull) { value = ''; kind = 'empty_not_null'; }
    else { value = null; kind = 'null'; }
    fillByTargetCanonical.set(target.canonical, value);
    fillAudit.push({ physicalName: target.physical, kind, literal: value });
  }
  const sheet = clone_ACU(template);
  sheet.uid = before.uid;
  const retainedHiddenColumns = hiddenEntries.map(entry => beforeColumns[entry.index]);
  const retainedHiddenHeaders = hiddenEntries.map(entry => entry.header);
  // 迁移后数据行（纯 JS 直通，替代契约驱动迁移）：匹配列原值直通，新列取填充值，隐藏列原值保留。
  const migratedRows: Array<Array<string | null>> = [];
  for (let rowIndex = 1; rowIndex < before.content.length; rowIndex += 1) {
    const beforeRow = before.content[rowIndex];
    const targetRow: Array<string | null> = [beforeRow[0] ?? null];
    for (const target of targetEntries) {
      const source = targetSourceByCanonical.get(target.canonical);
      if (source) targetRow.push(beforeRow[source.index] ?? null);
      else targetRow.push(fillByTargetCanonical.get(target.canonical) ?? null);
    }
    for (const hidden of hiddenEntries) targetRow.push(beforeRow[hidden.index] ?? null);
    migratedRows.push(targetRow);
  }
  sheet.content = [[...targetHeaders, ...retainedHiddenHeaders], ...migratedRows];
  sheet.sourceData = clone_ACU(template.sourceData);
  sheet.sourceData.ddl = buildRetainedColumnDDL_ACU(before, template, targetColumns, targetHeaders, retainedHiddenColumns, retainedHiddenHeaders);
  const activePhysical = new Set(targetColumns.map(column => column.sqlName.toLowerCase()));
  const previousHidden = getSheetColumnProjection_ACU(before).hiddenPhysicalColumns;
  const candidatePhysical = new Map([...targetColumns, ...retainedHiddenColumns].map(column => [column.sqlName.toLowerCase(), column.sqlName]));
  const hiddenPhysicalColumns = [...previousHidden, ...retainedHiddenColumns.map(column => column.sqlName)]
    .filter(name => !activePhysical.has(name.toLowerCase()) && candidatePhysical.has(name.toLowerCase()))
    .filter((name, index, values) => values.findIndex(value => value.toLowerCase() === name.toLowerCase()) === index)
    .map(name => candidatePhysical.get(name.toLowerCase())!);
  if (previousHidden.length > 0 || hiddenPhysicalColumns.length > 0) sheet.sourceData.hiddenPhysicalColumns = hiddenPhysicalColumns;
  else delete sheet.sourceData.hiddenPhysicalColumns;
  delete sheet.seedRows;
  const meta = buildPersistentMetadataUpdate_ACU(before, sheet);
  const beforeProjection = clone_ACU(before); delete beforeProjection.seedRows;
  const changed = JSON.stringify(beforeProjection) !== JSON.stringify(sheet);
  return { sheet, changed, meta, audit: { sheetKey, match: 'matched', baselineSheetKey: sheetKey, templateSheetKey, baselineName: before.name,
    templateName: template.name, canonicalName: canonicalizeDisplayName_ACU(before.name), inheritedColumns, addedColumns, deletedColumns: [], hiddenColumns,
    physicalColumnMappings: mappings, fills: fillAudit,
    affectedRowCount: before.content.length - 1, metadataChanged: !!meta, metadataChangedFields: meta ? Object.keys(meta) : [], destructiveChangeConfirmed: false, operations: [] } };
}

function buildRetainedColumnDDL_ACU(before: Sheet_ACU, template: Sheet_ACU, targetColumns: ReturnType<typeof parseDDLColumnInfos_ACU>, targetHeaders: string[], retainedColumns: ReturnType<typeof parseDDLColumnInfos_ACU>, retainedHeaders: string[]): string {
  const templateDDL = String(template.sourceData?.ddl || '');
  const tableName = parseDDLTableName(templateDDL);
  if (!tableName) throw new Error('模板 DDL 缺少可解析的物理表名。');
  const allColumns = [...targetColumns, ...retainedColumns];
  const definitions = allColumns.map((column, index) => {
    const header = index < targetColumns.length ? targetHeaders[index] : retainedHeaders[index - targetColumns.length];
    const comment = header && header !== column.sqlName ? ` -- ${header}` : '';
    return { definition: column.normalizedDefinition, comment };
  });
  const constraints = Array.from(new Set([
    ...parseDDLTableConstraints_ACU(String(before.sourceData?.ddl || '')),
    ...parseDDLTableConstraints_ACU(templateDDL),
  ]));
  const suffix = parseDDLTableSuffix_ACU(templateDDL);
  const entries = [...definitions, ...constraints.map(definition => ({ definition, comment: '' }))];
  return `CREATE TABLE ${tableName} (\n${entries.map((entry, index) => `  ${entry.definition}${index < entries.length - 1 ? ',' : ''}${entry.comment}`).join('\n')}\n)${suffix ? ` ${suffix}` : ''};`;
}

function buildPersistentMetadataUpdate_ACU(before: Sheet_ACU, template: Sheet_ACU): Record<string, any> | undefined {
  const beforeSourceData: Record<string, any> = clone_ACU(before.sourceData || {});
  const targetSourceData: Record<string, any> = clone_ACU(template.sourceData || {});
  delete beforeSourceData.ddl;
  delete targetSourceData.ddl;
  const removedSourceDataKeys = Object.keys(beforeSourceData).filter(key => !Object.prototype.hasOwnProperty.call(targetSourceData, key));
  const sourceDataDelta = Object.fromEntries(Object.entries(targetSourceData).filter(([key, value]) => !sameValue_ACU(beforeSourceData[key], value)));
  const meta: Record<string, any> = {};
  if (before.name !== template.name) meta.name = template.name;
  if (before.orderNo !== template.orderNo) meta.orderNo = template.orderNo;
  if (Object.keys(sourceDataDelta).length > 0 || removedSourceDataKeys.length > 0) meta.sourceData = clone_ACU(targetSourceData);
  if (!sameValue_ACU(before.updateConfig, template.updateConfig)) meta.updateConfig = clone_ACU(template.updateConfig);
  if (!sameValue_ACU(before.exportConfig, template.exportConfig)) meta.exportConfig = clone_ACU(template.exportConfig);
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function sameValue_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function literalToCellValue_ACU(literal: NonNullable<ReturnType<typeof parseDDLSafeDefaultLiteral_ACU>>): string | null {
  if (literal.kind === 'null') return null;
  if (literal.kind === 'boolean') return literal.value ? '1' : '0';
  return String(literal.value);
}

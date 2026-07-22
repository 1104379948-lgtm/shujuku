import { parseDDLColumnInfos_ACU } from '../../shared/ddl-utils';

export type UpgradeAuditStatus_ACU = 'clean' | 'repairable' | 'requires_confirmation' | 'unrecoverable';
export type UpgradeAuditIssueCode_ACU =
  | 'upgrade_invalid_data'
  | 'upgrade_missing_sheet'
  | 'upgrade_invalid_header'
  | 'upgrade_empty_row_id'
  | 'upgrade_duplicate_row_id'
  | 'upgrade_row_width_mismatch'
  | 'upgrade_overflow_cells'
  | 'upgrade_seed_pool_conflict';
export type UpgradeRepairAction_ACU = 'rename_header' | 'insert_row_id_column' | 'normalize_row_id' | 'assign_row_id' | 'pad_row' | 'preserve_overflow';

export interface UpgradeAuditIssue_ACU {
  code: UpgradeAuditIssueCode_ACU;
  sheetKey?: string;
  rowIndex?: number;
  rowPool?: 'content' | 'seedRows';
  rowId?: string;
  message: string;
}
export interface UpgradeRepairPlanItem_ACU {
  action: UpgradeRepairAction_ACU;
  sheetKey: string;
  rowIndex?: number;
  rowPool?: 'content' | 'seedRows';
  targetHeader?: string;
}
export interface UpgradeAuditResult_ACU {
  status: UpgradeAuditStatus_ACU;
  issues: UpgradeAuditIssue_ACU[];
  repairPlan: UpgradeRepairPlanItem_ACU[];
  dataFingerprintBefore: string;
  sourceData: unknown;
}

type RecordValue = Record<string, unknown>;
function isRecord_ACU(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fingerprint_ACU(value: unknown): string {
  const text = JSON.stringify(value, (_key, item) => {
    if (!isRecord_ACU(item)) return item;
    return Object.keys(item).sort().reduce<RecordValue>((out, key) => { out[key] = item[key]; return out; }, {});
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function canonicalId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
}
function addIssue_ACU(result: UpgradeAuditResult_ACU, issue: UpgradeAuditIssue_ACU, plan?: UpgradeRepairPlanItem_ACU): void {
  result.issues.push(issue);
  if (plan) result.repairPlan.push(plan);
}
function inspectRows_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, rows: unknown[], pool: 'content' | 'seedRows', headerLength: number, ids: Map<string, { pool: 'content' | 'seedRows'; rowIndex: number }>): void {
  rows.forEach((row, offset) => {
    const rowIndex = pool === 'content' ? offset + 1 : offset;
    if (!Array.isArray(row)) {
      addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, message: '行不是数组，无法无损自动修复' });
      return;
    }
    const rowId = canonicalId_ACU(row[0]);
    if (!rowId) addIssue_ACU(result, { code: 'upgrade_empty_row_id', sheetKey, rowIndex, rowPool: pool, message: '行缺少稳定 row_id' }, { action: 'assign_row_id', sheetKey, rowIndex, rowPool: pool });
    else {
      if (row[0] !== rowId) result.repairPlan.push({ action: 'normalize_row_id', sheetKey, rowIndex, rowPool: pool });
      const existing = ids.get(rowId);
      if (existing) {
        const code = existing.pool === pool ? 'upgrade_duplicate_row_id' : 'upgrade_seed_pool_conflict';
        const message = existing.pool === pool
          ? 'row_id 在同一行集中重复'
          : 'row_id 同时存在于 content 与 seedRows 中';
        addIssue_ACU(result, { code, sheetKey, rowIndex, rowPool: pool, rowId, message }, { action: 'assign_row_id', sheetKey, rowIndex, rowPool: pool });
      } else ids.set(rowId, { pool, rowIndex });
    }
    if (row.length < headerLength) addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, rowId: rowId || undefined, message: '行短于表头，可尾部补 null' }, { action: 'pad_row', sheetKey, rowIndex, rowPool: pool });
    if (row.length > headerLength) addIssue_ACU(result, { code: 'upgrade_overflow_cells', sheetKey, rowIndex, rowPool: pool, rowId: rowId || undefined, message: '行超出表头，必须保留原值并等待确认' }, { action: 'preserve_overflow', sheetKey, rowIndex, rowPool: pool });
  });
}
function inspectRowsWithoutIds_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, rows: unknown[], pool: 'content' | 'seedRows', expectedWidth: number): void {
  rows.forEach((row, offset) => {
    const rowIndex = pool === 'content' ? offset + 1 : offset;
    if (!Array.isArray(row)) {
      addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, message: '行不是数组，无法无损自动修复' });
    } else if (row.length < expectedWidth) {
      addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, message: '行短于业务表头，可尾部补 null' }, { action: 'pad_row', sheetKey, rowIndex, rowPool: pool });
    } else if (row.length > expectedWidth) {
      addIssue_ACU(result, { code: 'upgrade_overflow_cells', sheetKey, rowIndex, rowPool: pool, message: '行超出业务表头，必须保留原值并等待确认' }, { action: 'preserve_overflow', sheetKey, rowIndex, rowPool: pool });
    }
  });
}


function determineHeaderRepair_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, sheet: RecordValue): { header: unknown[]; insertsRowId: boolean } | null {
  const content = sheet.content;
  if (!Array.isArray(content) || !Array.isArray(content[0]) || content[0].length === 0) {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '缺少可识别表头，无法安全推导 row_id 位置' });
    return null;
  }
  const header = content[0];
  const firstHeader = String(header[0] ?? '').trim();
  if (firstHeader === 'row_id') return { header, insertsRowId: false };
  if (!firstHeader || /^(id|rowid|row_id)$/i.test(firstHeader) || firstHeader === '行号') {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '身份列表头可确定地规范化为 row_id' }, { action: 'rename_header', sheetKey, rowIndex: 0, targetHeader: 'row_id' });
    return { header: ['row_id', ...header.slice(1)], insertsRowId: false };
  }
  const ddl = isRecord_ACU(sheet.sourceData) ? sheet.sourceData.ddl : undefined;
  const ddlText = typeof ddl === 'string' ? ddl : '';
  const ddlColumns = ddlText ? parseDDLColumnInfos_ACU(ddlText) : [];
  const ddlHasLeadingRowId = ddlColumns[0]?.sqlName.toLowerCase() === 'row_id' && ddlColumns.length === header.length + 1;
  const headerMatchesDdlWithoutRowId = ddlHasLeadingRowId && header.every((value, index) => {
    const headerValue = String(value ?? '').trim();
    const ddlColumn = ddlColumns[index + 1];
    return !!headerValue && !!ddlColumn && (ddlColumn.sqlName === headerValue || ddlColumn.comment === headerValue);
  });
  if (headerMatchesDdlWithoutRowId) {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: 'DDL 证明当前业务表头缺少 row_id 列，可在首列插入' }, { action: 'insert_row_id_column', sheetKey, rowIndex: 0, targetHeader: 'row_id' });
    return { header: ['row_id', ...header], insertsRowId: true };
  }
  addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '无法依据 DDL 安全判定应改名还是插入 row_id' });
  return null;
}

export function getTableDataFingerprint_ACU(data: unknown): string {
  return fingerprint_ACU(data);
}

export function auditTableDataForUpgrade_ACU(data: unknown): UpgradeAuditResult_ACU {
  const result: UpgradeAuditResult_ACU = { status: 'clean', issues: [], repairPlan: [], dataFingerprintBefore: fingerprint_ACU(data), sourceData: data };
  if (!isRecord_ACU(data)) {
    addIssue_ACU(result, { code: 'upgrade_invalid_data', message: '表格数据不是对象' });
    result.status = 'unrecoverable';
    return result;
  }
  const sheets = Object.entries(data).filter(([key]) => key.startsWith('sheet_'));
  if (sheets.length === 0) {
    addIssue_ACU(result, { code: 'upgrade_missing_sheet', message: '表格数据不含 sheet_*' });
    result.status = 'unrecoverable';
    return result;
  }
  for (const [sheetKey, rawSheet] of sheets) {
    if (!isRecord_ACU(rawSheet)) {
      addIssue_ACU(result, { code: 'upgrade_invalid_data', sheetKey, message: 'sheet 不是对象' });
      continue;
    }
    const headerState = determineHeaderRepair_ACU(result, sheetKey, rawSheet);
    if (!headerState) continue;
    const content = Array.isArray(rawSheet.content) ? rawSheet.content : [];
    const seedRows = Array.isArray(rawSheet.seedRows) ? rawSheet.seedRows : [];
    const ids = new Map<string, { pool: 'content' | 'seedRows'; rowIndex: number }>();
    if (headerState.insertsRowId) {
      const expectedBusinessWidth = headerState.header.length - 1;
      inspectRowsWithoutIds_ACU(result, sheetKey, content.slice(1), 'content', expectedBusinessWidth);
      inspectRowsWithoutIds_ACU(result, sheetKey, seedRows, 'seedRows', expectedBusinessWidth);
      content.slice(1).forEach((_row, offset) => result.repairPlan.push({ action: 'assign_row_id', sheetKey, rowIndex: offset + 1, rowPool: 'content' }));
      seedRows.forEach((_row, offset) => result.repairPlan.push({ action: 'assign_row_id', sheetKey, rowIndex: offset, rowPool: 'seedRows' }));
      continue;
    }
    inspectRows_ACU(result, sheetKey, content.slice(1), 'content', headerState.header.length, ids);
    inspectRows_ACU(result, sheetKey, seedRows, 'seedRows', headerState.header.length, ids);
  }
  if (result.issues.some(issue => issue.code === 'upgrade_invalid_data' || issue.code === 'upgrade_missing_sheet')) result.status = 'unrecoverable';
  else if (result.issues.some(issue => issue.code === 'upgrade_invalid_header' && !result.repairPlan.some(plan => plan.sheetKey === issue.sheetKey && (plan.action === 'rename_header' || plan.action === 'insert_row_id_column')) || issue.code === 'upgrade_overflow_cells')) result.status = 'requires_confirmation';
  else if (result.issues.length > 0) result.status = 'repairable';
  return result;
}

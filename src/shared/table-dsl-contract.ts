import { TABLE_ORDER_FIELD_ACU } from './constants';
import { parseDDLTableName } from './ddl-utils';
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

export type DslTableTargetResolution_ACU =
  | { ok: true; sheetKey: string; sheet: Sheet_ACU; tableIndex: number }
  | { ok: false; code: 'invalid_table_target' | 'missing_table_target' | 'ambiguous_table_target' | 'invalid_table_structure'; message: string };

export function parseDslNonNegativeInteger_ACU(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value !== value.trim() || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function isDslRowDataObject_ACU(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function validateDslColumnTargets_ACU(data: Record<string, any>, columnCount: number): string | null {
  for (const columnTarget of Object.keys(data)) {
    const columnIndex = parseDslNonNegativeInteger_ACU(columnTarget);
    if (columnIndex === null || columnIndex >= columnCount) {
      return `invalid_column_target: 列目标 ${JSON.stringify(columnTarget)} 无效或超出当前表格的 ${columnCount} 个业务列`;
    }
  }
  return null;
}

function normalizeSqliteIdentifier_ACU(identifier: string): string {
  if (identifier.length < 2) return identifier;
  const first = identifier[0];
  const last = identifier[identifier.length - 1];
  if (first === '"' && last === '"') {
    return identifier.slice(1, -1).replace(/""/g, '"');
  }
  if (first === '`' && last === '`') {
    return identifier.slice(1, -1).replace(/``/g, '`');
  }
  if (first === '[' && last === ']') {
    return identifier.slice(1, -1).replace(/]]/g, ']');
  }
  return identifier;
}

export function extractDslCommands_ACU(text: string): string[] {
  const cleaned = String(text || '').replace(/<!--|-->/g, '');
  const commands: string[] = [];
  const commandPattern = /(?:insertRow|updateRow|deleteRow)\s*\(/g;
  let searchStart = 0;

  while (searchStart < cleaned.length) {
    commandPattern.lastIndex = searchStart;
    const match = commandPattern.exec(cleaned);
    if (!match) break;

    const commandStart = match.index;
    const openParenIndex = cleaned.indexOf('(', commandStart);
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;
    let commandEnd = -1;

    for (let i = openParenIndex; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          commandEnd = i + 1;
          break;
        }
      }
    }

    if (commandEnd === -1) throw new Error('malformed_command: DSL 指令括号未闭合');
    const command = cleaned.slice(commandStart, commandEnd).trim().replace(/;$/, '');
    if (command) commands.push(command);
    searchStart = commandEnd;
  }

  if (commands.length === 0 && cleaned.trim()) {
    throw new Error('malformed_command: table_edit_dsl 未包含可识别指令');
  }
  return commands;
}

export function getSnapshotSheetKeysForDsl_ACU(data: TableDataObject_ACU | Record<string, any>): string[] {
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data)
    .filter(key => key.startsWith('sheet_'))
    .sort((left, right) => {
      const leftSheet = (data as any)[left];
      const rightSheet = (data as any)[right];
      const leftOrder = Number.isFinite(leftSheet?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(leftSheet[TABLE_ORDER_FIELD_ACU]) : Infinity;
      const rightOrder = Number.isFinite(rightSheet?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(rightSheet[TABLE_ORDER_FIELD_ACU]) : Infinity;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const nameOrder = String(leftSheet?.name ?? left).localeCompare(String(rightSheet?.name ?? right));
      return nameOrder || left.localeCompare(right);
    });
}

function validateSheet_ACU(sheetKey: string, sheet: any): string | null {
  if (!sheet || typeof sheet !== 'object' || !Array.isArray(sheet.content) || sheet.content.length === 0 || !Array.isArray(sheet.content[0])) {
    return `invalid_table_structure: 表格 ${JSON.stringify(sheetKey)} 缺少有效的 content/header`;
  }
  return null;
}

export function resolveDslTableTarget_ACU(
  data: TableDataObject_ACU | Record<string, any>,
  target: unknown,
  sheetKeys = getSnapshotSheetKeysForDsl_ACU(data),
): DslTableTargetResolution_ACU {
  const numericIndex = parseDslNonNegativeInteger_ACU(target);
  const isNumericTarget = typeof target === 'number'
    || (typeof target === 'string' && target === target.trim() && /^(?:0|[1-9]\d*)$/.test(target));
  if (isNumericTarget) {
    if (numericIndex === null) return { ok: false, code: 'invalid_table_target', message: `invalid_table_target: 数字表索引 ${JSON.stringify(target)} 无效` };
    const sheetKey = sheetKeys[numericIndex];
    const sheet = sheetKey ? (data as any)[sheetKey] : null;
    if (!sheetKey || !sheet) return { ok: false, code: 'missing_table_target', message: `missing_table_target: 数字表索引 ${numericIndex} 未匹配到当前快照中的表格` };
    const structureError = validateSheet_ACU(sheetKey, sheet);
    if (structureError) return { ok: false, code: 'invalid_table_structure', message: structureError };
    return { ok: true, sheetKey, sheet, tableIndex: numericIndex };
  }

  if (typeof target !== 'string' || !target.trim()) {
    return { ok: false, code: 'invalid_table_target', message: `invalid_table_target: 表格目标必须是非负整数或非空字符串，当前值为 ${JSON.stringify(target)}` };
  }
  const identifier = target.trim();
  const matches = sheetKeys.filter(sheetKey => {
    const sheet = (data as any)[sheetKey];
    if (!sheet || typeof sheet !== 'object') return false;
    const parsedDdlName = typeof sheet.sourceData?.ddl === 'string' ? parseDDLTableName(sheet.sourceData.ddl) : null;
    const ddlName = parsedDdlName === null ? null : normalizeSqliteIdentifier_ACU(parsedDdlName);
    return sheetKey === identifier || String(sheet.name ?? '').trim() === identifier || String(sheet.uid ?? '').trim() === identifier || ddlName === identifier;
  });
  if (matches.length === 0) return { ok: false, code: 'missing_table_target', message: `missing_table_target: 表格目标 ${JSON.stringify(identifier)} 未匹配到当前快照中的表格` };
  if (matches.length > 1) return { ok: false, code: 'ambiguous_table_target', message: `ambiguous_table_target: 表格目标 ${JSON.stringify(identifier)} 匹配到多个当前快照表格：${matches.join(', ')}` };
  const sheetKey = matches[0];
  const sheet = (data as any)[sheetKey];
  const structureError = validateSheet_ACU(sheetKey, sheet);
  if (structureError) return { ok: false, code: 'invalid_table_structure', message: structureError };
  return { ok: true, sheetKey, sheet, tableIndex: sheetKeys.indexOf(sheetKey) };
}

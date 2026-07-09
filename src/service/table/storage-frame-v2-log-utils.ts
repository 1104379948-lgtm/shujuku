import { parseDDLTableName } from '../../data/sqlite/schema-mapper';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TableMutationWriteSetV2_ACU, TableSqlBatchOperationV2_ACU, TableSqlBindValueV2_ACU } from './storage-frame-v2-types';

export interface SingleTableOperationEntryDraftV2_ACU {
  operations: TableMutationOperationV2_ACU[];
  filledSheetKeys?: string[];
  changedSheetKeys?: string[] | null;
  groupKeys?: string[];
  writeSet?: TableMutationWriteSetV2_ACU;
}

export interface OperationSheetKeyResult_ACU {
  sheetKey: string | null;
  error?: string;
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeSheetKeyList_ACU(keys: string[] | null | undefined, data?: TableDataObject_ACU): string[] {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter(key => typeof key === 'string' && key.startsWith('sheet_') && (!data || Boolean((data as any)[key]))))];
}

function extractSqlWriteTargetTableName_ACU(statement: string): string | null {
  const ident = '(?:`([^`]+)`|"([^"]+)"|\\[([^\\]]+)\\]|([A-Za-z_][A-Za-z0-9_]*))';
  const patterns = [
    new RegExp(`^\\s*INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${ident}`, 'i'),
    new RegExp(`^\\s*REPLACE\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${ident}`, 'i'),
    new RegExp(`^\\s*UPDATE\\s+(?:OR\\s+\\w+\\s+)?${ident}`, 'i'),
    new RegExp(`^\\s*DELETE\\s+FROM\\s+${ident}`, 'i'),
    new RegExp(`^\\s*ALTER\\s+TABLE\\s+${ident}`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = String(statement || '').match(pattern);
    if (match) return match.slice(1).find(Boolean) || null;
  }
  return null;
}

function mapSqlTableNameToSheetKey_ACU(tableData: TableDataObject_ACU | null | undefined, tableName: string): OperationSheetKeyResult_ACU {
  if (!tableData || !tableName) return { sheetKey: null, error: `SQL 表 ${tableName || '(empty)'} 无法映射到 sheet key。` };
  const matched: string[] = [];
  for (const [sheetKey, value] of Object.entries(tableData)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    const sheet = value as any;
    const candidates = [
      typeof sheet?.uid === 'string' ? sheet.uid.trim() : '',
      typeof sheet?.name === 'string' ? sheet.name.trim() : '',
      typeof sheet?.sourceData?.ddl === 'string' ? parseDDLTableName(sheet.sourceData.ddl) : '',
    ].filter(Boolean);
    if (candidates.includes(tableName)) matched.push(sheetKey);
  }
  if (matched.length === 1) return { sheetKey: matched[0] };
  if (matched.length === 0) return { sheetKey: null, error: `SQL 表 ${tableName} 未匹配到任何 sheet key。` };
  return { sheetKey: null, error: `SQL 表 ${tableName} 匹配到多个 sheet key: ${matched.join(', ')}。` };
}

export function deriveSqlStatementTargetSheetKey_ACU(statement: string, tableData: TableDataObject_ACU | null | undefined): OperationSheetKeyResult_ACU {
  const tableName = extractSqlWriteTargetTableName_ACU(statement);
  if (!tableName) return { sheetKey: null, error: `无法识别 SQL 写入目标表: ${String(statement || '').slice(0, 120)}` };
  return mapSqlTableNameToSheetKey_ACU(tableData, tableName);
}

export function deriveOperationSheetKey_ACU(operation: TableMutationOperationV2_ACU, tableData?: TableDataObject_ACU | null): OperationSheetKeyResult_ACU {
  if (!operation || typeof operation !== 'object') return { sheetKey: null, error: 'operation 无效。' };
  if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update' || operation.kind === 'sheet_replace') {
    return typeof operation.sheetKey === 'string' && operation.sheetKey.startsWith('sheet_')
      ? { sheetKey: operation.sheetKey }
      : { sheetKey: null, error: `${operation.kind} 缺少有效 sheetKey。` };
  }
  if (operation.kind === 'sql_batch') {
    const keys = new Set<string>();
    for (const statement of operation.statements || []) {
      const result = deriveSqlStatementTargetSheetKey_ACU(statement, tableData);
      if (!result.sheetKey) return result;
      keys.add(result.sheetKey);
    }
    if (keys.size === 1) return { sheetKey: [...keys][0] };
    if (keys.size === 0) return { sheetKey: null, error: 'sql_batch 没有可归属的 SQL statement。' };
    return { sheetKey: null, error: `sql_batch 混合多张表: ${[...keys].join(', ')}。` };
  }
  if (operation.kind === 'table_edit_dsl') {
    return { sheetKey: null, error: 'table_edit_dsl 必须由生成链路按单表 entry 外层字段提供归属，不能在持久化层猜测。' };
  }
  return { sheetKey: null, error: `${operation.kind} 不是可写入单表增量 entry 的 operation。` };
}

export function deriveLogEntrySheetKey_ACU(
  input: Pick<TableMutationLogEntryV2_ACU, 'operations' | 'changedSheetKeys' | 'filledSheetKeys' | 'groupKeys' | 'writeSet'>,
  tableData?: TableDataObject_ACU | null,
): OperationSheetKeyResult_ACU {
  const keys = new Set<string>();
  for (const operation of input.operations || []) {
    const result = deriveOperationSheetKey_ACU(operation, tableData);
    if (!result.sheetKey) return result;
    keys.add(result.sheetKey);
  }
  for (const key of [...(input.changedSheetKeys || []), ...(input.filledSheetKeys || []), ...(input.groupKeys || [])]) {
    if (typeof key === 'string' && key.startsWith('sheet_')) keys.add(key);
  }
  if (Array.isArray(input.writeSet)) {
    for (const unit of input.writeSet) {
      if ((unit as any)?.kind === 'all') return { sheetKey: null, error: '单表 log entry 的 writeSet 不能包含 all。' };
      const sheetKey = (unit as any)?.sheetKey;
      if (typeof sheetKey === 'string' && sheetKey.startsWith('sheet_')) keys.add(sheetKey);
    }
  }
  if (keys.size === 1) return { sheetKey: [...keys][0] };
  if (keys.size === 0) return { sheetKey: null, error: 'log entry 缺少表归属。' };
  return { sheetKey: null, error: `log entry 混合多张表: ${[...keys].join(', ')}。` };
}

export function validateSingleTableLogEntryDraft_ACU(
  draft: SingleTableOperationEntryDraftV2_ACU,
  tableData?: TableDataObject_ACU | null,
): { ok: true; sheetKey: string; changedSheetKeys: string[]; filledSheetKeys: string[]; groupKeys: string[]; writeSet?: TableMutationWriteSetV2_ACU } | { ok: false; error: string } {
  const result = deriveLogEntrySheetKey_ACU({
    operations: draft.operations || [],
    changedSheetKeys: draft.changedSheetKeys || [],
    filledSheetKeys: draft.filledSheetKeys || [],
    groupKeys: draft.groupKeys || [],
    writeSet: draft.writeSet,
  }, tableData);
  if (!result.sheetKey) return { ok: false, error: result.error || '无法推导单表归属。' };
  const sheetKey = result.sheetKey;
  const changedSheetKeys = normalizeSheetKeyList_ACU(draft.changedSheetKeys && draft.changedSheetKeys.length > 0 ? draft.changedSheetKeys : [sheetKey], tableData);
  const filledSheetKeys = normalizeSheetKeyList_ACU(draft.filledSheetKeys, tableData);
  const groupKeys = normalizeSheetKeyList_ACU(draft.groupKeys, tableData);
  const assertSubset = (label: string, keys: string[]) => keys.every(key => key === sheetKey) ? null : `${label} 与单表归属 ${sheetKey} 冲突: ${keys.join(', ')}`;
  const conflict = assertSubset('changedSheetKeys', changedSheetKeys) || assertSubset('filledSheetKeys', filledSheetKeys) || assertSubset('groupKeys', groupKeys);
  if (conflict) return { ok: false, error: conflict };
  if (draft.writeSet) {
    for (const unit of draft.writeSet) {
      if ((unit as any).kind === 'all') return { ok: false, error: '单表 log entry 的 writeSet 不能包含 all。' };
      if ((unit as any).sheetKey !== sheetKey) return { ok: false, error: `writeSet 与单表归属 ${sheetKey} 冲突。` };
    }
  }
  return { ok: true, sheetKey, changedSheetKeys: [sheetKey], filledSheetKeys, groupKeys, writeSet: draft.writeSet };
}

export function groupSqlBatchOperationsBySheet_ACU(
  operations: TableMutationOperationV2_ACU[],
  tableData: TableDataObject_ACU | null | undefined,
): { ok: true; entries: SingleTableOperationEntryDraftV2_ACU[] } | { ok: false; error: string } {
  const grouped = new Map<string, { statements: string[]; params: TableSqlBindValueV2_ACU[][] }>();
  for (const operation of operations) {
    if (operation.kind !== 'sql_batch') return { ok: false, error: `非 sql_batch operation 不能使用 SQL 分组: ${operation.kind}` };
    const statements = Array.isArray(operation.statements) ? operation.statements : [];
    const params = Array.isArray(operation.params) ? operation.params : [];
    for (let i = 0; i < statements.length; i += 1) {
      const statement = statements[i];
      const target = deriveSqlStatementTargetSheetKey_ACU(statement, tableData);
      if (!target.sheetKey) return { ok: false, error: target.error || 'SQL statement 无法归属。' };
      const bucket = grouped.get(target.sheetKey) || { statements: [], params: [] };
      bucket.statements.push(statement);
      bucket.params.push(Array.isArray(params[i]) ? params[i].map(value => value ?? null) : []);
      grouped.set(target.sheetKey, bucket);
    }
  }
  const entries = [...grouped.entries()].map(([sheetKey, bucket]) => {
    const sqlBatch: TableSqlBatchOperationV2_ACU = { kind: 'sql_batch', statements: bucket.statements };
    if (bucket.params.some(item => item.length > 0)) sqlBatch.params = bucket.params;
    return { operations: [sqlBatch], changedSheetKeys: [sheetKey], filledSheetKeys: [] as string[], groupKeys: [] as string[] };
  });
  return { ok: true, entries };
}

export function extractTableEditDslCommands_ACU(text: string): string[] {
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
    if (openParenIndex === -1) break;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;
    let commandEnd = -1;
    for (let i = openParenIndex; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === stringChar) inString = false;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          commandEnd = i + 1;
          break;
        }
      }
    }
    if (commandEnd === -1) return [];
    const command = cleaned.slice(commandStart, commandEnd).trim().replace(/;$/, '');
    if (command) commands.push(command);
    searchStart = commandEnd;
  }
  return commands;
}

function parseDslArgs_ACU(argsString: string): any[] | null {
  try {
    const firstBracket = argsString.indexOf('{');
    if (firstBracket === -1) return JSON.parse(`[${argsString}]`);
    const paramsPart = argsString.substring(0, firstBracket).trim();
    const jsonPart = argsString.substring(firstBracket);
    const initialArgs = JSON.parse(`[${paramsPart.replace(/,$/, '')}]`);
    return [...initialArgs, JSON.parse(jsonPart)];
  } catch (_) {
    return null;
  }
}

export function groupTableEditDslBySheet_ACU(
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'table_edit_dsl' }>,
  tableData: TableDataObject_ACU | null | undefined,
): { ok: true; entries: SingleTableOperationEntryDraftV2_ACU[] } | { ok: false; error: string } {
  if (!tableData || typeof tableData !== 'object') return { ok: false, error: 'DSL 分组缺少 tableData。' };
  const sheetKeys = Object.keys(tableData).filter(key => key.startsWith('sheet_'));
  const commands = extractTableEditDslCommands_ACU(operation.text);
  if (commands.length === 0) return { ok: false, error: '无法解析 DSL 命令。' };
  const grouped = new Map<string, string[]>();
  for (const commandLine of commands) {
    const match = commandLine.match(/^(insertRow|deleteRow|updateRow)\s*\((.*)\)$/);
    if (!match) return { ok: false, error: `无法解析 DSL 命令: ${commandLine}` };
    const args = parseDslArgs_ACU(match[2]);
    if (!args) return { ok: false, error: `无法解析 DSL 参数: ${commandLine}` };
    const tableIndex = Number(args[0]);
    if (!Number.isInteger(tableIndex) || tableIndex < 0 || tableIndex >= sheetKeys.length) {
      return { ok: false, error: `DSL 表索引无法映射到 sheet key: ${args[0]}` };
    }
    const sheetKey = sheetKeys[tableIndex];
    grouped.set(sheetKey, [...(grouped.get(sheetKey) || []), commandLine]);
  }
  return {
    ok: true,
    entries: [...grouped.entries()].map(([sheetKey, sheetCommands]) => ({
      operations: [{ kind: 'table_edit_dsl', text: sheetCommands.join('\n'), updateMode: operation.updateMode }],
      changedSheetKeys: [sheetKey],
      filledSheetKeys: [] as string[],
      groupKeys: [] as string[],
      writeSet: [{ kind: 'sheet', sheetKey }],
    })),
  };
}

export function groupOperationsBySingleSheet_ACU(
  operations: TableMutationOperationV2_ACU[],
  tableData: TableDataObject_ACU | null | undefined,
): { ok: true; entries: SingleTableOperationEntryDraftV2_ACU[] } | { ok: false; error: string } {
  const entries: SingleTableOperationEntryDraftV2_ACU[] = [];
  const sqlOperations = operations.filter(operation => operation.kind === 'sql_batch');
  if (sqlOperations.length > 0) {
    const groupedSql = groupSqlBatchOperationsBySheet_ACU(sqlOperations, tableData);
    if (!groupedSql.ok) return groupedSql;
    entries.push(...groupedSql.entries);
  }
  const grouped = new Map<string, TableMutationOperationV2_ACU[]>();
  for (const operation of operations.filter(operation => operation.kind !== 'sql_batch')) {
    if (operation.kind === 'table_edit_dsl') {
      const groupedDsl = groupTableEditDslBySheet_ACU(operation, tableData);
      if (groupedDsl.ok === false) return groupedDsl;
      entries.push(...groupedDsl.entries);
      continue;
    }
    const result = deriveOperationSheetKey_ACU(operation, tableData);
    if (!result.sheetKey) return { ok: false, error: result.error || `${operation.kind} 无法归属。` };
    grouped.set(result.sheetKey, [...(grouped.get(result.sheetKey) || []), deepClone_ACU(operation)]);
  }
  for (const [sheetKey, sheetOperations] of grouped.entries()) {
    entries.push({ operations: sheetOperations, changedSheetKeys: [sheetKey], filledSheetKeys: [] as string[], groupKeys: [] as string[] });
  }
  return { ok: true, entries };
}

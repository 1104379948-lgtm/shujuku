import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU, independentTableStates_ACU } from '../runtime/state-manager';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../shared/models/table-data';
import { logError_ACU, logWarn_ACU } from '../../shared/utils';
import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';
import { normalizeSqlStructure, normalizeStatementValues } from '../../data/sqlite/sql-normalizer';
import type { TableCheckpointV2_ACU, TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TablePatchV2_ACU, TableSheetCheckpointV2_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { ensureStableRowIdsForSeedRows_ACU, getEffectiveSeedRowsForSheet_ACU, getSortedSheetKeys_ACU } from '../template/chat-scope';
import { formatCanonicalRowIssues_ACU, isEmptyCanonicalRowId_ACU, normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { applySheetSchemaMigrationOperation_ACU } from './table-schema-migration';
import { resolvePhysicalTableNames_ACU } from '../../shared/sheet-identity';
import { parseDDLTableName } from '../../shared/ddl-utils';

interface V2FrameRef_ACU {
  messageIndex: number;
  aiFloor: number;
  frame: TableStorageFrameV2_ACU;
}

export type TableScheduleSummaryV2_ACU = NonNullable<TableCheckpointV2_ACU['scheduleSummary']>;

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getV2FrameRefs_ACU(chat: any[], isolationKey: string): V2FrameRef_ACU[] {
  const refs: V2FrameRef_ACU[] = [];
  let aiFloor = 0;

  for (let i = 0; i < chat.length; i += 1) {
    const message = chat[i];
    if (!message || message.is_user) continue;
    aiFloor += 1;

    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (isV2TagData_ACU(tagData)) {
      refs.push({ messageIndex: i, aiFloor, frame: tagData.storageFrame });
    }
  }

  return refs;
}

function hasUnanchoredReplayArtifacts_ACU(frameRefs: V2FrameRef_ACU[]): boolean {
  return frameRefs.some(({ frame }) => {
    const persistedFrame = frame as unknown as Record<string, unknown>;
    const perSheetCheckpoints = persistedFrame.perSheetCheckpoints;
    const hasPerSheetCheckpointArtifact = perSheetCheckpoints !== undefined
      && (perSheetCheckpoints === null
        || typeof perSheetCheckpoints !== 'object'
        || Array.isArray(perSheetCheckpoints)
        || Object.keys(perSheetCheckpoints).length > 0);
    const headRevision = persistedFrame.headRevision;
    const hasHeadRevisionArtifact = headRevision !== undefined
      && headRevision !== null
      && (typeof headRevision !== 'string' || headRevision.length > 0);

    return frame.logEntries.length > 0
      || hasPerSheetCheckpointArtifact
      || persistedFrame.manualRefillProgress !== undefined
      || hasHeadRevisionArtifact;
  });
}

function applyEventToScheduleSummary_ACU(
  summary: TableScheduleSummaryV2_ACU,
  event: Pick<TableMutationLogEntryV2_ACU, 'filledSheetKeys' | 'changedSheetKeys' | 'groupKeys'> | undefined,
  aiFloor: number,
): void {
  if (!event) return;

  const filledKeys = [...new Set([...(event.filledSheetKeys || []), ...(event.groupKeys || [])])];
  for (const sheetKey of filledKeys) {
    if (!summary[sheetKey]) summary[sheetKey] = {};
    summary[sheetKey].lastFilledAiFloor = aiFloor;
  }

  for (const sheetKey of event.changedSheetKeys || []) {
    if (!summary[sheetKey]) summary[sheetKey] = {};
    summary[sheetKey].lastChangedAiFloor = aiFloor;
  }
}

function replayEventForState_ACU(event: Pick<TableMutationLogEntryV2_ACU, 'filledSheetKeys' | 'changedSheetKeys' | 'groupKeys'> | undefined, aiFloor: number): void {
  if (!event) return;

  const filledKeys = [...new Set([...(event.filledSheetKeys || []), ...(event.groupKeys || [])])];
  for (const sheetKey of filledKeys) {
    if (!independentTableStates_ACU[sheetKey]) independentTableStates_ACU[sheetKey] = {};
    independentTableStates_ACU[sheetKey].lastUpdatedAiFloor = aiFloor;
  }

}

function replayCheckpointSchedule_ACU(checkpoint: TableCheckpointV2_ACU, fallbackAiFloor: number): void {
  const summary = checkpoint.scheduleSummary || {};
  for (const [sheetKey, state] of Object.entries(summary)) {
    if (state.lastFilledAiFloor === undefined) continue;
    if (!independentTableStates_ACU[sheetKey]) independentTableStates_ACU[sheetKey] = {};
    independentTableStates_ACU[sheetKey].lastUpdatedAiFloor = state.lastFilledAiFloor;
  }
  replayEventForState_ACU(checkpoint.event, fallbackAiFloor);
}

function replaceState_ACU(state: TableDataObject_ACU, next: TableDataObject_ACU): void {
  Object.keys(state).forEach(key => delete (state as any)[key]);
  Object.assign(state, deepClone_ACU(next));
}

function getValidatedSheetCheckpoints_ACU(frame: TableStorageFrameV2_ACU): TableSheetCheckpointV2_ACU[] {
  const checkpoints = frame.perSheetCheckpoints;
  if (checkpoints === undefined) return [];
  if (!checkpoints || typeof checkpoints !== 'object' || Array.isArray(checkpoints)) {
    throw new Error('perSheetCheckpoints 必须是按 sheetKey 索引的对象');
  }

  return Object.entries(checkpoints).map(([recordKey, checkpoint]) => {
    if (!recordKey.startsWith('sheet_')) {
      throw new Error(`perSheetCheckpoints 包含非法键: ${recordKey}`);
    }
    if (!checkpoint || checkpoint.kind !== 'sheet_full') {
      throw new Error(`perSheetCheckpoints.${recordKey} 缺少有效的 sheet_full checkpoint`);
    }
    if (checkpoint.sheetKey !== recordKey) {
      throw new Error(`perSheetCheckpoints.${recordKey} 的 sheetKey 不一致: ${checkpoint.sheetKey}`);
    }
    if (!checkpoint.data || typeof checkpoint.data !== 'object' || Array.isArray(checkpoint.data)) {
      throw new Error(`perSheetCheckpoints.${recordKey} 缺少有效的单表 data`);
    }
    if (checkpoint.timeline !== undefined) {
      const timeline = checkpoint.timeline;
      if (timeline.kind !== 'sheet_introduction'
        || !Number.isInteger(timeline.activateAtMessageIndex)
        || timeline.activateAtMessageIndex < 0
        || !Number.isInteger(timeline.afterSeq)
        || timeline.afterSeq < 0) {
        throw new Error(`perSheetCheckpoints.${recordKey} 包含非法 introduction timeline`);
      }
    }
    return checkpoint;
  }).sort((left, right) => left.sheetKey.localeCompare(right.sheetKey));
}

function getValidatedFrameLogEntries_ACU(frame: TableStorageFrameV2_ACU): TableMutationLogEntryV2_ACU[] {
  const entries = frame.logEntries;
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw new Error('logEntries 必须是数组');

  let previousSeq = -1;
  return entries.map((entry, index) => {
    const seq = entry?.seq;
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(`logEntries[${index}] 包含非法 seq: ${String(seq)}`);
    }
    if (seq <= previousSeq) {
      throw new Error(`logEntries 必须按唯一且严格递增的 seq 排列: previous=${previousSeq}, current=${seq}`);
    }
    previousSeq = seq;
    return entry;
  });
}

function getValidatedIntroductionsForFrame_ACU(
  checkpoints: TableSheetCheckpointV2_ACU[],
  messageIndex: number,
): TableSheetCheckpointV2_ACU[] {
  const introductions = checkpoints.filter(checkpoint => checkpoint.timeline !== undefined);
  for (const checkpoint of introductions) {
    if (checkpoint.timeline!.activateAtMessageIndex !== messageIndex) {
      throw new Error(`[V2 Replay] introduction shard messageIndex 不匹配: sheetKey=${checkpoint.sheetKey}, expected=${checkpoint.timeline!.activateAtMessageIndex}, actual=${messageIndex}`);
    }
  }
  return introductions;
}

function splitSqlStatementsForReplay_ACU(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (inString) {
      current += char;
      if (char === stringChar) {
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          current += sql[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
    } else if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      current += char;
    } else if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function normalizeSqlStatementsForReplay_ACU(statements: string[]): string[] {
  return statements
    .flatMap(statement => splitSqlStatementsForReplay_ACU(String(statement || '').replace(/<!--|-->/g, '').trim()))
    .map(statement => normalizeStatementValues(normalizeSqlStructure(statement)))
    .filter(Boolean);
}

interface SqlReplayRuntime_ACU {
  engine: SqliteEngine;
  syncBridge: SyncBridge;
  loaded: boolean;
}

function normalizeReplayState_ACU(state: TableDataObject_ACU, context: string): void {
  const normalization = normalizeCanonicalTableRows_ACU(state);
  if (normalization.errors.length > 0) {
    throw new Error(`[V2 Replay] ${context} 行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}`);
  }
}

async function ensureSqlReplayRuntime_ACU(runtime: SqlReplayRuntime_ACU, state: TableDataObject_ACU): Promise<void> {
  if (runtime.loaded) return;
  normalizeReplayState_ACU(state, 'snapshot');
  await runtime.engine.init();
  runtime.syncBridge.loadFromTableData(state, { strict: true });
  runtime.loaded = true;
}

function getExportedSqlReplayRuntimeState_ACU(runtime: SqlReplayRuntime_ACU, state: TableDataObject_ACU): TableDataObject_ACU {
  if (!runtime.loaded) return deepClone_ACU(state);
  const next = runtime.syncBridge.exportToTableData((state.mate || { type: 'acu', version: 1 }) as Mate_ACU);
  normalizeReplayState_ACU(next, 'SQL 导出结果');
  return next;
}

function exportSqlReplayRuntime_ACU(runtime: SqlReplayRuntime_ACU, state: TableDataObject_ACU): void {
  if (!runtime.loaded) return;
  replaceState_ACU(state, getExportedSqlReplayRuntimeState_ACU(runtime, state));
}

async function reloadSqlReplayRuntime_ACU(runtime: SqlReplayRuntime_ACU, state: TableDataObject_ACU): Promise<void> {
  if (!runtime.loaded) return;
  runtime.engine.dispose();
  runtime.loaded = false;
  await ensureSqlReplayRuntime_ACU(runtime, state);
}

async function applySheetCheckpointsForReplay_ACU(
  state: TableDataObject_ACU,
  checkpoints: TableSheetCheckpointV2_ACU[],
  runtime: SqlReplayRuntime_ACU,
): Promise<void> {
  if (checkpoints.length === 0) return;
  if (runtime.loaded) exportSqlReplayRuntime_ACU(runtime, state);
  for (const checkpoint of checkpoints) {
    state[checkpoint.sheetKey] = deepClone_ACU(checkpoint.data);
  }
  normalizeReplayState_ACU(state, '单表 checkpoint');
  if (runtime.loaded) await reloadSqlReplayRuntime_ACU(runtime, state);
}

async function applySqlBatchOperationV2_ACU(
  state: TableDataObject_ACU,
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'sql_batch' | 'sql_sheet_batch' }>,
  runtime: SqlReplayRuntime_ACU,
): Promise<void> {
  const statements = normalizeSqlStatementsForReplay_ACU(operation.statements || []);
  if (statements.length === 0) return;
  const reboundStatements = rebindSqlReplayTableIdentifiers_ACU(statements, state, operation);
  await ensureSqlReplayRuntime_ACU(runtime, state);
  const params = Array.isArray(operation.params) ? operation.params : undefined;
  runtime.engine.runBatch(reboundStatements, params);
}

interface SqlReplayIdentifierToken_ACU {
  start: number;
  end: number;
  value: string;
  quote: '"' | '`' | '[' | null;
}

function isSqlReplayIdentifierStart_ACU(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return char === '_' || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSqlReplayIdentifierPart_ACU(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return isSqlReplayIdentifierStart_ACU(char) || char === '$' || (code >= 48 && code <= 57);
}


/**
 * Tokenizes identifiers only. Strings and comments are intentionally skipped,
 * so a table-like word in narrative text can never be rebound.
 */
function tokenizeSqlReplayIdentifiers_ACU(statement: string): SqlReplayIdentifierToken_ACU[] {
  const tokens: SqlReplayIdentifierToken_ACU[] = [];
  let index = 0;
  while (index < statement.length) {
    const char = statement[index];
    const next = statement[index + 1];
    if (char === '-' && next === '-') {
      index += 2;
      while (index < statement.length && statement[index] !== '\n' && statement[index] !== '\r') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < statement.length && !(statement[index] === '*' && statement[index + 1] === '/')) index += 1;
      if (index >= statement.length) throw new Error('[V2 Replay] SQL 块注释未闭合，无法安全重绑定表名。');
      index += 2;
      continue;
    }
    if (char === "'") {
      index += 1;
      while (index < statement.length) {
        if (statement[index] !== "'") {
          index += 1;
          continue;
        }
        if (statement[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      if (index > statement.length || statement[index - 1] !== "'") throw new Error('[V2 Replay] SQL 字符串未闭合，无法安全重绑定表名。');
      continue;
    }
    if (char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char;
      const start = index;
      let value = '';
      index += 1;
      let closed = false;
      while (index < statement.length) {
        if (statement[index] !== closing) {
          value += statement[index++];
          continue;
        }
        if (statement[index + 1] === closing) {
          value += closing;
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      if (!closed) throw new Error('[V2 Replay] SQL 引号标识符未闭合，无法安全重绑定表名。');
      tokens.push({ start, end: index, value, quote: char });
      continue;
    }
    if (isSqlReplayIdentifierStart_ACU(char)) {
      const start = index;
      index += 1;
      while (index < statement.length && isSqlReplayIdentifierPart_ACU(statement[index])) index += 1;
      tokens.push({ start, end: index, value: statement.slice(start, index), quote: null });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function sqlReplayKeyword_ACU(token: SqlReplayIdentifierToken_ACU | undefined, keyword: string): boolean {
  return !!token && token.quote === null && token.value.toUpperCase() === keyword;
}

function getSqlReplayMutationTargetToken_ACU(tokens: SqlReplayIdentifierToken_ACU[]): SqlReplayIdentifierToken_ACU {
  const first = tokens[0];
  if (sqlReplayKeyword_ACU(first, 'INSERT') || sqlReplayKeyword_ACU(first, 'REPLACE')) {
    if (!sqlReplayKeyword_ACU(tokens[1], 'INTO') || !tokens[2]) {
      throw new Error('[V2 Replay] INSERT/REPLACE SQL 缺少可验证的目标表。');
    }
    return tokens[2];
  }
  if (sqlReplayKeyword_ACU(first, 'UPDATE')) {
    let index = 1;
    if (sqlReplayKeyword_ACU(tokens[index], 'OR')) {
      const action = tokens[index + 1];
      if (!action || action.quote !== null || !new Set(['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE']).has(action.value.toUpperCase())) {
        throw new Error('[V2 Replay] UPDATE OR 子句非法，无法安全重绑定表名。');
      }
      index += 2;
    }
    if (!tokens[index]) throw new Error('[V2 Replay] UPDATE SQL 缺少可验证的目标表。');
    return tokens[index];
  }
  if (sqlReplayKeyword_ACU(first, 'DELETE')) {
    if (!sqlReplayKeyword_ACU(tokens[1], 'FROM') || !tokens[2]) {
      throw new Error('[V2 Replay] DELETE SQL 缺少可验证的目标表。');
    }
    return tokens[2];
  }
  throw new Error(`[V2 Replay] 不支持安全重绑定的 SQL 语句类型：${first?.value || 'empty'}。`);
}

function formatSqlReplayIdentifier_ACU(value: string, quote: SqlReplayIdentifierToken_ACU['quote']): string {
  if (quote === '"') return `"${value.replace(/"/g, '""')}"`;
  if (quote === '`') return `\`${value.replace(/`/g, '``')}\``;
  if (quote === '[') return `[${value.replace(/]/g, ']]')}]`;
  return value;
}

function rebindSqlReplayTableIdentifiers_ACU(
  statements: string[],
  state: TableDataObject_ACU,
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'sql_batch' | 'sql_sheet_batch' }>,
): string[] {
  const physicalNames = resolvePhysicalTableNames_ACU(state);
  const targets = new Map<string, string>();
  for (const [sheetKey, physicalName] of physicalNames) {
    const sheet = state[sheetKey] as Sheet_ACU | undefined;
    if (!sheet) continue;
    const aliases = [parseDDLTableName(sheet.sourceData?.ddl || ''), physicalName];
    for (const alias of aliases) {
      const normalized = String(alias || '').trim().toLowerCase();
      if (!normalized) continue;
      const existing = targets.get(normalized);
      if (existing && existing !== physicalName) {
        targets.set(normalized, '');
      } else if (existing !== '') {
        targets.set(normalized, physicalName);
      }
    }
  }
  const scopedPhysicalName = operation.kind === 'sql_sheet_batch'
    ? physicalNames.get(operation.sheetKey)
    : undefined;
  if (operation.kind === 'sql_sheet_batch' && !scopedPhysicalName) {
    throw new Error(`[V2 Replay] sql_sheet_batch 指向不存在的 Sheet：${operation.sheetKey}。`);
  }
  const recordedTableName = operation.kind === 'sql_sheet_batch'
    ? operation.tableName?.trim().toLowerCase()
    : undefined;
  if (operation.kind === 'sql_sheet_batch' && recordedTableName) {
    const recordedPhysicalName = targets.get(recordedTableName);
    if (recordedPhysicalName === '' || (recordedPhysicalName && recordedPhysicalName !== scopedPhysicalName)) {
      throw new Error(`[V2 Replay] sql_sheet_batch 的 tableName 与 sheetKey 不一致：sheetKey=${operation.sheetKey}, tableName=${operation.tableName}。`);
    }
  }

  return statements.map(statement => {
    const tokens = tokenizeSqlReplayIdentifiers_ACU(statement);
    const target = getSqlReplayMutationTargetToken_ACU(tokens);
    const targetName = target.value.toLowerCase();
    let physicalName = targets.get(targetName);
    // 物理表名会随显示名变更。旧日志中未知于当前 schema 的 tableName 只在
    // 它与 SQL 实际目标完全一致时，才能作为该 sheet 的历史物理名重绑定。
    if (physicalName === undefined && scopedPhysicalName && recordedTableName === targetName) {
      physicalName = scopedPhysicalName;
    }
    if (!physicalName) {
      throw new Error(`[V2 Replay] 无法唯一解析 SQL 目标表标识符：${target.value}。`);
    }
    if (scopedPhysicalName && recordedTableName && targets.get(recordedTableName) === undefined && targetName !== recordedTableName) {
      throw new Error(`[V2 Replay] sql_sheet_batch 的 tableName 与 sheetKey 不一致：记录的历史表名未与 SQL 目标一致（tableName=${recordedTableName}, table=${target.value}）。`);
    }
    if (scopedPhysicalName && physicalName !== scopedPhysicalName) {
      const sheetKey = operation.kind === 'sql_sheet_batch' ? operation.sheetKey : '(legacy sql_batch)';
      throw new Error(`[V2 Replay] sql_sheet_batch 跨 Sheet 引用被拒绝：sheetKey=${sheetKey}, table=${target.value}。`);
    }
    return `${statement.slice(0, target.start)}${formatSqlReplayIdentifier_ACU(physicalName, target.quote)}${statement.slice(target.end)}`;
  });
}

function assertMetaUpdateDoesNotChangeDdl_ACU(patch: Extract<TablePatchV2_ACU, { kind: 'meta_update' }>): void {
  const sourceData = patch.meta?.sourceData;
  if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)
    && Object.prototype.hasOwnProperty.call(sourceData, 'ddl')) {
    throw new Error(
      '[V2 Replay] legacy meta_update.sourceData.ddl 无法安全回放；该结构变更需要迁移为 sheet_schema_migrate 或 sheet_replace。',
    );
  }
}

export function applyTablePatchV2_ACU(state: TableDataObject_ACU, patch: TablePatchV2_ACU): void {
  if (patch.kind === 'sheet_replace') {
    state[patch.sheetKey] = deepClone_ACU(patch.sheet);
    return;
  }

  const sheet = state[patch.sheetKey] as Sheet_ACU | undefined;
  if (!sheet || !Array.isArray(sheet.content)) {
    const isLegacyRowUpsertDelete = patch.kind === 'row_upsert'
      && Array.isArray(patch.cells)
      && isEmptyCanonicalRowId_ACU(patch.cells[0]);
    if (isLegacyRowUpsertDelete) {
      throw new Error(
        `[V2 Replay] legacy row_upsert 删除目标 Sheet 缺失或 content 非法：sheetKey=${patch.sheetKey}。`,
      );
    }
    logWarn_ACU(`[V2 Replay] 跳过 patch，缺少表或 content: ${patch.sheetKey}`);
    return;
  }

  if (patch.kind === 'row_upsert') {
    if (!Array.isArray(patch.cells)) {
      throw new Error(`[V2 Replay] row_upsert cells 必须是数组：sheetKey=${patch.sheetKey}。`);
    }
    const nextCells = deepClone_ACU(patch.cells);
    const header = sheet.content[0];
    if (isEmptyCanonicalRowId_ACU(nextCells[0])) {
      const targetRowId = String(patch.rowId ?? '').trim();
      if (!targetRowId) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除缺少 row_id：sheetKey=${patch.sheetKey}。`);
      }
      if (!Array.isArray(header) || header[0] !== 'row_id') {
        throw new Error(`[V2 Replay] legacy row_upsert 删除要求 row_id 表头：sheetKey=${patch.sheetKey}。`);
      }
      const matchingIndexes = sheet.content.reduce<number[]>((indexes, row, index) => {
        if (index > 0 && Array.isArray(row) && String(row[0] ?? '').trim() === targetRowId) indexes.push(index);
        return indexes;
      }, []);
      if (matchingIndexes.length === 0) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除目标 row_id 不存在：sheetKey=${patch.sheetKey}。`);
      }
      if (matchingIndexes.length > 1) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除遇到重复 row_id：sheetKey=${patch.sheetKey}。`);
      }
      sheet.content.splice(matchingIndexes[0], 1);
      return;
    }
    const rowId = String(patch.rowId ?? '').trim();
    const cellsRowId = String(nextCells[0]).trim();
    if (!rowId || rowId !== cellsRowId) {
      throw new Error(`[V2 Replay] row_upsert 身份不一致：sheetKey=${patch.sheetKey}。`);
    }
    if (!Array.isArray(header) || header[0] !== 'row_id') {
      throw new Error(`[V2 Replay] row_upsert 要求 row_id 表头：sheetKey=${patch.sheetKey}。`);
    }
    if (nextCells.length !== header.length) {
      throw new Error(`[V2 Replay] row_upsert 行宽不匹配：sheetKey=${patch.sheetKey}。`);
    }
    const matchingIndexes = sheet.content.reduce<number[]>((indexes, row, index) => {
      if (index > 0 && Array.isArray(row) && String(row[0] ?? '').trim() === rowId) indexes.push(index);
      return indexes;
    }, []);
    if (matchingIndexes.length > 1) {
      throw new Error(`[V2 Replay] row_upsert 遇到重复 row_id：sheetKey=${patch.sheetKey}。`);
    }
    nextCells[0] = rowId;
    if (matchingIndexes.length === 1) sheet.content[matchingIndexes[0]] = nextCells;
    else sheet.content.push(nextCells);
    return;
  }

  if (patch.kind === 'row_delete') {
    const targetRowId = String(patch.rowId ?? '').trim();
    sheet.content = sheet.content.filter((row, index) => {
      if (index === 0 || !Array.isArray(row)) return true;
      return String(row[0] ?? '').trim() !== targetRowId;
    });
    return;
  }

  if (patch.kind === 'meta_update') {
    const meta = deepClone_ACU(patch.meta || {});
    assertMetaUpdateDoesNotChangeDdl_ACU(patch);
    const sourceData = meta.sourceData;
    if (meta.name !== undefined) sheet.name = meta.name;
    if (meta.orderNo !== undefined) sheet.orderNo = meta.orderNo;
    if (meta.updateConfig !== undefined) sheet.updateConfig = meta.updateConfig;
    if (meta.exportConfig !== undefined) sheet.exportConfig = meta.exportConfig;
    if (sourceData !== undefined) {
      sheet.sourceData = { ...sheet.sourceData, ...(sourceData as Record<string, unknown>) };
    }
  }
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

function extractTableEditDslCommands_ACU(text: string): string[] {
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
        continue;
      }
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          commandEnd = i + 1;
          break;
        }
      }
    }

    if (commandEnd === -1) break;
    const command = cleaned.slice(commandStart, commandEnd).trim().replace(/;$/, '');
    if (command) commands.push(command);
    searchStart = commandEnd;
  }

  return commands;
}

function resolveDslReplaySheetKeys_ACU(state: TableDataObject_ACU): string[] {
  const sortedKeys = getSortedSheetKeys_ACU(state as any);
  if (Array.isArray(sortedKeys) && sortedKeys.length > 0) return sortedKeys;
  return Object.keys(state).filter(k => k.startsWith('sheet_'));
}

function materializeSeedRowsForDslReplay_ACU(sheet: Sheet_ACU): void {
  if (!Array.isArray(sheet.content) || sheet.content.length !== 1) return;
  let seedRows = Array.isArray(sheet.seedRows) && sheet.seedRows.length > 0 ? sheet.seedRows : null;
  if (!seedRows && sheet.uid && String(sheet.uid).startsWith('sheet_')) {
    seedRows = getEffectiveSeedRowsForSheet_ACU(String(sheet.uid), {
      guideData: null,
      allowTemplateFallback: true,
    });
    if (Array.isArray(seedRows) && seedRows.length > 0) sheet.seedRows = deepClone_ACU(seedRows);
  }
  if (!Array.isArray(seedRows) || seedRows.length === 0) return;
  const headerRow = Array.isArray(sheet.content[0]) ? deepClone_ACU(sheet.content[0]) : ['row_id'];
  // 与实时 DSL 路径保持同一身份契约：只有明确的 seedRows 新行能在物化时补 row_id。
  sheet.content = [headerRow, ...ensureStableRowIdsForSeedRows_ACU(seedRows)];
}

function applyTableEditDslOperationV2_ACU(state: TableDataObject_ACU, text: string): void {
  const sheetKeys = resolveDslReplaySheetKeys_ACU(state);
  const commands = extractTableEditDslCommands_ACU(text);

  for (const commandLine of commands) {
    const match = commandLine.match(/^(insertRow|deleteRow|updateRow)\s*\((.*)\)$/);
    if (!match) continue;
    const command = match[1];
    const args = parseDslArgs_ACU(match[2]);
    if (!args) continue;
    const tableIndex = Number(args[0]);
    const sheetKey = sheetKeys[tableIndex];
    const sheet = sheetKey ? state[sheetKey] as Sheet_ACU : null;
    if (!sheet || !Array.isArray(sheet.content)) continue;

    materializeSeedRowsForDslReplay_ACU(sheet);

    if (command === 'insertRow') {
      const data = args[1] || {};
      const headers = Array.isArray(sheet.content[0]) ? sheet.content[0].slice(1) : [];
      const row = [allocateStableRowId_ACU(createStableRowIdReservation_ACU(sheet.content.slice(1)))];
      headers.forEach((_, colIndex) => row.push(data[colIndex] ?? data[String(colIndex)] ?? ''));
      sheet.content.push(row);
    } else if (command === 'deleteRow') {
      const rowIndex = Number(args[1]);
      if (Number.isFinite(rowIndex) && sheet.content.length > rowIndex + 1) sheet.content.splice(rowIndex + 1, 1);
    } else if (command === 'updateRow') {
      const rowIndex = Number(args[1]);
      const data = args[2] || {};
      const row = Number.isFinite(rowIndex) ? sheet.content[rowIndex + 1] : null;
      if (!Array.isArray(row)) continue;
      Object.keys(data).forEach(colIndexStr => {
        const colIndex = Number.parseInt(colIndexStr, 10);
        if (!Number.isFinite(colIndex)) return;
        row[colIndex + 1] = data[colIndexStr];
      });
    }
  }
}

export async function applyTableOperationV2_ACU(
  state: TableDataObject_ACU,
  operation: TableMutationOperationV2_ACU,
  runtime?: SqlReplayRuntime_ACU,
): Promise<void> {
  if (!operation || typeof operation !== 'object' || typeof (operation as any).kind !== 'string') {
    throw new Error('[V2 Replay] operation 缺少有效 kind。');
  }
  const ownedRuntime = !runtime && (operation.kind === 'sql_batch' || operation.kind === 'sql_sheet_batch')
    ? { engine: new SqliteEngine(), syncBridge: null as unknown as SyncBridge, loaded: false }
    : null;
  if (ownedRuntime) ownedRuntime.syncBridge = new SyncBridge(ownedRuntime.engine);
  const effectiveRuntime = runtime || ownedRuntime || null;

  try {
    if (operation.kind === 'data_replace') {
      if (effectiveRuntime?.loaded) exportSqlReplayRuntime_ACU(effectiveRuntime, state);
      replaceState_ACU(state, operation.data);
      normalizeReplayState_ACU(state, 'data_replace');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, state);
      return;
    }
    if (operation.kind === 'sql_batch' || operation.kind === 'sql_sheet_batch') {
      if (!effectiveRuntime) throw new Error(`${operation.kind} replay requires runtime`);
      await applySqlBatchOperationV2_ACU(state, operation, effectiveRuntime);
      if (ownedRuntime) exportSqlReplayRuntime_ACU(ownedRuntime, state);
      return;
    }
    if (operation.kind === 'sheet_schema_migrate') {
      const sourceState = effectiveRuntime?.loaded
        ? getExportedSqlReplayRuntimeState_ACU(effectiveRuntime, state)
        : state;
      const candidate = await applySheetSchemaMigrationOperation_ACU(sourceState, operation);
      normalizeReplayState_ACU(candidate, 'sheet_schema_migrate');
      if (effectiveRuntime?.loaded) {
        await reloadSqlReplayRuntime_ACU(effectiveRuntime, candidate);
      }
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'sheet_replace') {
      if (effectiveRuntime?.loaded) exportSqlReplayRuntime_ACU(effectiveRuntime, state);
      state[operation.sheetKey] = deepClone_ACU(operation.sheet);
      normalizeReplayState_ACU(state, 'sheet_replace');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, state);
      return;
    }
    if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update') {
      if (operation.kind === 'meta_update') {
        assertMetaUpdateDoesNotChangeDdl_ACU(operation);
      }
      if (effectiveRuntime?.loaded) exportSqlReplayRuntime_ACU(effectiveRuntime, state);
      applyTablePatchV2_ACU(state, operation);
      normalizeReplayState_ACU(state, operation.kind);
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, state);
      return;
    }
    if (operation.kind === 'table_edit_dsl') {
      if (effectiveRuntime?.loaded) exportSqlReplayRuntime_ACU(effectiveRuntime, state);
      applyTableEditDslOperationV2_ACU(state, operation.text);
      normalizeReplayState_ACU(state, 'table_edit_dsl');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, state);
      return;
    }

    throw new Error(`[V2 Replay] 不支持的 operation kind: ${(operation as any).kind}`);
  } finally {
    if (ownedRuntime) ownedRuntime.engine.dispose();
  }
}

export function collectScheduleSummaryFromFramesV2_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
): TableScheduleSummaryV2_ACU {
  const chat = chatArg || [];
  if (!Array.isArray(chat) || chat.length === 0) return {};

  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  const checkpointRef = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');

  const summary: TableScheduleSummaryV2_ACU = checkpointRef?.frame.checkpoint
    ? deepClone_ACU(checkpointRef.frame.checkpoint.scheduleSummary || {})
    : {};
  if (checkpointRef?.frame.checkpoint) {
    applyEventToScheduleSummary_ACU(summary, checkpointRef.frame.checkpoint.event, checkpointRef.aiFloor);
  }

  for (const ref of frameRefs) {
    if (checkpointRef && ref.messageIndex < checkpointRef.messageIndex) continue;
    const checkpoints = getValidatedSheetCheckpoints_ACU(ref.frame);
    const introductions = getValidatedIntroductionsForFrame_ACU(checkpoints, ref.messageIndex);
    for (const sheetCheckpoint of checkpoints.filter(checkpoint => checkpoint.timeline === undefined)) {
      summary[sheetCheckpoint.sheetKey] = deepClone_ACU(sheetCheckpoint.scheduleSummary || {});
      applyEventToScheduleSummary_ACU(
        summary,
        sheetCheckpoint.event,
        ref.aiFloor,
      );
    }
    const entries = getValidatedFrameLogEntries_ACU(ref.frame);
    const pendingIntroductions = [...introductions];
    const applyDueIntroductions = (nextSeq: number): void => {
      const due = pendingIntroductions.filter(checkpoint => checkpoint.timeline!.afterSeq < nextSeq);
      for (const checkpoint of due) {
        summary[checkpoint.sheetKey] = deepClone_ACU(checkpoint.scheduleSummary || {});
        applyEventToScheduleSummary_ACU(summary, checkpoint.event, ref.aiFloor);
        pendingIntroductions.splice(pendingIntroductions.indexOf(checkpoint), 1);
      }
    };
    for (const entry of entries) {
      applyDueIntroductions(entry.seq);
      applyEventToScheduleSummary_ACU(summary, entry, ref.aiFloor);
    }
    applyDueIntroductions(Number.POSITIVE_INFINITY);
  }

  return summary;
}

export async function loadTableStateFromFramesV2_ACU(
  chatArg?: any[],
  isolationKeyArg?: string,
  options: { maxMessageIndex?: number; updateRuntimeState?: boolean } = {},
): Promise<TableDataObject_ACU | null> {
  const chat = chatArg || getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return null;

  const isolationKey = isolationKeyArg ?? getCurrentIsolationKey_ACU();
  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  const checkpointRef = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');

  if (!checkpointRef?.frame.checkpoint) {
    if (hasUnanchoredReplayArtifacts_ACU(frameRefs)) {
      logWarn_ACU('[V2 Replay] 未找到 full checkpoint，检测到无锚点 V2 replay artifacts，拒绝恢复不完整 V2 表格数据。');
    }
    return null;
  }

  const checkpoint = checkpointRef.frame.checkpoint;
  const state: TableDataObject_ACU = deepClone_ACU(checkpoint.data);
  normalizeReplayState_ACU(state, 'full checkpoint');
  const replayStartMessageIndex = checkpointRef.messageIndex;
  if (options.updateRuntimeState !== false) {
    replayCheckpointSchedule_ACU(checkpoint, checkpointRef.aiFloor);
  }

  const runtime: SqlReplayRuntime_ACU = {
    engine: new SqliteEngine(),
    syncBridge: null as unknown as SyncBridge,
    loaded: false,
  };
  runtime.syncBridge = new SyncBridge(runtime.engine);

  try {
    for (const ref of frameRefs) {
      if (ref.messageIndex < replayStartMessageIndex) continue;
      const checkpoints = getValidatedSheetCheckpoints_ACU(ref.frame);
      const introductions = getValidatedIntroductionsForFrame_ACU(checkpoints, ref.messageIndex);
      await applySheetCheckpointsForReplay_ACU(
        state,
        checkpoints.filter(checkpoint => checkpoint.timeline === undefined),
        runtime,
      );
      const entries = getValidatedFrameLogEntries_ACU(ref.frame);
      const pendingIntroductions = [...introductions];
      const applyDueIntroductions = async (nextSeq: number): Promise<void> => {
        const due = pendingIntroductions.filter(checkpoint => checkpoint.timeline!.afterSeq < nextSeq);
        if (due.length === 0) return;
        await applySheetCheckpointsForReplay_ACU(state, due, runtime);
        for (const checkpoint of due) {
          if (options.updateRuntimeState !== false) {
            replayEventForState_ACU(checkpoint.event, ref.aiFloor);
          }
          pendingIntroductions.splice(pendingIntroductions.indexOf(checkpoint), 1);
        }
      };
      for (const entry of entries) {
        try {
          await applyDueIntroductions(entry.seq);
          if (Array.isArray(entry.operations) && entry.operations.length > 0) {
            for (const operation of entry.operations) {
              await applyTableOperationV2_ACU(state, operation, runtime);
            }
          } else {
            if (runtime.loaded) exportSqlReplayRuntime_ACU(runtime, state);
            // 兼容旧版 derived patch log；新 V2 不再写 patches。
            for (const patch of entry.patches || []) {
              applyTablePatchV2_ACU(state, patch);
            }
            normalizeReplayState_ACU(state, 'legacy patches');
            if (runtime.loaded) await reloadSqlReplayRuntime_ACU(runtime, state);
          }
          if (options.updateRuntimeState !== false) {
            replayEventForState_ACU(entry, ref.aiFloor);
          }
        } catch (error) {
          logError_ACU(`[V2 Replay] 应用日志失败: messageIndex=${ref.messageIndex}, seq=${entry.seq}`, error);
          throw error;
        }
      }
      await applyDueIntroductions(Number.POSITIVE_INFINITY);
    }

    if (runtime.loaded) exportSqlReplayRuntime_ACU(runtime, state);
    return state;
  } finally {
    runtime.engine.dispose();
  }
}

export async function validateCurrentChatTableRecovery_ACU(
  options: { chat?: any[]; isolationKey?: string } = {},
): Promise<{ success: true } | { success: false; error: string }> {
  const chat = options.chat || getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return { success: true };
  try {
    await loadTableStateFromFramesV2_ACU(chat, options.isolationKey ?? getCurrentIsolationKey_ACU());
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error || '未知错误'),
    };
  }
}

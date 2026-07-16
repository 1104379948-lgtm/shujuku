import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU, independentTableStates_ACU } from '../runtime/state-manager';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../shared/models/table-data';
import { logError_ACU, logWarn_ACU } from '../../shared/utils';
import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';
import type { TableCheckpointV2_ACU, TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TablePatchV2_ACU, TableSheetCheckpointV2_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { formatCanonicalRowIssues_ACU, isEmptyCanonicalRowId_ACU, normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';
import { allocateStableRowIdForSheet_ACU, ensureStableNextRowId_ACU } from '../../shared/stable-row-id-allocator';
import { applySheetSchemaMigrationOperation_ACU } from './table-schema-migration';
import { normalizeSqlStatementsForRuntimeLog_ACU } from './sql-table-service';
import { extractDslCommands_ACU, getSnapshotSheetKeysForDsl_ACU, isDslRowDataObject_ACU, parseDslNonNegativeInteger_ACU, resolveDslTableTarget_ACU, validateDslColumnTargets_ACU } from '../../shared/table-dsl-contract';

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

function normalizeSqlStatementsForReplay_ACU(statements: string[]): string[] {
  return statements
    .flatMap(statement => normalizeSqlStatementsForRuntimeLog_ACU(String(statement || '')))
    .filter(Boolean);
}

interface SqlReplayRuntime_ACU {
  engine: SqliteEngine;
  syncBridge: SyncBridge;
  loaded: boolean;
}

function safeDisposeSqlReplayEngine_ACU(engine: Pick<SqliteEngine, 'dispose'>, context: string): void {
  try {
    engine.dispose();
  } catch (disposeError) {
    logWarn_ACU(`[V2 Replay] ${context} 清理失败: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`);
  }
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
  const replacementEngine = new SqliteEngine();
  const replacementRuntime: SqlReplayRuntime_ACU = {
    engine: replacementEngine,
    syncBridge: new SyncBridge(replacementEngine),
    loaded: false,
  };
  try {
    await ensureSqlReplayRuntime_ACU(replacementRuntime, state);
  } catch (error) {
    safeDisposeSqlReplayEngine_ACU(replacementEngine, 'replacement runtime');
    throw error;
  }
  const previousEngine = runtime.engine;
  runtime.engine = replacementRuntime.engine;
  runtime.syncBridge = replacementRuntime.syncBridge;
  runtime.loaded = true;
  safeDisposeSqlReplayEngine_ACU(previousEngine, '旧 runtime（已保留成功切换后的 runtime）');
}

async function applySheetCheckpointsForReplay_ACU(
  state: TableDataObject_ACU,
  checkpoints: TableSheetCheckpointV2_ACU[],
  runtime: SqlReplayRuntime_ACU,
): Promise<void> {
  if (checkpoints.length === 0) return;
  const candidate = runtime.loaded
    ? getExportedSqlReplayRuntimeState_ACU(runtime, state)
    : deepClone_ACU(state);
  for (const checkpoint of checkpoints) {
    candidate[checkpoint.sheetKey] = deepClone_ACU(checkpoint.data);
  }
  normalizeReplayState_ACU(candidate, '单表 checkpoint');
  if (runtime.loaded) await reloadSqlReplayRuntime_ACU(runtime, candidate);
  replaceState_ACU(state, candidate);
}

async function applySqlBatchOperationV2_ACU(
  state: TableDataObject_ACU,
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'sql_batch' | 'sql_sheet_batch' }>,
  runtime: SqlReplayRuntime_ACU,
): Promise<void> {
  const statements = normalizeSqlStatementsForReplay_ACU(operation.statements || []);
  if (statements.length === 0) return;
  await ensureSqlReplayRuntime_ACU(runtime, state);
  const params = Array.isArray(operation.params) ? operation.params : undefined;
  runtime.engine.runBatch(statements, params);
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
    sheet.content = sheet.content.filter(row => !(Array.isArray(row) && row[0] === patch.rowId));
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

function materializeSeedRowsForDslReplay_ACU(sheet: Sheet_ACU): void {
  if (!Array.isArray(sheet.content) || sheet.content.length !== 1) return;
  const seedRows = Array.isArray(sheet.seedRows) && sheet.seedRows.length > 0 ? sheet.seedRows : null;
  if (!Array.isArray(seedRows) || seedRows.length === 0) return;
  const headerRow = deepClone_ACU(sheet.content[0]);
  sheet.content = [headerRow, ...deepClone_ACU(seedRows)];
}

function applyTableEditDslOperationV2_ACU(state: TableDataObject_ACU, text: string): void {
  const sheetKeys = getSnapshotSheetKeysForDsl_ACU(state);
  let commands: string[];
  try {
    commands = extractDslCommands_ACU(text);
  } catch (error: any) {
    const message = error?.message || String(error);
    throw new Error(`[V2 Replay] ${message}`);
  }

  for (const commandLine of commands) {
    const match = commandLine.match(/^(insertRow|deleteRow|updateRow)\s*\((.*)\)$/);
    if (!match) throw new Error(`[V2 Replay] malformed_command: 无法解析指令 ${JSON.stringify(commandLine)}`);
    const command = match[1];
    const args = parseDslArgs_ACU(match[2]);
    if (!args) throw new Error(`[V2 Replay] malformed_command: 指令参数 JSON 无法解析 ${JSON.stringify(commandLine)}`);
    const resolved = resolveDslTableTarget_ACU(state, args[0], sheetKeys);
    if (resolved.ok === false) throw new Error(`[V2 Replay] ${resolved.message}`);
    const { sheet } = resolved;

    materializeSeedRowsForDslReplay_ACU(sheet);
    ensureStableNextRowId_ACU(sheet);

    if (command === 'insertRow') {
      const data = args[1];
      if (!isDslRowDataObject_ACU(data)) throw new Error(`[V2 Replay] invalid_row_data: insertRow 的数据必须是非空对象，当前值为 ${JSON.stringify(data)}`);
      const headers = sheet.content[0].slice(1);
      const columnError = validateDslColumnTargets_ACU(data, headers.length);
      if (columnError) throw new Error(`[V2 Replay] ${columnError}`);
      const row = [allocateStableRowIdForSheet_ACU(sheet)];
      headers.forEach((_, colIndex) => row.push(data[colIndex] ?? data[String(colIndex)] ?? ''));
      sheet.content.push(row);
    } else if (command === 'deleteRow') {
      const rowIndex = parseDslNonNegativeInteger_ACU(args[1]);
      if (rowIndex === null) throw new Error(`[V2 Replay] invalid_row_target: deleteRow 的行号必须是非负整数，当前值为 ${JSON.stringify(args[1])}`);
      if (sheet.content.length <= rowIndex + 1) throw new Error(`[V2 Replay] invalid_row_target: deleteRow 的行号 ${rowIndex} 不存在`);
      if (!Array.isArray(sheet.content[rowIndex + 1])) {
        throw new Error(`[V2 Replay] invalid_table_structure: deleteRow 的目标行 ${rowIndex} 不是有效数组`);
      }
      sheet.content.splice(rowIndex + 1, 1);
    } else if (command === 'updateRow') {
      const rowIndex = parseDslNonNegativeInteger_ACU(args[1]);
      if (rowIndex === null) throw new Error(`[V2 Replay] invalid_row_target: updateRow 的行号必须是非负整数，当前值为 ${JSON.stringify(args[1])}`);
      const data = args[2];
      if (!isDslRowDataObject_ACU(data)) throw new Error(`[V2 Replay] invalid_row_data: updateRow 的数据必须是非空对象，当前值为 ${JSON.stringify(data)}`);
      const row = sheet.content[rowIndex + 1];
      if (row === undefined) throw new Error(`[V2 Replay] invalid_row_target: updateRow 的行号 ${rowIndex} 不存在`);
      if (!Array.isArray(row)) throw new Error(`[V2 Replay] invalid_table_structure: updateRow 的目标行 ${rowIndex} 不是有效数组`);
      const writableColumnCount = Math.max(0, Math.min(sheet.content[0].length, row.length) - 1);
      const columnError = validateDslColumnTargets_ACU(data, writableColumnCount);
      if (columnError) throw new Error(`[V2 Replay] ${columnError}`);
      Object.keys(data).forEach(colIndexStr => {
        const colIndex = Number(colIndexStr);
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
      const candidate = deepClone_ACU(operation.data);
      normalizeReplayState_ACU(candidate, 'data_replace');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, candidate);
      replaceState_ACU(state, candidate);
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
      const candidate = effectiveRuntime?.loaded
        ? getExportedSqlReplayRuntimeState_ACU(effectiveRuntime, state)
        : deepClone_ACU(state);
      candidate[operation.sheetKey] = deepClone_ACU(operation.sheet);
      normalizeReplayState_ACU(candidate, 'sheet_replace');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, candidate);
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update') {
      if (operation.kind === 'meta_update') {
        assertMetaUpdateDoesNotChangeDdl_ACU(operation);
      }
      const candidate = effectiveRuntime?.loaded
        ? getExportedSqlReplayRuntimeState_ACU(effectiveRuntime, state)
        : deepClone_ACU(state);
      applyTablePatchV2_ACU(candidate, operation);
      normalizeReplayState_ACU(candidate, operation.kind);
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, candidate);
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'table_edit_dsl') {
      const candidate = effectiveRuntime?.loaded
        ? getExportedSqlReplayRuntimeState_ACU(effectiveRuntime, state)
        : deepClone_ACU(state);
      applyTableEditDslOperationV2_ACU(candidate, operation.text);
      normalizeReplayState_ACU(candidate, 'table_edit_dsl');
      if (effectiveRuntime?.loaded) await reloadSqlReplayRuntime_ACU(effectiveRuntime, candidate);
      replaceState_ACU(state, candidate);
      return;
    }

    throw new Error(`[V2 Replay] 不支持的 operation kind: ${(operation as any).kind}`);
  } finally {
    if (ownedRuntime) safeDisposeSqlReplayEngine_ACU(ownedRuntime.engine, 'owned runtime');
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
  const trackingBeforeReplay = options.updateRuntimeState === false ? null : deepClone_ACU(independentTableStates_ACU);

  const runtime: SqlReplayRuntime_ACU = {
    engine: new SqliteEngine(),
    syncBridge: null as unknown as SyncBridge,
    loaded: false,
  };
  runtime.syncBridge = new SyncBridge(runtime.engine);

  try {
    if (options.updateRuntimeState !== false) {
      replayCheckpointSchedule_ACU(checkpoint, checkpointRef.aiFloor);
    }
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
            const candidate = runtime.loaded
              ? getExportedSqlReplayRuntimeState_ACU(runtime, state)
              : deepClone_ACU(state);
            // 兼容旧版 derived patch log；新 V2 不再写 patches。
            for (const patch of entry.patches || []) {
              applyTablePatchV2_ACU(candidate, patch);
            }
            normalizeReplayState_ACU(candidate, 'legacy patches');
            if (runtime.loaded) await reloadSqlReplayRuntime_ACU(runtime, candidate);
            replaceState_ACU(state, candidate);
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
  } catch (error) {
    if (trackingBeforeReplay) {
      Object.keys(independentTableStates_ACU).forEach(key => delete independentTableStates_ACU[key]);
      Object.assign(independentTableStates_ACU, deepClone_ACU(trackingBeforeReplay));
    }
    throw error;
  } finally {
    safeDisposeSqlReplayEngine_ACU(runtime.engine, 'replay runtime');
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

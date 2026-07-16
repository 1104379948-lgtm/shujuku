import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { ITableStorageProvider, SqlMutationResult, SqlReseedPlan_ACU, SqlSheetMetadataUpdate_ACU } from '../../shared/table-storage-provider';
import { logError_ACU, logWarn_ACU } from '../../shared/utils';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { ensureLegacyStorageMigratedBeforeWrite_ACU, persistTablesToChatMessage_ACU } from './table-service';
import { ensureStorageProviderReady_ACU, reloadStorageProvider } from './table-storage-strategy';
import { buildSqlSheetBatchOperations_ACU, mergeSqlSheetMetadataUpdates_ACU, normalizeSqlStatementsForRuntimeLog_ACU } from './sql-table-service';
import { runTableWriteTransaction_ACU, type TableWriteTransactionContext_ACU } from './table-write-transaction';
import type { ReplaceExistingIncrementalOptions_ACU } from './storage-frame-v2-persist';
import type { ManualRefillProgressV2_ACU, TableCheckpointV2_ACU, TableMutationOperationV2_ACU, TableMutationSourceV2_ACU, TableWriteConflictUnitV2_ACU } from './storage-frame-v2-types';

export interface TableUpdateCommitApplyContext_ACU {
  transactionContext: TableWriteTransactionContext_ACU;
  workingData: TableDataObject_ACU | null;
}

export interface TableUpdateCommitPersistOverride_ACU {
  targetMessageIndex?: number;
  targetSheetKeys?: string[] | null;
  updateGroupKeys?: string[] | null;
  trackingSheetKeys?: string[] | null;
  trackAsUpdate?: boolean;
  operations?: TableMutationOperationV2_ACU[];
  revisionWriteSet?: TableWriteConflictUnitV2_ACU[];
  forceCheckpoint?: boolean;
  checkpointReason?: TableCheckpointV2_ACU['reason'];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  strictSave?: boolean;
}

export interface TableUpdateCommitApplyResult_ACU<T> {
  success: boolean;
  value?: T;
  tableData?: TableDataObject_ACU;
  mutationResult?: SqlMutationResult;
  persist?: TableUpdateCommitPersistOverride_ACU;
  error?: string;
}

export interface RunTableUpdateCommitOptions_ACU {
  source: TableMutationSourceV2_ACU;
  reason: string;
  writeSet: TableWriteConflictUnitV2_ACU[];
  revisionWriteSet?: TableWriteConflictUnitV2_ACU[];
  isolationKey?: string;
  baseRevision?: string | null;
  initialData?: TableDataObject_ACU | null;
  targetMessageIndex: number;
  targetSheetKeys: string[] | null;
  updateGroupKeys?: string[] | null;
  trackingSheetKeys?: string[] | null;
  trackAsUpdate?: boolean;
  operations?: TableMutationOperationV2_ACU[];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  strictSave?: boolean;
  skipChatSave?: boolean;
}

export interface RunTableUpdateCommitResult_ACU<T> {
  success: boolean;
  value?: T;
  tableData?: TableDataObject_ACU;
  mutationResult?: SqlMutationResult;
  saved?: boolean;
  messageIndex?: number;
  error?: string;
}

function cloneTableData_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  return JSON.parse(JSON.stringify(data));
}

function requireSqlitePreparedCommitProvider_ACU(provider: ITableStorageProvider): string | null {
  if (typeof provider.exportCanonicalData !== 'function') return '当前 SQLite 运行时不支持严格 canonical data 导出。';
  if (typeof provider.prepareReseedPlanForEmptyTables !== 'function') return '当前 SQLite 运行时不支持显式 seedRows reseed prepare。';
  if (typeof provider.applyEditsBatchWithSheetMetadata !== 'function') return '当前 SQLite 运行时不支持 SQL 与 Sheet metadata 原子提交。';
  if (typeof provider.createRuntimeSnapshot !== 'function' || typeof provider.restoreRuntimeSnapshot !== 'function') {
    return '当前 SQLite 运行时不支持提交后失败的 runtime snapshot 补偿。';
  }
  return null;
}

function buildReseedOperations_ACU(
  reseedPlan: SqlReseedPlan_ACU,
  canonicalData: TableDataObject_ACU,
  targetSheetKeys: string[] | null,
): TableMutationOperationV2_ACU[] {
  const operationBuild = buildSqlSheetBatchOperations_ACU(reseedPlan.statements, canonicalData, {
    params: reseedPlan.paramsList,
    fallbackTargetSheetKeys: targetSheetKeys || [],
    allowSingleTargetFallback: false,
    keepLegacyForUnclassified: false,
    reason: 'system',
  });
  if (operationBuild.unknownStatements.length > 0
    || operationBuild.ambiguousStatements.length > 0
    || operationBuild.operations.some(operation => operation.kind === 'sql_batch')) {
    throw new Error('seedRows reseed SQL 无法归属到单表日志，拒绝执行。');
  }
  const operations = [...operationBuild.operations];
  for (const update of reseedPlan.metadataUpdates) {
    const nextRowId = update.sheet?.sourceData?.nextRowId;
    if (Number.isSafeInteger(nextRowId) && Number(nextRowId) >= 1) {
      operations.push({
        kind: 'meta_update',
        sheetKey: update.sheetKey,
        meta: { sourceData: { nextRowId: Number(nextRowId) } },
      });
    }
  }
  return operations;
}

function applyMetadataToAllocationData_ACU(
  canonicalData: TableDataObject_ACU,
  updates: SqlSheetMetadataUpdate_ACU[],
): TableDataObject_ACU {
  const allocationData = cloneTableData_ACU(canonicalData);
  for (const update of updates) {
    allocationData[update.sheetKey] = JSON.parse(JSON.stringify(update.sheet));
  }
  return allocationData;
}

async function restoreRuntimeAfterPostCommitFailure_ACU(
  provider: ITableStorageProvider,
  snapshot: unknown,
  error: unknown,
): Promise<never> {
  const failureMessage = error instanceof Error ? error.message : String(error);
  try {
    await provider.restoreRuntimeSnapshot!(snapshot);
  } catch (restoreError: unknown) {
    const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
    throw new Error(`SQLite post-commit verification failed: ${failureMessage}; runtime snapshot restore failed: ${restoreMessage}`);
  }
  throw error instanceof Error ? error : new Error(failureMessage);
}

function normalizeSqlBindParams_ACU(params: (string | number | null)[] | undefined): (string | number | null)[][] | undefined {
  return Array.isArray(params) && params.length > 0 ? [params.map(value => value ?? null)] : undefined;
}

async function reloadRuntimeAfterPersistFailure_ACU(error: unknown): Promise<never> {
  const persistMessage = error instanceof Error ? error.message : String(error);
  logWarn_ACU(`[TableUpdateCommit] persist failed after runtime update, reload runtime before releasing lock: ${persistMessage}`);
  try {
    await reloadStorageProvider();
  } catch (reloadError: unknown) {
    const reloadMessage = reloadError instanceof Error ? reloadError.message : String(reloadError);
    throw new Error(
      `Table persistence failed: ${persistMessage}; runtime reload failed: ${reloadMessage}`,
    );
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(persistMessage);
}

export async function runTableUpdateCommit_ACU<T>(
  options: RunTableUpdateCommitOptions_ACU,
  apply: (context: TableUpdateCommitApplyContext_ACU) => Promise<TableUpdateCommitApplyResult_ACU<T>> | TableUpdateCommitApplyResult_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  try {
    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU(options.reason);
    if (!migration.success) {
      return { success: false, error: migration.error || '旧存储迁移失败，已阻止本次写入。' };
    }
    if (migration.migrated) {
      await reloadStorageProvider();
    }

    return await runTableWriteTransaction_ACU({
      source: options.source,
      reason: options.reason,
      isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
      writeSet: options.writeSet,
      baseRevision: options.baseRevision,
      initialData: options.initialData !== undefined ? options.initialData : currentJsonTableData_ACU,
    }, async (transactionContext, workingData) => {
      let commitRevisionWriteSet = options.revisionWriteSet;
      return transactionContext.runCommit(async () => {
        const applied = await apply({ transactionContext, workingData });
        if (!applied.success || !applied.tableData) {
          throw new Error(applied.error || `${options.reason}: update apply failed`);
        }

        let saved = true;
        let messageIndex: number | undefined;
        const persistOptions = applied.persist || {};
        const revisionWriteSet = persistOptions.revisionWriteSet ?? options.revisionWriteSet;
        const targetSheetKeys = persistOptions.targetSheetKeys !== undefined ? persistOptions.targetSheetKeys : options.targetSheetKeys;
        const operations = persistOptions.operations ?? options.operations;
        commitRevisionWriteSet = revisionWriteSet;
        if (!options.skipChatSave) {
          let saveResult;
          try {
            saveResult = await persistTablesToChatMessage_ACU({
              targetMessageIndex: persistOptions.targetMessageIndex ?? options.targetMessageIndex,
              targetSheetKeys,
              updateGroupKeys: persistOptions.updateGroupKeys !== undefined ? persistOptions.updateGroupKeys : (options.updateGroupKeys ?? null),
              trackingSheetKeys: persistOptions.trackingSheetKeys !== undefined ? persistOptions.trackingSheetKeys : (options.trackingSheetKeys ?? []),
              tableData: applied.tableData,
              trackAsUpdate: persistOptions.trackAsUpdate ?? options.trackAsUpdate ?? false,
              source: options.source,
              operations,
              revisionWriteSet,
              forceCheckpoint: persistOptions.forceCheckpoint,
              checkpointReason: persistOptions.checkpointReason,
              manualRefillProgress: persistOptions.manualRefillProgress ?? options.manualRefillProgress,
              replaceExistingIncremental: persistOptions.replaceExistingIncremental ?? options.replaceExistingIncremental,
              strictSave: persistOptions.strictSave ?? options.strictSave,
              assumeCommitLock: true,
              transactionContext,
            });
          } catch (error: unknown) {
            await reloadRuntimeAfterPersistFailure_ACU(error);
          }
          saved = saveResult.saved;
          messageIndex = saveResult.messageIndex;
          if (!saveResult.saved) {
            await reloadRuntimeAfterPersistFailure_ACU(
              new Error(saveResult.error || `${options.reason}: persist failed`),
            );
          }
        }

        _set_currentJsonTableData_ACU(cloneTableData_ACU(applied.tableData));
        return {
          success: true,
          value: applied.value,
          tableData: applied.tableData,
          mutationResult: applied.mutationResult,
          saved,
          messageIndex,
        };
      }, () => commitRevisionWriteSet);
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    logError_ACU(`[TableUpdateCommit] ${options.reason} failed:`, error);
    return { success: false, error: message };
  }
}

export interface ReplaceRuntimeDataStrictOptions_ACU {
  validate?: (tableData: TableDataObject_ACU) => string | null;
}

/**
 * 严格替换完整 runtime，并以替换后的 runtime canonical export 作为唯一结果。
 * SQLite 的 replace、export 或校验失败都会恢复二进制快照。
 */
export async function replaceRuntimeDataStrict_ACU(
  provider: ITableStorageProvider,
  replacementData: TableDataObject_ACU,
  options: ReplaceRuntimeDataStrictOptions_ACU = {},
): Promise<TableDataObject_ACU> {
  if (typeof provider.replaceAllData !== 'function') throw new Error('当前存储 provider 不支持全量替换命令。');

  const isSqlite = provider.mode === 'sqlite';
  if (isSqlite && typeof provider.exportCanonicalData !== 'function') {
    throw new Error('当前 SQLite 运行时不支持严格 canonical data 导出。');
  }
  if (isSqlite && (typeof provider.createRuntimeSnapshot !== 'function' || typeof provider.restoreRuntimeSnapshot !== 'function')) {
    throw new Error('当前 SQLite 运行时不支持全量替换失败的 runtime snapshot 补偿。');
  }

  const snapshot = isSqlite ? provider.createRuntimeSnapshot!() : undefined;
  if (isSqlite && snapshot == null) throw new Error('SQLite runtime snapshot 创建失败，拒绝执行不可补偿的全量替换。');
  const previousData = !isSqlite ? provider.getCurrentData() : null;
  let runtimeMayHaveChanged = false;
  try {
    runtimeMayHaveChanged = true;
    const replaced = await provider.replaceAllData(replacementData);
    if (!replaced.success) throw new Error(replaced.error || '运行时全量替换失败。');
    const canonicalData = isSqlite ? provider.exportCanonicalData!() : provider.getCurrentData();
    if (!canonicalData) throw new Error('全量替换后的 runtime canonical data 为空。');
    const validationError = options.validate?.(canonicalData);
    if (validationError) throw new Error(validationError);
    return cloneTableData_ACU(canonicalData);
  } catch (error: unknown) {
    if (!runtimeMayHaveChanged) throw error;
    const failureMessage = error instanceof Error ? error.message : String(error);
    try {
      if (isSqlite) {
        await provider.restoreRuntimeSnapshot!(snapshot);
      } else if (previousData) {
        const restored = await provider.replaceAllData(previousData);
        if (!restored.success) throw new Error(restored.error || '原生 runtime 数据恢复失败。');
      } else {
        provider.clearRuntimeData();
      }
    } catch (restoreError: unknown) {
      const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`Runtime full replacement failed: ${failureMessage}; runtime restore failed: ${restoreMessage}`);
    }
    throw error instanceof Error ? error : new Error(failureMessage);
  }
}

export interface RunRuntimeDataReplaceCommitOptions_ACU<T> extends RunTableUpdateCommitOptions_ACU {
  replacementData: TableDataObject_ACU;
  replacementReason: Extract<TableMutationOperationV2_ACU, { kind: 'data_replace' }>['reason'];
  validate?: (tableData: TableDataObject_ACU) => string | null;
  mapValue: (tableData: TableDataObject_ACU) => T;
}

export async function runRuntimeDataReplaceCommit_ACU<T>(
  options: RunRuntimeDataReplaceCommitOptions_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  return runTableUpdateCommit_ACU(options, async () => {
    const provider = await ensureStorageProviderReady_ACU();
    try {
      const tableData = await replaceRuntimeDataStrict_ACU(provider, options.replacementData, { validate: options.validate });
      return {
        success: true,
        value: options.mapValue(tableData),
        tableData,
        persist: {
          operations: [{ kind: 'data_replace', data: cloneTableData_ACU(tableData), reason: options.replacementReason }],
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
}

export interface RunSqliteRuntimeMutationCommitOptions_ACU<T> extends RunTableUpdateCommitOptions_ACU {
  sql: string;
  params?: (string | number | null)[];
  validate?: (input: { mutationResult: SqlMutationResult; tableData: TableDataObject_ACU }) => string | null;
  mapValue: (input: { mutationResult: SqlMutationResult; tableData: TableDataObject_ACU }) => T;
}

export async function runSqliteRuntimeMutationCommit_ACU<T>(
  options: RunSqliteRuntimeMutationCommitOptions_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  return runTableUpdateCommit_ACU(options, async () => {
    const provider = await ensureStorageProviderReady_ACU();
    const capabilityError = requireSqlitePreparedCommitProvider_ACU(provider);
    if (capabilityError) return { success: false, error: capabilityError };

    let canonicalData: TableDataObject_ACU;
    let reseedPlan: SqlReseedPlan_ACU;
    let reseedOperations: TableMutationOperationV2_ACU[];
    try {
      canonicalData = provider.exportCanonicalData!();
      reseedPlan = provider.prepareReseedPlanForEmptyTables!(canonicalData, options.targetSheetKeys || undefined);
      reseedOperations = buildReseedOperations_ACU(reseedPlan, canonicalData, options.targetSheetKeys);
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }

    const businessStatements = normalizeSqlStatementsForRuntimeLog_ACU(options.sql);
    if (businessStatements.length === 0) return { success: false, error: 'SQLite mutation SQL 为空。' };
    const businessParams = businessStatements.map((_, index) => index === 0 ? (options.params || []).map(value => value ?? null) : []);
    const allocationData = applyMetadataToAllocationData_ACU(canonicalData, reseedPlan.metadataUpdates);
    const businessOperations = options.operations ?? buildSqlSheetBatchOperations_ACU(businessStatements, allocationData, {
      params: businessParams,
      fallbackTargetSheetKeys: options.targetSheetKeys || [],
      allowSingleTargetFallback: Array.isArray(options.targetSheetKeys) && options.targetSheetKeys.length === 1,
      keepLegacyForUnclassified: true,
      reason: 'system',
    }).operations;
    const snapshot = provider.createRuntimeSnapshot!();
    if (snapshot == null) return { success: false, error: 'SQLite runtime snapshot 创建失败，拒绝执行不可补偿的写入。' };

    let batchResult;
    try {
      batchResult = provider.applyEditsBatchWithSheetMetadata!(
        [...reseedPlan.statements, ...businessStatements],
        [...reseedPlan.paramsList, ...businessParams],
        reseedPlan.metadataUpdates,
        options.reason,
        { includeImplicitReseed: false },
      );
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
    if (!batchResult.success) return { success: false, error: batchResult.error || `${options.reason}: SQLite atomic batch failed` };

    const businessChanges = Array.isArray(batchResult.statementChanges)
      ? batchResult.statementChanges.slice(reseedPlan.statements.length).reduce((sum, value) => sum + value, 0)
      : (batchResult.changes ?? batchResult.appliedEdits);
    const mutationResult: SqlMutationResult = { changes: businessChanges, errors: [] };
    try {
      const tableData = provider.exportCanonicalData!();
      const validationError = options.validate?.({ mutationResult, tableData });
      if (validationError) throw new Error(validationError);
      return {
        success: true,
        value: options.mapValue({ mutationResult, tableData }),
        tableData,
        mutationResult,
        persist: { operations: [...reseedOperations, ...businessOperations] },
      };
    } catch (error: unknown) {
      await restoreRuntimeAfterPostCommitFailure_ACU(provider, snapshot, error);
    }
  });
}

export interface PreparedSqliteAtomicBatch_ACU<T> {
  statements: string[];
  paramsList: (string | number | null)[][];
  metadataUpdates: SqlSheetMetadataUpdate_ACU[];
  operations: TableMutationOperationV2_ACU[];
  validate?: (tableData: TableDataObject_ACU) => string | null;
  mapValue: (tableData: TableDataObject_ACU) => T;
}

export interface RunSqliteAtomicBatchCommitOptions_ACU<T> extends RunTableUpdateCommitOptions_ACU {
  prepare: (context: TableUpdateCommitApplyContext_ACU) => PreparedSqliteAtomicBatch_ACU<T> | { error: string };
}

/**
 * 在 transaction working copy 上准备显式 ID 与 Sheet metadata，再由 SQLite
 * provider 将用户 SQL 和 metadata 放入同一个底层事务。持久化 operation 由
 * prepare 的同一份结果生成，避免 runtime 与 V2 log 使用不同 row_id。
 */
export async function runSqliteAtomicBatchCommit_ACU<T>(
  options: RunSqliteAtomicBatchCommitOptions_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  return runTableUpdateCommit_ACU(options, async context => {
    const provider = await ensureStorageProviderReady_ACU();
    const capabilityError = requireSqlitePreparedCommitProvider_ACU(provider);
    if (capabilityError) return { success: false, error: capabilityError };

    let canonicalData: TableDataObject_ACU;
    let reseedPlan: SqlReseedPlan_ACU;
    let reseedOperations: TableMutationOperationV2_ACU[];
    let prepared: PreparedSqliteAtomicBatch_ACU<T> | { error: string };
    try {
      canonicalData = provider.exportCanonicalData!();
      reseedPlan = provider.prepareReseedPlanForEmptyTables!(canonicalData, options.targetSheetKeys || undefined);
      reseedOperations = buildReseedOperations_ACU(reseedPlan, canonicalData, options.targetSheetKeys);
      prepared = options.prepare({
        ...context,
        workingData: applyMetadataToAllocationData_ACU(canonicalData, reseedPlan.metadataUpdates),
      });
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
    if ('error' in prepared) return { success: false, error: prepared.error };

    const metadataUpdates = mergeSqlSheetMetadataUpdates_ACU(reseedPlan.metadataUpdates, prepared.metadataUpdates);
    const snapshot = provider.createRuntimeSnapshot!();
    if (snapshot == null) return { success: false, error: 'SQLite runtime snapshot 创建失败，拒绝执行不可补偿的写入。' };

    let batchResult;
    try {
      batchResult = provider.applyEditsBatchWithSheetMetadata!(
        [...reseedPlan.statements, ...prepared.statements],
        [...reseedPlan.paramsList, ...prepared.paramsList],
        metadataUpdates,
        options.reason,
        { includeImplicitReseed: false },
      );
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
    if (!batchResult.success) {
      return { success: false, error: batchResult.error || `${options.reason}: SQLite atomic batch failed` };
    }

    try {
      const tableData = provider.exportCanonicalData!();
      const validationError = prepared.validate?.(tableData);
      if (validationError) throw new Error(validationError);
      const businessChanges = Array.isArray(batchResult.statementChanges)
        ? batchResult.statementChanges.slice(reseedPlan.statements.length).reduce((sum, value) => sum + value, 0)
        : (batchResult.changes ?? batchResult.appliedEdits);
      return {
        success: true,
        value: prepared.mapValue(tableData),
        tableData,
        mutationResult: { changes: businessChanges, errors: [] },
        persist: { operations: [...reseedOperations, ...prepared.operations] },
      };
    } catch (error: unknown) {
      await restoreRuntimeAfterPostCommitFailure_ACU(provider, snapshot, error);
    }
  });
}

import { getChatArray_ACU, saveChatToHost_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { cloneIsolatedData_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import type { ManualRefillProgressV2_ACU, TableMutationEventV2_ACU, TableMutationLogEntryV2_ACU, TableMutationSourceV2_ACU, TableStorageFrameV2_ACU, TableCheckpointV2_ACU, TableMutationWriteSetV2_ACU, TableMutationOperationV2_ACU, TableSheetCheckpointV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { collectScheduleSummaryFromFramesV2_ACU } from './storage-frame-v2-replay';
import type { TableWriteTransactionContext_ACU } from './table-write-transaction';

export interface TableCheckpointGenerationConfig_ACU {
  maxEntriesAfterCheckpoint: number;
  maxOperationKbAfterCheckpoint: number;
  maxOperationBytesAfterCheckpoint: number;
  maxOperationCountAfterCheckpoint: number;
  cumulativeOperationRatioPercent: number;
  singleOperationRatioPercent: number;
  cumulativeOperationRatio: number;
  singleOperationRatio: number;
}

export interface TableCheckpointGenerationStatus_ACU {
  latestCheckpointMessageIndex?: number;
  latestCheckpointAiFloor?: number;
  entryCountAfterCheckpoint: number;
  cumulativeOperationBytes: number;
  cumulativeOperationCount: number;
  fullCheckpointBytes: number;
  nextWriteKind: 'incremental' | 'full';
  config: TableCheckpointGenerationConfig_ACU;
}

export interface PersistTableMutationV2Options_ACU {
  targetMessageIndex?: number;
  source: TableMutationSourceV2_ACU;
  afterData: TableDataObject_ACU;
  operations?: TableMutationOperationV2_ACU[];
  filledSheetKeys?: string[];
  candidateChangedSheetKeys?: string[] | null;
  groupKeys?: string[];
  requestId?: string;
  batchId?: string;
  error?: string;
  forceCheckpoint?: boolean;
  checkpointReason?: TableCheckpointV2_ACU['reason'];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  isolationKey?: string;
  baseRevision?: string | null;
  parentRevision?: string | null;
  writeSet?: TableMutationWriteSetV2_ACU;
  revisionWriteSet?: TableMutationWriteSetV2_ACU;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用，避免嵌套 commit 锁。 */
  assumeCommitLock?: boolean;
  /** 对破坏性复合写入要求宿主真实保存；默认保持历史宽松保存语义。 */
  strictSave?: boolean;
  transactionContext?: Pick<TableWriteTransactionContext_ACU, 'runCommit' | 'baseRevision' | 'writeSet' | 'assertFresh'>;
}

export interface PersistTableSheetCheckpointV2Options_ACU {
  targetMessageIndex?: number;
  sheetKey: string;
  sheetData: Sheet_ACU;
  reason?: TableCheckpointV2_ACU['reason'];
  createdAt?: number;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  isolationKey?: string;
  baseRevision?: string | null;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用，避免嵌套 commit 锁。 */
  assumeCommitLock?: boolean;
  transactionContext?: Pick<TableWriteTransactionContext_ACU, 'runCommit' | 'baseRevision' | 'writeSet' | 'assertFresh'>;
}

function safeJsonByteLength_ACU(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function countOperationUnits_ACU(operations: unknown[]): number {
  return operations.reduce<number>((sum, operation: any) => {
    if ((operation?.kind === 'sql_batch' || operation?.kind === 'sql_sheet_batch') && Array.isArray(operation.statements)) return sum + operation.statements.length;
    if (operation?.kind === 'data_replace' || operation?.kind === 'sheet_replace') return sum + 1;
    return sum + 1;
  }, 0);
}

function normalizePositiveIntegerSetting_ACU(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 1 ? Math.floor(num) : fallback;
}

export function resolveCheckpointGenerationConfig_ACU(): TableCheckpointGenerationConfig_ACU {
  // 单一保留边界 checkpoint 策略下，运行期 full checkpoint 不再由用户阈值触发。
  // 这里保留 status shape 给旧调用方读取日志统计，但这些值不再参与写入判定。
  const maxOperationKbAfterCheckpoint = Number.MAX_SAFE_INTEGER;
  const cumulativeOperationRatioPercent = 100;
  const singleOperationRatioPercent = 100;

  return {
    maxEntriesAfterCheckpoint: Number.MAX_SAFE_INTEGER,
    maxOperationKbAfterCheckpoint,
    maxOperationBytesAfterCheckpoint: maxOperationKbAfterCheckpoint * 1024,
    maxOperationCountAfterCheckpoint: Number.MAX_SAFE_INTEGER,
    cumulativeOperationRatioPercent,
    singleOperationRatioPercent,
    cumulativeOperationRatio: cumulativeOperationRatioPercent / 100,
    singleOperationRatio: singleOperationRatioPercent / 100,
  };
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function generateEntryId_ACU(): string {
  return `v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildCommitRevision_ACU(seq: number | 'checkpoint', entryId: string): string {
  return `${seq}:${entryId}`;
}

function findTargetAiMessage_ACU(chat: any[], targetMessageIndex: number | undefined): { message: any; index: number } | null {
  if (targetMessageIndex !== undefined && targetMessageIndex !== -1) {
    const message = chat[targetMessageIndex];
    if (message && !message.is_user) {
      return { message, index: targetMessageIndex };
    }
    return null;
  }

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i] && !chat[i].is_user) {
      return { message: chat[i], index: i };
    }
  }

  return null;
}

function countAiFloor_ACU(chat: any[], messageIndex: number): number {
  let count = 0;
  for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
    if (chat[i] && !chat[i].is_user) count += 1;
  }
  return count;
}

function hasAnyV2Checkpoint_ACU(chat: any[], isolationKey: string): boolean {
  return chat.some(message => {
    const tagData = message?.TavernDB_ACU_IsolatedData?.[isolationKey];
    return isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full';
  });
}

function hasAnyV2Frame_ACU(chat: any[], isolationKey: string): boolean {
  return chat.some(message => {
    const tagData = message?.TavernDB_ACU_IsolatedData?.[isolationKey];
    return isV2TagData_ACU(tagData);
  });
}

export function getLatestTableStorageHeadRevisionV2_ACU(chat: any[] | null | undefined, isolationKey: string): string | null {
  if (!Array.isArray(chat) || chat.length === 0) return null;
  let headRevision: string | null = null;
  for (const message of chat) {
    const tagData = message?.TavernDB_ACU_IsolatedData?.[isolationKey];
    if (isV2TagData_ACU(tagData)) {
      headRevision = tagData.storageFrame.headRevision ?? headRevision;
    }
  }
  return headRevision;
}

function findLatestFullCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
): { message: any; index: number; checkpoint: TableCheckpointV2_ACU } | null {
  if (!Array.isArray(chat) || chat.length === 0) return null;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const tagData = chat[i]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    if (isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full') {
      return { message: chat[i], index: i, checkpoint: tagData.storageFrame.checkpoint };
    }
  }
  return null;
}

function getLogEntriesAfterLatestCheckpoint_ACU(chat: any[], isolationKey: string): TableMutationLogEntryV2_ACU[] {
  const latestCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  const latestCheckpointIndex = latestCheckpoint?.index ?? -1;
  const entries: TableMutationLogEntryV2_ACU[] = [];
  for (let i = Math.max(0, latestCheckpointIndex); i < chat.length; i += 1) {
    const tagData = chat[i]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    if (isV2TagData_ACU(tagData)) {
      entries.push(...(tagData.storageFrame.logEntries || []));
    }
  }
  return entries;
}

export function collectCheckpointGenerationStatusV2_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  currentData?: TableDataObject_ACU | null,
): TableCheckpointGenerationStatus_ACU {
  const config = resolveCheckpointGenerationConfig_ACU();
  const safeChat = Array.isArray(chat) ? chat : [];
  const latestCheckpoint = findLatestFullCheckpoint_ACU(safeChat, isolationKey);
  const previousEntries = getLogEntriesAfterLatestCheckpoint_ACU(safeChat, isolationKey);
  const previousOperations = previousEntries.flatMap(entry => entry.operations || []);
  const fullCheckpointSource = currentData || latestCheckpoint?.checkpoint?.data || {};
  const fullCheckpointBytes = Math.max(1, safeJsonByteLength_ACU(fullCheckpointSource));
  const cumulativeOperationBytes = safeJsonByteLength_ACU(previousOperations);
  const cumulativeOperationCount = countOperationUnits_ACU(previousOperations);

  return {
    ...(latestCheckpoint ? {
      latestCheckpointMessageIndex: latestCheckpoint.index,
      latestCheckpointAiFloor: countAiFloor_ACU(safeChat, latestCheckpoint.index),
    } : {}),
    entryCountAfterCheckpoint: previousEntries.length,
    cumulativeOperationBytes,
    cumulativeOperationCount,
    fullCheckpointBytes,
    nextWriteKind: latestCheckpoint ? 'incremental' : 'full',
    config,
  };
}

function normalizeKeys_ACU(keys: string[] | null | undefined, data?: TableDataObject_ACU): string[] {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter(key => typeof key === 'string' && key.startsWith('sheet_') && (!data || Boolean(data[key]))))];
}

function normalizeOperations_ACU(
  operations: TableMutationOperationV2_ACU[] | null | undefined,
  afterData: TableDataObject_ACU,
  source: TableMutationSourceV2_ACU,
): TableMutationOperationV2_ACU[] {
  if (Array.isArray(operations) && operations.length > 0) {
    return deepClone_ACU(operations);
  }
  if (source === 'import') {
    return [{
      kind: 'data_replace',
      data: deepClone_ACU(afterData),
      reason: 'import',
    }];
  }
  return [];
}

function getOrInitV2Frame_ACU(isolatedData: Record<string, any>, isolationKey: string): TableStorageFrameV2_ACU {
  const tagData = isolatedData[isolationKey];
  if (isV2TagData_ACU(tagData)) {
    return tagData.storageFrame;
  }

  const nextTagData: any = {
    storageFrame: {
      version: 2,
      logEntries: [],
    },
    _acu_storage_version: 2,
  };

  if (tagData?.summaryVectorIndexState !== undefined) {
    nextTagData.summaryVectorIndexState = tagData.summaryVectorIndexState;
  }
  if (tagData?.summaryVectorIndexManifest !== undefined) {
    nextTagData.summaryVectorIndexManifest = tagData.summaryVectorIndexManifest;
  }

  isolatedData[isolationKey] = nextTagData;
  return nextTagData.storageFrame;
}

function isObjectRecord_ACU(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function logEntryConflictsWithSheetCheckpoint_ACU(entry: TableMutationLogEntryV2_ACU, sheetKey: string): boolean {
  if ([...(entry.filledSheetKeys || []), ...(entry.changedSheetKeys || []), ...(entry.groupKeys || [])].includes(sheetKey)) {
    return true;
  }

  for (const operation of entry.operations || []) {
    if (operation.kind === 'data_replace' || operation.kind === 'sql_batch' || operation.kind === 'table_edit_dsl') {
      return true;
    }
    if ('sheetKey' in operation && operation.sheetKey === sheetKey) {
      return true;
    }
  }

  return (entry.patches || []).some(patch => patch.sheetKey === sheetKey);
}

function validateSheetCheckpointInput_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): { createdAt: number; reason: TableCheckpointV2_ACU['reason'] } | { error: string } {
  if (typeof options.sheetKey !== 'string' || !options.sheetKey.startsWith('sheet_')) {
    return { error: 'V2 sheet checkpoint requires a sheetKey beginning with "sheet_".' };
  }
  if (!isObjectRecord_ACU(options.sheetData)) {
    return { error: `V2 sheet checkpoint requires object sheetData for ${options.sheetKey}.` };
  }
  if (!options.reason) {
    return { error: 'V2 sheet checkpoint requires an explicit checkpoint reason.' };
  }
  const createdAt = options.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { error: 'V2 sheet checkpoint requires a finite non-negative createdAt.' };
  }
  return { createdAt, reason: options.reason };
}

async function persistTableMutationLogV2Core_ACU(
  options: PersistTableMutationV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; entry?: TableMutationLogEntryV2_ACU; error?: string }> {
  const chat = getChatArray_ACU();
  if (!chat || chat.length === 0) {
    return { saved: false, error: 'chat history is empty' };
  }

  const target = findTargetAiMessage_ACU(chat, options.targetMessageIndex);
  if (!target) {
    return { saved: false, error: 'no AI message found' };
  }

  options.transactionContext?.assertFresh?.('persistTableMutationLogV2:before_persist');
  if (!chat[target.index] || chat[target.index] !== target.message || target.message.is_user) {
    return { saved: false, error: 'target AI message changed before persist; abort stale table write.' };
  }

  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const afterData = deepClone_ACU(options.afterData);
  const filledSheetKeys = normalizeKeys_ACU(options.filledSheetKeys, afterData);
  const candidateChangedSheetKeys = normalizeKeys_ACU(options.candidateChangedSheetKeys, afterData);
  const operations = normalizeOperations_ACU(options.operations, afterData, options.source);
  const effectiveChangedSheetKeys = candidateChangedSheetKeys;

  const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
  const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
  const currentWriteSet = options.writeSet ?? options.transactionContext?.writeSet;
  const revisionWriteSet = options.revisionWriteSet;
  const requestedBaseRevision = options.baseRevision !== undefined
    ? options.baseRevision
    : options.transactionContext?.baseRevision;

  const hasExistingCheckpoint = hasAnyV2Checkpoint_ACU(chat, isolationKey);
  const hasExistingV2Frame = hasAnyV2Frame_ACU(chat, isolationKey);
  const hasMetadataOnlyFillEvent = filledSheetKeys.length > 0 || (Array.isArray(options.groupKeys) && options.groupKeys.length > 0);
  const hasManualRefillProgress = !!options.manualRefillProgress;
  if (operations.length === 0 && !hasMetadataOnlyFillEvent && !hasManualRefillProgress && options.source !== 'import' && hasExistingCheckpoint) {
    return { saved: false, error: `V2 operation log requires explicit operations for source=${options.source}; snapshot diff fallback is not allowed.` };
  }

  const initialCheckpointReason: TableCheckpointV2_ACU['reason'] = options.checkpointReason
    || (hasExistingV2Frame ? 'migration' : 'init');
  const shouldCheckpoint = !hasExistingCheckpoint
    && (initialCheckpointReason === 'init' || initialCheckpointReason === 'migration');

  if (options.forceCheckpoint && !shouldCheckpoint) {
    logWarn_ACU(`[V2 Persist] 单一保留边界 checkpoint 策略已忽略非初次 forceCheckpoint：reason=${options.checkpointReason || 'unspecified'}, source=${options.source}`);
  }

  if (options.manualRefillProgress) {
    frame.manualRefillProgress = deepClone_ACU(options.manualRefillProgress);
  }
  const now = Date.now();
  const aiFloor = countAiFloor_ACU(chat, target.index);
  let entry: TableMutationLogEntryV2_ACU | undefined;

  if (shouldCheckpoint) {
    const checkpointRevision = buildCommitRevision_ACU('checkpoint', generateEntryId_ACU());
    const checkpointEvent = {
      filledSheetKeys,
      changedSheetKeys: effectiveChangedSheetKeys,
      groupKeys: options.groupKeys || [],
      requestId: options.requestId,
      batchId: options.batchId,
      error: options.error,
    };
    frame.checkpoint = {
      kind: 'full',
      createdAt: now,
      reason: initialCheckpointReason,
      data: afterData,
      scheduleSummary: collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index }),
      event: checkpointEvent,
    };
    frame.headRevision = checkpointRevision;
    frame.logEntries = [];
    logDebug_ACU(`[V2 Persist] 写入 full checkpoint: messageIndex=${target.index}, revision=${checkpointRevision}, sheets=${Object.keys(afterData).filter(k => k.startsWith('sheet_')).length}`);
  } else {
    const nextSeq = Math.max(0, ...frame.logEntries.map(item => Number(item.seq) || 0)) + 1;
    const entryId = generateEntryId_ACU();
    const parentRevision = options.parentRevision !== undefined ? options.parentRevision : (frame.headRevision ?? null);
    const commitRevision = buildCommitRevision_ACU(nextSeq, entryId);
    entry = {
      seq: nextSeq,
      entryId,
      createdAt: now,
      source: options.source,
      targetMessageIndex: target.index,
      aiFloor,
      filledSheetKeys,
      changedSheetKeys: effectiveChangedSheetKeys,
      groupKeys: options.groupKeys || [],
      requestId: options.requestId,
      batchId: options.batchId,
      error: options.error,
      operations,
      baseRevision: requestedBaseRevision ?? parentRevision,
      parentRevision,
      commitRevision,
      writeSet: currentWriteSet,
    };
    frame.logEntries.push(entry);
    frame.headRevision = commitRevision;
    logDebug_ACU(`[V2 Persist] 追加 operation log entry: messageIndex=${target.index}, seq=${entry.seq}, revision=${commitRevision}, operations=${operations.length}`);
  }

  target.message.TavernDB_ACU_IsolatedData = isolatedData;
  writeMessageIdentity_ACU(target.message, {
    enabled: settings_ACU.dataIsolationEnabled,
    code: settings_ACU.dataIsolationCode,
  });

  if (operations.length === 0 && filledSheetKeys.length === 0 && !shouldCheckpoint) {
    logWarn_ACU(`[V2 Persist] 无 operation 且无 filled 事件，仍保存空日志事件: messageIndex=${target.index}`);
  }

  if (options.strictSave) {
    await saveChatToHostStrict_ACU();
  } else {
    await saveChatToHost_ACU();
  }
  return { saved: true, messageIndex: target.index, entry };
}

export async function persistTableMutationLogV2_ACU(
  options: PersistTableMutationV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; entry?: TableMutationLogEntryV2_ACU; error?: string }> {
  if (!options.transactionContext) {
    return { saved: false, error: 'V2 operation log write requires TableWriteTransactionContext; direct unsafe writes are not allowed.' };
  }
  if (options.assumeCommitLock) {
    return persistTableMutationLogV2Core_ACU(options);
  }
  return options.transactionContext.runCommit(() => persistTableMutationLogV2Core_ACU(options), options.revisionWriteSet);
}

async function persistTableSheetCheckpointV2Core_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; checkpoint?: TableSheetCheckpointV2_ACU; error?: string }> {
  const validation = validateSheetCheckpointInput_ACU(options);
  if ('error' in validation) return { saved: false, error: validation.error };

  const chat = getChatArray_ACU();
  if (!chat || chat.length === 0) {
    return { saved: false, error: 'chat history is empty' };
  }
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const latestFullCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  if (!latestFullCheckpoint) {
    return { saved: false, error: 'V2 sheet checkpoint requires an existing full checkpoint anchor.' };
  }

  const target = findTargetAiMessage_ACU(chat, options.targetMessageIndex);
  if (!target) {
    return { saved: false, error: 'no AI message found' };
  }
  if (target.index < latestFullCheckpoint.index) {
    return { saved: false, error: `V2 sheet checkpoint target precedes the latest full checkpoint and would never replay: targetMessageIndex=${target.index}, latestFullCheckpointIndex=${latestFullCheckpoint.index}.` };
  }

  options.transactionContext?.assertFresh?.('persistTableSheetCheckpointV2:before_persist');
  if (!chat[target.index] || chat[target.index] !== target.message || target.message.is_user) {
    return { saved: false, error: 'target AI message changed before persist; abort stale sheet checkpoint write.' };
  }

  const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
  const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
  const conflictingEntry = (frame.logEntries || []).find(entry => logEntryConflictsWithSheetCheckpoint_ACU(entry, options.sheetKey));
  if (conflictingEntry) {
    return {
      saved: false,
      error: `V2 sheet checkpoint cannot be inserted before an existing target-sheet log entry: sheetKey=${options.sheetKey}, entryId=${conflictingEntry.entryId}.`,
    };
  }

  const existingCheckpoint = frame.perSheetCheckpoints?.[options.sheetKey];
  if (existingCheckpoint && Number(existingCheckpoint.createdAt) > validation.createdAt) {
    return {
      saved: false,
      error: `V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${options.sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${validation.createdAt}.`,
    };
  }

  const scheduleSummary = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index })[options.sheetKey];
  const checkpoint: TableSheetCheckpointV2_ACU = {
    kind: 'sheet_full',
    createdAt: validation.createdAt,
    reason: validation.reason,
    sheetKey: options.sheetKey,
    data: deepClone_ACU(options.sheetData),
    ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
    ...(options.event ? { event: deepClone_ACU(options.event) } : {}),
    ...(options.manualRefillProgress ? { manualRefillProgress: deepClone_ACU(options.manualRefillProgress) } : {}),
    ...(options.baseRevision !== undefined || options.transactionContext?.baseRevision !== undefined
      ? { baseRevision: options.baseRevision !== undefined ? options.baseRevision : options.transactionContext?.baseRevision }
      : {}),
  };

  const hadIsolatedData = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_IsolatedData');
  const previousIsolatedData = target.message.TavernDB_ACU_IsolatedData;
  const hadIdentity = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_Identity');
  const previousIdentity = target.message.TavernDB_ACU_Identity;
  frame.perSheetCheckpoints = {
    ...(frame.perSheetCheckpoints || {}),
    [options.sheetKey]: checkpoint,
  };
  try {
    target.message.TavernDB_ACU_IsolatedData = isolatedData;
    writeMessageIdentity_ACU(target.message, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });
    await saveChatToHost_ACU();
  } catch (error) {
    if (hadIsolatedData) {
      target.message.TavernDB_ACU_IsolatedData = previousIsolatedData;
    } else {
      delete target.message.TavernDB_ACU_IsolatedData;
    }
    if (hadIdentity) {
      target.message.TavernDB_ACU_Identity = previousIdentity;
    } else {
      delete target.message.TavernDB_ACU_Identity;
    }
    throw error;
  }
  logDebug_ACU(`[V2 Persist] 写入单表 checkpoint: messageIndex=${target.index}, sheetKey=${options.sheetKey}, createdAt=${checkpoint.createdAt}`);
  return { saved: true, messageIndex: target.index, checkpoint };
}

export async function persistTableSheetCheckpointV2_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; checkpoint?: TableSheetCheckpointV2_ACU; error?: string }> {
  if (!options.transactionContext) {
    return { saved: false, error: 'V2 sheet checkpoint write requires TableWriteTransactionContext; direct unsafe writes are not allowed.' };
  }
  if (options.assumeCommitLock) return persistTableSheetCheckpointV2Core_ACU(options);
  return options.transactionContext.runCommit(() => persistTableSheetCheckpointV2Core_ACU(options), []);
}

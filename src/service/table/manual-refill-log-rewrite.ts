import { saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { readIsolatedTagData_ACU, writeIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { TableMutationLogEntryV2_ACU } from './storage-frame-v2-types';
import { deriveLogEntrySheetKey_ACU, validateSingleTableLogEntryDraft_ACU } from './storage-frame-v2-log-utils';
import { normalizeV2OperationLogToSingleTableRecords_ACU } from './storage-frame-v2-normalize';
import { loadTableStateFromFramesV2_ACU } from './storage-frame-v2-replay';
import { isV2TagData_ACU } from './storage-strategy-resolver';

export interface ManualRefillDirtyCheckpoint_ACU {
  messageIndex: number;
  rebuilt: boolean;
}

export interface ManualRefillLogRewriteSession_ACU {
  originalChat: any[];
  chat: any[];
  isolationKey: string;
  startMessageIndex: number;
  endMessageIndex: number;
  selectedSheetKeys: string[];
  removedEntries: number;
  dirtyCheckpoints: ManualRefillDirtyCheckpoint_ACU[];
  refillId: string;
  completedSaveTargetIndices: number[];
}

export interface ManualRefillLogRewriteResult_ACU {
  success: boolean;
  session?: ManualRefillLogRewriteSession_ACU;
  removedEntries?: number;
  error?: string;
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function entryHasNonDataEvent_ACU(entry: TableMutationLogEntryV2_ACU): boolean {
  return Boolean(entry.error || entry.requestId || entry.batchId)
    || (Array.isArray(entry.filledSheetKeys) && entry.filledSheetKeys.length > 0)
    || (Array.isArray(entry.groupKeys) && entry.groupKeys.length > 0);
}

function rebuildFrameSeq_ACU(entries: TableMutationLogEntryV2_ACU[], previousHeadRevision: string | null | undefined): string | null | undefined {
  let parentRevision = previousHeadRevision ?? null;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    entry.seq = i + 1;
    entry.parentRevision = parentRevision;
    entry.commitRevision = `${entry.seq}:${entry.entryId}`;
    parentRevision = entry.commitRevision;
  }
  return entries.length > 0 ? entries[entries.length - 1].commitRevision : previousHeadRevision;
}

export function prepareManualRefillLogRewrite_ACU(options: {
  chat: any[];
  isolationKey: string;
  startMessageIndex: number;
  endMessageIndex: number;
  selectedSheetKeys: string[];
  refillId: string;
  plannedSaveTargetIndices: number[];
}): ManualRefillLogRewriteResult_ACU {
  const chatClone = deepClone_ACU(options.chat || []);
  const selectedSet = new Set((options.selectedSheetKeys || []).filter(key => typeof key === 'string' && key.startsWith('sheet_')));
  if (selectedSet.size === 0) return { success: false, error: '手动重填清旧缺少 selectedSheetKeys。' };

  const normalizeResult = normalizeV2OperationLogToSingleTableRecords_ACU({
    chat: chatClone,
    isolationKey: options.isolationKey,
    mode: 'before_manual_refill',
  });
  if (normalizeResult.errors.length > 0) {
    return { success: false, error: `手动重填前 V2 操作记录归一化失败：${normalizeResult.errors.join('; ')}` };
  }

  let removedEntries = 0;
  const plannedSaveTargetSet = new Set(options.plannedSaveTargetIndices || []);
  const completedSaveTargetSet = new Set<number>();
  const dirtyCheckpoints: ManualRefillDirtyCheckpoint_ACU[] = [];
  for (let messageIndex = Math.max(0, options.startMessageIndex); messageIndex <= options.endMessageIndex && messageIndex < chatClone.length; messageIndex += 1) {
    const message = chatClone[messageIndex];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, options.isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const frame = tagData.storageFrame;
    if (frame.checkpoint?.kind === 'full') dirtyCheckpoints.push({ messageIndex, rebuilt: false });
    if (!Array.isArray(frame.logEntries) || frame.logEntries.length === 0) continue;
    const previousHeadRevision = frame.checkpoint ? frame.headRevision ?? null : null;
    const kept: TableMutationLogEntryV2_ACU[] = [];
    for (const entry of frame.logEntries) {
      const sheetResult = deriveLogEntrySheetKey_ACU(entry, frame.checkpoint?.data || null);
      if (!sheetResult.sheetKey) return { success: false, error: `手动重填清旧失败：messageIndex=${messageIndex}, entry=${entry.entryId || entry.seq}: ${sheetResult.error}` };
      if (selectedSet.has(sheetResult.sheetKey)) {
        const batchId = typeof entry.batchId === 'string' ? entry.batchId : '';
        const refillPrefix = `manual_refill:${options.refillId}:`;
        if (batchId.startsWith(refillPrefix) && plannedSaveTargetSet.has(entry.targetMessageIndex)) {
          completedSaveTargetSet.add(entry.targetMessageIndex);
          kept.push(deepClone_ACU(entry));
          continue;
        }
        removedEntries += 1;
        continue;
      }
      const validation = validateSingleTableLogEntryDraft_ACU({
        operations: entry.operations || [],
        changedSheetKeys: [sheetResult.sheetKey],
        filledSheetKeys: (entry.filledSheetKeys || []).filter(key => key === sheetResult.sheetKey),
        groupKeys: (entry.groupKeys || []).filter(key => key === sheetResult.sheetKey),
        writeSet: entry.writeSet,
      }, frame.checkpoint?.data || null);
      if (validation.ok === false) return { success: false, error: `手动重填清旧保留 entry 校验失败：${validation.error}` };
      const nextEntry = deepClone_ACU(entry);
      nextEntry.changedSheetKeys = validation.changedSheetKeys;
      nextEntry.filledSheetKeys = validation.filledSheetKeys;
      nextEntry.groupKeys = validation.groupKeys;
      nextEntry.writeSet = validation.writeSet;
      if ((nextEntry.operations || []).length > 0 || entryHasNonDataEvent_ACU(nextEntry)) kept.push(nextEntry);
    }
    frame.logEntries = kept;
    frame.headRevision = rebuildFrameSeq_ACU(frame.logEntries, previousHeadRevision);
    writeIsolatedTagData_ACU(message, options.isolationKey, tagData);
  }

  return {
    success: true,
    removedEntries,
    session: {
      chat: chatClone,
      originalChat: options.chat,
      isolationKey: options.isolationKey,
      startMessageIndex: options.startMessageIndex,
      endMessageIndex: options.endMessageIndex,
      selectedSheetKeys: [...selectedSet],
      removedEntries,
      dirtyCheckpoints,
      refillId: options.refillId,
      completedSaveTargetIndices: [...completedSaveTargetSet].sort((a, b) => a - b),
    },
  };
}

export function applyManualRefillLogRewriteInMemory_ACU(session: ManualRefillLogRewriteSession_ACU): void {
  session.originalChat.splice(0, session.originalChat.length, ...deepClone_ACU(session.chat));
}

export async function rebuildManualRefillCheckpoint_ACU(
  session: ManualRefillLogRewriteSession_ACU,
  messageIndex: number,
): Promise<{ success: boolean; error?: string }> {
  const message = session.originalChat[messageIndex];
  const tagData = readIsolatedTagData_ACU(message, session.isolationKey) as any;
  if (!isV2TagData_ACU(tagData) || tagData.storageFrame.checkpoint?.kind !== 'full') return { success: true };
  const savedCheckpoint = deepClone_ACU(tagData.storageFrame.checkpoint);
  delete tagData.storageFrame.checkpoint;
  writeIsolatedTagData_ACU(message, session.isolationKey, tagData);
  try {
    const rebuiltData = await loadTableStateFromFramesV2_ACU(session.originalChat, session.isolationKey, { maxMessageIndex: messageIndex });
    tagData.storageFrame.checkpoint = {
      ...savedCheckpoint,
      data: rebuiltData as any,
      scheduleSummary: savedCheckpoint.scheduleSummary,
    };
    writeIsolatedTagData_ACU(message, session.isolationKey, tagData);
    const dirty = session.dirtyCheckpoints.find(item => item.messageIndex === messageIndex);
    if (dirty) dirty.rebuilt = true;
    return { success: true };
  } catch (error: any) {
    tagData.storageFrame.checkpoint = savedCheckpoint;
    writeIsolatedTagData_ACU(message, session.isolationKey, tagData);
    return { success: false, error: `重建范围内 checkpoint 失败：messageIndex=${messageIndex}: ${error?.message || String(error)}` };
  }
}

export async function rebuildManualRefillCheckpointsReady_ACU(
  session: ManualRefillLogRewriteSession_ACU,
  completedSaveTargetIndices: number[],
  allPlannedSaveTargetIndices: number[],
): Promise<{ success: boolean; rebuilt: number[]; error?: string }> {
  const rebuilt: number[] = [];
  const completed = new Set(completedSaveTargetIndices);
  for (const checkpoint of session.dirtyCheckpoints) {
    if (checkpoint.rebuilt) continue;
    const blockers = allPlannedSaveTargetIndices.filter(index => index <= checkpoint.messageIndex && !completed.has(index));
    if (blockers.length > 0) continue;
    const result = await rebuildManualRefillCheckpoint_ACU(session, checkpoint.messageIndex);
    if (!result.success) return { success: false, rebuilt, error: result.error };
    rebuilt.push(checkpoint.messageIndex);
  }
  return { success: true, rebuilt };
}

export async function saveManualRefillRewrite_ACU(): Promise<{ success: boolean; error?: string }> {
  await saveChatToHost_ACU();
  return { success: true };
}

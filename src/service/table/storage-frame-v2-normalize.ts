import { readIsolatedTagData_ACU, writeIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TableMutationWriteSetV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { groupOperationsBySingleSheet_ACU, validateSingleTableLogEntryDraft_ACU } from './storage-frame-v2-log-utils';

export interface NormalizeV2OperationLogOptions_ACU {
  chat: any[];
  isolationKey: string;
  mode: 'on_import' | 'before_manual_refill' | 'repair';
}

export interface NormalizeV2OperationLogResult_ACU {
  changed: boolean;
  errors: string[];
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function generateEntryId_ACU(): string {
  return `v2_norm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildWriteSetForSheet_ACU(sheetKey: string, original?: TableMutationWriteSetV2_ACU): TableMutationWriteSetV2_ACU | undefined {
  if (!Array.isArray(original)) return undefined;
  const filtered = original.filter(unit => (unit as any)?.sheetKey === sheetKey) as TableMutationWriteSetV2_ACU;
  return filtered.length > 0 ? filtered : [{ kind: 'sheet', sheetKey }];
}

function isNonDataReplaceOperation_ACU(operation: TableMutationOperationV2_ACU): boolean {
  return operation?.kind !== 'data_replace';
}

function normalizeEntry_ACU(
  entry: TableMutationLogEntryV2_ACU,
  tableData: Record<string, any> | null,
): { entries: TableMutationLogEntryV2_ACU[]; changed: boolean; error?: string } {
  const operations = (entry.operations || []).filter(isNonDataReplaceOperation_ACU);
  if (operations.length !== (entry.operations || []).length) {
    return { entries: [], changed: false, error: `entry ${entry.entryId || entry.seq} 包含 data_replace，无法归一化为单表增量记录。` };
  }
  const grouped = groupOperationsBySingleSheet_ACU(operations, tableData as any);
  if (grouped.ok === false) return { entries: [], changed: false, error: `entry ${entry.entryId || entry.seq} 归一化失败: ${grouped.error}` };
  const nextEntries: TableMutationLogEntryV2_ACU[] = [];
  for (const draft of grouped.entries) {
    const validation = validateSingleTableLogEntryDraft_ACU({
      ...draft,
      filledSheetKeys: (entry.filledSheetKeys || []).filter(key => key === draft.changedSheetKeys?.[0]),
      groupKeys: (entry.groupKeys || []).filter(key => key === draft.changedSheetKeys?.[0]),
      writeSet: buildWriteSetForSheet_ACU(draft.changedSheetKeys?.[0] || '', entry.writeSet),
    }, tableData as any);
    if (validation.ok === false) return { entries: [], changed: false, error: `entry ${entry.entryId || entry.seq} 校验失败: ${validation.error}` };
    nextEntries.push({
      ...deepClone_ACU(entry),
      entryId: generateEntryId_ACU(),
      operations: deepClone_ACU(draft.operations),
      changedSheetKeys: validation.changedSheetKeys,
      filledSheetKeys: validation.filledSheetKeys,
      groupKeys: validation.groupKeys,
      writeSet: validation.writeSet,
    });
  }
  const changed = nextEntries.length !== 1
    || JSON.stringify(nextEntries[0].operations) !== JSON.stringify(entry.operations)
    || JSON.stringify(nextEntries[0].changedSheetKeys) !== JSON.stringify(entry.changedSheetKeys || []);
  if (!changed) return { entries: [entry], changed: false };
  return { entries: nextEntries, changed: true };
}

export function normalizeV2OperationLogToSingleTableRecords_ACU(
  options: NormalizeV2OperationLogOptions_ACU,
): NormalizeV2OperationLogResult_ACU {
  const errors: string[] = [];
  let changed = false;
  if (!Array.isArray(options.chat)) return { changed: false, errors: ['chat is not an array'] };

  for (let messageIndex = 0; messageIndex < options.chat.length; messageIndex += 1) {
    const message = options.chat[messageIndex];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, options.isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const frame = tagData.storageFrame;
    if (!Array.isArray(frame.logEntries) || frame.logEntries.length === 0) continue;
    const tableData = frame.checkpoint?.data || null;
    const normalizedEntries: TableMutationLogEntryV2_ACU[] = [];
    for (const entry of frame.logEntries) {
      const result = normalizeEntry_ACU(entry, tableData as any);
      if (result.error) errors.push(`messageIndex=${messageIndex}: ${result.error}`);
      normalizedEntries.push(...result.entries);
      changed ||= result.changed;
    }
    if (errors.length > 0) continue;
    normalizedEntries.forEach((entry, index) => {
      entry.seq = index + 1;
      entry.commitRevision = `${entry.seq}:${entry.entryId}`;
      entry.parentRevision = index === 0 ? (frame.checkpoint ? frame.headRevision ?? null : entry.parentRevision ?? null) : normalizedEntries[index - 1].commitRevision || null;
    });
    if (changed) {
      frame.logEntries = normalizedEntries;
      if (normalizedEntries.length > 0) frame.headRevision = normalizedEntries[normalizedEntries.length - 1].commitRevision;
      writeIsolatedTagData_ACU(message, options.isolationKey, tagData);
    }
  }

  return { changed: errors.length === 0 && changed, errors };
}

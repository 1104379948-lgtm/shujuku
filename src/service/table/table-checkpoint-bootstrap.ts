import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import { saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { parseTableTemplateJson_ACU } from '../../shared/utils';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { getTablePersistenceDeltasV2_ACU, hasTablePersistenceDeltasV2_ACU } from '../../shared/models/table-persistence-v2-utils';
import { applyTableDelta_ACU } from './table-delta-apply';
import { buildLegacyCheckpointFromChat_ACU } from './table-delta-migration';
import { readTablePersistenceLayerV2_ACU, writeTablePersistenceLayerV2_ACU, clearCurrentIsolationLegacyTableSnapshots_ACU } from './table-delta-repository';
import type { TableCheckpointSourceV2_ACU, TableCheckpointV2_ACU, TableLayerDeltaV2_ACU, TablePersistenceLayerV2_ACU } from './table-delta-types';
import { normalizeTableDataRowIdentity_ACU } from './table-row-identity';

export type ChatOpenCheckpointSource_ACU =
  | 'existing-checkpoint'
  | 'legacy-migration'
  | 'template-seed'
  | 'legacy-orphan-delta-repair'
  | 'template-orphan-delta-repair';

export interface EnsureChatOpenCheckpointOptions_ACU {
  chat: any[];
  isolationKey: string;
  isolationConfig: IsolationConfig_ACU;
  templateSheetKeys?: string[];
  retainRecentLayers?: number;
  save?: boolean;
}

export interface EnsureChatOpenCheckpointResult_ACU {
  changed: boolean;
  source: ChatOpenCheckpointSource_ACU;
  checkpointMessageIndex?: number;
  checkpointId?: string;
  reconstructedData: TableDataObject_ACU | null;
  orphanDeltaIds?: string[];
  earliestDeltaIndex?: number;
  sameLayerDeltaRolledIntoCheckpoint?: boolean;
  error?: string;
}

function cloneJson_ACU<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function hasAnySheet_ACU(data: TableDataObject_ACU | null | undefined): boolean {
  return !!data && typeof data === 'object' && Object.keys(data).some(key => key.startsWith('sheet_'));
}

function normalizeDataOrNull_ACU(data: TableDataObject_ACU | null | undefined): TableDataObject_ACU | null {
  const normalized = normalizeTableDataRowIdentity_ACU(data || null, { sourceLabel: 'ensureChatOpenCheckpoint' });
  return hasAnySheet_ACU(normalized) ? normalized : null;
}

function isWritableAiMessage_ACU(message: any): boolean {
  return !!message && !message.is_user;
}

function findLatestWritableAiMessageIndex_ACU(chat: any[]): number {
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (isWritableAiMessage_ACU(chat[i])) return i;
  }
  return -1;
}

function findPreviousWritableAiMessageIndex_ACU(chat: any[], beforeIndex: number): number {
  const start = Math.min(chat.length - 1, Math.trunc(Number(beforeIndex)) - 1);
  for (let i = start; i >= 0; i -= 1) {
    if (isWritableAiMessage_ACU(chat[i])) return i;
  }
  return -1;
}

function findExistingCheckpoint_ACU(
  chat: any[],
  isolationKey: string,
): { checkpoint: TableCheckpointV2_ACU; messageIndex: number } | null {
  for (let i = 0; i < chat.length; i += 1) {
    const message = chat[i];
    if (!isWritableAiMessage_ACU(message)) continue;
    const layer = readTablePersistenceLayerV2_ACU(message, isolationKey);
    if (layer?.checkpoint) {
      return { checkpoint: cloneJson_ACU(layer.checkpoint), messageIndex: i };
    }
  }
  return null;
}

function findFirstOrphanDelta_ACU(
  chat: any[],
  isolationKey: string,
): { messageIndex: number; deltas: TableLayerDeltaV2_ACU[] } | null {
  for (let i = 0; i < chat.length; i += 1) {
    const message = chat[i];
    if (!isWritableAiMessage_ACU(message)) continue;
    const layer = readTablePersistenceLayerV2_ACU(message, isolationKey);
    if (!hasTablePersistenceDeltasV2_ACU(layer)) continue;
    const deltas = getTablePersistenceDeltasV2_ACU(layer);
    if (deltas.length > 0) return { messageIndex: i, deltas };
  }
  return null;
}

function collectDeltasFromIndex_ACU(
  chat: any[],
  isolationKey: string,
  startIndex: number,
): TableLayerDeltaV2_ACU[] {
  const deltas: TableLayerDeltaV2_ACU[] = [];
  for (let i = Math.max(0, startIndex); i < chat.length; i += 1) {
    const message = chat[i];
    if (!isWritableAiMessage_ACU(message)) continue;
    const layer = readTablePersistenceLayerV2_ACU(message, isolationKey);
    for (const delta of getTablePersistenceDeltasV2_ACU(layer)) {
      deltas.push(cloneJson_ACU(delta));
    }
  }
  return deltas;
}

function createCheckpoint_ACU(options: {
  source: TableCheckpointSourceV2_ACU;
  isolationKey: string;
  messageIndex: number;
  data: TableDataObject_ACU;
}): TableCheckpointV2_ACU {
  return {
    kind: 'checkpoint',
    version: 2,
    checkpointId: `${options.source}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    source: options.source,
    isolationKey: options.isolationKey,
    messageIndexHint: options.messageIndex,
    data: cloneJson_ACU(options.data),
  };
}

function getTemplateCheckpointData_ACU(): TableDataObject_ACU | null {
  const templateData = parseTableTemplateJson_ACU({ stripSeedRows: false }) as TableDataObject_ACU | null;
  return normalizeDataOrNull_ACU(templateData ? cloneJson_ACU(templateData) : null);
}

function buildLegacyData_ACU(
  chat: any[],
  options: EnsureChatOpenCheckpointOptions_ACU,
  targetBoundaryMessageIndex: number,
): TableDataObject_ACU | null {
  const legacyResult = buildLegacyCheckpointFromChat_ACU(chat, {
    isolationKey: options.isolationKey,
    isolationConfig: options.isolationConfig,
    templateSheetKeys: options.templateSheetKeys,
    targetBoundaryMessageIndex,
  });
  return normalizeDataOrNull_ACU(legacyResult.checkpoint?.data ? cloneJson_ACU(legacyResult.checkpoint.data) : null);
}

function resolveBaseData_ACU(
  chat: any[],
  options: EnsureChatOpenCheckpointOptions_ACU,
  targetBoundaryMessageIndex: number,
): { data: TableDataObject_ACU | null; source: 'legacy' | 'template' } {
  const legacyData = buildLegacyData_ACU(chat, options, targetBoundaryMessageIndex);
  if (legacyData) return { data: legacyData, source: 'legacy' };
  return { data: getTemplateCheckpointData_ACU(), source: 'template' };
}

function applyDeltas_ACU(
  baseData: TableDataObject_ACU | null,
  deltas: TableLayerDeltaV2_ACU[],
): TableDataObject_ACU | null {
  let data = baseData ? cloneJson_ACU(baseData) : null;
  for (const delta of deltas) {
    data = applyTableDelta_ACU(data, delta);
  }
  return normalizeDataOrNull_ACU(data);
}

function writeCheckpointOnlyLayer_ACU(
  message: any,
  isolationKey: string,
  checkpoint: TableCheckpointV2_ACU,
): void {
  const layer: TablePersistenceLayerV2_ACU = {
    version: 2,
    checkpoint: cloneJson_ACU(checkpoint),
  };
  writeTablePersistenceLayerV2_ACU(message, isolationKey, layer);
}

function clearLegacySnapshotsThroughIndex_ACU(
  chat: any[],
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU,
  endIndexInclusive: number,
): void {
  const endIndex = Math.min(chat.length - 1, Math.max(-1, Math.trunc(Number(endIndexInclusive))));
  for (let i = 0; i <= endIndex; i += 1) {
    const message = chat[i];
    if (!isWritableAiMessage_ACU(message)) continue;
    clearCurrentIsolationLegacyTableSnapshots_ACU(message, isolationKey, isolationConfig);
  }
}

async function saveIfNeeded_ACU(save: boolean | undefined, changed: boolean): Promise<void> {
  if (!changed || save === false) return;
  await saveChatToHost_ACU();
}

export async function ensureChatOpenCheckpoint_ACU(
  options: EnsureChatOpenCheckpointOptions_ACU,
): Promise<EnsureChatOpenCheckpointResult_ACU> {
  const chat = Array.isArray(options.chat) ? options.chat : [];
  if (chat.length === 0) {
    return { changed: false, source: 'template-seed', reconstructedData: null, error: 'chat history is empty' };
  }

  const existingCheckpoint = findExistingCheckpoint_ACU(chat, options.isolationKey);
  if (existingCheckpoint) {
    return {
      changed: false,
      source: 'existing-checkpoint',
      checkpointMessageIndex: existingCheckpoint.messageIndex,
      checkpointId: existingCheckpoint.checkpoint.checkpointId,
      reconstructedData: normalizeDataOrNull_ACU(existingCheckpoint.checkpoint.data),
    };
  }

  const orphanDelta = findFirstOrphanDelta_ACU(chat, options.isolationKey);
  if (orphanDelta) {
    return repairOrphanDeltaCheckpoint_ACU(chat, options, orphanDelta);
  }

  const legacyData = buildLegacyData_ACU(chat, options, chat.length - 1);
  if (legacyData) {
    return writeBootstrapCheckpoint_ACU(chat, options, {
      source: 'legacy-migration',
      data: legacyData,
      anchorMessageIndex: findLatestWritableAiMessageIndex_ACU(chat),
      clearLegacyThroughIndex: chat.length - 1,
    });
  }

  const templateData = getTemplateCheckpointData_ACU();
  if (!templateData) {
    return { changed: false, source: 'template-seed', reconstructedData: null, error: 'template data is empty' };
  }

  return writeBootstrapCheckpoint_ACU(chat, options, {
    source: 'template-seed',
    data: templateData,
    anchorMessageIndex: findLatestWritableAiMessageIndex_ACU(chat),
    clearLegacyThroughIndex: chat.length - 1,
  });
}

async function writeBootstrapCheckpoint_ACU(
  chat: any[],
  options: EnsureChatOpenCheckpointOptions_ACU,
  params: {
    source: Exclude<ChatOpenCheckpointSource_ACU, 'existing-checkpoint'>;
    data: TableDataObject_ACU;
    anchorMessageIndex: number;
    clearLegacyThroughIndex: number;
  },
): Promise<EnsureChatOpenCheckpointResult_ACU> {
  if (params.anchorMessageIndex < 0 || !isWritableAiMessage_ACU(chat[params.anchorMessageIndex])) {
    return { changed: false, source: params.source, reconstructedData: null, error: 'no writable AI message' };
  }

  const checkpoint = createCheckpoint_ACU({
    source: params.source,
    isolationKey: options.isolationKey,
    messageIndex: params.anchorMessageIndex,
    data: params.data,
  });
  writeCheckpointOnlyLayer_ACU(chat[params.anchorMessageIndex], options.isolationKey, checkpoint);
  clearLegacySnapshotsThroughIndex_ACU(
    chat,
    options.isolationKey,
    options.isolationConfig,
    params.clearLegacyThroughIndex,
  );
  await saveIfNeeded_ACU(options.save, true);

  return {
    changed: true,
    source: params.source,
    checkpointMessageIndex: params.anchorMessageIndex,
    checkpointId: checkpoint.checkpointId,
    reconstructedData: normalizeDataOrNull_ACU(params.data),
  };
}

async function repairOrphanDeltaCheckpoint_ACU(
  chat: any[],
  options: EnsureChatOpenCheckpointOptions_ACU,
  orphanDelta: { messageIndex: number; deltas: TableLayerDeltaV2_ACU[] },
): Promise<EnsureChatOpenCheckpointResult_ACU> {
  const previousAnchorIndex = findPreviousWritableAiMessageIndex_ACU(chat, orphanDelta.messageIndex);
  const base = resolveBaseData_ACU(chat, options, orphanDelta.messageIndex - 1);
  if (!base.data) {
    const source: ChatOpenCheckpointSource_ACU = base.source === 'legacy'
      ? 'legacy-orphan-delta-repair'
      : 'template-orphan-delta-repair';
    return { changed: false, source, reconstructedData: null, earliestDeltaIndex: orphanDelta.messageIndex, error: 'template data is empty' };
  }

  if (previousAnchorIndex >= 0) {
    const source: Exclude<ChatOpenCheckpointSource_ACU, 'existing-checkpoint'> = base.source === 'legacy'
      ? 'legacy-orphan-delta-repair'
      : 'template-orphan-delta-repair';
    const futureDeltas = collectDeltasFromIndex_ACU(chat, options.isolationKey, orphanDelta.messageIndex);
    const reconstructedData = applyDeltas_ACU(base.data, futureDeltas);
    const result = await writeBootstrapCheckpoint_ACU(chat, options, {
      source,
      data: base.data,
      anchorMessageIndex: previousAnchorIndex,
      clearLegacyThroughIndex: previousAnchorIndex,
    });
    return {
      ...result,
      reconstructedData,
      orphanDeltaIds: futureDeltas.map(delta => delta.deltaId),
      earliestDeltaIndex: orphanDelta.messageIndex,
    };
  }

  if (!isWritableAiMessage_ACU(chat[orphanDelta.messageIndex])) {
    const source: ChatOpenCheckpointSource_ACU = base.source === 'legacy'
      ? 'legacy-orphan-delta-repair'
      : 'template-orphan-delta-repair';
    return { changed: false, source, reconstructedData: null, earliestDeltaIndex: orphanDelta.messageIndex, error: 'no writable checkpoint anchor' };
  }

  const rolledData = applyDeltas_ACU(base.data, orphanDelta.deltas);
  if (!rolledData) {
    const source: ChatOpenCheckpointSource_ACU = base.source === 'legacy'
      ? 'legacy-orphan-delta-repair'
      : 'template-orphan-delta-repair';
    return { changed: false, source, reconstructedData: null, earliestDeltaIndex: orphanDelta.messageIndex, error: 'rolled checkpoint data is empty' };
  }

  const source: Exclude<ChatOpenCheckpointSource_ACU, 'existing-checkpoint'> = base.source === 'legacy'
    ? 'legacy-orphan-delta-repair'
    : 'template-orphan-delta-repair';
  const checkpoint = createCheckpoint_ACU({
    source,
    isolationKey: options.isolationKey,
    messageIndex: orphanDelta.messageIndex,
    data: rolledData,
  });
  writeCheckpointOnlyLayer_ACU(chat[orphanDelta.messageIndex], options.isolationKey, checkpoint);
  clearLegacySnapshotsThroughIndex_ACU(chat, options.isolationKey, options.isolationConfig, orphanDelta.messageIndex);
  await saveIfNeeded_ACU(options.save, true);

  const laterDeltas = collectDeltasFromIndex_ACU(chat, options.isolationKey, orphanDelta.messageIndex + 1);
  return {
    changed: true,
    source,
    checkpointMessageIndex: orphanDelta.messageIndex,
    checkpointId: checkpoint.checkpointId,
    reconstructedData: applyDeltas_ACU(rolledData, laterDeltas),
    orphanDeltaIds: orphanDelta.deltas.map(delta => delta.deltaId),
    earliestDeltaIndex: orphanDelta.messageIndex,
    sameLayerDeltaRolledIntoCheckpoint: true,
  };
}

import { readIsolatedTagData_ACU, writeIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { ManualRefillSessionMarkerV2_ACU, ManualRefillSessionStatusV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';

export interface ManualRefillSessionConfig_ACU {
  selectedSheetKeys: string[];
  startMessageIndex: number;
  endMessageIndex: number;
  batchSize: number;
  plannedSaveTargetIndices: number[];
}

export type ManualRefillCommand_ACU =
  | { type: 'start'; config: ManualRefillSessionConfig_ACU }
  | { type: 'resume'; sessionId: string }
  | { type: 'abandon'; sessionId: string }
  | { type: 'replace'; oldSessionId: string; config: ManualRefillSessionConfig_ACU };

export interface PreparedManualRefillSession_ACU {
  marker: ManualRefillSessionMarkerV2_ACU;
  command: ManualRefillCommand_ACU;
  replacing?: ManualRefillSessionMarkerV2_ACU;
}

const ACTIVE_STATUSES_ACU = new Set<ManualRefillSessionStatusV2_ACU>(['cleaning', 'cleaned', 'filling', 'failed']);

function stableStringify_ACU(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify_ACU).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify_ACU(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString_ACU(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeConfig_ACU(config: ManualRefillSessionConfig_ACU): ManualRefillSessionConfig_ACU {
  return {
    selectedSheetKeys: [...new Set((config.selectedSheetKeys || []).filter(key => typeof key === 'string' && key.startsWith('sheet_')))].sort(),
    startMessageIndex: Math.max(0, Math.trunc(Number(config.startMessageIndex) || 0)),
    endMessageIndex: Math.max(0, Math.trunc(Number(config.endMessageIndex) || 0)),
    batchSize: Math.max(1, Math.trunc(Number(config.batchSize) || 1)),
    plannedSaveTargetIndices: [...new Set((config.plannedSaveTargetIndices || []).filter(Number.isInteger))].sort((a, b) => a - b),
  };
}

export function computeManualRefillConfigHash_ACU(config: ManualRefillSessionConfig_ACU): string {
  return hashString_ACU(stableStringify_ACU(normalizeConfig_ACU(config)));
}

function createSessionId_ACU(config: ManualRefillSessionConfig_ACU): string {
  const normalized = normalizeConfig_ACU(config);
  return `range_${normalized.startMessageIndex}_${normalized.endMessageIndex}_sheets_${normalized.selectedSheetKeys.join('_')}_batch_${normalized.batchSize}_${Date.now().toString(36)}`;
}

export function createManualRefillSessionMarker_ACU(config: ManualRefillSessionConfig_ACU): ManualRefillSessionMarkerV2_ACU {
  const normalized = normalizeConfig_ACU(config);
  const now = Date.now();
  return {
    kind: 'manual_refill_session',
    sessionId: createSessionId_ACU(normalized),
    status: 'cleaning',
    configHash: computeManualRefillConfigHash_ACU(normalized),
    selectedSheetKeys: normalized.selectedSheetKeys,
    startMessageIndex: normalized.startMessageIndex,
    endMessageIndex: normalized.endMessageIndex,
    batchSize: normalized.batchSize,
    plannedSaveTargetIndices: normalized.plannedSaveTargetIndices,
    completedSaveTargetIndices: [],
    dirtyCheckpointIndices: [],
    rebuiltCheckpointIndices: [],
    createdAt: now,
    updatedAt: now,
  };
}

function markerLooksValid_ACU(marker: any): marker is ManualRefillSessionMarkerV2_ACU {
  return marker?.kind === 'manual_refill_session'
    && typeof marker.sessionId === 'string'
    && typeof marker.configHash === 'string'
    && ACTIVE_STATUSES_ACU.has(marker.status);
}

export function loadActiveManualRefillSession_ACU(chat: any[], isolationKey: string): ManualRefillSessionMarkerV2_ACU | null {
  let latest: ManualRefillSessionMarkerV2_ACU | null = null;
  for (const message of Array.isArray(chat) ? chat : []) {
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const marker = tagData.storageFrame.manualRefillSession;
    if (!markerLooksValid_ACU(marker)) continue;
    if (!latest || Number(marker.updatedAt) > Number(latest.updatedAt)) latest = JSON.parse(JSON.stringify(marker));
  }
  return latest;
}

function findSessionMessageIndex_ACU(chat: any[], isolationKey: string, marker: ManualRefillSessionMarkerV2_ACU): number {
  const preferred = Number.isInteger(marker.endMessageIndex) ? marker.endMessageIndex : -1;
  const preferredMessage = Array.isArray(chat) ? chat[preferred] : null;
  if (preferredMessage && !preferredMessage.is_user && isV2TagData_ACU(readIsolatedTagData_ACU(preferredMessage, isolationKey))) return preferred;
  for (let index = Math.min(Array.isArray(chat) ? chat.length - 1 : -1, preferred); index >= 0; index -= 1) {
    const message = chat[index];
    if (!message || message.is_user) continue;
    if (isV2TagData_ACU(readIsolatedTagData_ACU(message, isolationKey))) return index;
  }
  return -1;
}

export function saveManualRefillSessionMarker_ACU(chat: any[], isolationKey: string, marker: ManualRefillSessionMarkerV2_ACU): { success: boolean; error?: string } {
  const index = findSessionMessageIndex_ACU(chat, isolationKey, marker);
  if (index < 0) return { success: false, error: '找不到可写入手动重填 session marker 的 V2 消息。' };
  const message = chat[index];
  const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
  if (!isV2TagData_ACU(tagData)) return { success: false, error: '目标消息不是 V2 存储帧。' };
  tagData.storageFrame.manualRefillSession = JSON.parse(JSON.stringify({ ...marker, updatedAt: Date.now() }));
  writeIsolatedTagData_ACU(message, isolationKey, tagData);
  return { success: true };
}

export function transitionManualRefillSession_ACU(
  marker: ManualRefillSessionMarkerV2_ACU,
  nextStatus: ManualRefillSessionStatusV2_ACU,
  patch: Partial<ManualRefillSessionMarkerV2_ACU> = {},
): { success: true; marker: ManualRefillSessionMarkerV2_ACU } | { success: false; error: string } {
  const allowed: Record<ManualRefillSessionStatusV2_ACU, ManualRefillSessionStatusV2_ACU[]> = {
    cleaning: ['cleaned', 'failed', 'abandoned'],
    cleaned: ['filling', 'complete', 'failed', 'abandoned'],
    filling: ['cleaned', 'failed', 'abandoned'],
    failed: ['cleaned', 'abandoned'],
    abandoned: [],
    complete: [],
  };
  if (!allowed[marker.status]?.includes(nextStatus)) {
    return { success: false, error: `非法手动重填状态转移：${marker.status} -> ${nextStatus}` };
  }
  return {
    success: true,
    marker: {
      ...marker,
      ...patch,
      status: nextStatus,
      updatedAt: Date.now(),
    },
  };
}

export function prepareManualRefillSession_ACU(chat: any[], isolationKey: string, config: ManualRefillSessionConfig_ACU): PreparedManualRefillSession_ACU {
  const normalized = normalizeConfig_ACU(config);
  const active = loadActiveManualRefillSession_ACU(chat, isolationKey);
  const configHash = computeManualRefillConfigHash_ACU(normalized);
  if (active && active.configHash === configHash) {
    return { marker: active, command: { type: 'resume', sessionId: active.sessionId } };
  }
  const marker = createManualRefillSessionMarker_ACU(normalized);
  if (active) {
    return { marker, replacing: active, command: { type: 'replace', oldSessionId: active.sessionId, config: normalized } };
  }
  return { marker, command: { type: 'start', config: normalized } };
}

export function abandonManualRefillSession_ACU(marker: ManualRefillSessionMarkerV2_ACU, error?: string): ManualRefillSessionMarkerV2_ACU {
  return { ...marker, status: 'abandoned', error, updatedAt: Date.now() };
}

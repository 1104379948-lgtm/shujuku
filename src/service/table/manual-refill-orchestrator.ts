import { getChatArray_ACU } from '../chat/chat-service';
import { getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { logDebug_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { buildGuidedBaseDataFromSheetGuide_ACU, getChatSheetGuideDataForIsolationKey_ACU } from '../template/chat-scope';
import { ensureLegacyStorageMigratedBeforeWrite_ACU } from './table-service';
import { ensureStorageProviderReady_ACU, reloadStorageProvider } from './table-storage-strategy';
import { resolveTableStorageStrategy_ACU } from './storage-strategy-resolver';
import { applyManualRefillLogRewriteInMemory_ACU, prepareManualRefillLogRewrite_ACU, saveManualRefillRewrite_ACU, type ManualRefillLogRewriteSession_ACU } from './manual-refill-log-rewrite';
import { collectManualRefillSaveTargetsForGroups_ACU, filterCompletedManualRefillGroups_ACU, markManualRefillBatchesCompleted_ACU } from './manual-refill-batch-runner';
import { rebuildReadyDirtyCheckpoints_ACU } from './manual-refill-checkpoint';
import { abandonManualRefillSession_ACU, prepareManualRefillSession_ACU, saveManualRefillSessionMarker_ACU, transitionManualRefillSession_ACU } from './manual-refill-session';
import type { ManualRefillSessionMarkerV2_ACU } from './storage-frame-v2-types';
import type { GroupedRuntimeUpdateGroup_ACU } from './update-orchestrator';
import { loadTableStateFromFramesV2_ACU } from './storage-frame-v2-replay';
import { isSqliteMode } from './storage-mode';

export interface ManualRefillRuntimeGroup_ACU {
  indices: number[];
  batchSize: number;
}

export interface ManualRefillRunContext_ACU {
  enabled: boolean;
  session: ManualRefillLogRewriteSession_ACU | null;
  marker: ManualRefillSessionMarkerV2_ACU | null;
  refillId: string;
  plannedSaveTargetIndices: Set<number>;
  completedSaveTargetIndices: Set<number>;
}

export interface ManualRefillChunkContext_ACU {
  saveTargetIndices: number[];
}

function computePlannedSaveTargets_ACU(updateGroups: Record<string, ManualRefillRuntimeGroup_ACU>): number[] {
  const targets = new Set<number>();
  for (const group of Object.values(updateGroups)) {
    const batchSize = Math.max(1, Number(group.batchSize) || Number(settings_ACU.updateBatchSize) || 2);
    for (let i = 0; i < group.indices.length; i += batchSize) {
      const batch = group.indices.slice(i, i + batchSize);
      const target = batch[batch.length - 1];
      if (Number.isInteger(target)) targets.add(target);
    }
  }
  return [...targets].sort((a, b) => a - b);
}

function failMarker_ACU(marker: ManualRefillSessionMarkerV2_ACU, error: string): ManualRefillSessionMarkerV2_ACU {
  return { ...marker, status: 'failed', error, updatedAt: Date.now() };
}

function getNextPendingSaveTargetIndex_ACU(marker: ManualRefillSessionMarkerV2_ACU): number | null {
  const completed = new Set(marker.completedSaveTargetIndices || []);
  return (marker.plannedSaveTargetIndices || []).find(index => !completed.has(index)) ?? null;
}

async function resetManualRefillRuntimeAtResumePoint_ACU(
  chat: any[],
  isolationKey: string,
  marker: ManualRefillSessionMarkerV2_ACU,
): Promise<{ success: boolean; error?: string }> {
  const nextPending = getNextPendingSaveTargetIndex_ACU(marker);
  if (nextPending == null) return { success: true };
  let replayedData: Record<string, any> | null = null;
  if (nextPending > 0) {
    replayedData = await loadTableStateFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: nextPending - 1 }) as Record<string, any> | null;
  } else {
    const guideData = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
    replayedData = guideData && Object.keys(guideData).some(key => key.startsWith('sheet_'))
      ? buildGuidedBaseDataFromSheetGuide_ACU(guideData)
      : parseTableTemplateJson_ACU({ stripSeedRows: true }) || null;
  }
  if (!replayedData || typeof replayedData !== 'object') {
    return { success: false, error: `手动重填恢复运行时失败：无法重放到下一批 ${nextPending} 之前。` };
  }
  _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(replayedData)) as any);
  if (isSqliteMode()) {
    const provider = await ensureStorageProviderReady_ACU();
    if (typeof provider.replaceAllData !== 'function') return { success: false, error: '手动重填恢复运行时失败：当前 SQLite provider 不支持 replaceAllData。' };
    const replaceResult = await provider.replaceAllData(replayedData as any);
    if (!replaceResult.success) return { success: false, error: replaceResult.error || '手动重填恢复运行时失败：SQLite runtime 重置失败。' };
    _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(provider.getCurrentData() || replayedData)) as any);
  }
  logDebug_ACU(`[Manual Refill] 已将运行时恢复到下一批 ${nextPending} 之前的历史状态。`);
  return { success: true };
}

export async function prepareManualRefillRun_ACU(options: {
  enabled: boolean;
  liveChat: any[];
  targetKeys: string[];
  contextScopeIndices: number[];
  batchSize: number;
  updateGroups: Record<string, ManualRefillRuntimeGroup_ACU>;
}): Promise<{ success: true; context: ManualRefillRunContext_ACU } | { success: false; error: string }> {
  const refillTargetIndex = options.contextScopeIndices[options.contextScopeIndices.length - 1];
  const fallbackRefillId = `range_${options.contextScopeIndices[0]}_${refillTargetIndex}_sheets_${[...new Set(options.targetKeys)].sort().join('_')}_batch_${options.batchSize}`;
  const context: ManualRefillRunContext_ACU = {
    enabled: false,
    session: null,
    marker: null,
    refillId: fallbackRefillId,
    plannedSaveTargetIndices: new Set<number>(),
    completedSaveTargetIndices: new Set<number>(),
  };
  if (!options.enabled) return { success: true, context };

  const isolationKey = getCurrentIsolationKey_ACU();
  let strategy = resolveTableStorageStrategy_ACU(options.liveChat, isolationKey, {
    enabled: settings_ACU.dataIsolationEnabled,
    code: settings_ACU.dataIsolationCode,
  });
  if (strategy.mode !== 'v2') {
    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('manual_refill_session_start');
    if (!migration.success) return { success: false, error: migration.error || '手动重填需要 V2 日志存储，旧存储迁移失败。' };
    if (migration.migrated) await reloadStorageProvider();
    strategy = resolveTableStorageStrategy_ACU(options.liveChat, isolationKey, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });
    if (strategy.mode !== 'v2') return { success: false, error: `手动重填需要 V2 日志存储，当前存储不可重写：${'reason' in strategy ? strategy.reason : strategy.mode}` };
  }

  computePlannedSaveTargets_ACU(options.updateGroups).forEach(index => context.plannedSaveTargetIndices.add(index));
  const preparedSession = prepareManualRefillSession_ACU(options.liveChat, isolationKey, {
    selectedSheetKeys: options.targetKeys,
    startMessageIndex: options.contextScopeIndices[0],
    endMessageIndex: refillTargetIndex,
    batchSize: options.batchSize,
    plannedSaveTargetIndices: [...context.plannedSaveTargetIndices],
  });
  if (preparedSession.replacing) {
    const abandonResult = saveManualRefillSessionMarker_ACU(options.liveChat, isolationKey, abandonManualRefillSession_ACU(preparedSession.replacing, 'manual_refill_replaced'));
    if (!abandonResult.success) return { success: false, error: abandonResult.error || '手动重填替换旧 session 失败。' };
  }
  if (preparedSession.marker.status === 'filling') {
    const failedTransition = transitionManualRefillSession_ACU(preparedSession.marker, 'failed', { error: '上次手动重填在批次提交中断，等待恢复。' });
    if (!failedTransition.success) return { success: false, error: 'error' in failedTransition ? failedTransition.error : '手动重填状态转移失败。' };
    preparedSession.marker = failedTransition.marker;
  }
  if (preparedSession.marker.status === 'failed') {
    const resumeTransition = transitionManualRefillSession_ACU(preparedSession.marker, 'cleaned');
    if (!resumeTransition.success) return { success: false, error: 'error' in resumeTransition ? resumeTransition.error : '手动重填状态转移失败。' };
    preparedSession.marker = resumeTransition.marker;
  }
  if (preparedSession.marker.status === 'complete') {
    logDebug_ACU('[Manual Refill] 手动重填 session 已完成，无需重复执行。');
    return { success: true, context: { ...context, enabled: true, marker: preparedSession.marker, refillId: preparedSession.marker.sessionId } };
  }

  let marker = preparedSession.marker;
  const markerSaveResult = saveManualRefillSessionMarker_ACU(options.liveChat, isolationKey, marker);
  if (!markerSaveResult.success) return { success: false, error: markerSaveResult.error || '手动重填 session marker 保存失败。' };
  const rewriteResult = prepareManualRefillLogRewrite_ACU({
    chat: options.liveChat,
    isolationKey,
    startMessageIndex: options.contextScopeIndices[0],
    endMessageIndex: refillTargetIndex,
    selectedSheetKeys: options.targetKeys,
    refillId: marker.sessionId,
    plannedSaveTargetIndices: [...context.plannedSaveTargetIndices],
  });
  if (!rewriteResult.success || !rewriteResult.session) {
    saveManualRefillSessionMarker_ACU(options.liveChat, isolationKey, failMarker_ACU(marker, rewriteResult.error || '手动重填清旧失败。'));
    return { success: false, error: rewriteResult.error || '手动重填 V2 日志清旧准备失败。' };
  }

  applyManualRefillLogRewriteInMemory_ACU(rewriteResult.session);
  const completedFromLog = [...new Set([...(marker.completedSaveTargetIndices || []), ...rewriteResult.session.completedSaveTargetIndices])].sort((a, b) => a - b);
  completedFromLog.forEach(index => context.completedSaveTargetIndices.add(index));
  const cleanedTransition = marker.status === 'cleaning'
    ? transitionManualRefillSession_ACU(marker, 'cleaned', {
      completedSaveTargetIndices: completedFromLog,
      dirtyCheckpointIndices: rewriteResult.session.dirtyCheckpoints.map(item => item.messageIndex),
    })
    : { success: true as const, marker: { ...marker, completedSaveTargetIndices: completedFromLog } };
  if (!cleanedTransition.success) return { success: false, error: 'error' in cleanedTransition ? cleanedTransition.error : '手动重填状态转移失败。' };
  marker = cleanedTransition.marker;
  filterCompletedManualRefillGroups_ACU(options.updateGroups, [...context.completedSaveTargetIndices]);
  const checkpointResult = await rebuildReadyDirtyCheckpoints_ACU(rewriteResult.session, marker);
  if (!checkpointResult.success) return { success: false, error: checkpointResult.error || '手动重填清旧后 checkpoint 重建失败。' };
  marker = checkpointResult.marker;
  const sessionSaveResult = saveManualRefillSessionMarker_ACU(options.liveChat, isolationKey, marker);
  if (!sessionSaveResult.success) return { success: false, error: sessionSaveResult.error || '手动重填 session marker 保存失败。' };
  const saveCleanResult = await saveManualRefillRewrite_ACU();
  if (!saveCleanResult.success) return { success: false, error: saveCleanResult.error || '手动重填清旧保存失败。' };
  const runtimeReset = await resetManualRefillRuntimeAtResumePoint_ACU(options.liveChat, isolationKey, marker);
  if (!runtimeReset.success) return { success: false, error: runtimeReset.error || '手动重填恢复运行时失败。' };
  logDebug_ACU(`[Manual Refill] V2 session=${marker.sessionId} 已清理选中表旧单表记录 ${rewriteResult.removedEntries || 0} 条，按 session 批次继续写新。`);

  return {
    success: true,
    context: {
      ...context,
      enabled: true,
      session: rewriteResult.session,
      marker,
      refillId: marker.sessionId,
    },
  };
}

export function isManualRefillAlreadyComplete_ACU(context: ManualRefillRunContext_ACU): boolean {
  return context.enabled && context.marker?.status === 'complete' && !context.session;
}

export function getManualRefillBatchIdPrefix_ACU(context: ManualRefillRunContext_ACU): string | undefined {
  return context.session ? `manual_refill:${context.refillId}` : undefined;
}

export function prepareManualRefillChunk_ACU(context: ManualRefillRunContext_ACU, groups: GroupedRuntimeUpdateGroup_ACU[]): ManualRefillChunkContext_ACU {
  return {
    saveTargetIndices: context.session ? collectManualRefillSaveTargetsForGroups_ACU(groups) : [],
  };
}

export async function beginManualRefillChunk_ACU(context: ManualRefillRunContext_ACU, chunk: ManualRefillChunkContext_ACU): Promise<{ success: boolean; error?: string }> {
  if (!context.session || !context.marker || chunk.saveTargetIndices.length === 0) return { success: true };
  const transition = transitionManualRefillSession_ACU(context.marker, 'filling');
  if (!transition.success) return { success: false, error: 'error' in transition ? transition.error : '手动重填状态转移失败。' };
  context.marker = transition.marker;
  const saveResult = saveManualRefillSessionMarker_ACU(getChatArray_ACU() || [], getCurrentIsolationKey_ACU(), context.marker);
  return saveResult.success ? { success: true } : { success: false, error: saveResult.error || '手动重填 filling 状态保存失败。' };
}

export async function commitManualRefillChunk_ACU(context: ManualRefillRunContext_ACU, chunk: ManualRefillChunkContext_ACU): Promise<{ success: boolean; error?: string }> {
  if (!context.session || !context.marker) return { success: true };
  chunk.saveTargetIndices.forEach(index => context.completedSaveTargetIndices.add(index));
  context.marker = markManualRefillBatchesCompleted_ACU(context.marker, chunk.saveTargetIndices);
  const checkpointResult = await rebuildReadyDirtyCheckpoints_ACU(context.session, context.marker);
  if (!checkpointResult.success) {
    context.marker = failMarker_ACU(context.marker, checkpointResult.error || '手动重填批次后 checkpoint 重建失败。');
    saveManualRefillSessionMarker_ACU(getChatArray_ACU() || [], getCurrentIsolationKey_ACU(), context.marker);
    await saveManualRefillRewrite_ACU();
    return { success: false, error: checkpointResult.error || '手动重填批次后 checkpoint 重建失败。' };
  }
  context.marker = checkpointResult.marker;
  const sessionSaveResult = saveManualRefillSessionMarker_ACU(getChatArray_ACU() || [], getCurrentIsolationKey_ACU(), context.marker);
  if (!sessionSaveResult.success) return { success: false, error: sessionSaveResult.error || '手动重填批次 session marker 保存失败。' };
  const saveResult = await saveManualRefillRewrite_ACU();
  return saveResult.success ? { success: true } : { success: false, error: saveResult.error || '手动重填批次保存失败。' };
}

export async function failManualRefillChunk_ACU(context: ManualRefillRunContext_ACU, error: string): Promise<void> {
  if (!context.session || !context.marker) return;
  context.marker = failMarker_ACU(context.marker, error);
  saveManualRefillSessionMarker_ACU(getChatArray_ACU() || [], getCurrentIsolationKey_ACU(), context.marker);
  await saveManualRefillRewrite_ACU();
}

export async function completeManualRefillRun_ACU(context: ManualRefillRunContext_ACU): Promise<{ success: boolean; error?: string }> {
  if (!context.session || !context.marker) return { success: true };
  const completed = new Set(context.marker.completedSaveTargetIndices || []);
  const allBatchesComplete = (context.marker.plannedSaveTargetIndices || []).every(index => completed.has(index));
  if (!allBatchesComplete || context.marker.status !== 'cleaned') return { success: true };
  const transition = transitionManualRefillSession_ACU(context.marker, 'complete');
  if (!transition.success) return { success: false, error: 'error' in transition ? transition.error : '手动重填状态转移失败。' };
  context.marker = transition.marker;
  const completeSaveResult = saveManualRefillSessionMarker_ACU(getChatArray_ACU() || [], getCurrentIsolationKey_ACU(), context.marker);
  if (!completeSaveResult.success) return { success: false, error: completeSaveResult.error || '手动重填 complete 状态保存失败。' };
  const saveResult = await saveManualRefillRewrite_ACU();
  return saveResult.success ? { success: true } : { success: false, error: saveResult.error || '手动重填 complete 状态持久化失败。' };
}

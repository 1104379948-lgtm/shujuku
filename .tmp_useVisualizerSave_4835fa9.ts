import { TABLE_ORDER_FIELD_ACU } from '../../../shared/constants';
import { topLevelWindow_ACU } from '../../../shared/env';
import {
  applySheetOrderNumbers_ACU,
  ensureSheetOrderNumbers_ACU,
  isSummaryOrOutlineTable_ACU,
  logWarn_ACU,
  parseTableTemplateJson_ACU,
} from '../../../shared/utils';
import {
  isDefaultTemplatePresetSelection_ACU,
  normalizeTemplatePresetSelectionValue_ACU,
} from '../../../shared/template-preset-utils';
import { commitCurrentChatTemplateChangesAtomic_ACU } from '../../../service/chat/chat-service';
import {
  getCurrentIsolationKey_ACU,
  _set_currentJsonTableData_ACU,
} from '../../../service/runtime/state-manager';
import {
  applySummaryIndexSequenceToTable_ACU,
  commitTableLockDraftsBatch_ACU,
  getSummaryIndexColumnIndex_ACU,
  restoreCurrentTableLocksSnapshot_ACU,
  type TableLocksBatchCommitResult_ACU,
} from '../../../service/runtime/helpers-remaining';
import { getCurrentWorldbookConfig_ACU } from '../../../service/settings/settings-readers';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { reloadStorageProvider } from '../../../service/table/table-storage-strategy';
import { applyTemplateScopeForCurrentChat_ACU } from '../../../service/settings/settings-service';
import {
  buildChatSheetGuideDataFromData_ACU,
  getChatSheetGuideDataForIsolationKey_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU,
  getSortedSheetKeys_ACU,
  materializeDataFromSheetGuide_ACU,
  sanitizeTemplateSnapshotForChat_ACU,
} from '../../../service/template/chat-scope';
import {
  applyTemplatePresetToCurrent_ACU,
  resolveActiveTemplatePresetName_ACU,
  upsertTemplatePreset_ACU,
} from '../../../service/template/template-preset-service';
import {
  getGlobalInjectionConfigFromData_ACU,
} from '../../../service/worldbook/injection-engine';
import { refreshMergedDataAndNotify_ACU } from '../../../service/worldbook/pipeline';
import {
  applyVisualizerPendingDataOps_ACU,
  hasVisualizerPendingDataOps_ACU,
  replaceVisualizerTemporaryRowIds_ACU,
  resetVisualizerPendingDataOps_ACU,
} from '../../../service/visualizer/visualizer-data-ops';
import { useToastStore } from '../../stores/toast-store';
import { ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU } from '../useTemplateRecoveryGuard';
import { useVisualizerStore, type VisualizerLockDraft } from '../../stores/visualizer-store';

export interface VisualizerSaveInteractions {
  requestGlobalPresetName?: (defaultName: string) => string | null | Promise<string | null>;
  confirmOverwriteGlobalPreset?: (presetName: string) => boolean | Promise<boolean>;
}

type GlobalTemplateSaveResult =
  | { status: 'saved'; presetName: string }
  | { status: 'unchanged' }
  | { status: 'cancelled' };

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function applySpecialIndexSequenceFromDrafts(
  data: Record<string, any>,
  lockDrafts: Record<string, VisualizerLockDraft>,
): void {
  Object.keys(data || {}).forEach(sheetKey => {
    if (!sheetKey.startsWith('sheet_')) return;
    const table = data[sheetKey];
    if (!table || !isSummaryOrOutlineTable_ACU(String(table.name || ''))) return;
    if (lockDrafts[sheetKey]?.specialIndexLocked === false) return;
    const colIndex = getSummaryIndexColumnIndex_ACU(table);
    if (colIndex < 0) return;
    applySummaryIndexSequenceToTable_ACU(table, colIndex);
  });
}

function buildOrderedData(
  tempData: Record<string, any> | null,
  sheetOrder: string[],
  lockDrafts: Record<string, VisualizerLockDraft>,
): Record<string, any> {
  const source = tempData || { mate: { type: 'chatSheets', version: 1 } };
  const orderedData: Record<string, any> = {};
  Object.keys(source).forEach(key => {
    if (!key.startsWith('sheet_')) orderedData[key] = cloneData(source[key]);
  });
  sheetOrder.forEach(key => {
    if (source[key]) orderedData[key] = cloneData(source[key]);
  });
  applySheetOrderNumbers_ACU(orderedData, sheetOrder);
  applySpecialIndexSequenceFromDrafts(orderedData, lockDrafts);
  return orderedData;
}

function commitLockDrafts(
  drafts: Record<string, VisualizerLockDraft>,
  deletedSheetKeys: string[] = [],
): TableLocksBatchCommitResult_ACU {
  const result = commitTableLockDraftsBatch_ACU({
    drafts,
    deletedSheetKeys,
  });
  if (!result.success) {
    throw new Error(result.warning || '表格锁设置保存失败。');
  }
  return result;
}

function restoreLockDraftsAfterFailure(
  result: TableLocksBatchCommitResult_ACU,
  error: unknown,
): Error {
  if (!result.changed) return error instanceof Error ? error : new Error(String(error));
  const rollback = restoreCurrentTableLocksSnapshot_ACU(result.snapshot);
  const message = error instanceof Error ? error.message : String(error);
  if (rollback.success) return new Error(message);
  return new Error(`${message}；表格锁设置回滚也失败：${rollback.warning || '未知错误'}`);
}

type ChatSheetGuideSyncPayload = {
  isolationKey: string;
  guideData: Record<string, any>;
};

function buildChatSheetGuideSyncPayload(orderedData: Record<string, any>, orderedKeys: string[]): ChatSheetGuideSyncPayload | null {
  const guideIsolationKey = getCurrentIsolationKey_ACU();
  const existingGuide = getChatSheetGuideDataForIsolationKey_ACU(guideIsolationKey);
  const templateObjForSeed = parseTableTemplateJson_ACU({ stripSeedRows: false });
  const guideData = buildChatSheetGuideDataFromData_ACU(orderedData, {
    preserveSeedRowsFromGuideData: existingGuide,
    seedRowsFromTemplateObj: templateObjForSeed,
    orderedKeys,
  });
  if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) return null;
  return { isolationKey: guideIsolationKey, guideData };
}

async function saveGlobalTemplateSnapshot(
  orderedData: Record<string, any>,
  interactions: VisualizerSaveInteractions,
): Promise<GlobalTemplateSaveResult> {
  const templateObj: Record<string, any> = {};
  Object.keys(orderedData || {}).forEach(key => {
    if (!key.startsWith('sheet_')) templateObj[key] = cloneData(orderedData[key]);
  });
  if (!templateObj.mate || typeof templateObj.mate !== 'object') {
    templateObj.mate = { type: 'chatSheets', version: 1 };
  }
  if (!templateObj.mate.type) templateObj.mate.type = 'chatSheets';
  if (!Number.isFinite(templateObj.mate.version)) templateObj.mate.version = 1;
  templateObj.mate.globalInjectionConfig = getGlobalInjectionConfigFromData_ACU(orderedData, {
    ensureWriteBack: true,
  });

  const orderedSheetKeys = getSortedSheetKeys_ACU(orderedData, { ignoreChatGuide: true });
  orderedSheetKeys.forEach(key => {
    const currentTable = orderedData?.[key];
    if (!currentTable || typeof currentTable !== 'object') return;
    const templateTable = cloneData(currentTable);
    if (Array.isArray(templateTable.content) && templateTable.content.length > 1) {
      templateTable.content = [templateTable.content[0]];
    }
    templateTable[TABLE_ORDER_FIELD_ACU] = currentTable[TABLE_ORDER_FIELD_ACU];
    templateObj[key] = templateTable;
  });

  ensureSheetOrderNumbers_ACU(templateObj, {
    baseOrderKeys: orderedSheetKeys,
    forceRebuild: false,
  });

  const currentGlobalSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
  const currentGlobalStr = currentGlobalSnapshot?.templateStr || '';

  const isolationKey = getCurrentIsolationKey_ACU();
  const activePresetName = normalizeTemplatePresetSelectionValue_ACU(
    resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }),
  );
  let finalGlobalPresetName = activePresetName;
  if (isDefaultTemplatePresetSelection_ACU(finalGlobalPresetName)) {
    const promptedName = interactions.requestGlobalPresetName
      ? await interactions.requestGlobalPresetName('新模板预设')
      : null;
    if (!promptedName) return { status: 'cancelled' };
    finalGlobalPresetName = normalizeTemplatePresetSelectionValue_ACU(String(promptedName).trim());
  } else {
    const confirmed = interactions.confirmOverwriteGlobalPreset
      ? await interactions.confirmOverwriteGlobalPreset(finalGlobalPresetName)
      : false;
    if (!confirmed) return { status: 'cancelled' };
  }
  if (!finalGlobalPresetName) return { status: 'cancelled' };

  const preparedSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateObj);
  if (!preparedSnapshot?.templateStr) {
    throw new Error('无法生成模板快照。');
  }
  if (currentGlobalStr && preparedSnapshot.templateStr === currentGlobalStr) return { status: 'unchanged' };
  const presetSaved = upsertTemplatePreset_ACU(finalGlobalPresetName, preparedSnapshot.templateStr);
  if (!presetSaved) throw new Error('无法写入全局预设库。');

  const applied = await applyTemplatePresetToCurrent_ACU(finalGlobalPresetName, {
    source: 'visualizer_v2_save_to_global',
    updateGlobal: true,
    save: true,
    persistChatScope: false,
  });
  if (!applied) throw new Error('模板快照应用失败。');
  return { status: 'saved', presetName: finalGlobalPresetName };
}

export function useVisualizerSave(interactions: VisualizerSaveInteractions = {}) {
  const visualizer = useVisualizerStore();
  const toastStore = useToastStore();

  async function runSaving(task: () => Promise<boolean>): Promise<boolean> {
    if (visualizer.isSaving) return false;
    visualizer.setSaving(true);
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败，请查看控制台日志。';
      logWarn_ACU('[ACU-V2 Visualizer] save failed:', error);
      toastStore.error(message, { muteable: false });
      return false;
    } finally {
      visualizer.setSaving(false);
    }
  }

  function assertDraftRevisionUnchanged(revision: number): void {
    if (visualizer.draftRevision !== revision) {
      throw new Error('保存期间草稿已发生变化，本次不会清除较新的修改。请重新保存。');
    }
  }

  async function saveDataToCurrentMessage(): Promise<boolean> {
    return runSaving(async () => {
      if (visualizer.templateDirty || (visualizer.deletedSheetKeys || []).length > 0) {
        toastStore.error('存在未保存的模板/结构或删表修改；数据保存不会持久化这些修改，请先保存当前聊天模板。', { muteable: false });
        return false;
      }
      const revision = visualizer.draftRevision;
      const hasDataChanges = hasVisualizerPendingDataOps_ACU(visualizer);
      const hasLockChanges = visualizer.lockDirty;
      if (!hasDataChanges && !hasLockChanges) {
        toastStore.info('没有需要保存的数据或锁增量。', { muteable: false });
        return false;
      }
      const result = hasDataChanges
        ? await applyVisualizerPendingDataOps_ACU(visualizer)
        : { success: true, changed: false };
      if (!result.success) {
        toastStore.error(result.error || '数据保存失败。', { muteable: false });
        return false;
      }
      assertDraftRevisionUnchanged(revision);
      if (hasLockChanges) commitLockDrafts(cloneData(visualizer.tableLockDrafts));
      try {
        await refreshMergedDataAndNotify_ACU();
      } catch (error: any) {
        const detail = error?.message || String(error);
        toastStore.error(`数据已持久化，但本地刷新失败：${detail}。请重试保存完成恢复，期间不要继续编辑。`, { muteable: false });
        return false;
      }
      assertDraftRevisionUnchanged(revision);
      if (hasDataChanges) {
        replaceVisualizerTemporaryRowIds_ACU(visualizer, result.insertedRowIds || {});
        resetVisualizerPendingDataOps_ACU(visualizer);
      }
      try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
      } catch {}
      visualizer.markSaved(hasDataChanges ? 'data' : 'locks');
      toastStore.success(hasDataChanges
        ? '数据增量已保存到当前消息。'
        : '表格锁设置已保存。', { muteable: false });
      return true;
    });
  }

  async function saveTemplateToCurrentChat(): Promise<boolean> {
    return runSaving(async () => {
      if (hasVisualizerPendingDataOps_ACU(visualizer)) {
        toastStore.error('存在未保存的数据增量；本次是模板保存，已阻止混合提交。', { muteable: false });
        return false;
      }
      const revision = visualizer.draftRevision;
      const deletedSheetKeys = [...new Set((visualizer.deletedSheetKeys || [])
        .filter(key => typeof key === 'string' && key.startsWith('sheet_')))];
      const lockDrafts = cloneData(visualizer.tableLockDrafts);
      const orderedData = buildOrderedData(visualizer.tempData, visualizer.sheetOrder, lockDrafts);
      const guidePayload = buildChatSheetGuideSyncPayload(orderedData, [...visualizer.sheetOrder]);
      if (!guidePayload) throw new Error('无法生成当前聊天 Sheet Guide。');
      const recoveryGuard = await ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU(
        guidePayload.guideData,
        'save-template',
      );
      if (!recoveryGuard.success) return false;
      assertDraftRevisionUnchanged(revision);
      const lockCommit = commitLockDrafts(lockDrafts, deletedSheetKeys);
      let commitResult;
      try {
        commitResult = await commitCurrentChatTemplateChangesAtomic_ACU({
        isolationKey: guidePayload.isolationKey,
        guideData: guidePayload.guideData,
        templateSource: orderedData,
        presetName: resolveActiveTemplatePresetName_ACU({
          fallbackToGlobal: true,
          isolationKey: guidePayload.isolationKey,
        }),
        deletedSheetKeys,
        resetCurrentIsolationData: recoveryGuard.dataWasReset,
      });
        if (!commitResult.success) throw new Error(commitResult.error || '当前聊天模板提交失败。');
      } catch (error) {
        throw restoreLockDraftsAfterFailure(lockCommit, error);
      }
      assertDraftRevisionUnchanged(revision);
      if (commitResult.cleanupWarnings?.length) {
        const detail = commitResult.cleanupWarnings.join('；');
        logWarn_ACU('[ACU-V2 Visualizer] template commit cleanup warning:', detail);
        toastStore.warning(`模板已提交，但外置索引资源清理未完全完成：${detail}`, { muteable: false });
      }
      applyTemplateScopeForCurrentChat_ACU();
      _set_currentJsonTableData_ACU(recoveryGuard.dataWasReset
        ? materializeDataFromSheetGuide_ACU(guidePayload.guideData, { includeSeedRows: true })
        : cloneData(orderedData));
      try {
        if (isSqliteMode()) await reloadStorageProvider();
        await refreshMergedDataAndNotify_ACU();
      } catch (error: any) {
        const detail = error?.message || String(error);
        logWarn_ACU('[ACU-V2 Visualizer] derived refresh failed after template commit:', error);
        toastStore.warning(`模板已提交，但本地派生刷新失败：${detail}。重新打开编辑器可恢复显示。`, { muteable: false });
      }
      assertDraftRevisionUnchanged(revision);
      try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
      } catch {}
      visualizer.markSaved('template-chat');
      toastStore.success(deletedSheetKeys.length > 0
        ? '模板/结构与删表清理已原子保存到当前聊天。'
        : '模板/结构已保存到当前聊天。', { muteable: false });
      return true;
    });
  }

  async function saveTemplateToGlobal(): Promise<boolean> {
    return runSaving(async () => {
      if ((visualizer.deletedSheetKeys || []).length > 0) {
        toastStore.error('存在待保存的删表操作；全局模板保存不能代替删表清理，请先保存数据。', { muteable: false });
        return false;
      }
      if (hasVisualizerPendingDataOps_ACU(visualizer)) {
        toastStore.error('存在未保存的数据增量；本次是模板保存，已阻止混合提交。', { muteable: false });
        return false;
      }
      const revision = visualizer.draftRevision;
      const lockDrafts = cloneData(visualizer.tableLockDrafts);
      const orderedData = buildOrderedData(visualizer.tempData, visualizer.sheetOrder, lockDrafts);
      const globalTemplateResult = await saveGlobalTemplateSnapshot(orderedData, interactions);
      if (globalTemplateResult.status === 'cancelled') return false;
      assertDraftRevisionUnchanged(revision);
      commitLockDrafts(lockDrafts);
      if (isSqliteMode()) await reloadStorageProvider();
      await refreshMergedDataAndNotify_ACU();
      assertDraftRevisionUnchanged(revision);
      visualizer.markSaved('template-global');
      if (globalTemplateResult.status === 'saved') {
        toastStore.success(`模板/结构已保存到全局预设：${globalTemplateResult.presetName}。`, { muteable: false });
      } else {
        toastStore.info('全局模板无变化。', { muteable: false });
      }
      return true;
    });
  }

  return {
    saveDataToCurrentMessage,
    saveTemplateToCurrentChat,
    saveTemplateToGlobal,
    saveToChat: saveDataToCurrentMessage,
    saveToGlobal: saveTemplateToGlobal,
  };
}

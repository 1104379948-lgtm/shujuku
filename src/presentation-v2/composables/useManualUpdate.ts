import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  currentJsonTableData_ACU,
  settings_ACU,
  abortAllActiveRequests_ACU,
  _set_isAutoUpdatingCard_ACU,
  _set_manualExtraHint_ACU,
  _set_wasStoppedByUser_ACU,
  getCurrentIsolationKey_ACU,
} from '../../service/runtime/state-manager';
import { getChatArray_ACU } from '../../service/chat/chat-service';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import {
  collectV2CheckpointFloorsFromChat_ACU,
  resolveTableHistoryStateFromChat_ACU,
} from '../../service/table/table-history';
import {
  executeCardUpdateCore_ACU,
  orchestrateManualUpdate_ACU,
  processUpdatesBatch_ACU,
  type BatchUpdateProgressContext,
  type CardUpdateProgressEvent,
} from '../../service/table/update-orchestrator';
import { refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { topLevelWindow_ACU } from '../../shared/env';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { useDialogStore } from '../stores/dialog-store';
import { useToastStore } from '../stores/toast-store';
import {
  planManualFillCatchUp,
  type CatchUpGroup,
} from './manual-fill-catch-up-planner';

type MessageKind = 'info' | 'success' | 'warning' | 'error';

export interface ManualUpdateState {
  selectedManualTableKeys: Ref<string[]>;
  manualContextDepth: Ref<number>;
  manualBatchSize: Ref<number>;
  manualExtraHint: Ref<string>;
  manualUpdateBusy: Ref<boolean>;
  autoCatchUpBusy: Ref<boolean>;
  sheetKeys: ComputedRef<string[]>;
  sheetNames: ComputedRef<Record<string, string>>;
  selectedSheetSummary: ComputedRef<string>;
  checkpointFloorsLabel: ComputedRef<string>;
  manualRefillRangeLabel: ComputedRef<string>;
  checkpointRiskMessage: ComputedRef<string>;
  vectorIndexWarning: ComputedRef<boolean>;
  refresh: () => void;
  setManualContextDepth: (value: number | string) => void;
  setManualBatchSize: (value: number | string) => void;
  setManualSelectedKeys: (keys: string[]) => void;
  selectAllManualTables: () => void;
  selectNoManualTables: () => void;
  runManualUpdate: () => Promise<void>;
  runAutoCatchUp: () => Promise<void>;
}

function currentSheetKeys(): string[] {
  try {
    return getSortedSheetKeys_ACU(currentJsonTableData_ACU || {});
  } catch {
    return [];
  }
}

function resolveManualSelection(keys: string[]): string[] {
  if (!keys.length) return [];
  const saved = Array.isArray(settings_ACU.manualSelectedTables) ? settings_ACU.manualSelectedTables : [];
  if (settings_ACU.hasManualSelection !== true) return keys.slice();
  const valid = new Set(keys);
  return saved.filter((key: string) => valid.has(key));
}

function saveManualSelection(keys: string[]): void {
  const valid = new Set(currentSheetKeys());
  settings_ACU.manualSelectedTables = keys.filter(key => valid.has(key));
  settings_ACU.hasManualSelection = true;
  saveSettings_ACU();
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function resolveManualContextDepth(): number {
  const fallback = normalizeNonNegativeInteger(settings_ACU.autoUpdateThreshold, 3);
  return settings_ACU.manualUpdateContextDepth == null
    ? fallback
    : normalizeNonNegativeInteger(settings_ACU.manualUpdateContextDepth, fallback);
}

function resolveManualBatchSize(): number {
  const fallback = 3;
  return settings_ACU.manualUpdateBatchSize == null
    ? fallback
    : normalizePositiveInteger(settings_ACU.manualUpdateBatchSize, fallback);
}

function applyManualSettingsForOrchestrator(contextDepth: number): () => void {
  const previousAutoUpdateThreshold = settings_ACU.autoUpdateThreshold;
  const previousUpdateBatchSize = settings_ACU.updateBatchSize;

  // orchestrateManualUpdate_ACU still reads the legacy automatic settings.
  // Keep the temporary bridge local to this UI action so the independent
  // manual fields do not persist back into automatic update configuration.
  settings_ACU.autoUpdateThreshold = manualDepthForOrchestrator_ACU(
    contextDepth,
    previousAutoUpdateThreshold,
  );
  settings_ACU.updateBatchSize = normalizePositiveInteger(
    settings_ACU.manualUpdateBatchSize,
    normalizePositiveInteger(previousUpdateBatchSize, 3),
  );

  return () => {
    settings_ACU.autoUpdateThreshold = previousAutoUpdateThreshold;
    settings_ACU.updateBatchSize = previousUpdateBatchSize;
  };
}

function manualDepthForOrchestrator_ACU(
  manualDepth: unknown,
  fallbackDepth: unknown,
): number {
  const fallback = normalizeNonNegativeInteger(fallbackDepth, 3);
  return manualDepth == null
    ? fallback
    : normalizeNonNegativeInteger(manualDepth, fallback);
}

interface ManualRefillRangeSummary {
  indices: number[];
  startAiFloor: number;
  endAiFloor: number;
}

function resolveManualRefillRangeSummary_ACU(manualDepth: number): ManualRefillRangeSummary | null {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return null;
  const aiItems = chat
    .map((msg: any, index: number) => (msg && !msg.is_user ? { index, aiFloor: 0 } : null))
    .filter((item): item is { index: number; aiFloor: number } => item !== null);
  aiItems.forEach((item, idx) => { item.aiFloor = idx + 1; });
  const skip = normalizeNonNegativeInteger(settings_ACU.skipUpdateFloors, 0);
  const effectiveAiItems = skip > 0 ? aiItems.slice(0, -skip) : aiItems.slice();
  const contextItems = manualDepth > 0 ? effectiveAiItems.slice(-manualDepth) : effectiveAiItems;
  if (!contextItems.length) return null;
  return {
    indices: contextItems.map(item => item.index),
    startAiFloor: contextItems[0].aiFloor,
    endAiFloor: contextItems[contextItems.length - 1].aiFloor,
  };
}

function formatAiFloorRange_ACU(startAiFloor: number, endAiFloor: number): string {
  return startAiFloor === endAiFloor
    ? `AI 第 ${startAiFloor} 层`
    : `AI 第 ${startAiFloor}~${endAiFloor} 层`;
}

function progressLabel(event: CardUpdateProgressEvent): string {
  const prefix = event.currentBatch && event.totalBatches
    ? `批次 ${event.currentBatch}/${event.totalBatches} · `
    : '';
  if (event.message && event.phase !== 'retry' && event.phase !== 'error') {
    return `${prefix}${normalizeManualProgressMessage(event.message)}`;
  }
  switch (event.phase) {
    case 'preparing': return `${prefix}准备上下文`;
    case 'calling_ai': return `${prefix}调用 AI${event.attempt ? `（第 ${event.attempt}/${event.maxRetries || '?'} 次尝试）` : ''}`;
    case 'parsing': return `${prefix}解析填表结果`;
    case 'saving': return `${prefix}保存表格数据`;
    case 'retry': return `${prefix}重试中${event.message ? `:${event.message}` : ''}`;
    case 'complete': return `${prefix}完成`;
    case 'chunk_done': return `${prefix}分块完成`;
    case 'error': return `${prefix}出错${event.message ? `:${event.message}` : ''}`;
    default: return prefix || '处理中';
  }
}

function normalizeManualProgressMessage(message: string): string {
  return message
    .split(' AI 响应').join('手动填表结果')
    .split('AI 响应').join('手动填表结果');
}

interface ChatStructureFingerprint {
  isolationKey: string;
  aiMessageIndices: number[];
  effectiveTailFloor: number;
}

function collectAiMessageIndices(chat: any[]): number[] {
  const indices: number[] = [];
  for (let index = 0; index < chat.length; index += 1) {
    if (chat[index] && !chat[index].is_user) indices.push(index);
  }
  return indices;
}

function sameChatStructure(left: ChatStructureFingerprint, right: ChatStructureFingerprint): boolean {
  return left.isolationKey === right.isolationKey
    && left.effectiveTailFloor === right.effectiveTailFloor
    && left.aiMessageIndices.length === right.aiMessageIndices.length
    && left.aiMessageIndices.every((value, index) => value === right.aiMessageIndices[index]);
}

type ManualFillOrchestratorResult = Awaited<ReturnType<typeof orchestrateManualUpdate_ACU>>;
type ManualFillFailureStage = '首次 orchestrator' | '破坏性确认' | '破坏性确认重入';

type ManualFillSessionResult =
  | { status: 'success'; result: ManualFillOrchestratorResult }
  | { status: 'cancelled'; reason: 'boundary_reset' }
  | { status: 'failed'; error: string; stage: ManualFillFailureStage; result?: ManualFillOrchestratorResult };

interface ExecuteManualFillSessionOptions {
  targetKeys: string[];
  contextDepth: number;
  handleProgress: (event: CardUpdateProgressEvent) => void;
  taskLabel: string;
}

export function useManualUpdate(): ManualUpdateState {
  const dialogStore = useDialogStore();
  const toast = useToastStore();
  const selectedManualTableKeys = ref<string[]>(resolveManualSelection(currentSheetKeys()));
  const manualContextDepth = ref(resolveManualContextDepth());
  const manualBatchSize = ref(resolveManualBatchSize());
  const manualExtraHint = ref('');
  const manualUpdateBusy = ref(false);
  const autoCatchUpBusy = ref(false);
  const refreshTick = ref(0);
  let progressToastId: string | null = null;
  let abortRequested = false;
  let activeTaskLabel = '手动填表';
  let actionPending = false;

  function progressToastOptions() {
    return {
      durationMs: 0,
      muteable: false,
      dismissible: false,
      action: abortRequested
        ? undefined
        : {
            label: '终止',
            variant: 'danger' as const,
            dismissOnClick: false,
            onClick: requestAbort,
          },
    };
  }

  function notifyProgress(text: string): void {
    if (progressToastId && toast.update(progressToastId, 'info', text, progressToastOptions())) {
      return;
    }
    progressToastId = toast.info(text, progressToastOptions());
  }

  function finishToast(kind: MessageKind, text: string): void {
    if (progressToastId) {
      if (toast.update(progressToastId, kind, text, { muteable: false })) {
        progressToastId = null;
        return;
      }
      progressToastId = null;
    }
    toast[kind](text, { muteable: false });
  }

  function requestAbort(): void {
    if (abortRequested) return;
    abortRequested = true;
    _set_wasStoppedByUser_ACU(true);
    abortAllActiveRequests_ACU();
    _set_isAutoUpdatingCard_ACU(false);
    if (progressToastId) {
      toast.update(progressToastId, 'warning', `${activeTaskLabel}已终止，正在停止当前任务与后续批次...`, {
        durationMs: 0,
        muteable: false,
        dismissible: false,
      });
    } else {
      toast.warning(`${activeTaskLabel}已终止，正在停止当前任务与后续批次...`, {
        durationMs: 0,
        muteable: false,
        dismissible: false,
      });
    }
  }

  const sheetKeys = computed(() => {
    void refreshTick.value;
    return currentSheetKeys();
  });

  const sheetNames = computed<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    for (const key of sheetKeys.value) {
      names[key] = String(currentJsonTableData_ACU?.[key]?.name || key);
    }
    return names;
  });

  const selectedSheetSummary = computed<string>(() => {
    const keys = selectedManualTableKeys.value;
    if (!keys.length) return '未选择表格';
    const names = sheetNames.value;
    return keys
      .map(key => `${names[key] || key}（${key}）`)
      .join('、');
  });

  const checkpointFloors = computed(() => {
    void refreshTick.value;
    try {
      return collectV2CheckpointFloorsFromChat_ACU(getChatArray_ACU(), getCurrentIsolationKey_ACU());
    } catch {
      return [];
    }
  });

  function formatCheckpointReasonLabel(reason?: string): string {
    switch (reason) {
      case 'init':
        return '初始基线';
      case 'migration':
        return '迁移基线';
      case 'compaction':
        return '保留边界基线';
      case 'manual':
        return '历史手动基线';
      case 'periodic':
        return '历史周期基线';
      default:
        return reason ? `旧基线:${reason}` : '旧基线';
    }
  }

  const checkpointFloorsLabel = computed<string>(() => {
    const checkpoints = checkpointFloors.value;
    return checkpoints.length > 0
      ? checkpoints
        .map(item => `AI 第 ${item.aiFloor} 层（${formatCheckpointReasonLabel(item.reason)}）`)
        .join('、')
      : '当前隔离标签暂无 full checkpoint';
  });

  const manualRefillRange = computed<ManualRefillRangeSummary | null>(() => {
    void refreshTick.value;
    try {
      return resolveManualRefillRangeSummary_ACU(manualContextDepth.value);
    } catch {
      return null;
    }
  });

  const manualRefillRangeLabel = computed<string>(() => {
    const range = manualRefillRange.value;
    return range
      ? formatAiFloorRange_ACU(range.startAiFloor, range.endAiFloor)
      : '暂无可重填 AI 楼层';
  });

  const checkpointRiskMessage = computed<string>(() => {
    const checkpoints = checkpointFloors.value;
    const range = manualRefillRange.value;
    if (checkpoints.length === 0 || !range) return '';
    const checkpointIndexSet = new Set(range.indices);
    const coveredCheckpoints = checkpoints.filter(item => checkpointIndexSet.has(item.messageIndex));
    if (coveredCheckpoints.length !== checkpoints.length) return '';
    const coveredFloors = coveredCheckpoints.map(item => `AI 第 ${item.aiFloor} 层`).join('、');
    return `危险：当前聊天的所有 full checkpoint 都在本次重填范围内（${coveredFloors}）。系统首次执行时只会做边界检查；如果确认缺少重填起点前可回放 checkpoint，会在下一步要求你单独确认是否替换本次范围内选中表的基底。`;
  });

  const vectorIndexWarning = computed<boolean>(() => {
    void refreshTick.value;
    try {
      return getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true;
    } catch {
      return false;
    }
  });

  function refresh(): void {
    selectedManualTableKeys.value = resolveManualSelection(currentSheetKeys());
    manualContextDepth.value = resolveManualContextDepth();
    manualBatchSize.value = resolveManualBatchSize();
    refreshTick.value++;
  }

  function setManualContextDepth(value: number | string): void {
    const normalized = normalizeNonNegativeInteger(value, manualContextDepth.value);
    manualContextDepth.value = normalized;
    settings_ACU.manualUpdateContextDepth = normalized;
    saveSettings_ACU();
  }

  function setManualBatchSize(value: number | string): void {
    const normalized = normalizePositiveInteger(value, manualBatchSize.value);
    manualBatchSize.value = normalized;
    settings_ACU.manualUpdateBatchSize = normalized;
    saveSettings_ACU();
  }

  function setManualSelectedKeys(keys: string[]): void {
    selectedManualTableKeys.value = keys.slice();
    saveManualSelection(selectedManualTableKeys.value);
    refreshTick.value++;
  }

  function selectAllManualTables(): void {
    setManualSelectedKeys(sheetKeys.value);
  }

  function selectNoManualTables(): void {
    setManualSelectedKeys([]);
  }

  async function executeManualFillSession({
    targetKeys,
    contextDepth,
    handleProgress,
    taskLabel,
  }: ExecuteManualFillSessionOptions): Promise<ManualFillSessionResult> {
    const runProcessBatch = (indices: number[], mode: string, options: any) =>
      processUpdatesBatch_ACU(indices, mode, options, (
        messagesToUse: any[],
        saveTargetIndex: number,
        updateMode: string,
        isSilentMode: boolean,
        targetSheetKeys: string[] | null,
        requestOptions: Record<string, any> | null,
        progressContext: BatchUpdateProgressContext,
      ) => executeCardUpdateCore_ACU(
        messagesToUse,
        saveTargetIndex,
        false,
        updateMode,
        isSilentMode,
        targetSheetKeys,
        requestOptions,
        new AbortController(),
        progressContext,
        handleProgress,
      ));

    const executeManualUpdate = async (confirmBoundaryReset: boolean) => {
      const restoreAutoUpdateSettings = applyManualSettingsForOrchestrator(contextDepth);
      try {
        return await orchestrateManualUpdate_ACU(
          targetKeys,
          runProcessBatch,
          async () => { await refreshMergedDataAndNotify_ACU(); },
          { clearBeforeUpdate: true, confirmBoundaryReset, onProgress: handleProgress },
        );
      } finally {
        restoreAutoUpdateSettings();
      }
    };

    let failureStage: ManualFillFailureStage = '首次 orchestrator';
    try {
      let result: ManualFillOrchestratorResult = await executeManualUpdate(false);
      if (!result.success && result.requiresUserConfirmation) {
        failureStage = '破坏性确认';
        const request = result.requiresUserConfirmation;
        const dangerConfirmed = await dialogStore.confirm({
          title: '破坏性手动重填确认',
          message: `${request.message}\n\n高风险操作：确认后会在一次提交中删除本次重填范围内选中表的旧表基底，并写入新的单表 checkpoint，随后才继续本次手动填表。\n目标表：${request.targetSheetKeys.join('、')}\n目标消息索引：${request.contextScopeIndices.join('、')}\n\n范围外 checkpoint、范围外聊天记录表格数据和未选中的表不会被删除。`,
          dangerMessage: '此操作不可撤销。取消将不会执行基底替换，不会写入新的单表 checkpoint，也不会继续本次手动填表。',
          confirmLabel: '我已了解风险，继续执行',
          cancelLabel: '取消',
          confirmVariant: 'danger',
        });
        if (!dangerConfirmed) return { status: 'cancelled', reason: 'boundary_reset' };
        notifyProgress(`已确认破坏性基底替换，继续${taskLabel}。`);
        failureStage = '破坏性确认重入';
        result = await executeManualUpdate(true);
      }

      return result.success
        ? { status: 'success', result }
        : { status: 'failed', error: result.error || `${taskLabel}失败。`, stage: failureStage, result };
    } catch (error: any) {
      return { status: 'failed', error: error?.message || `${taskLabel}执行异常。`, stage: failureStage };
    }
  }

  function createChatStructureFingerprint(): ChatStructureFingerprint {
    const chat = getChatArray_ACU();
    const aiMessageIndices = Array.isArray(chat) ? collectAiMessageIndices(chat) : [];
    const skip = Math.min(normalizeNonNegativeInteger(settings_ACU.skipUpdateFloors, 0), aiMessageIndices.length);
    return {
      isolationKey: getCurrentIsolationKey_ACU(),
      aiMessageIndices,
      effectiveTailFloor: aiMessageIndices.length - skip,
    };
  }

  function formatCatchUpGroup(group: CatchUpGroup): string {
    const names = sheetNames.value;
    const targets = group.targetKeys.map(key => names[key] || key).join('、');
    return `${formatAiFloorRange_ACU(group.startAiFloor, group.endAiFloor)}：${targets}`;
  }

  async function runAutoCatchUp(): Promise<void> {
    if (manualUpdateBusy.value || autoCatchUpBusy.value || actionPending) return;
    const targetKeys = selectedManualTableKeys.value.slice();
    if (!targetKeys.length) {
      toast.warning('未选择需要自动追平的表格。');
      return;
    }

    actionPending = true;
    try {
      const chat = getChatArray_ACU();
      const liveChat = Array.isArray(chat) ? chat : [];
      const fingerprint = createChatStructureFingerprint();
      if (!fingerprint.aiMessageIndices.length) {
        toast.info('当前没有可用于填表的 AI 回复。');
        return;
      }
      const plan = planManualFillCatchUp({
        aiMessageIndices: fingerprint.aiMessageIndices,
        skipUpdateFloors: settings_ACU.skipUpdateFloors,
        sheets: targetKeys.map(sheetKey => {
          const table = currentJsonTableData_ACU?.[sheetKey];
          const history = resolveTableHistoryStateFromChat_ACU(liveChat, {
            sheetKey,
            isSummaryTable: isSummaryOrOutlineTable_ACU(String(table?.name || '')),
            isolationKey: fingerprint.isolationKey,
            settings: settings_ACU,
          });
          return {
            sheetKey,
            hasAnyData: history.hasAnyData,
            hasTrackedUpdate: history.hasTrackedUpdate,
            lastTrackedUpdateAiFloor: history.lastTrackedUpdateAiFloor,
          };
        }),
      });
      if (!plan.length) {
        toast.info('所选表已追平。');
        return;
      }

      const confirmed = await dialogStore.confirm({
        title: '执行自动追平',
        message: `即将按以下 ${plan.length} 个范围组严格串行执行：\n\n${plan.map((group, index) => `${index + 1}. ${formatCatchUpGroup(group)}`).join('\n')}\n\n每个范围组都会复用普通手动填表的 service 调用与破坏性边界确认；任一组取消、失败、异常、终止或聊天结构变化后，后续组不会执行。`,
        confirmLabel: '确认并继续',
        cancelLabel: '取消',
      });
      if (!confirmed) return;

      autoCatchUpBusy.value = true;
      progressToastId = null;
      activeTaskLabel = '自动追平';
      abortRequested = false;
      _set_wasStoppedByUser_ACU(false);
      const extra = manualExtraHint.value.trim();
      if (extra) _set_manualExtraHint_ACU(`以下为用户的额外填表要求,请严格遵守:\n${extra}`);

      for (let index = 0; index < plan.length; index += 1) {
        const group = plan[index];
        if (abortRequested) break;
        if (!sameChatStructure(fingerprint, createChatStructureFingerprint())) {
          finishToast('warning', '自动追平已停止：聊天或隔离范围已变化，请重新规划后再执行。');
          return;
        }
        const groupLabel = `自动追平第 ${index + 1}/${plan.length} 组（${formatCatchUpGroup(group)}）`;
        notifyProgress(`${groupLabel}开始。`);
        const handleProgress = (event: CardUpdateProgressEvent) => {
          notifyProgress(`${groupLabel} · ${progressLabel(event)}`);
          if (event.phase === 'complete') {
            try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.(); } catch (_) {}
            refreshTick.value++;
          }
        };
        const session = await executeManualFillSession({
          targetKeys: group.targetKeys,
          contextDepth: group.contextDepth,
          handleProgress,
          taskLabel: groupLabel,
        });
        if (session.status === 'cancelled') {
          finishToast('info', `${groupLabel}已取消，后续范围组未执行。`);
          return;
        }
        if (session.status === 'failed') {
          finishToast(abortRequested || session.error.includes('终止') ? 'warning' : 'error',
            `${groupLabel}在${session.stage}阶段失败：${session.error}`);
          return;
        }
      }

      if (abortRequested) {
        finishToast('warning', '自动追平任务已由用户终止。');
      } else {
        finishToast('success', `自动追平完成，共完成 ${plan.length} 个范围组。`);
      }
    } catch (error: any) {
      finishToast('error', `自动追平规划或调度失败：${error?.message || '未知错误'}`);
    } finally {
      autoCatchUpBusy.value = false;
      refresh();
      actionPending = false;
    }
  }

  async function runManualUpdate(): Promise<void> {
    if (manualUpdateBusy.value || autoCatchUpBusy.value || actionPending) return;
    actionPending = true;
    try {
      if (!selectedManualTableKeys.value.length) {
        toast.warning('未选择需要手动填表的表格。');
        return;
      }

      const confirmed = await dialogStore.confirm({
        title: '执行手动填表',
        message: `即将执行手动填表。\n\n当前 full checkpoint：${checkpointFloorsLabel.value}\n本次重填范围：${manualRefillRangeLabel.value}\n选中表：${selectedSheetSummary.value}\n\n系统会先在 service 层做重填边界检查，并在内存中按当前上下文和批处理设置准备重填当前选中的表。\n常规路径只会在确认可回放边界后清理本次范围内选中表的 V2 增量日志与 revision 指纹，并在全部成功后写入手动重填进度记录。\n如果边界检查确认重填起点前没有可回放 checkpoint，系统会停止并弹出第二次破坏性确认；只有你在第二次确认中授权后，才会替换本次范围内选中表的旧 checkpoint 基底并写入新的单表 checkpoint。\n\n取消、失败、终止或从中断处继续时，不会清理本次重填范围之外的聊天记录表格数据，也不会在未二次确认时替换 checkpoint 基底。`,
        dangerMessage: checkpointRiskMessage.value || undefined,
        confirmLabel: '确认并继续',
        cancelLabel: '取消',
        confirmVariant: checkpointRiskMessage.value ? 'danger' : undefined,
      });
      if (!confirmed) return;
      const targetManualTableKeys = selectedManualTableKeys.value.slice();

      manualUpdateBusy.value = true;
      progressToastId = null;
      activeTaskLabel = '手动填表';
      abortRequested = false;
      _set_wasStoppedByUser_ACU(false);
      notifyProgress('手动填表开始。');
      const extra = manualExtraHint.value.trim();
      if (extra) _set_manualExtraHint_ACU(`以下为用户的额外填表要求,请严格遵守:\n${extra}`);
      const handleProgress = (event: CardUpdateProgressEvent) => {
        notifyProgress(progressLabel(event));
        if (event.phase === 'complete') {
          try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.(); } catch (_) {}
          refreshTick.value++;
        }
      };

      try {
        const session = await executeManualFillSession({
          targetKeys: targetManualTableKeys,
          contextDepth: manualContextDepth.value,
          handleProgress,
          taskLabel: '手动填表',
        });
        if (session.status === 'cancelled') {
          finishToast('info', '已取消破坏性基底替换。');
          return;
        }
        if (session.status === 'failed') {
          finishToast(abortRequested || session.error.includes('终止') ? 'warning' : 'error',
            abortRequested ? '手动填表任务已由用户终止。' : session.error);
          return;
        }
        const result = session.result;
        finishToast(
          result.checkpointWarning ? 'warning' : 'success',
          `${result.autoMergeTriggered
            ? `手动填表完成;自动合并总结${result.autoMergeSuccess ? '已完成' : '未完成'}。`
            : '手动填表完成。'}${result.checkpointWarning
              ? ` 但 AI 楼层保留边界 checkpoint 建立失败：${result.checkpointWarning}`
              : ''}`,
        );
      } catch (error: any) {
        finishToast('error', error?.message || '手动填表执行异常。');
      } finally {
        manualUpdateBusy.value = false;
        refresh();
      }
    } finally {
      actionPending = false;
    }
  }

  return {
    selectedManualTableKeys,
    manualContextDepth,
    manualBatchSize,
    manualExtraHint,
    manualUpdateBusy,
    autoCatchUpBusy,
    sheetKeys,
    sheetNames,
    selectedSheetSummary,
    checkpointFloorsLabel,
    manualRefillRangeLabel,
    checkpointRiskMessage,
    vectorIndexWarning,
    refresh,
    setManualContextDepth,
    setManualBatchSize,
    setManualSelectedKeys,
    selectAllManualTables,
    selectNoManualTables,
    runManualUpdate,
    runAutoCatchUp,
  };
}

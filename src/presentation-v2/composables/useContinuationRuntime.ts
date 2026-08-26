import { computed, ref } from 'vue';
import { getContinuationRuntime_ACU } from '../../service/continuation/continuation-runtime';
import { buildDefaultContinuationSettings_ACU } from '../../service/continuation/defaults';
import { ContinuationValidationError_ACU, type ContinuationEnvelope_ACU, type ContinuationSettings_ACU, type ContinuationTask_ACU, type StageOutline_ACU } from '../../service/continuation/model';
import type { ContinuationOrchestratorResult_ACU } from '../../service/continuation/continuation-orchestrator';
import type { ContinuationPreparedTurnInstruction_ACU } from '../../service/continuation/stage-execution-engine';
import { useToastStore } from '../stores/toast-store';

type ContinuationActionResult_ACU = ContinuationOrchestratorResult_ACU & { preparedTurn?: ContinuationPreparedTurnInstruction_ACU };
type ContinuationRuntimeActionResult_ACU = ContinuationActionResult_ACU | ContinuationEnvelope_ACU;

function errorMessage_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : '智能续写操作失败';
}

export function useContinuationRuntime() {
  const toast = useToastStore();
  const runtime = getContinuationRuntime_ACU();
  const envelope = ref<ContinuationEnvelope_ACU | null>(null);
  const fallbackSettings = buildDefaultContinuationSettings_ACU();
  const busy = ref(false);
  const originInstruction = ref('');
  let initialization: Promise<void> | null = null;

  function refresh(): void {
    try {
      envelope.value = runtime.read();
    } catch (error) {
      envelope.value = null;
      toast.error(errorMessage_ACU(error), { muteable: false });
    }
  }

  async function initialize(): Promise<void> {
    if (initialization) return initialization;
    busy.value = true;
    const currentInitialization = runtime.initialize()
      .then(() => refresh())
      .catch(error => {
        toast.error(errorMessage_ACU(error), { muteable: false });
        refresh();
      })
      .finally(() => {
        busy.value = false;
        if (initialization === currentInitialization) initialization = null;
      });
    initialization = currentInitialization;
    return initialization;
  }

  async function run_ACU(action: () => Promise<ContinuationRuntimeActionResult_ACU>): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const result = await action();
      if ('preparedTurn' in result && result.preparedTurn) {
        const sent = await runtime.bridge.send(result.preparedTurn);
        if (!sent) toast.error('宿主输入不可用，智能续写已暂停。', { muteable: false });
      }
      envelope.value = 'envelope' in result ? result.envelope : result;
      refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage_ACU(error), { muteable: false });
      refresh();
      return false;
    } finally {
      busy.value = false;
    }
  }

  const task = computed(() => envelope.value?.activeTask ?? null);
  const settings = computed(() => envelope.value?.settings ?? fallbackSettings);
  const activeStage = computed(() => task.value?.activeStageId
    ? task.value.stages.find(stage => stage.stageId === task.value?.activeStageId) ?? null
    : null);
  const activeRevision = computed(() => activeStage.value
    ? activeStage.value.revisions.find(revision => revision.revision === activeStage.value?.activeRevision) ?? null
    : null);
  const activeNode = computed(() => activeRevision.value?.outline.nodes[activeStage.value?.activeNodeIndex ?? -1] ?? null);
  const activeTurn = computed(() => activeNode.value?.turns[activeStage.value?.activeTurnIndex ?? -1] ?? null);
  // 无阶段（大纲待创建）与已完成阶段（下一阶段待继续）也可继续：由主 Agent 派工大纲子代理处理。
  const canContinue = computed(() => !!task.value
    && task.value.status === 'paused'
    && task.value.stopReason === null
    && (!activeStage.value || ['running', 'completed'].includes(activeStage.value.status)));
  const isAwaitingHostResult = computed(() => task.value?.status === 'running' && task.value.pendingHostTurn?.status === 'awaiting_generation');
  const statusText = computed(() => task.value
    ? (isAwaitingHostResult.value ? '等待宿主正文' : task.value.status)
    : '尚未创建任务');

  async function createTask(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.createTask({ originInstruction: originInstruction.value }));
    if (task.value) originInstruction.value = '';
  }

  async function continueTask(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.continueTask());
  }

  async function stopTask(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.stopTask());
  }

  async function replanRemaining(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.replanRemaining());
  }

  async function replanRemainingWithInstruction(instruction: string): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.replanRemaining({ instruction }));
  }

  async function retryCurrentTurn(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.retryCurrentTurn());
  }

  async function acceptOutline(outline: StageOutline_ACU): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.acceptOutline({ outline }));
  }

  async function abandonAndCreate(newOriginInstruction: string): Promise<boolean> {
    const succeeded = await run_ACU(() => runtime.orchestrator.abandonAndCreate({ originInstruction: newOriginInstruction, confirmAbandon: true }));
    if (succeeded) originInstruction.value = '';
    return succeeded;
  }

  async function saveSettings(settings: ContinuationSettings_ACU): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.replaceSettings({ settings }));
  }

  return {
    activeStage,
    activeNode,
    activeRevision,
    activeTurn,
    abandonAndCreate,
    acceptOutline,
    busy,
    canContinue,
    createTask,
    continueTask,
    initialize,
    isAwaitingHostResult,
    originInstruction,
    refresh,
    replanRemaining,
    replanRemainingWithInstruction,
    retryCurrentTurn,
    saveSettings,
    statusText,
    settings,
    stopTask,
    task,
  };
}

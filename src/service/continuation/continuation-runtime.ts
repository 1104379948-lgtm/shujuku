import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { FirstFloorContinuationStore_ACU } from './continuation-store';
import { buildMigratedContinuationEnvelope_ACU, stripLegacyContinuationLoopFields_ACU } from './continuation-store';
import { ContinuationOrchestrator_ACU, type ContinuationPlanningContext_ACU } from './continuation-orchestrator';
import { ContinuationOutlinePlanner_ACU } from './outline-planner';
import { StageExecutionEngine_ACU, type ContinuationExecutionSnapshot_ACU } from './stage-execution-engine';
import { ContinuationAgentTurnPlanner_ACU } from './agent/agent-main-loop';
import { ContinuationWorldbookContext_ACU } from './worldbook-context';
import { createSillyTavernContinuationHostBridge_ACU } from './sillytavern-host-bridge';
import { registerContinuationHostGenerationBridge_ACU } from './host-generation-bridge-registry';
import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import type { ContinuationHostGenerationBridge_ACU } from './host-generation-bridge';
import type { ContinuationPromptPlaceholder_ACU } from './prompt-template';
import type { ContinuationEnvelope_ACU, ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from './model';

export interface ContinuationRuntime_ACU {
  orchestrator: ContinuationOrchestrator_ACU;
  bridge: ContinuationHostGenerationBridge_ACU;
  initialize(): Promise<ContinuationEnvelope_ACU | null>;
  read(): ContinuationEnvelope_ACU | null;
  dispose(): void;
}

let runtime_ACU: ContinuationRuntime_ACU | null = null;
let idSequence_ACU = 0;

function allocateContinuationId_ACU(prefix: string): string {
  idSequence_ACU += 1;
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}-${idSequence_ACU}`;
}

function readRecentStory_ACU(limit: number): string {
  return getChatArray_ACU()
    .filter(message => message && !message.is_user && message?.extra?.type !== 'narrator')
    .slice(-Math.max(0, limit))
    .map(message => String(message.mes ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 阶段历史里保留逐轮目标的阶段数（从最新往前数）。更早的阶段只保留节点级摘要。 */
const STAGE_HISTORY_DETAILED_STAGES_ACU = 2;

/**
 * 渲染阶段历史。
 *
 * 只给每个阶段的活动 revision：被替换掉的旧 revision 是作废的计划，对规划下一阶段没有信息价值，
 * 全量塞进去只会让提示词随 revision 数线性膨胀。最近两个阶段给到逐轮目标，更早的压到节点级——
 * 那些阶段的事实已经沉淀进纪要，这里只需要让模型知道故事大致走过哪些节点。
 * 输出是可读文本而不是 JSON，避免诱导大纲模型用 JSON 回话。
 * @param task 当前任务
 * @returns 自然语言文本
 */
export function serializeStageHistory_ACU(task: ContinuationTask_ACU): string {
  if (!task.stages.length) return '还没有任何阶段，本次是第一个阶段。';
  const detailedFrom = Math.max(0, task.stages.length - STAGE_HISTORY_DETAILED_STAGES_ACU);
  const sections = task.stages.map((stage, index) => {
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision) ?? null;
    const head = `## 第 ${stage.stageNumber} 阶段（${stage.status}，已完成 ${stage.completedTurns}/${revision?.outline.totalTurns ?? 0} 轮${stage.chronicleRange ? `，纪要范围 ${stage.chronicleRange.first} → ${stage.chronicleRange.last}` : ''}）`;
    if (!revision) return `${head}\n（该阶段没有可读的大纲。）`;
    const lines = [head, `标题：${revision.outline.title}`, `目标：${revision.outline.goal}`];
    for (const node of revision.outline.nodes) {
      lines.push(`- 节点「${node.title}」：${node.goal}`);
      if (index >= detailedFrom) for (const turn of node.turns) lines.push(`  · ${turn.goal}`);
    }
    if (index < detailedFrom) lines.push('（该阶段较早，已省略逐轮目标；其事实已进入纪要。）');
    return lines.join('\n');
  });
  return sections.join('\n\n');
}

function previousStages_ACU(task: ContinuationTask_ACU, activeStage: ContinuationStage_ACU | null): ContinuationStage_ACU[] {
  if (!activeStage) return [];
  return task.stages.filter(stage => stage.stageNumber < activeStage.stageNumber && stage.status === 'completed');
}

/** 已完成前缀渲染为可读文本（不用 JSON，避免诱导模型输出 JSON 而非大纲标签）。 */
function completedPrefix_ACU(stage: ContinuationStage_ACU | null, revision: StageRevision_ACU | null): string {
  if (!stage || !revision || stage.completedTurns <= 0) return '';
  let remaining = stage.completedTurns;
  let turnNumber = 0;
  const parts: string[] = [];
  for (const node of revision.outline.nodes) {
    if (remaining <= 0) break;
    const turns = node.turns.slice(0, Math.min(remaining, node.turns.length));
    remaining -= turns.length;
    if (!turns.length) continue;
    const lines = [`节点「${node.title}」：${node.goal}`];
    for (const turn of turns) {
      turnNumber += 1;
      lines.push(`已完成第 ${turnNumber} 轮：${turn.goal}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

function buildResolvers_ACU(task: ContinuationTask_ACU, stage: ContinuationStage_ACU | null, revision: StageRevision_ACU | null, worldbook: ContinuationWorldbookContext_ACU, current?: ContinuationExecutionSnapshot_ACU): Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string>>> {
  const previous = previousStages_ACU(task, stage);
  const lastStage = previous.length ? previous[previous.length - 1] : null;
  const earlier = previous.slice(0, -1);
  const recentStory = () => readRecentStory_ACU(task ? 3 : 0);
  const background = () => worldbook.readRelevantBackground(`${task.originInstruction}\n${recentStory()}`);
  return {
    $ORIGIN_INSTRUCTION: () => task.originInstruction,
    $1: background,
    $RECENT_STORY: recentStory,
    $STAGE_HISTORY: () => serializeStageHistory_ACU(task),
    $LAST_STAGE_CHRONICLES: () => worldbook.readLastStageChronicles(lastStage?.chronicleRange),
    $EARLIER_STAGE_SUMMARIES: () => worldbook.readEarlierStageSummaries(earlier.map(item => item.chronicleRange)),
    $COMPLETED_STAGE_PART: () => completedPrefix_ACU(stage, revision),
    $REPLAN_INSTRUCTION: () => revision?.replanInstruction ?? '',
    $REMAINING_TURNS: () => revision ? String(revision.outline.totalTurns - (stage?.completedTurns ?? 0)) : '',
    $CURRENT_STAGE: () => stage && revision ? `阶段 ${stage.stageNumber}: ${revision.outline.title}\n${revision.outline.goal}` : '',
    $CURRENT_NODE: () => current ? `${current.node.title}\n${current.node.goal}` : '',
    $CURRENT_TURN_GOAL: () => current?.turn.goal ?? '',
    $TURN_NUMBER: () => current ? String(current.turnNumber) : '',
    $NODE_TURN_NUMBER: () => current ? String(current.nodeTurnNumber) : '',
  };
}

function getChatIdentity_ACU(): string {
  return getActiveChatStorageIdentity_ACU(getChatArray_ACU());
}

function hasLegacyContinuationLoopFields_ACU(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const loopSettings = (value as Record<string, unknown>).loopSettings;
  if (!loopSettings || typeof loopSettings !== 'object' || Array.isArray(loopSettings)) return false;
  return Object.prototype.hasOwnProperty.call(loopSettings, 'quickReplyContent')
    || Object.prototype.hasOwnProperty.call(loopSettings, 'currentPromptIndex');
}

async function migrateLegacySettings_ACU(store: FirstFloorContinuationStore_ACU): Promise<ContinuationEnvelope_ACU | null> {
  const existing = store.readPersisted();
  const legacyPlotSettings = settings_ACU?.plotSettings;
  if (!existing) {
    const migration = buildMigratedContinuationEnvelope_ACU(legacyPlotSettings);
    if (!migration.didMigrate) return null;
    await store.replaceAtomically(migration.envelope);
  }
  if (!hasLegacyContinuationLoopFields_ACU(legacyPlotSettings)) return store.read();
  const stripped = stripLegacyContinuationLoopFields_ACU(legacyPlotSettings);
  if (stripped && typeof stripped === 'object' && !Array.isArray(stripped)) {
    const previous = settings_ACU.plotSettings;
    settings_ACU.plotSettings = stripped as Record<string, unknown>;
    try {
      if (!saveSettings_ACU().saved) settings_ACU.plotSettings = previous;
    } catch (error) {
      settings_ACU.plotSettings = previous;
      throw error;
    }
  }
  return store.read();
}

function createRuntime_ACU(): ContinuationRuntime_ACU {
  const store = new FirstFloorContinuationStore_ACU();
  const worldbook = new ContinuationWorldbookContext_ACU();
  const planner = new ContinuationOutlinePlanner_ACU();
  const agentPlanner = new ContinuationAgentTurnPlanner_ACU();
  // 桥在 orchestrator 之后创建，orchestrator 依赖用闭包延迟取活认领状态。
  let bridgeRef: ContinuationHostGenerationBridge_ACU | null = null;
  const executionEngine = new StageExecutionEngine_ACU({
    readEnvelope: () => store.readPersisted(),
    getChatIdentity: getChatIdentity_ACU,
    allocateId: allocateContinuationId_ACU,
    planner: agentPlanner,
  });
  const orchestrator = new ContinuationOrchestrator_ACU({
    store,
    planner,
    executionEngine,
    getChatIdentity: getChatIdentity_ACU,
    now: () => Date.now(),
    allocateId: allocateContinuationId_ACU,
    readChronicleSnapshot: () => worldbook.readChronicleSnapshot(),
    createOutlineResolvers: (context: ContinuationPlanningContext_ACU) => {
      const stage = context.stage;
      const revision = stage?.revisions.find(item => item.revision === stage.activeRevision) ?? null;
      return buildResolvers_ACU(context.task, stage, revision, worldbook);
    },
    hasLiveHostClaim: chatIdentity => bridgeRef?.hasLiveClaim(chatIdentity) ?? false,
  });
  const bridge = createSillyTavernContinuationHostBridge_ACU(orchestrator);
  bridgeRef = bridge;
  const unregister = registerContinuationHostGenerationBridge_ACU(bridge);
  return {
    orchestrator,
    bridge,
    initialize: () => migrateLegacySettings_ACU(store),
    read: () => {
      // 桥内存里有本次生成的活认领时保留 running 视图：UI 显示"等待宿主正文"并隐藏继续按钮。
      // 无认领（重载/事件丢失）时走重载派生，任务回到可继续的暂停态。
      const persisted = store.readPersisted();
      const task = persisted?.activeTask;
      if (persisted && task?.status === 'running' && task.pendingHostTurn?.status === 'awaiting_generation' && bridge.hasLiveClaim(getChatIdentity_ACU())) {
        return persisted;
      }
      return store.read();
    },
    dispose: () => {
      unregister();
      if (runtime_ACU?.orchestrator === orchestrator) runtime_ACU = null;
    },
  };
}

export function getContinuationRuntime_ACU(): ContinuationRuntime_ACU {
  if (!runtime_ACU) runtime_ACU = createRuntime_ACU();
  return runtime_ACU;
}

export function resetContinuationRuntimeForTests_ACU(): void {
  runtime_ACU?.dispose();
  runtime_ACU = null;
  idSequence_ACU = 0;
}

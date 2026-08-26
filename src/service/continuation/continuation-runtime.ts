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

function serializeStageHistory_ACU(task: ContinuationTask_ACU): string {
  return JSON.stringify(task.stages.map(stage => ({
    stageId: stage.stageId,
    stageNumber: stage.stageNumber,
    status: stage.status,
    activeRevision: stage.activeRevision,
    completedTurns: stage.completedTurns,
    chronicleRange: stage.chronicleRange,
    revisions: stage.revisions.map(revision => ({ revision: revision.revision, frozen: revision.frozen, outline: revision.outline })),
  })));
}

function previousStages_ACU(task: ContinuationTask_ACU, activeStage: ContinuationStage_ACU | null): ContinuationStage_ACU[] {
  if (!activeStage) return [];
  return task.stages.filter(stage => stage.stageNumber < activeStage.stageNumber && stage.status === 'completed');
}

function completedPrefix_ACU(stage: ContinuationStage_ACU | null, revision: StageRevision_ACU | null): string {
  if (!stage || !revision || stage.completedTurns <= 0) return '';
  let remaining = stage.completedTurns;
  return JSON.stringify(revision.outline.nodes.flatMap(node => {
    const turns = node.turns.slice(0, Math.max(0, Math.min(remaining, node.turns.length)));
    remaining -= turns.length;
    return turns.length ? [{ id: node.id, title: node.title, goal: node.goal, turns }] : [];
  }));
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
  });
  const bridge = createSillyTavernContinuationHostBridge_ACU(orchestrator);
  const unregister = registerContinuationHostGenerationBridge_ACU(bridge);
  return {
    orchestrator,
    bridge,
    initialize: () => migrateLegacySettings_ACU(store),
    read: () => store.read(),
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

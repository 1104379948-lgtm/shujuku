import { buildDefaultContinuationSettings_ACU } from './defaults';
import { FirstFloorContinuationStore_ACU } from './continuation-store';
import { acceptPlannedStageRevision_ACU, ContinuationOutlinePlanner_ACU, createPlannedStageRevision_ACU, type ContinuationOutlinePlanningResult_ACU } from './outline-planner';
import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationEnvelope_ACU, type ContinuationHostGenerationCapture_ACU, type ContinuationReplanConstraints_ACU, type ContinuationRevisionReason_ACU, type ContinuationStage_ACU, type ContinuationTask_ACU, type ContinuationWriteGuard_ACU, type StageOutline_ACU, type StageRevision_ACU, type TurnAttemptIdentity_ACU } from './model';
import { StageExecutionEngine_ACU, type ContinuationPreparedTurnInstruction_ACU, type ContinuationExecutionSnapshot_ACU } from './stage-execution-engine';
import type { ContinuationPromptPlaceholder_ACU } from './prompt-template';

export interface ContinuationChronicleSnapshot_ACU { count: number; range: { first: string; last: string } | null; }
export interface ContinuationPlanningContext_ACU { envelope: ContinuationEnvelope_ACU; task: ContinuationTask_ACU; stage: ContinuationStage_ACU | null; reason: ContinuationRevisionReason_ACU; replanInstruction: string; }
export interface CreateContinuationTaskInput_ACU { originInstruction: string; }
export interface ReplanContinuationInput_ACU { instruction?: string; }
export interface AcceptOutlineInput_ACU { outline?: StageOutline_ACU; }
export interface ReplaceContinuationSettingsInput_ACU { settings: ContinuationEnvelope_ACU['settings']; }
export interface ContinuationOrchestratorResult_ACU { envelope: ContinuationEnvelope_ACU; task: ContinuationTask_ACU; planning?: Pick<ContinuationOutlinePlanningResult_ACU, 'attempts' | 'apiPreset' | 'requiresReview'>; }
export interface RecordHostTurnInput_ACU { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU; }
export interface RejectHostTurnInput_ACU { identity: TurnAttemptIdentity_ACU; messageIndex: number; }
export interface ContinuationPendingHostTurnSnapshot_ACU { settings: ContinuationEnvelope_ACU['settings']; pending: NonNullable<ContinuationTask_ACU['pendingHostTurn']>; }

export interface ContinuationOrchestratorDependencies_ACU {
  store: FirstFloorContinuationStore_ACU;
  planner: ContinuationOutlinePlanner_ACU;
  executionEngine: StageExecutionEngine_ACU;
  getChatIdentity: () => string;
  now: () => number;
  allocateId: (prefix: string) => string;
  readChronicleSnapshot: () => Promise<ContinuationChronicleSnapshot_ACU>;
  createOutlineResolvers: (context: ContinuationPlanningContext_ACU) => Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string | null | undefined> | null | undefined>>;
}

type Lease_ACU = { id: string; epoch: number };
const leasesByChat_ACU = new Map<string, Lease_ACU>();
const epochsByChat_ACU = new Map<string, number>();

function fail_ACU(code: 'CONTINUATION_OPERATION_BUSY' | 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY' | 'CONTINUATION_TASK_NOT_FOUND' | 'CONTINUATION_TASK_STATE_INVALID', message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'persist', message, false));
}

function cloneOutline_ACU(outline: StageOutline_ACU): StageOutline_ACU {
  return { ...outline, nodes: outline.nodes.map(node => ({ ...node, turns: node.turns.map(turn => ({ ...turn })) })) };
}

function guardForTask_ACU(chatIdentity: string, task: ContinuationTask_ACU | null): ContinuationWriteGuard_ACU {
  const stage = task?.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
  return task
    ? { chatIdentity, taskId: task.taskId, stageId: task.activeStageId, revision: stage?.activeRevision }
    : { chatIdentity };
}

function getActiveStage_ACU(task: ContinuationTask_ACU): ContinuationStage_ACU {
  const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
  if (!stage) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '任务缺少活动阶段');
  return stage;
}

function getActiveRevision_ACU(stage: ContinuationStage_ACU): StageRevision_ACU {
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  if (!revision) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '阶段缺少活动 revision');
  return revision;
}

function taskResult_ACU(envelope: ContinuationEnvelope_ACU, planning?: ContinuationOrchestratorResult_ACU['planning']): ContinuationOrchestratorResult_ACU {
  if (!envelope.activeTask) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
  return { envelope, task: envelope.activeTask, ...(planning ? { planning } : {}) };
}

function normalizeOriginInstruction_ACU(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail_ACU('CONTINUATION_ORIGIN_INSTRUCTION_EMPTY', '初始续写要求不能为空');
  return value.trim();
}

function stageForOutline_ACU(stageId: string, stageNumber: number, revision: StageRevision_ACU, snapshot: ContinuationChronicleSnapshot_ACU, status: ContinuationStage_ACU['status']): ContinuationStage_ACU {
  return { stageId, stageNumber, status, chronicleStartCount: snapshot.count, chronicleEndCount: null, chronicleAddedCount: null, chronicleRange: null, activeRevision: revision.revision, revisions: [revision], activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: 0 };
}

function identityMatchesCurrentTurn_ACU(task: ContinuationTask_ACU, identity: TurnAttemptIdentity_ACU): boolean {
  if (task.taskId !== identity.taskId || task.activeStageId !== identity.stageId) return false;
  const stage = task.stages.find(item => item.stageId === identity.stageId);
  if (!stage || stage.activeRevision !== identity.revision) return false;
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  const node = revision?.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (node?.id !== identity.nodeId || turn?.id !== identity.turnId) return false;
  const pending = task.pendingHostTurn;
  return !pending || (
    pending.identity.chatIdentity === identity.chatIdentity
    && pending.identity.taskId === identity.taskId && pending.identity.stageId === identity.stageId
    && pending.identity.revision === identity.revision && pending.identity.nodeId === identity.nodeId
    && pending.identity.turnId === identity.turnId && pending.identity.attemptId === identity.attemptId
  );
}

function advanceConfirmedTurn_ACU(task: ContinuationTask_ACU, snapshot: ContinuationChronicleSnapshot_ACU | null, now: number, timeline: (kind: ContinuationTask_ACU['timeline'][number]['kind'], at: number, fields?: Omit<ContinuationTask_ACU['timeline'][number], 'id' | 'at' | 'kind'>) => ContinuationTask_ACU['timeline'][number]): ContinuationTask_ACU {
  const stage = getActiveStage_ACU(task);
  const revision = getActiveRevision_ACU(stage);
  const node = revision.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (!node || !turn) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已确认轮次的阶段游标无效');
  const completedTurns = stage.completedTurns + 1;
  const isFinalTurn = completedTurns === revision.outline.totalTurns;
  const nextStage = isFinalTurn
    ? { ...stage, status: 'completed' as const, completedTurns, chronicleEndCount: snapshot?.count ?? stage.chronicleEndCount, chronicleAddedCount: snapshot ? snapshot.count - stage.chronicleStartCount : stage.chronicleAddedCount, chronicleRange: snapshot?.range ?? stage.chronicleRange }
    : stage.activeTurnIndex + 1 < node.turns.length
      ? { ...stage, activeTurnIndex: stage.activeTurnIndex + 1, completedTurns }
      : { ...stage, activeNodeIndex: stage.activeNodeIndex + 1, activeTurnIndex: 0, completedTurns };
  const entries = [...task.timeline, timeline('turn_completed', now, { stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id })];
  if (isFinalTurn) entries.push(timeline('stage_completed', now, { stageId: stage.stageId, revision: stage.activeRevision }));
  return { ...task, updatedAt: now, stages: task.stages.map(item => item.stageId === stage.stageId ? nextStage : item), timeline: entries };
}


export class ContinuationOrchestrator_ACU {
  constructor(private readonly dependencies: ContinuationOrchestratorDependencies_ACU) {}

  async createTask(input: CreateContinuationTaskInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const originInstruction = normalizeOriginInstruction_ACU(input.originInstruction);
    return this.withLease_ACU(async (chatIdentity, lease) => {
      const existing = this.dependencies.store.readPersisted()?.activeTask ?? null;
      if (existing && !['completed', 'abandoned', 'failed'].includes(existing.status)) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前聊天已有未完成的智能续写任务');
      }
      const now = this.dependencies.now();
      const taskId = this.dependencies.allocateId('task');
      const stageId = this.dependencies.allocateId('stage');
      const draft: ContinuationTask_ACU = {
        taskId, originInstruction, status: 'drafting', createdAt: now, updatedAt: now, runStartedAt: null, deadlineAt: null,
        runStageCount: 1, activeStageId: stageId, stages: [], timeline: [], stopReason: null, lastError: null,
      };
      const context: ContinuationPlanningContext_ACU = { envelope: this.baseEnvelope_ACU(), task: draft, stage: null, reason: 'initial', replanInstruction: '' };
      const planned = await this.planOutline_ACU(context, chatIdentity, lease, stageId, 1);
      const snapshot = await this.dependencies.readChronicleSnapshot();
      this.assertLeaseCurrent_ACU(chatIdentity, lease);
      const revision = createPlannedStageRevision_ACU(planned.outline, 1, 'initial', '', now);
      const needsReview = planned.requiresReview;
      const stage = stageForOutline_ACU(stageId, 1, needsReview ? revision : acceptPlannedStageRevision_ACU(revision, context.envelope.settings), snapshot, needsReview ? 'awaiting_review' : 'running');
      const candidate: ContinuationEnvelope_ACU = {
        schemaVersion: context.envelope.schemaVersion,
        settings: context.envelope.settings,
        activeTask: {
          ...draft,
          status: needsReview ? 'awaiting_outline_review' : 'paused',
          stages: [stage],
          timeline: [this.timeline_ACU('task_created', now, { stageId }), this.timeline_ACU('outline_ready', now, { stageId, revision: 1 })],
        },
      };
      await this.dependencies.store.replaceAtomically(candidate, guardForTask_ACU(chatIdentity, existing));
      return taskResult_ACU(candidate, this.planningSummary_ACU(planned));
    });
  }

  async acceptOutline(input: AcceptOutlineInput_ACU = {}): Promise<ContinuationOrchestratorResult_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        const revision = getActiveRevision_ACU(stage);
        if (task.status !== 'awaiting_outline_review' || stage.status !== 'awaiting_review' || revision.frozen) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务没有可确认的大纲预览');
        }
        const previous = revision.reason === 'manual_replan'
          ? stage.revisions.find(item => item.revision === revision.revision - 1)
          : null;
        const constraints = previous
          ? { previousOutline: previous.outline, completedTurns: stage.completedTurns, expectedRemainingTurns: previous.outline.totalTurns - stage.completedTurns }
          : undefined;
        const accepted = acceptPlannedStageRevision_ACU({ ...revision, outline: cloneOutline_ACU(input.outline ?? revision.outline) }, envelope.settings, constraints);
        const now = this.dependencies.now();
        const nextStage = { ...stage, status: 'running' as const, revisions: stage.revisions.map(item => item.revision === accepted.revision ? accepted : item) };
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stages: task.stages.map(item => item.stageId === stage.stageId ? nextStage : item) } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  async replaceSettings(input: ReplaceContinuationSettingsInput_ACU): Promise<ContinuationEnvelope_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        if (envelope.activeTask?.status === 'running' || envelope.activeTask?.status === 'stopping_after_inflight') {
          fail_ACU('CONTINUATION_OPERATION_BUSY', '宿主生成进行中，不能修改智能续写设置');
        }
        result = { ...envelope, settings: input.settings };
        return result;
      }, { chatIdentity });
      return result!;
    });
  }

  async continueTask(): Promise<ContinuationOrchestratorResult_ACU & { preparedTurn?: ContinuationPreparedTurnInstruction_ACU }> {
    return this.withLease_ACU(async (chatIdentity, lease) => {
      let started: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (task.pendingHostTurn?.status === 'awaiting_generation') {
          fail_ACU('CONTINUATION_OPERATION_BUSY', '当前轮次正在等待宿主生成结果');
        }
        if (task.pendingHostTurn?.status === 'exhausted') fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前轮次正文重试已耗尽');
        if (task.status === 'awaiting_outline_review' || task.status === 'stopping_after_inflight' || task.status === 'abandoned' || task.status === 'completed' || task.status === 'failed') {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不可继续');
        }
        if (task.stopReason !== null) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已停止的任务不可继续');
        }
        const stage = getActiveStage_ACU(task);
        if (stage.status === 'completed') return envelope;
        if (stage.status !== 'running' || !getActiveRevision_ACU(stage).frozen) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段不可继续');
        const now = this.dependencies.now();
        if (task.deadlineAt !== null && now >= task.deadlineAt) {
          started = this.stopEnvelope_ACU(envelope, 'duration_reached', now);
          return started;
        }
        const deadlineAt = task.deadlineAt ?? (envelope.settings.totalDurationMinutes > 0 ? now + envelope.settings.totalDurationMinutes * 60_000 : null);
        started = { ...envelope, activeTask: { ...task, status: 'running', runStartedAt: task.runStartedAt ?? now, deadlineAt, stopReason: null, lastError: null, updatedAt: now } };
        return started;
      }, { chatIdentity });
      const task = started!.activeTask!;
      if (task.status !== 'running') return taskResult_ACU(started!);
      const stage = getActiveStage_ACU(task);
      try {
        const retryAttempt = task.pendingHostTurn?.status === 'retry_ready' ? task.pendingHostTurn.identity : undefined;
        const preparedTurn = await this.dependencies.executionEngine.prepareCurrentTurnInstruction(() => this.isLeaseCurrent_ACU(chatIdentity, lease), retryAttempt);
        return { ...taskResult_ACU(this.dependencies.store.readPersisted() ?? started!), preparedTurn };
      } catch (error) {
        await this.pauseAfterTurnPreparationFailure_ACU(chatIdentity, task.taskId, stage.stageId, stage.activeRevision, error);
        throw error;
      }
    });
  }

  async retryCurrentTurn(): Promise<ContinuationOrchestratorResult_ACU & { preparedTurn?: ContinuationPreparedTurnInstruction_ACU }> {
    return this.continueTask();
  }

  /** Persists the host attribution boundary before the adapter writes the host textarea. */
  async recordHostTurn(input: RecordHostTurnInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (input.identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送所属聊天已变化', false));
    }
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const existing = task.pendingHostTurn;
        if (task.status !== 'running' || !identityMatchesCurrentTurn_ACU(task, input.identity)
          || (existing !== undefined && existing !== null && existing.status !== 'retry_ready')) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '待发送正文已不属于当前轮次', false));
        }
        const retryCount = existing?.status === 'retry_ready' ? existing.retryCount : 0;
        const now = this.dependencies.now();
        result = {
          ...envelope,
          activeTask: {
            ...task,
            updatedAt: now,
            pendingHostTurn: { identity: input.identity, capture: input.capture, retryCount, status: 'awaiting_generation' },
            timeline: [...task.timeline, this.timeline_ACU('turn_sent', now, { stageId: input.identity.stageId, revision: input.identity.revision, nodeId: input.identity.nodeId, turnId: input.identity.turnId, attemptId: input.identity.attemptId })],
          },
        };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  async pauseForHostInputFailure(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    return this.pauseHostTurn_ACU(identity, 'CONTINUATION_HOST_INPUT_UNAVAILABLE', '酒馆输入框或发送按钮不可用', 'host_input_unavailable');
  }

  /** Binds a generation sequence only after the host bridge observed a synchronous send-start event. */
  async bindHostTurnGeneration(identity: TurnAttemptIdentity_ACU, generationSeq: number): Promise<void> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主生成所属聊天已变化', false));
    await this.withLease_ACU(async () => {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const pending = task.pendingHostTurn;
        if (!pending || pending.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity) || pending.capture.generationSeq !== null) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主生成开始事件不属于当前轮次', false));
        }
        return { ...envelope, activeTask: { ...task, pendingHostTurn: { ...pending, capture: { ...pending.capture, generationSeq } } } };
      }, { chatIdentity });
    });
  }

  /** Read-only bridge input; it never derives reload state or writes the envelope. */
  readPendingHostTurn(): ContinuationPendingHostTurnSnapshot_ACU | null {
    const envelope = this.dependencies.store.readPersisted();
    const task = envelope?.activeTask;
    if (!envelope || !task || !task.pendingHostTurn || task.pendingHostTurn.status === 'exhausted') return null;
    if (task.pendingHostTurn.identity.chatIdentity !== this.dependencies.getChatIdentity()) return null;
    return { settings: envelope.settings, pending: task.pendingHostTurn };
  }

  async pauseForHostResultFailure(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    return this.pauseHostTurn_ACU(identity, 'CONTINUATION_TASK_STATE_INVALID', '宿主正文无法唯一归属当前轮次', 'state_invalid');
  }

  async rejectHostTurnForMissingTags(input: RejectHostTurnInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (input.identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果所属聊天已变化', false));
    }
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const pending = task.pendingHostTurn;
        if (task.status !== 'running' || !pending || pending.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, input.identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '标签校验结果已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const error = createContinuationError_ACU('CONTINUATION_GENERATION_TAGS_MISSING', 'generation_evaluate', '宿主正文缺少必需标签', true, { messageIndex: input.messageIndex });
        if (pending.retryCount >= envelope.settings.generationRetryLimit) {
          result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason: 'generation_retry_exhausted', lastError: { ...error, retryable: false }, pendingHostTurn: { ...pending, status: 'exhausted' }, timeline: [...task.timeline, this.timeline_ACU('failed', now, { stageId: input.identity.stageId, revision: input.identity.revision, nodeId: input.identity.nodeId, turnId: input.identity.turnId, attemptId: input.identity.attemptId, messageIndex: input.messageIndex, errorCode: error.code })] } };
          return result;
        }
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, lastError: error, pendingHostTurn: { ...pending, retryCount: pending.retryCount + 1, status: 'retry_ready' }, timeline: [...task.timeline, this.timeline_ACU('turn_retry', now, { stageId: input.identity.stageId, revision: input.identity.revision, nodeId: input.identity.nodeId, turnId: input.identity.turnId, attemptId: input.identity.attemptId, messageIndex: input.messageIndex, errorCode: error.code })] } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  /** T9 calls this only after uniquely attributing a successful host generation to identity. */
  async confirmCurrentTurn(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果所属聊天已变化', false));
    }
    return this.withLease_ACU(async (_currentChatIdentity, lease) => {
      const preEnvelope = this.requireEnvelope_ACU(this.dependencies.store.readPersisted());
      const preTask = this.requireTask_ACU(preEnvelope);
      if (preTask.status !== 'running' || preTask.pendingHostTurn?.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(preTask, identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果已不属于当前轮次', false));
      }
      const preStage = getActiveStage_ACU(preTask);
      const preRevision = getActiveRevision_ACU(preStage);
      const isFinalTurn = preStage.completedTurns + 1 === preRevision.outline.totalTurns;
      const chronicleSnapshot = isFinalTurn ? await this.dependencies.readChronicleSnapshot() : null;
      this.assertLeaseCurrent_ACU(chatIdentity, lease);
      let advanced: ContinuationEnvelope_ACU | null = null;
      let mustPlanNextStage = false;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (task.status !== 'running' || task.pendingHostTurn?.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const stage = getActiveStage_ACU(task);
        const isLastTurn = stage.completedTurns + 1 === getActiveRevision_ACU(stage).outline.totalTurns;
        const progressed = advanceConfirmedTurn_ACU(task, chronicleSnapshot, now, this.timeline_ACU.bind(this));
        const completedTurn: ContinuationTask_ACU = { ...progressed, pendingHostTurn: null };
        if (!isLastTurn) {
          advanced = { ...envelope, activeTask: completedTurn };
          return advanced;
        }
        if (task.deadlineAt !== null && now >= task.deadlineAt) {
          advanced = this.stopEnvelope_ACU({ ...envelope, activeTask: completedTurn }, 'duration_reached', now);
          return advanced;
        }
        if (task.runStageCount >= envelope.settings.maxAutomaticStages) {
          advanced = this.stopEnvelope_ACU({ ...envelope, activeTask: completedTurn }, 'stage_limit_reached', now);
          return advanced;
        }
        if (!envelope.settings.autoNextStage) {
          advanced = { ...envelope, activeTask: { ...completedTurn, status: 'paused', updatedAt: now } };
          return advanced;
        }
        mustPlanNextStage = true;
        advanced = { ...envelope, activeTask: { ...completedTurn, status: 'paused', updatedAt: now } };
        return advanced;
      }, { chatIdentity });
      if (!mustPlanNextStage) return taskResult_ACU(advanced!);
      return this.planNextStage_ACU(chatIdentity, lease, advanced!);
    });
  }

  async startNextStage(): Promise<ContinuationOrchestratorResult_ACU> {
    return this.withLease_ACU(async (chatIdentity, lease) => {
      const current = this.dependencies.store.readPersisted();
      const envelope = this.requireEnvelope_ACU(current);
      const task = this.requireTask_ACU(envelope);
      const stage = getActiveStage_ACU(task);
      if (task.status !== 'paused' || stage.status !== 'completed' || task.stopReason !== null) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不可创建下一阶段');
      }
      return this.planNextStage_ACU(chatIdentity, lease, envelope);
    });
  }

  async stopTask(): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    const task = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    const guard = guardForTask_ACU(chatIdentity, task);
    this.invalidateLease_ACU(chatIdentity);
    return this.withLease_ACU(async () => {
      let stopped: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        stopped = this.stopEnvelope_ACU(envelope, 'manual', this.dependencies.now());
        return stopped;
      }, guard);
      return taskResult_ACU(stopped!);
    });
  }

  async replanRemaining(input: ReplanContinuationInput_ACU = {}): Promise<ContinuationOrchestratorResult_ACU> {
    const replanInstruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    const chatIdentity = this.requireChatIdentity_ACU();
    const sourceTask = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    const sourceGuard = guardForTask_ACU(chatIdentity, sourceTask);
    this.invalidateLease_ACU(chatIdentity);
    return this.withLease_ACU(async (_identity, lease) => {
      let planningEnvelope: ContinuationEnvelope_ACU | null = null;
      let planningContext: ContinuationPlanningContext_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        const previous = getActiveRevision_ACU(stage);
        if (!['running', 'paused', 'failed'].includes(task.status) || !['running', 'failed'].includes(stage.status)) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段不可重新规划');
        }
        if (task.stopReason !== null) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已停止的任务不可重新规划');
        }
        const nextRevision = previous.revision + 1;
        const pending = createPlannedStageRevision_ACU(cloneOutline_ACU(previous.outline), nextRevision, 'manual_replan', replanInstruction, this.dependencies.now());
        const nextStage = { ...stage, status: 'planning' as const, activeRevision: nextRevision, revisions: [...stage.revisions, pending] };
        const nextTask: ContinuationTask_ACU = { ...task, status: 'paused', updatedAt: this.dependencies.now(), stopReason: null, lastError: null, stages: task.stages.map(item => item.stageId === stage.stageId ? nextStage : item) };
        planningEnvelope = { ...envelope, activeTask: nextTask };
        planningContext = { envelope: planningEnvelope, task: nextTask, stage: nextStage, reason: 'manual_replan', replanInstruction };
        return planningEnvelope;
      }, sourceGuard);
      const context = planningContext!;
      const stage = context.stage!;
      const previous = stage.revisions.find(item => item.revision === stage.activeRevision - 1)!;
      const constraints: ContinuationReplanConstraints_ACU = { previousOutline: previous.outline, completedTurns: stage.completedTurns, expectedRemainingTurns: previous.outline.totalTurns - stage.completedTurns };
      try {
        const planned = await this.planOutline_ACU(context, chatIdentity, lease, stage.stageId, stage.activeRevision, constraints);
        this.assertLeaseCurrent_ACU(chatIdentity, lease);
        let completed: ContinuationEnvelope_ACU | null = null;
        await this.dependencies.store.updatePersistedAtomically(current => {
          const envelope = this.requireEnvelope_ACU(current);
          const task = this.requireTask_ACU(envelope);
          const activeStage = getActiveStage_ACU(task);
          if (task.taskId !== context.task.taskId || activeStage.stageId !== stage.stageId || activeStage.activeRevision !== stage.activeRevision || activeStage.status !== 'planning') {
            fail_ACU('CONTINUATION_TASK_STATE_INVALID', '重新规划结果已失效');
          }
          const pending = getActiveRevision_ACU(activeStage);
          const accepted = planned.requiresReview ? { ...pending, outline: cloneOutline_ACU(planned.outline) } : acceptPlannedStageRevision_ACU({ ...pending, outline: cloneOutline_ACU(planned.outline) }, envelope.settings, constraints);
          const nextStage = { ...activeStage, status: (planned.requiresReview ? 'awaiting_review' : 'running') as ContinuationStage_ACU['status'], revisions: activeStage.revisions.map(item => item.revision === accepted.revision ? accepted : item) };
          completed = { ...envelope, activeTask: { ...task, status: planned.requiresReview ? 'awaiting_outline_review' : 'paused', updatedAt: this.dependencies.now(), stages: task.stages.map(item => item.stageId === nextStage.stageId ? nextStage : item), timeline: [...task.timeline, this.timeline_ACU('outline_ready', this.dependencies.now(), { stageId: nextStage.stageId, revision: accepted.revision })] } };
          return completed;
        }, guardForTask_ACU(chatIdentity, context.task));
        return taskResult_ACU(completed!, this.planningSummary_ACU(planned));
      } catch (error) {
        await this.pauseAfterPlanningFailure_ACU(chatIdentity, context.task.taskId, stage.stageId, stage.activeRevision, error);
        throw error;
      }
    });
  }

  async abandonAndCreate(input: CreateContinuationTaskInput_ACU & { confirmAbandon?: boolean }): Promise<ContinuationOrchestratorResult_ACU> {
    if (input.confirmAbandon !== true) {
      fail_ACU('CONTINUATION_TASK_STATE_INVALID', '放弃当前任务并新建必须经过明确确认');
    }
    const chatIdentity = this.requireChatIdentity_ACU();
    const sourceTask = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    const sourceGuard = guardForTask_ACU(chatIdentity, sourceTask);
    this.invalidateLease_ACU(chatIdentity);
    await this.withLease_ACU(async () => {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        return { ...envelope, activeTask: { ...task, status: 'abandoned', updatedAt: this.dependencies.now(), stopReason: 'manual', timeline: [...task.timeline, this.timeline_ACU('stopped', this.dependencies.now())] } };
      }, sourceGuard);
    });
    return this.createTask(input);
  }

  private async planNextStage_ACU(chatIdentity: string, lease: Lease_ACU, sourceEnvelope: ContinuationEnvelope_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const sourceTask = this.requireTask_ACU(sourceEnvelope);
    const sourceStage = getActiveStage_ACU(sourceTask);
    if (sourceTask.deadlineAt !== null && this.dependencies.now() >= sourceTask.deadlineAt) {
      const stopped = this.stopEnvelope_ACU(sourceEnvelope, 'duration_reached', this.dependencies.now());
      await this.dependencies.store.replaceAtomically(stopped, guardForTask_ACU(chatIdentity, sourceTask));
      return taskResult_ACU(stopped);
    }
    if (sourceTask.runStageCount >= sourceEnvelope.settings.maxAutomaticStages) {
      const stopped = this.stopEnvelope_ACU(sourceEnvelope, 'stage_limit_reached', this.dependencies.now());
      await this.dependencies.store.replaceAtomically(stopped, guardForTask_ACU(chatIdentity, sourceTask));
      return taskResult_ACU(stopped);
    }
    const snapshot = await this.dependencies.readChronicleSnapshot();
    this.assertLeaseCurrent_ACU(chatIdentity, lease);
    const nextStageId = this.dependencies.allocateId('stage');
    let planningContext: ContinuationPlanningContext_ACU | null = null;
    await this.dependencies.store.updatePersistedAtomically(current => {
      const envelope = this.requireEnvelope_ACU(current);
      const task = this.requireTask_ACU(envelope);
      const completedStage = getActiveStage_ACU(task);
      if (task.taskId !== sourceTask.taskId || completedStage.stageId !== sourceStage.stageId || completedStage.status !== 'completed' || task.status !== 'paused' || task.stopReason !== null) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '下一阶段规划前提已失效', false));
      }
      const previousRevision = getActiveRevision_ACU(completedStage);
      const pendingRevision = createPlannedStageRevision_ACU(cloneOutline_ACU(previousRevision.outline), 1, 'auto_next_stage', '', this.dependencies.now());
      const nextStage = stageForOutline_ACU(nextStageId, task.runStageCount + 1, pendingRevision, snapshot, 'planning');
      const nextTask: ContinuationTask_ACU = { ...task, status: 'drafting', updatedAt: this.dependencies.now(), activeStageId: nextStageId, runStageCount: task.runStageCount + 1, stages: [...task.stages, nextStage], stopReason: null, lastError: null };
      const candidate = { ...envelope, activeTask: nextTask };
      planningContext = { envelope: candidate, task: nextTask, stage: nextStage, reason: 'auto_next_stage', replanInstruction: '' };
      return candidate;
    }, guardForTask_ACU(chatIdentity, sourceTask));
    const context = planningContext!;
    try {
      const planned = await this.planOutline_ACU(context, chatIdentity, lease, nextStageId, 1);
      this.assertLeaseCurrent_ACU(chatIdentity, lease);
      let completed: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        if (task.taskId !== context.task.taskId || task.status !== 'drafting' || stage.stageId !== nextStageId || stage.status !== 'planning' || stage.activeRevision !== 1) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '下一阶段规划结果已失效', false));
        }
        const pending = getActiveRevision_ACU(stage);
        const accepted = planned.requiresReview
          ? { ...pending, outline: cloneOutline_ACU(planned.outline) }
          : acceptPlannedStageRevision_ACU({ ...pending, outline: cloneOutline_ACU(planned.outline) }, envelope.settings);
        const nextStage = { ...stage, status: (planned.requiresReview ? 'awaiting_review' : 'running') as ContinuationStage_ACU['status'], revisions: stage.revisions.map(item => item.revision === 1 ? accepted : item) };
        completed = { ...envelope, activeTask: { ...task, status: planned.requiresReview ? 'awaiting_outline_review' : 'paused', updatedAt: this.dependencies.now(), stages: task.stages.map(item => item.stageId === nextStageId ? nextStage : item), timeline: [...task.timeline, this.timeline_ACU('outline_ready', this.dependencies.now(), { stageId: nextStageId, revision: 1 })] } };
        return completed;
      }, guardForTask_ACU(chatIdentity, context.task));
      return taskResult_ACU(completed!, this.planningSummary_ACU(planned));
    } catch (error) {
      await this.pauseAfterPlanningFailure_ACU(chatIdentity, context.task.taskId, nextStageId, 1, error);
      throw error;
    }
  }


  private async planOutline_ACU(context: ContinuationPlanningContext_ACU, chatIdentity: string, lease: Lease_ACU, stageId: string, revision: number, replanConstraints?: ContinuationReplanConstraints_ACU): Promise<ContinuationOutlinePlanningResult_ACU> {
    return this.dependencies.planner.plan({
      settings: context.envelope.settings,
      reason: context.reason,
      replanInstruction: context.replanInstruction,
      replanConstraints,
      resolvers: this.dependencies.createOutlineResolvers(context),
      createInternalRequestIdentity: attempt => ({ source: 'outline', requestId: this.dependencies.allocateId('outline-request'), chatIdentity, taskId: context.task.taskId, stageId, revision, attemptId: `outline-${attempt}` }),
      isInternalRequestCurrent: identity => this.isLeaseCurrent_ACU(chatIdentity, lease) && identity.chatIdentity === chatIdentity && identity.taskId === context.task.taskId && identity.stageId === stageId && identity.revision === revision,
    });
  }

  private async pauseAfterPlanningFailure_ACU(chatIdentity: string, taskId: string, stageId: string, revision: number, error: unknown): Promise<void> {
    const lastError = error instanceof ContinuationValidationError_ACU ? error.error : createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'outline_call', '阶段规划失败', false);
    try {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        if (task.taskId !== taskId || task.stopReason !== null || stage.stageId !== stageId || stage.activeRevision !== revision || stage.status !== 'planning') return envelope;
        return { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: this.dependencies.now(), lastError, stages: task.stages.map(item => item.stageId === stageId ? { ...item, status: 'failed' } : item), timeline: [...task.timeline, this.timeline_ACU('failed', this.dependencies.now(), { stageId, revision, errorCode: lastError.code })] } };
      }, { chatIdentity });
    } catch { /* Preserve the primary planning error; persistence failures remain visible on the next guarded operation. */ }
  }

  private async pauseAfterTurnPreparationFailure_ACU(chatIdentity: string, taskId: string, stageId: string, revision: number, error: unknown): Promise<void> {
    const lastError = error instanceof ContinuationValidationError_ACU ? error.error : createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'turn_call', '每轮指令生成失败', false);
    try {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        if (task.taskId !== taskId || task.status !== 'running' || stage.stageId !== stageId || stage.activeRevision !== revision || stage.status !== 'running') return envelope;
        return { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: this.dependencies.now(), lastError, timeline: [...task.timeline, this.timeline_ACU('failed', this.dependencies.now(), { stageId, revision, errorCode: lastError.code })] } };
      }, { chatIdentity });
    } catch { /* Preserve the primary generator error; a later guarded operation exposes persistence failure. */ }
  }

  private planningSummary_ACU(result: ContinuationOutlinePlanningResult_ACU): ContinuationOrchestratorResult_ACU['planning'] {
    return { attempts: result.attempts, apiPreset: result.apiPreset, requiresReview: result.requiresReview };
  }

  private baseEnvelope_ACU(): ContinuationEnvelope_ACU {
    return this.dependencies.store.readPersisted() ?? { schemaVersion: 1, settings: buildDefaultContinuationSettings_ACU(), activeTask: null };
  }

  private requireEnvelope_ACU(value: ContinuationEnvelope_ACU | null): ContinuationEnvelope_ACU {
    if (!value) return { schemaVersion: 1, settings: buildDefaultContinuationSettings_ACU(), activeTask: null };
    return value;
  }

  private requireTask_ACU(envelope: ContinuationEnvelope_ACU): ContinuationTask_ACU {
    if (!envelope.activeTask) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
    return envelope.activeTask;
  }

  private stopEnvelope_ACU(envelope: ContinuationEnvelope_ACU, reason: 'manual' | 'duration_reached' | 'stage_limit_reached', now: number): ContinuationEnvelope_ACU {
    const task = this.requireTask_ACU(envelope);
    return { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason: reason, timeline: [...task.timeline, this.timeline_ACU('stopped', now)] } };
  }

  private async pauseHostTurn_ACU(identity: TurnAttemptIdentity_ACU, code: 'CONTINUATION_HOST_INPUT_UNAVAILABLE' | 'CONTINUATION_TASK_STATE_INVALID', message: string, stopReason: 'host_input_unavailable' | 'state_invalid'): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送所属聊天已变化', false));
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (!task.pendingHostTurn || task.pendingHostTurn.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送失败已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const error = createContinuationError_ACU(code, 'host_send', message, false);
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason, lastError: error, pendingHostTurn: { ...task.pendingHostTurn, status: 'exhausted' }, timeline: [...task.timeline, this.timeline_ACU('failed', now, { stageId: identity.stageId, revision: identity.revision, nodeId: identity.nodeId, turnId: identity.turnId, attemptId: identity.attemptId, errorCode: error.code })] } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  private timeline_ACU(kind: ContinuationTask_ACU['timeline'][number]['kind'], at: number, fields: Omit<ContinuationTask_ACU['timeline'][number], 'id' | 'at' | 'kind'> = {}): ContinuationTask_ACU['timeline'][number] {
    return { id: this.dependencies.allocateId('timeline'), at, kind, ...fields };
  }

  private requireChatIdentity_ACU(): string {
    const identity = this.dependencies.getChatIdentity();
    if (!identity) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前聊天身份不可用');
    return identity;
  }

  private async withLease_ACU<T>(work: (chatIdentity: string, lease: Lease_ACU) => Promise<T>): Promise<T> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (leasesByChat_ACU.has(chatIdentity)) fail_ACU('CONTINUATION_OPERATION_BUSY', '当前聊天已有智能续写操作正在执行');
    const lease: Lease_ACU = { id: this.dependencies.allocateId('lease'), epoch: epochsByChat_ACU.get(chatIdentity) ?? 0 };
    leasesByChat_ACU.set(chatIdentity, lease);
    try { return await work(chatIdentity, lease); }
    finally { if (leasesByChat_ACU.get(chatIdentity) === lease) leasesByChat_ACU.delete(chatIdentity); }
  }

  private invalidateLease_ACU(chatIdentity: string): void {
    epochsByChat_ACU.set(chatIdentity, (epochsByChat_ACU.get(chatIdentity) ?? 0) + 1);
    leasesByChat_ACU.delete(chatIdentity);
  }

  private isLeaseCurrent_ACU(chatIdentity: string, lease: Lease_ACU): boolean {
    return this.dependencies.getChatIdentity() === chatIdentity && (epochsByChat_ACU.get(chatIdentity) ?? 0) === lease.epoch && leasesByChat_ACU.get(chatIdentity) === lease;
  }

  private assertLeaseCurrent_ACU(chatIdentity: string, lease: Lease_ACU): void {
    if (!this.isLeaseCurrent_ACU(chatIdentity, lease)) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '智能续写操作已失效', false));
    }
  }
}

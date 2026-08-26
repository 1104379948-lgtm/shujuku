import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationEnvelope_ACU, type ContinuationInternalAiRequestIdentity_ACU, type ContinuationStage_ACU, type ContinuationTask_ACU, type StageNode_ACU, type StageRevision_ACU, type StageTurn_ACU, type TurnAttemptIdentity_ACU } from './model';
import type { ContinuationAgentTurnPlanResult_ACU } from './agent/agent-model';
import type { ContinuationAgentTurnPlanner_ACU } from './agent/agent-main-loop';

export interface ContinuationExecutionSnapshot_ACU {
  envelope: ContinuationEnvelope_ACU;
  task: ContinuationTask_ACU;
  stage: ContinuationStage_ACU;
  revision: StageRevision_ACU;
  node: StageNode_ACU;
  turn: StageTurn_ACU;
  turnNumber: number;
  nodeTurnNumber: number;
}

export interface ContinuationPreparedTurnInstruction_ACU {
  identity: TurnAttemptIdentity_ACU;
  instruction: ContinuationAgentTurnPlanResult_ACU;
}

export interface StageExecutionEngineDependencies_ACU {
  readEnvelope: () => ContinuationEnvelope_ACU | null;
  getChatIdentity: () => string;
  allocateId: (prefix: string) => string;
  planner: ContinuationAgentTurnPlanner_ACU;
}

function fail_ACU(code: 'CONTINUATION_TASK_NOT_FOUND' | 'CONTINUATION_TASK_STATE_INVALID' | 'CONTINUATION_INTERNAL_REQUEST_STALE', message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'turn_call', message, false));
}

function currentSnapshot_ACU(envelope: ContinuationEnvelope_ACU | null): ContinuationExecutionSnapshot_ACU {
  const task = envelope?.activeTask;
  if (!task) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
  if (task.status !== 'running' || !task.activeStageId) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不允许生成每轮指令');
  const stage = task.stages.find(item => item.stageId === task.activeStageId);
  if (!stage || stage.status !== 'running') fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段不允许生成每轮指令');
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  if (!revision || !revision.frozen) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段大纲尚未冻结');
  const node = revision.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (!node || !turn) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段游标无效');
  const previousTurns = revision.outline.nodes.slice(0, stage.activeNodeIndex).reduce((total, item) => total + item.turns.length, 0) + stage.activeTurnIndex;
  if (stage.completedTurns !== previousTurns) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段游标与已完成轮数不一致');
  return { envelope, task, stage, revision, node, turn, turnNumber: previousTurns + 1, nodeTurnNumber: stage.activeTurnIndex + 1 };
}

export class StageExecutionEngine_ACU {
  constructor(private readonly dependencies: StageExecutionEngineDependencies_ACU) {}

  async prepareCurrentTurnInstruction(
    isLeaseCurrent: () => boolean = () => true,
    existingAttempt?: TurnAttemptIdentity_ACU,
    reviseOutline?: (replanInstruction: string) => Promise<void>,
  ): Promise<ContinuationPreparedTurnInstruction_ACU> {
    const snapshot = currentSnapshot_ACU(this.dependencies.readEnvelope());
    const identity: TurnAttemptIdentity_ACU = existingAttempt ?? {
      chatIdentity: this.dependencies.getChatIdentity(), taskId: snapshot.task.taskId, stageId: snapshot.stage.stageId,
      revision: snapshot.revision.revision, nodeId: snapshot.node.id, turnId: snapshot.turn.id, attemptId: this.dependencies.allocateId('attempt'),
    };
    if (identity.chatIdentity !== this.dependencies.getChatIdentity() || identity.taskId !== snapshot.task.taskId
      || identity.stageId !== snapshot.stage.stageId || identity.revision !== snapshot.revision.revision
      || identity.nodeId !== snapshot.node.id || identity.turnId !== snapshot.turn.id) {
      fail_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', '正文重试身份已不属于当前阶段游标');
    }
    const isCurrent = (candidate: ContinuationInternalAiRequestIdentity_ACU) => {
      if (!isLeaseCurrent()
        || candidate.chatIdentity !== identity.chatIdentity || candidate.taskId !== identity.taskId
        || candidate.stageId !== identity.stageId || candidate.revision !== identity.revision
        || candidate.nodeId !== identity.nodeId || candidate.turnId !== identity.turnId
        || candidate.attemptId !== identity.attemptId) return false;
      try {
        const current = currentSnapshot_ACU(this.dependencies.readEnvelope());
        return current.task.taskId === identity.taskId && current.stage.stageId === identity.stageId
          && current.revision.revision === identity.revision && current.node.id === identity.nodeId
          && current.turn.id === identity.turnId;
      } catch {
        return false;
      }
    };
    const instruction = await this.dependencies.planner.plan({
      settings: snapshot.envelope.settings,
      snapshot,
      createInternalRequestIdentity: () => ({ ...identity, requestId: this.dependencies.allocateId('turn-request'), source: 'turn_instruction' }),
      isInternalRequestCurrent: isCurrent,
      reviseOutline,
    });
    return { identity, instruction };
  }
}

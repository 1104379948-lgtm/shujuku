import { resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../runtime/message-handler';
import { validateLoopTags_ACU } from '../loop/loop-evaluator';
import type { ContinuationPreparedTurnInstruction_ACU } from './stage-execution-engine';
import type { ContinuationHostGenerationCapture_ACU, TurnAttemptIdentity_ACU } from './model';
import type { ContinuationHostTurnAdapter_ACU } from './host-turn-adapter';

export interface ContinuationHostTurnRuntime_ACU {
  getChatIdentity(): string;
  getChat(): any[];
  getGenerationSequence(): number;
  readPendingHostTurn(): { settings: { loopTags: string; retryDelaySeconds?: number }; pending: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU; status: 'awaiting_generation' | 'retry_ready' | 'exhausted' } } | null;
  readAutoContinueState(): { eligible: boolean; delaySeconds: number };
  continueTask(): Promise<{ preparedTurn?: ContinuationPreparedTurnInstruction_ACU }>;
  retryCurrentTurn(): Promise<{ preparedTurn?: ContinuationPreparedTurnInstruction_ACU }>;
  recordHostTurn(input: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU }): Promise<unknown>;
  bindHostTurnGeneration(identity: TurnAttemptIdentity_ACU, generationSeq: number): Promise<void>;
  confirmCurrentTurn(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  rejectHostTurnForMissingTags(input: { identity: TurnAttemptIdentity_ACU; messageIndex: number }): Promise<unknown>;
  pauseForHostInputFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  pauseForHostResultFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
}

export interface ContinuationHostGenerationBridgeDependencies_ACU {
  runtime: ContinuationHostTurnRuntime_ACU;
  hostInput: ContinuationHostTurnAdapter_ACU;
  now(): number;
  wait(ms: number): Promise<void>;
  materializationRetries: number;
  materializationRetryDelayMs: number;
}

type StartedHostGeneration_ACU = { identity: TurnAttemptIdentity_ACU; sequence: number; bind: Promise<void> };

/**
 * The only bridge that may couple a prepared continuation turn to host input
 * and GENERATION_* events. It deliberately fails closed when lifecycle events
 * cannot be synchronously paired with the click it initiated.
 */
export class ContinuationHostGenerationBridge_ACU {
  private sendingIdentity: TurnAttemptIdentity_ACU | null = null;
  private readonly startedByChat = new Map<string, StartedHostGeneration_ACU>();

  constructor(private readonly dependencies: ContinuationHostGenerationBridgeDependencies_ACU) {}

  async send(prepared: ContinuationPreparedTurnInstruction_ACU): Promise<boolean> {
    const runtime = this.dependencies.runtime;
    if (prepared.identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const chat = runtime.getChat();
    const capture: ContinuationHostGenerationCapture_ACU = {
      capturedAt: this.dependencies.now(),
      capturedChatLength: Array.isArray(chat) ? chat.length : 0,
      capturedAiFloorCount: Array.isArray(chat) ? chat.filter(message => message && !message.is_user && message?.extra?.type !== 'narrator').length : 0,
      generationSeq: null,
    };
    await runtime.recordHostTurn({ identity: prepared.identity, capture });
    this.sendingIdentity = prepared.identity;
    try {
      if (!this.dependencies.hostInput.send(prepared.instruction.instruction)) {
        await runtime.pauseForHostInputFailure(prepared.identity);
        return false;
      }
      return true;
    } finally {
      this.sendingIdentity = null;
    }
  }

  onGenerationStarted(sequence: number): boolean {
    const identity = this.sendingIdentity;
    const runtime = this.dependencies.runtime;
    if (!identity || identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const pending = runtime.readPendingHostTurn();
    if (!pending || pending.pending.identity.attemptId !== identity.attemptId || pending.pending.capture.generationSeq !== null) return false;
    this.startedByChat.set(identity.chatIdentity, { identity, sequence, bind: runtime.bindHostTurnGeneration(identity, sequence) });
    return true;
  }

  claimsGenerationEnded(sequence: number | undefined): boolean {
    if (sequence === undefined) return false;
    const current = this.startedByChat.get(this.dependencies.runtime.getChatIdentity());
    return !!current && current.sequence === sequence;
  }

  async onGenerationEnded(eventMessageId: unknown, sequence: number | undefined): Promise<void> {
    if (!this.claimsGenerationEnded(sequence)) return;
    const chatIdentity = this.dependencies.runtime.getChatIdentity();
    const started = this.startedByChat.get(chatIdentity)!;
    this.startedByChat.delete(chatIdentity);
    try {
      await started.bind;
      const snapshot = this.dependencies.runtime.readPendingHostTurn();
      if (!snapshot || snapshot.pending.identity.attemptId !== started.identity.attemptId || snapshot.pending.capture.generationSeq !== sequence) return;
      const messageIndex = await this.resolveMessageIndex_ACU(eventMessageId, snapshot.pending.capture, chatIdentity);
      if (messageIndex === null) {
        await this.dependencies.runtime.pauseForHostResultFailure(started.identity);
        return;
      }
      const message = this.dependencies.runtime.getChat()[messageIndex];
      if (!message || !validateLoopTags_ACU(String(message.mes ?? ''), snapshot.settings.loopTags)) {
        // The legacy evaluator's retry_delete decision applies only to the exact
        // reply just attributed to this attempt. The host exposes only a
        // delete-last primitive, so never risk deleting a newer user/AI floor.
        const chatBeforeRemoval = this.dependencies.runtime.getChat();
        if (messageIndex !== chatBeforeRemoval.length - 1 || !await this.dependencies.hostInput.removeLastMessage()) {
          await this.dependencies.runtime.pauseForHostResultFailure(started.identity);
          return;
        }
        const chatAfterRemoval = this.dependencies.runtime.getChat();
        if (chatAfterRemoval.length !== messageIndex) {
          await this.dependencies.runtime.pauseForHostResultFailure(started.identity);
          return;
        }
        await this.dependencies.runtime.rejectHostTurnForMissingTags({ identity: started.identity, messageIndex });
        const afterReject = this.dependencies.runtime.readPendingHostTurn();
        if (afterReject?.pending.status === 'retry_ready' && afterReject.pending.identity.attemptId === started.identity.attemptId) {
          await this.retryCurrentHostTurn_ACU(snapshot.settings.retryDelaySeconds ?? 0);
        }
        return;
      }
      await this.dependencies.runtime.confirmCurrentTurn(started.identity);
    } catch {
      // A bridge failure must not leave an attributable turn indefinitely running.
      // The guarded fallback preserves a stale/persistence error when it can no
      // longer safely write the original task identity.
      try {
        await this.dependencies.runtime.pauseForHostResultFailure(started.identity);
      } catch {
        // No safe write remains after a stale or persistence failure.
      }
      return;
    }
    await this.autoContinueAfterTurn_ACU();
  }

  /**
   * 一轮正文确认成功后的自动续写：等待轮次延迟后自动触发下一轮，
   * 与正文重试自动链同构。资格在延迟前后各读一次——用户可能在延迟期间停止任务。
   * continueTask 的失败已由 orchestrator 落为 paused+lastError，这里不再改写状态。
   */
  private async autoContinueAfterTurn_ACU(): Promise<void> {
    const runtime = this.dependencies.runtime;
    const state = runtime.readAutoContinueState();
    if (!state.eligible) return;
    await this.dependencies.wait(state.delaySeconds * 1_000);
    if (!runtime.readAutoContinueState().eligible) return;
    try {
      const result = await runtime.continueTask();
      if (result.preparedTurn) await this.send(result.preparedTurn);
    } catch {
      // 状态已由 orchestrator 记录（paused+lastError 或拒绝原因），自动链到此为止。
    }
  }

  private async resolveMessageIndex_ACU(eventMessageId: unknown, capture: ContinuationHostGenerationCapture_ACU, chatIdentity: string): Promise<number | null> {
    if (!Number.isInteger(eventMessageId)) return null;
    const intent: AutoFillIntent_ACU = { eventMessageId: eventMessageId as number, chatKey: chatIdentity, isolationKey: '', capturedAt: capture.capturedAt, capturedChatLength: capture.capturedChatLength, capturedAiFloorCount: capture.capturedAiFloorCount, generationSeq: capture.generationSeq ?? undefined };
    for (let attempt = 0; attempt <= this.dependencies.materializationRetries; attempt += 1) {
      if (this.dependencies.runtime.getChatIdentity() !== chatIdentity) return null;
      const result = resolveGeneratedAiMessageIndex_ACU({ liveChat: this.dependencies.runtime.getChat(), intent });
      if (result.kind === 'resolved') return result.messageIndex;
      if (result.kind !== 'pending_materialization' || attempt === this.dependencies.materializationRetries) return null;
      await this.dependencies.wait(this.dependencies.materializationRetryDelayMs);
    }
    return null;
  }

  private async retryCurrentHostTurn_ACU(retryDelaySeconds: number): Promise<void> {
    await this.dependencies.wait(Math.max(0, retryDelaySeconds) * 1_000);
    const result = await this.dependencies.runtime.retryCurrentTurn();
    if (result.preparedTurn) await this.send(result.preparedTurn);
  }
}

import { describe, expect, it, vi } from 'vitest';

import { StageExecutionEngine_ACU } from '../../../src/service/continuation/stage-execution-engine';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';

function envelope() {
  return {
    schemaVersion: 1 as const,
    settings: buildDefaultContinuationSettings_ACU(),
    activeTask: {
      taskId: 'task-a', originInstruction: '推进剧情', status: 'running' as const, createdAt: 1, updatedAt: 1,
      runStartedAt: 1, deadlineAt: null, runStageCount: 1, activeStageId: 'stage-a', stopReason: null, lastError: null, timeline: [],
      stages: [{
        stageId: 'stage-a', stageNumber: 1, status: 'running' as const, chronicleStartCount: 0, chronicleEndCount: null, chronicleAddedCount: null, chronicleRange: null,
        activeRevision: 1, activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: 0,
        revisions: [{ revision: 1, createdAt: 1, reason: 'initial' as const, replanInstruction: '', frozen: true, outline: { schemaVersion: 1 as const, title: '阶段', goal: '目标', totalTurns: 6, nodes: [{ id: 'node-a', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }] } }],
      }],
    },
  };
}

describe('StageExecutionEngine_ACU', () => {
  it('binds every internal retry to one durable turn attempt identity', async () => {
    const identities: any[] = [];
    const planner = { plan: vi.fn(async request => {
      const first = request.createInternalRequestIdentity(0);
      const retry = request.createInternalRequestIdentity(1);
      identities.push(first, retry);
      expect(request.isInternalRequestCurrent(first)).toBe(true);
      expect(request.isInternalRequestCurrent(retry)).toBe(true);
      expect(request.snapshot.turn.goal).toBe('轮次 1');
      return { instruction: '最终文本', attempts: 2, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope, getChatIdentity: () => 'chat-a', allocateId: prefix => prefix === 'attempt' ? 'attempt-a' : 'request-a',
      planner: planner as any,
    });

    const prepared = await engine.prepareCurrentTurnInstruction();
    expect(prepared.identity).toMatchObject({ chatIdentity: 'chat-a', taskId: 'task-a', attemptId: 'attempt-a' });
    expect(identities.map(identity => identity.attemptId)).toEqual(['attempt-a', 'attempt-a']);
    expect(prepared.instruction.instruction).toBe('最终文本');
  });

  it('marks an in-flight instruction stale when the lease is revoked', async () => {
    let current = true;
    const planner = { plan: vi.fn(async request => {
      const identity = request.createInternalRequestIdentity(0);
      current = false;
      expect(request.isInternalRequestCurrent(identity)).toBe(false);
      throw Object.assign(new Error('stale'), { error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });

    await expect(engine.prepareCurrentTurnInstruction(() => current)).rejects.toThrow('stale');
  });

  it('forwards the outline revision callback to the planner', async () => {
    const revised: string[] = [];
    const planner = { plan: vi.fn(async request => {
      await request.reviseOutline?.('把剩余节点改成慢推进');
      return { instruction: '最终文本', attempts: 1, apiPreset: { presetName: '', source: 'current', reason: 'current_configuration' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });

    await engine.prepareCurrentTurnInstruction(() => true, undefined, async instruction => { revised.push(instruction); });
    expect(revised).toEqual(['把剩余节点改成慢推进']);
  });
});

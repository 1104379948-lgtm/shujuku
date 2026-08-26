import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import { ContinuationTurnInstructionGenerator_ACU } from '../../../src/service/continuation/turn-instruction-generator';

function request_ACU(retries = 1, current = () => true) {
  return {
    settings: { ...buildDefaultContinuationSettings_ACU(), apiPresetMode: 'fixed' as const, fixedApiPresetName: 'preset-a', internalAiRetryLimit: retries, turnInstructionPrompt: [{ role: 'user', content: '$CURRENT_TURN_GOAL' }] },
    createInternalRequestIdentity: (attempt: number) => ({ source: 'turn_instruction' as const, requestId: `request-${attempt}`, chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-a', attemptId: `attempt-${attempt}` }),
    isInternalRequestCurrent: current,
    resolvers: { $CURRENT_TURN_GOAL: () => '收束冲突' },
  };
}

function generator_ACU(outputs: Array<string | null | Error>) {
  const callInternalAi = vi.fn(async () => {
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    return output ?? null;
  });
  const resolveApiPreset = vi.fn(() => ({ presetName: 'preset-a', source: 'fixed' as const, reason: 'fixed_preset' as const, apiMode: 'custom' as const, apiConfig: { url: 'https://example.invalid', apiKey: '', model: 'test', useMainApi: false, max_tokens: 1, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: '' }));
  return { generator: new ContinuationTurnInstructionGenerator_ACU({ callInternalAi, resolveApiPreset }), callInternalAi };
}

async function expectCode_ACU(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('ContinuationTurnInstructionGenerator_ACU', () => {
  it('returns only trimmed non-empty plain text and passes the identity to the internal adapter', async () => {
    const { generator, callInternalAi } = generator_ACU(['  只输出最终指令  ']);
    await expect(generator.generate(request_ACU())).resolves.toMatchObject({ instruction: '只输出最终指令', attempts: 1 });
    expect(callInternalAi).toHaveBeenCalledWith([{ role: 'user', content: '收束冲突' }], expect.any(Object), expect.objectContaining({ source: 'turn_instruction', attemptId: 'attempt-0' }), undefined);
  });

  it('retries only empty responses or request failures, then fails with a stable code', async () => {
    const { generator, callInternalAi } = generator_ACU([null, '可发送文本']);
    await expect(generator.generate(request_ACU(1))).resolves.toMatchObject({ instruction: '可发送文本', attempts: 2 });
    expect(callInternalAi).toHaveBeenCalledTimes(2);

    const exhausted = generator_ACU([null]);
    await expectCode_ACU(() => exhausted.generator.generate(request_ACU(0)), 'CONTINUATION_TURN_INSTRUCTION_RETRY_EXHAUSTED');
  });

  it('rejects stale requests before dispatch without producing a host instruction', async () => {
    const { generator, callInternalAi } = generator_ACU(['late result']);
    await expectCode_ACU(() => generator.generate(request_ACU(3, () => false)), 'CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(callInternalAi).not.toHaveBeenCalled();
  });

  it('rejects a result that becomes stale after dispatch without retrying or producing a host instruction', async () => {
    const { generator, callInternalAi } = generator_ACU(['late result']);
    let checks = 0;
    await expectCode_ACU(() => generator.generate(request_ACU(3, () => ++checks === 1)), 'CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(callInternalAi).toHaveBeenCalledTimes(1);
  });
});

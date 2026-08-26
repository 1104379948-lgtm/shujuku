import { normalizeContinuationInternalAiRetryLimit_ACU } from './defaults';
import { callContinuationInternalAi_ACU } from './internal-ai-call';
import { resolveContinuationApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from './api-preset';
import { renderContinuationPrompt_ACU, type ContinuationPromptPlaceholder_ACU } from './prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationSettings_ACU,
} from './model';

export interface ContinuationTurnInstructionRequest_ACU {
  settings: ContinuationSettings_ACU;
  createInternalRequestIdentity: (attempt: number) => ContinuationInternalAiRequestIdentity_ACU & { source: 'turn_instruction' };
  isInternalRequestCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  resolvers?: Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string | null | undefined> | null | undefined>>;
  signal?: AbortSignal | null;
}

export interface ContinuationTurnInstructionResult_ACU {
  instruction: string;
  attempts: number;
  apiPreset: Pick<ContinuationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'>;
}

export interface ContinuationTurnInstructionGeneratorDependencies_ACU {
  resolveApiPreset: typeof resolveContinuationApiPreset_ACU;
  callInternalAi: (messages: Array<{ role: string; content: string }>, preset: ContinuationResolvedApiPreset_ACU, identity: ContinuationInternalAiRequestIdentity_ACU, signal?: AbortSignal | null) => Promise<string | null>;
}

const defaultDependencies_ACU: ContinuationTurnInstructionGeneratorDependencies_ACU = {
  resolveApiPreset: resolveContinuationApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
};

function asTurnInstructionError_ACU(error: unknown): ContinuationError_ACU {
  if (error instanceof ContinuationValidationError_ACU) return error.error;
  return createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'turn_call', '每轮指令内部 AI 调用失败', true);
}

function isRetryableTurnInstructionError_ACU(error: ContinuationError_ACU): boolean {
  return error.code === 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' || error.code === 'CONTINUATION_TURN_INSTRUCTION_EMPTY';
}

function staleRequestError_ACU(message: string): ContinuationValidationError_ACU {
  return new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'turn_call', message, false));
}

/** Generates only the final plain-text host instruction; it performs no host-input side effect. */
export class ContinuationTurnInstructionGenerator_ACU {
  constructor(private readonly dependencies: ContinuationTurnInstructionGeneratorDependencies_ACU = defaultDependencies_ACU) {}

  async generate(request: ContinuationTurnInstructionRequest_ACU, apiDependencies?: ContinuationApiPresetDependencies_ACU): Promise<ContinuationTurnInstructionResult_ACU> {
    const preset = this.dependencies.resolveApiPreset(request.settings, 'turn_call', apiDependencies);
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(request.settings.internalAiRetryLimit);
    let lastError: ContinuationError_ACU | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const identity = request.createInternalRequestIdentity(attempt);
        if (!request.isInternalRequestCurrent(identity)) throw staleRequestError_ACU('每轮指令内部请求已失效');
        const rendered = await renderContinuationPrompt_ACU(request.settings.turnInstructionPrompt, request.resolvers ?? {}, 'turn_prompt');
        const instruction = (await this.dependencies.callInternalAi(rendered.messages, preset, identity, request.signal))?.trim() ?? '';
        if (!request.isInternalRequestCurrent(identity)) throw staleRequestError_ACU('每轮指令内部结果已失效');
        if (!instruction) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_TURN_INSTRUCTION_EMPTY', 'turn_call', '每轮指令内部 AI 返回为空', true));
        }
        return { instruction, attempts: attempt + 1, apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason } };
      } catch (error) {
        lastError = asTurnInstructionError_ACU(error);
        if (!isRetryableTurnInstructionError_ACU(lastError)) throw error;
      }
    }

    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_TURN_INSTRUCTION_RETRY_EXHAUSTED',
      'turn_call',
      '每轮指令生成重试次数已耗尽',
      false,
      { attempts: retries + 1, lastErrorCode: lastError?.code ?? 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' },
    ));
  }
}

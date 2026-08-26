import { callAIWithResolvedPreset_ACU } from '../ai/api-call';
import type { ContinuationResolvedApiPreset_ACU } from './api-preset';
import type { ContinuationInternalAiRequestIdentity_ACU } from './model';
import {
  beginContinuationInternalAiMainApiInvocation_ACU,
  beginContinuationInternalAiRequest_ACU,
  endContinuationInternalAiMainApiInvocation_ACU,
  settleContinuationInternalAiRequest_ACU,
} from './internal-ai-events';

/**
 * Executes one continuation-owned internal request with explicit provenance.
 * It never writes host input or continuation state; callers must gate returned
 * text again before scheduling a later side effect.
 */
export async function callContinuationInternalAi_ACU(
  messages: Array<{ role: string; content: string }>,
  preset: ContinuationResolvedApiPreset_ACU,
  identity: ContinuationInternalAiRequestIdentity_ACU,
  signal?: AbortSignal | null,
): Promise<string | null> {
  beginContinuationInternalAiRequest_ACU(identity);
  try {
    return await callAIWithResolvedPreset_ACU(messages, preset, signal, {
      beforeMainApiCall: () => beginContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
      afterMainApiCall: () => endContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
    });
  } finally {
    // A bound host lifecycle remains registered until its matching ended event.
    // An unbound request is removed, so later unrelated events are never claimed.
    settleContinuationInternalAiRequest_ACU(identity.requestId);
  }
}

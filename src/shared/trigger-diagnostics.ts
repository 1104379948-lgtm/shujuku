import { logWarn_ACU } from './utils';

export type AutoFillSkipReason_ACU =
  | 'quiet_or_background_generation'
  | 'user_aborted'
  | 'core_apis_not_ready'
  | 'empty_chat'
  | 'last_message_not_ai'
  | 'different_character'
  | 'message_evaluation_skipped'
  | 'chat_changed'
  | 'auto_update_coalesced'
  | 'preconditions_failed'
  | 'no_tables_due';

export interface AutoFillSkipContext_ACU {
  eventType?: string;
  messageId?: unknown;
  chatKey?: string;
  lastGenerationType?: unknown;
  aiFloorCount?: number;
  inFlight?: boolean;
}

export function logAutoFillSkip_ACU(
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU = {},
): void {
  const { eventType, messageId, chatKey, lastGenerationType, aiFloorCount, inFlight } = context;
  logWarn_ACU('[AutoFill] Trigger skipped', {
    reason,
    eventType,
    messageId,
    chatKey,
    lastGenerationType,
    aiFloorCount,
    inFlight,
  });
}

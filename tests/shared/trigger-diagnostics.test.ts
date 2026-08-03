import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogWarn } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import { logAutoFillSkip_ACU } from '../../src/shared/trigger-diagnostics';

describe('logAutoFillSkip_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a structured warning without message content', () => {
    logAutoFillSkip_ACU('quiet_or_background_generation', {
      eventType: 'GENERATION_ENDED',
      messageId: 42,
      chatKey: 'chat-1',
      lastGenerationType: 'quiet',
      messageText: 'must never be logged',
    });

    expect(mockLogWarn).toHaveBeenCalledOnce();
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[AutoFill] Trigger skipped',
      expect.objectContaining({
        reason: 'quiet_or_background_generation',
        eventType: 'GENERATION_ENDED',
        messageId: 42,
        chatKey: 'chat-1',
        lastGenerationType: 'quiet',
      }),
    );
    expect(JSON.stringify(mockLogWarn.mock.calls[0])).not.toContain('must never be logged');
  });
});

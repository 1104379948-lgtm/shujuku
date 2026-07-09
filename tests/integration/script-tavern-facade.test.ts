import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  character: { avatar: 'char-a', name: '角色A' },
  officialContext: { chatId: 'chat-a', characterId: 'char-a', name2: '角色A', chat: [{ mes: 'hello' }] } as any,
  topWindow: { SillyTavern: { getContext: vi.fn(() => mocks.officialContext) } } as any,
}));

vi.mock('../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterFallback_ACU: vi.fn(() => mocks.character),
}));

vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: mocks.topWindow }));

import { createScriptTavernFacade_ACU, getCurrentScriptScope_ACU } from '../../src/service/scripts/script-tavern-facade';

beforeEach(() => {
  mocks.officialContext = { chatId: 'chat-a', characterId: 'char-a', name2: '角色A', chat: [{ mes: 'hello' }] };
  mocks.topWindow.SillyTavern.getContext.mockClear();
});

describe('createScriptTavernFacade_ACU', () => {
  it('returns the official SillyTavern context object directly', () => {
    const context = createScriptTavernFacade_ACU();

    expect(context).toBe(mocks.officialContext);
    expect(context.chat).toEqual([{ mes: 'hello' }]);
    expect(mocks.topWindow.SillyTavern.getContext).toHaveBeenCalledTimes(1);
  });

  it('returns an empty object when SillyTavern context is unavailable', () => {
    mocks.topWindow.SillyTavern.getContext.mockImplementationOnce(() => null);

    expect(createScriptTavernFacade_ACU()).toEqual({});
  });
});

describe('getCurrentScriptScope_ACU', () => {
  it('uses the official context plus current character fallback for scope identity', () => {
    expect(getCurrentScriptScope_ACU()).toEqual({
      chatId: 'chat-a',
      characterId: 'char-a',
      characterName: '角色A',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runScriptHook: vi.fn(),
  currentData: {
    sheet_1: { name: '背包' },
    sheet_0: { name: '角色' },
    mate: { type: 'acu' },
  } as any,
  currentJsonTableData: null as any,
  scope: { chatId: 'chat-a', characterId: 'char-a', characterName: '角色A' },
}));

vi.mock('../../src/service/scripts/script-runner', () => ({
  runScriptHook_ACU: (...args: any[]) => mocks.runScriptHook(...args),
}));

vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({ mode: 'sqlite', getCurrentData: () => mocks.currentData })),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
}));

vi.mock('../../src/service/scripts/script-tavern-facade', () => ({
  getCurrentScriptScope_ACU: vi.fn(() => mocks.scope),
}));

import { runChatLoadedScriptHook_ACU, runDbLoadedScriptHook_ACU } from '../../src/service/scripts/script-lifecycle-events';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentJsonTableData = null;
});

describe('script lifecycle events', () => {
  it('db.loaded includes sheet keys and display names separately', async () => {
    await runDbLoadedScriptHook_ACU();

    expect(mocks.runScriptHook).toHaveBeenCalledWith('db.loaded', expect.objectContaining({
      eventPayload: expect.objectContaining({
        hook: 'db.loaded',
        sheetKeys: ['sheet_0', 'sheet_1'],
        tableDisplayNames: ['背包', '角色'],
        tableNames: ['背包', '角色'],
        storageMode: 'sqlite',
      }),
    }));
  });

  it('chat.loaded includes current chat and character scope', async () => {
    await runChatLoadedScriptHook_ACU();

    expect(mocks.runScriptHook).toHaveBeenCalledWith('chat.loaded', expect.objectContaining({
      eventPayload: expect.objectContaining({ chatId: 'chat-a', characterId: 'char-a', characterName: '角色A' }),
    }));
  });
});

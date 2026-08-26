import { afterEach, describe, expect, it, vi } from 'vitest';

type RuntimeHarness = {
  runtime: typeof import('../../../src/service/continuation/continuation-runtime');
  setHostApi: typeof import('../../../src/shared/host-api')._set_SillyTavern_APICU;
  settings: any;
  saveSettings: ReturnType<typeof vi.fn>;
  chat: any[];
  saveChat: ReturnType<typeof vi.fn>;
  getBridge: () => unknown;
};

async function createHarness(saveResult: { saved: boolean } = { saved: true }): Promise<RuntimeHarness> {
  vi.resetModules();
  const settings = {
    plotSettings: {
      contextTurnCount: 3,
      loopSettings: {
        quickReplyContent: ['旧提示词'],
        currentPromptIndex: 1,
        loopTags: '<content>',
        loopDelay: 5,
        retryDelay: 3,
        loopTotalDuration: 20,
        maxRetries: 3,
      },
    },
  } as any;
  const saveSettings = vi.fn(() => saveResult);
  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: saveSettings }));

  const [runtime, hostApi, registry] = await Promise.all([
    import('../../../src/service/continuation/continuation-runtime'),
    import('../../../src/shared/host-api'),
    import('../../../src/service/continuation/host-generation-bridge-registry'),
  ]);
  const chat: any[] = [{}];
  const saveChat = vi.fn(async () => undefined);
  hostApi._set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
  return { runtime, setHostApi: hostApi._set_SillyTavern_API_ACU, settings, saveSettings, chat, saveChat, getBridge: registry.getContinuationHostGenerationBridge_ACU };
}

afterEach(() => {
  vi.doUnmock('../../../src/service/runtime/state-manager');
  vi.doUnmock('../../../src/service/settings/settings-service');
  vi.resetModules();
});

describe('ContinuationRuntime_ACU migration', () => {
  it('先写入首楼权威状态，再成功清理废弃的 v2 循环字段', async () => {
    const h = await createHarness();
    const runtime = h.runtime.getContinuationRuntime_ACU();

    await runtime.initialize();

    expect(h.chat[0]._qrf_continuation).toMatchObject({ schemaVersion: 1, activeTask: null });
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('quickReplyContent');
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('currentPromptIndex');
    expect(h.saveChat).toHaveBeenCalledOnce();
    expect(h.saveSettings).toHaveBeenCalledOnce();
    expect(h.getBridge()).toBe(runtime.bridge);
    h.runtime.resetContinuationRuntimeForTests_ACU();
    expect(h.getBridge()).toBeNull();
  });

  it('设置保存失败时保留废弃字段，并可在后续初始化中恢复清理', async () => {
    const h = await createHarness({ saved: false });
    const runtime = h.runtime.getContinuationRuntime_ACU();

    await runtime.initialize();

    expect(h.chat[0]._qrf_continuation).toMatchObject({ schemaVersion: 1, activeTask: null });
    expect(h.settings.plotSettings.loopSettings.quickReplyContent).toEqual(['旧提示词']);
    expect(h.settings.plotSettings.loopSettings.currentPromptIndex).toBe(1);
    expect(h.saveChat).toHaveBeenCalledOnce();

    h.saveSettings.mockReturnValueOnce({ saved: true });
    await runtime.initialize();

    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('quickReplyContent');
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('currentPromptIndex');
    expect(h.saveChat).toHaveBeenCalledOnce();
    h.runtime.resetContinuationRuntimeForTests_ACU();
    expect(h.getBridge()).toBeNull();
  });
});

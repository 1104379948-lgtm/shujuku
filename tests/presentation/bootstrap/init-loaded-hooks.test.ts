import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sillyTavernApi: { chat: [{ mes: 'hello' }], chat_metadata: { file_name: 'chat-a' } } as any,
  runChatLoaded: vi.fn(),
  runDbLoaded: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  loadAllChatMessages: vi.fn(),
  applyTemplateScope: vi.fn(),
  refreshMergedData: vi.fn(),
  reloadStorageProvider: vi.fn(),
  isSqliteMode: vi.fn(() => false),
  attemptToLoadCoreApis: vi.fn(() => false),
  eventHandlers: new Map<string, any>(),
  orchestrateTavernHelperHook: vi.fn(),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({ DEFAULT_PLOT_SETTINGS_ACU: {} }));
vi.mock('../../../src/presentation/bootstrap/startup', () => ({ addAutoCardMenuItem_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  newMessageDebounceTimer_ACU: null,
  _set_newMessageDebounceTimer_ACU: vi.fn(),
  currentChatFileIdentifier_ACU: 'chat-a',
  generationGate_ACU: {},
  markUserSendIntent_ACU: vi.fn(),
  isProcessing_Plot_ACU: false,
  isQuietLikeGeneration_ACU: vi.fn(() => false),
  isRecentUserSendIntent_ACU: vi.fn(() => false),
  loopState_ACU: {},
  recordGenerationContext_ACU: vi.fn(),
  recordLastUserSend_ACU: vi.fn(),
  settings_ACU: {},
  shouldProcessAutoTableUpdateForGenerationEnded_ACU: vi.fn(() => false),
  shouldProcessPlotForGeneration_ACU: vi.fn(() => false),
  shouldProcessSummaryVectorIndexForGeneration_ACU: vi.fn(() => false),
  _set_allChatMessages_ACU: vi.fn(),
  _set_currentChatFileIdentifier_ACU: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_independentTableStates_ACU: vi.fn(),
  _set_isProcessing_Plot_ACU: vi.fn(),
  _set_lastTotalAiMessages_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync', () => ({ attemptToLoadCoreApis_ACU: mocks.attemptToLoadCoreApis, handleNewMessageDebounced_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  ensureInitialSeedCheckpoint_ACU: vi.fn(),
  handleChatCompletionReady_ACU: vi.fn(),
  loadPresetAndCleanCharacterData_ACU: vi.fn(),
}));
vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: mocks.sillyTavernApi }));
vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: mocks.applyTemplateScope,
  loadSettings_ACU: vi.fn(),
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ resetScriptStateForNewChat_ACU: vi.fn() }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: mocks.reloadStorageProvider,
  disposeStorageProvider: vi.fn(),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: mocks.isSqliteMode }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: mocks.loadAllChatMessages }));
vi.mock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: mocks.refreshMergedData }));
vi.mock('../../../src/shared/utils', () => ({
  cleanChatName_ACU: (value: unknown) => String(value || '').trim(),
  logDebug_ACU: mocks.logDebug,
  logError_ACU: mocks.logError,
  logWarn_ACU: mocks.logWarn,
}));
vi.mock('../../../src/service/plot/plot-logic', () => ({ shouldSkipPlotIntercept_ACU: vi.fn(() => false) }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({
  orchestrateTavernHelperHook_ACU: mocks.orchestrateTavernHelperHook,
  orchestrateAfterCommandsStrategy1_ACU: vi.fn(),
  orchestrateAfterCommandsStrategy2_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation/components/status-display', () => ({ getSendTextareaValue_ACU: vi.fn(() => ''), setSendTextareaValue_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/auto-loop', () => ({ enterLoopRetryFlow_ACU: vi.fn(), onLoopGenerationEnded_ACU: vi.fn(), stopAutoLoop_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/plot-planning-ui', () => ({ runOptimizationLogicWithUI_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/summary-vector-index-ui', () => ({ processSummaryVectorIndexBeforeGenerationWithUI_ACU: vi.fn() }));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({ preloadSummaryVectorIndexCacheForCurrentChat_ACU: vi.fn() }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({ restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU: vi.fn() }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: {} } }));
vi.mock('../../../src/service/scripts/script-output-context', () => ({ clearScriptChatOutputs_ACU: vi.fn() }));
vi.mock('../../../src/service/scripts', () => ({
  runChatLoadedScriptHook_ACU: mocks.runChatLoaded,
  runDbLoadedScriptHook_ACU: mocks.runDbLoaded,
  runScriptHook_ACU: vi.fn(),
}));
vi.mock('../../../src/service/scripts/script-request-context', () => ({ beginScriptRequestCycle_ACU: vi.fn((id?: string) => id || 'request'), endScriptRequestCycle_ACU: vi.fn() }));
vi.mock('../../../src/service/scripts/script-tavern-facade', () => ({
  clearScriptTavernRuntimeState_ACU: vi.fn(),
  setScriptCurrentMainReplyAiResponse_ACU: vi.fn(),
  setScriptCurrentMainReplyRequestId_ACU: vi.fn(),
  setScriptCurrentUserInput_ACU: vi.fn(),
  setScriptPromptDraft_ACU: vi.fn(),
}));

describe('loaded hook mount points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sillyTavernApi.chat = [{ mes: 'hello' }];
    mocks.sillyTavernApi.chat_metadata = { file_name: 'chat-a' };
    mocks.sillyTavernApi.eventTypes = {};
    mocks.sillyTavernApi.eventSource = undefined;
    mocks.attemptToLoadCoreApis.mockReturnValue(false);
    mocks.eventHandlers.clear();
    mocks.orchestrateTavernHelperHook.mockResolvedValue({ action: 'passthrough' });
    delete (globalThis as any).window?.original_TavernHelper_generate_ACU;
    mocks.isSqliteMode.mockReturnValue(false);
  });

  it('does not let completed chat.loaded block later db.loaded for the same chat', async () => {
    const { dispatchLoadedScriptHooks_ACU } = await import('../../../src/presentation/bootstrap/init');

    await dispatchLoadedScriptHooks_ACU({ reason: 'first', chatId: 'chat-a', dbRuntimeReady: false });
    await dispatchLoadedScriptHooks_ACU({ reason: 'retry', chatId: 'chat-a', dbRuntimeReady: true });

    expect(mocks.runChatLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.runDbLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('跳过 db.loaded'));
    expect(mocks.loadAllChatMessages).not.toHaveBeenCalled();
    expect(mocks.refreshMergedData).not.toHaveBeenCalled();
  });

  it('deduplicates db.loaded after it succeeds', async () => {
    const { dispatchLoadedScriptHooks_ACU } = await import('../../../src/presentation/bootstrap/init');

    await dispatchLoadedScriptHooks_ACU({ reason: 'first-ready', chatId: 'chat-b', dbRuntimeReady: true });
    await dispatchLoadedScriptHooks_ACU({ reason: 'second-ready', chatId: 'chat-b', dbRuntimeReady: true });

    expect(mocks.runChatLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.runDbLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.logDebug).toHaveBeenCalledWith(expect.stringContaining('跳过重复 chat.loaded'));
    expect(mocks.logDebug).toHaveBeenCalledWith(expect.stringContaining('跳过重复 db.loaded'));
  });

  it('does not roll back completed chat.loaded when db.loaded throws', async () => {
    const { dispatchLoadedScriptHooks_ACU } = await import('../../../src/presentation/bootstrap/init');
    mocks.runDbLoaded.mockRejectedValueOnce(new Error('db hook failed'));

    await dispatchLoadedScriptHooks_ACU({ reason: 'db-fails', chatId: 'chat-c', dbRuntimeReady: true });
    await dispatchLoadedScriptHooks_ACU({ reason: 'retry-after-db-fails', chatId: 'chat-c', dbRuntimeReady: false });

    expect(mocks.runChatLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.runDbLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('chat.loaded/db.loaded 执行失败:'), expect.any(Error));
  });

  it('prepares initial loaded runtime before dispatching hooks', async () => {
    const { prepareInitialLoadedHookRuntime_ACU } = await import('../../../src/presentation/bootstrap/init');

    const runtime = await prepareInitialLoadedHookRuntime_ACU('initial_load');

    expect(runtime).toEqual({ reason: 'initial_load', chatId: 'chat-a', dbRuntimeReady: true });
    expect(mocks.loadAllChatMessages).toHaveBeenCalledTimes(1);
    expect(mocks.applyTemplateScope).toHaveBeenCalledTimes(1);
    expect(mocks.refreshMergedData).toHaveBeenCalledTimes(1);
    expect(mocks.runChatLoaded).not.toHaveBeenCalled();
    expect(mocks.runDbLoaded).not.toHaveBeenCalled();
  });

  it('marks prepared runtime dbReady false when sqlite reload fails', async () => {
    const { prepareInitialLoadedHookRuntime_ACU } = await import('../../../src/presentation/bootstrap/init');
    mocks.isSqliteMode.mockReturnValue(true);
    mocks.reloadStorageProvider.mockRejectedValueOnce(new Error('sqlite failed'));

    const runtime = await prepareInitialLoadedHookRuntime_ACU('initial_load');

    expect(runtime).toEqual({ reason: 'initial_load', chatId: 'chat-a', dbRuntimeReady: false });
    expect(mocks.reloadStorageProvider).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining('数据库重建失败'));
    expect(mocks.runChatLoaded).not.toHaveBeenCalled();
    expect(mocks.runDbLoaded).not.toHaveBeenCalled();
  });
});

describe('main_reply TavernHelper.generate lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sillyTavernApi.chat = [{ mes: 'hello' }];
    mocks.sillyTavernApi.chat_metadata = { file_name: 'chat-a' };
    mocks.sillyTavernApi.eventTypes = { CHAT_CHANGED: 'CHAT_CHANGED' };
    mocks.sillyTavernApi.eventSource = {
      on: vi.fn((event: string, handler: any) => mocks.eventHandlers.set(event, handler)),
      makeLast: vi.fn(),
    };
    mocks.attemptToLoadCoreApis.mockReturnValue(true);
    mocks.eventHandlers.clear();
    mocks.orchestrateTavernHelperHook.mockResolvedValue({ action: 'passthrough' });
    (globalThis as any).window = {
      document: { getElementById: vi.fn(() => null) },
      parent: { document: { getElementById: vi.fn(() => null) } },
      TavernHelper: { generate: vi.fn().mockRejectedValue(new Error('model failed')) },
    };
  });

  it('cleans pending request state when original TavernHelper.generate throws', async () => {
    const requestContext = await import('../../../src/service/scripts/script-request-context');
    const { runScriptHook_ACU } = await import('../../../src/service/scripts');
    const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');

    mainInitialize_ACU();
    const chatChangedHandler = mocks.eventHandlers.get('CHAT_CHANGED');
    await chatChangedHandler('chat-a');

    await expect((globalThis as any).window.TavernHelper.generate({ user_input: 'hello' })).rejects.toThrow('model failed');

    expect(runScriptHook_ACU).toHaveBeenCalledWith('main_reply.before_generation', expect.objectContaining({
      eventPayload: expect.objectContaining({ requestId: expect.stringContaining('main_reply_tavernhelper_generate_') }),
    }));
    expect(runScriptHook_ACU).not.toHaveBeenCalledWith('main_reply.after_response', expect.anything());
    expect(requestContext.endScriptRequestCycle_ACU).toHaveBeenCalledWith(expect.stringContaining('main_reply_tavernhelper_generate_'));
  });

  it('normalizes GENERATION_ENDED chat length to the last assistant message', async () => {
    mocks.sillyTavernApi.chat = [
      { is_user: true, mes: 'user input' },
      { is_user: false, is_system: false, mes: 'assistant reply', id: 'assistant-1' },
    ];
    mocks.sillyTavernApi.eventTypes = {
      CHAT_CHANGED: 'CHAT_CHANGED',
      GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
      GENERATION_ENDED: 'GENERATION_ENDED',
    };
    const { runScriptHook_ACU } = await import('../../../src/service/scripts');
    const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');

    mainInitialize_ACU();
    await mocks.eventHandlers.get('GENERATION_AFTER_COMMANDS')('normal', {}, false);
    await mocks.eventHandlers.get('GENERATION_ENDED')(mocks.sillyTavernApi.chat.length);

    expect(runScriptHook_ACU).toHaveBeenCalledWith('main_reply.after_response', expect.objectContaining({
      eventPayload: expect.objectContaining({
        aiResponse: 'assistant reply',
        responseSource: 'chat_length_normalized',
        messageId: 'assistant-1',
      }),
      sourceContext: expect.objectContaining({
        aiResponse: 'assistant reply',
        responseSource: 'chat_length_normalized',
        messageId: 'assistant-1',
      }),
    }));
  });
});

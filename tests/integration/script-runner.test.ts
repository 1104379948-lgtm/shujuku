import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    userScripts: [] as any[],
    scriptLogs: [] as any[],
  },
  topWindow: {
    AutoCardUpdaterAPI: {
      marker: 'api-ref',
    },
    SillyTavern: {
      getContext: vi.fn(() => ({ characterId: 'char-a', name2: '角色A' })),
    },
  } as any,
  character: { avatar: 'char-a', name: '角色A' },
  globalMeta: {
    userScriptsGlobal: [] as any[],
    scriptLogsGlobal: [] as any[],
  } as any,
  saveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: mocks.settings,
  currentChatFileIdentifier_ACU: 'chat-a',
  generationGate_ACU: { lastUserMessageText: '用户输入' },
}));

vi.mock('../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mocks.saveSettings,
}));

vi.mock('../../src/data/repositories/profile-repo', () => ({
  get globalMeta_ACU() { return mocks.globalMeta; },
  ensureGlobalScriptSettings_ACU: vi.fn(() => {
    if (!Array.isArray(mocks.globalMeta.userScriptsGlobal)) mocks.globalMeta.userScriptsGlobal = [];
    if (!Array.isArray(mocks.globalMeta.scriptLogsGlobal)) mocks.globalMeta.scriptLogsGlobal = [];
    return { userScripts: mocks.globalMeta.userScriptsGlobal, scriptLogs: mocks.globalMeta.scriptLogsGlobal };
  }),
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: mocks.topWindow,
}));

vi.mock('../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterFallback_ACU: vi.fn(() => mocks.character),
}));

import { upsertUserScript_ACU } from '../../src/service/scripts/script-store';
import { getScriptOutput_ACU, setScriptOutput_ACU } from '../../src/service/scripts/script-output-context';
import { ScriptRunner_ACU, runScriptHook_ACU, runScriptManual_ACU, runScriptVariable_ACU, stringifyScriptValue_ACU } from '../../src/service/scripts/script-runner';

function addScript(script: any) {
  return upsertUserScript_ACU({
    enabled: true,
    version: 1,
    language: 'javascript',
    source: 'return "ok";',
    bindings: [],
    scope: { type: 'global' },
    order: 100,
    timeoutSeconds: 1,
    createdAt: 1,
    updatedAt: 1,
    ...script,
  }, false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.globalMeta.userScriptsGlobal = [];
  mocks.globalMeta.scriptLogsGlobal = [];
  mocks.settings.userScripts = mocks.globalMeta.userScriptsGlobal;
  mocks.settings.scriptLogs = mocks.globalMeta.scriptLogsGlobal;
  mocks.character = { avatar: 'char-a', name: '角色A' };
});

describe('ScriptRunner 阶段二能力', () => {
  it('提供 ScriptRunner 门面', () => {
    expect(ScriptRunner_ACU.runHook).toBe(runScriptHook_ACU);
    expect(typeof ScriptRunner_ACU.runVariable).toBe('function');
  });

  it('按启用状态、作用域和 hook 筛选脚本', async () => {
    addScript({
      id: 'script_global_match',
      name: 'global-match',
      source: 'ctx.api.order.push("global"); return "global";',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });
    addScript({
      id: 'script_disabled',
      name: 'disabled',
      enabled: false,
      source: 'ctx.api.order.push("disabled");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });
    addScript({
      id: 'script_other_hook',
      name: 'other-hook',
      source: 'ctx.api.order.push("other-hook");',
      bindings: [{ hook: 'main_reply.before_generation', enabled: true }],
    });
    addScript({
      id: 'script_other_character',
      name: 'other-character',
      source: 'ctx.api.order.push("other-character");',
      scope: { type: 'character', characterNames: ['角色B'] },
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });
    mocks.topWindow.AutoCardUpdaterAPI.order = [];

    const results = await runScriptHook_ACU('table_fill.after_commit');

    expect(results.map(result => result.scriptId)).toEqual(['script_global_match']);
    expect(mocks.topWindow.AutoCardUpdaterAPI.order).toEqual(['global']);
  });

  it('按全局优先、角色后置、order、name、id 稳定排序，并串行 await', async () => {
    mocks.topWindow.AutoCardUpdaterAPI.order = [];
    addScript({
      id: 'script_character',
      name: 'A-character',
      scope: { type: 'character', characterNames: ['角色A'] },
      order: 1,
      source: 'await new Promise(resolve => setTimeout(resolve, 5)); ctx.api.order.push("character"); return "character";',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 1 }],
    });
    addScript({
      id: 'script_global_b',
      name: 'B-global',
      order: 2,
      source: 'ctx.api.order.push("global-b"); return "global-b";',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 2 }],
    });
    addScript({
      id: 'script_global_a',
      name: 'A-global',
      order: 2,
      source: 'ctx.api.order.push("global-a"); return "global-a";',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 2 }],
    });

    await runScriptHook_ACU('table_fill.after_commit');

    expect(mocks.topWindow.AutoCardUpdaterAPI.order).toEqual(['global-a', 'global-b', 'character']);
  });

  it('构造 ctx.api/event/config/input/source/variable/scope/log 并执行用户函数体', async () => {
    addScript({
      id: 'script_ctx',
      name: 'ctx-script',
      source: [
        'ctx.log.info("hello", ctx.config.flag);',
        'return {',
        '  api: ctx.api.marker,',
        '  event: ctx.event.changedSheets[0],',
        '  config: ctx.config.flag,',
        '  input: ctx.input.manual,',
        '  source: ctx.source.sourceType,',
        '  scope: ctx.scope.characterName,',
        '  callType: ctx.callType,',
        '  hook: ctx.hook',
        '};',
      ].join('\n'),
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, config: { flag: 'cfg' } }],
    });

    const [result] = await runScriptHook_ACU('table_fill.after_commit', {
      eventPayload: { changedSheets: ['sheet_0'] },
      input: { manual: 'input' },
      sourceContext: { sourceType: 'test' },
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      api: 'api-ref',
      event: 'sheet_0',
      config: 'cfg',
      input: 'input',
      source: 'test',
      scope: '角色A',
      callType: 'hook',
      hook: 'table_fill.after_commit',
    });
    expect(mocks.settings.scriptLogs.some((log: any) => log.level === 'info' && log.message.includes('hello cfg'))).toBe(true);
    expect(mocks.saveSettings).toHaveBeenCalled();
  });

  it('变量调用未传 input 时使用 defaultVariableInput', async () => {
    addScript({
      id: 'script_default_input',
      name: 'default-input',
      source: 'return ctx.input.limit;',
      defaultVariableInput: { limit: 7 },
    });

    const result = await runScriptVariable_ACU({ raw: '{[script "default-input"]}', kind: 'execute', scriptName: 'default-input' });

    expect(result.success).toBe(true);
    expect(result.value).toBe(7);
  });

  it('hook 和手动运行未传 input 时 ctx.input 默认为空对象', async () => {
    addScript({
      id: 'script_empty_input',
      name: 'empty-input',
      source: 'return typeof ctx.input === "object" && ctx.input !== null && Object.keys(ctx.input).length === 0;',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });

    const [hookResult] = await runScriptHook_ACU('table_fill.after_commit');
    const manualResult = await runScriptManual_ACU('script_empty_input');

    expect(hookResult.value).toBe(true);
    expect(manualResult.value).toBe(true);
  });

  it('hook 和手动运行未配置 config 时 ctx.config 默认为空对象', async () => {
    addScript({
      id: 'script_empty_config',
      name: 'empty-config',
      source: 'return typeof ctx.config === "object" && ctx.config !== null && Object.keys(ctx.config).length === 0;',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });

    const [hookResult] = await runScriptHook_ACU('table_fill.after_commit');
    const manualResult = await runScriptManual_ACU('script_empty_config');

    expect(hookResult.value).toBe(true);
    expect(manualResult.value).toBe(true);
  });

  it('后执行脚本可通过 ctx.outputs.get 读取前序脚本 outputKey', async () => {
    addScript({
      id: 'script_output_writer',
      name: 'output-writer',
      source: 'return { hint: "动态提示", count: 2 };',
      bindings: [{ hook: 'table_fill.before_request', enabled: true, order: 1, outputKey: 'fillHint' }],
    });
    addScript({
      id: 'script_output_reader',
      name: 'output-reader',
      source: 'const value = ctx.outputs.get("fillHint"); return `${value.hint}:${value.count}`;',
      bindings: [{ hook: 'table_fill.before_request', enabled: true, order: 2 }],
    });

    const results = await runScriptHook_ACU('table_fill.before_request', {
      eventPayload: { hook: 'table_fill.before_request', requestId: 'request-a' },
      sourceContext: { requestId: 'request-a' },
    });

    expect(results.map(result => result.value)).toEqual([{ hint: '动态提示', count: 2 }, '动态提示:2']);
  });

  it('ctx.outputs.get 找不到输出时返回 defaultValue', async () => {
    addScript({
      id: 'script_output_default',
      name: 'output-default',
      source: 'return ctx.outputs.get("missingKey", { defaultValue: "默认提示" });',
      bindings: [{ hook: 'table_fill.before_request', enabled: true }],
    });

    const [result] = await runScriptHook_ACU('table_fill.before_request');

    expect(result.value).toBe('默认提示');
  });

  it('hook 脚本可调用注入的 ctx.controller，且失败时不提交 controller draft', async () => {
    addScript({
      id: 'script_controller_ok',
      name: 'controller-ok',
      source: 'ctx.controller.skipStage(2); return "ok";',
      bindings: [{ hook: 'plot.after_stage', enabled: true, order: 1 }],
    });
    addScript({
      id: 'script_controller_fail',
      name: 'controller-fail',
      source: 'ctx.controller.skipStage(3); throw new Error("boom");',
      bindings: [{ hook: 'plot.after_stage', enabled: true, order: 2, failurePolicy: 'continue' }],
    });
    const committedStages: number[] = [];

    const results = await runScriptHook_ACU('plot.after_stage', {
      createController: () => {
        const draft: number[] = [];
        return {
          controller: { skipStage: (stage: number) => draft.push(stage) },
          commit: () => committedStages.push(...draft),
        };
      },
    });

    expect(results.map(result => result.success)).toEqual([true, false]);
    expect(committedStages).toEqual([2]);
  });

  it('binding filter 不匹配时不运行脚本，匹配时才运行', async () => {
    mocks.topWindow.AutoCardUpdaterAPI.order = [];
    addScript({
      id: 'script_filter_miss',
      name: 'filter-miss',
      source: 'ctx.api.order.push("miss");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, filter: { updateMode: 'manual' } }],
    });
    addScript({
      id: 'script_filter_hit',
      name: 'filter-hit',
      source: 'ctx.api.order.push("hit");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, filter: { changedSheets: 'sheet_a' } }],
    });

    const results = await runScriptHook_ACU('table_fill.after_commit', {
      eventPayload: { updateMode: 'auto', changedSheets: ['sheet_a'] },
    });

    expect(results.map(result => result.scriptId)).toEqual(['script_filter_hit']);
    expect(mocks.topWindow.AutoCardUpdaterAPI.order).toEqual(['hit']);
  });

  it('同 binding order 时继续按 script order 排序', async () => {
    mocks.topWindow.AutoCardUpdaterAPI.order = [];
    addScript({
      id: 'script_late',
      name: 'A-late',
      order: 20,
      source: 'ctx.api.order.push("late");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 1 }],
    });
    addScript({
      id: 'script_early',
      name: 'Z-early',
      order: 10,
      source: 'ctx.api.order.push("early");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 1 }],
    });

    await runScriptHook_ACU('table_fill.after_commit');

    expect(mocks.topWindow.AutoCardUpdaterAPI.order).toEqual(['early', 'late']);
  });

  it('手动运行允许禁用脚本并注入所选 hook 的 binding config', async () => {
    addScript({
      id: 'script_manual_disabled',
      name: 'manual-disabled',
      enabled: false,
      source: 'return { hook: ctx.hook, config: ctx.config.flag, manual: ctx.event.manual === true };',
      bindings: [{ hook: 'main_reply.before_generation', enabled: true, config: { flag: 'cfg' } }],
    });

    const result = await runScriptManual_ACU('script_manual_disabled', { hook: 'main_reply.before_generation' });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ hook: 'main_reply.before_generation', config: 'cfg', manual: true });
  });

  it('手动运行默认不写 outputKey，显式 writeOutput 才写入输出上下文', async () => {
    addScript({
      id: 'script_manual_binding_index',
      name: 'manual-binding-index',
      source: 'return ctx.config.flag;',
      bindings: [
        { hook: 'main_reply.before_generation', enabled: true, config: { flag: 'first' }, outputKey: 'firstOut' },
        { hook: 'main_reply.before_generation', enabled: true, config: { flag: 'second' }, outputKey: 'secondOut' },
      ],
    });

    const result = await runScriptManual_ACU('script_manual_binding_index', { bindingIndex: 1, sourceContext: { requestId: 'manual_request' } });

    expect(result.success).toBe(true);
    expect(result.value).toBe('second');
    expect(getScriptOutput_ACU('secondOut', 'request', { requestId: 'manual_request' })).toBeUndefined();

    const writeResult = await runScriptManual_ACU('script_manual_binding_index', { bindingIndex: 1, sourceContext: { requestId: 'manual_request' }, writeOutput: true });

    expect(writeResult.success).toBe(true);
    expect(getScriptOutput_ACU('secondOut', 'request', { requestId: 'manual_request' })?.value).toBe('second');
    expect(getScriptOutput_ACU('firstOut', 'request', { requestId: 'manual_request' })).toBeUndefined();
  });

  it('hook outputKey 重复写入时拒绝覆盖已有输出', async () => {
    setScriptOutput_ACU('request', {
      key: 'sameOut',
      value: 'existing-value',
      scope: {},
    }, { requestId: 'duplicate_request' });
    addScript({
      id: 'script_duplicate_output_runtime',
      name: 'duplicate-output-runtime',
      source: 'return "new-value";',
      bindings: [{ hook: 'table_fill.before_request', enabled: true, outputKey: 'sameOut' }],
    });

    await expect(runScriptHook_ACU('table_fill.before_request', { sourceContext: { requestId: 'duplicate_request' } }))
      .rejects.toThrow('脚本输出 key 重复: sameOut');
    expect(getScriptOutput_ACU('sameOut', 'request', { requestId: 'duplicate_request' })?.value).toBe('existing-value');
  });

  it('超时后 abort signal 生效并阻止后续 API 副作用', async () => {
    addScript({
      id: 'script_timeout_abort',
      name: 'timeout-abort',
      timeoutSeconds: 0.01,
      source: [
        'await new Promise(resolve => setTimeout(resolve, 30));',
        'ctx.api.setLateMarker();',
        'return ctx.signal.aborted;',
      ].join('\n'),
      bindings: [{ hook: 'table_fill.after_commit', enabled: true }],
    });
    mocks.topWindow.AutoCardUpdaterAPI.lateMarker = false;
    mocks.topWindow.AutoCardUpdaterAPI.setLateMarker = vi.fn(() => { mocks.topWindow.AutoCardUpdaterAPI.lateMarker = true; });

    const [result] = await runScriptHook_ACU('table_fill.after_commit');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(result.success).toBe(false);
    expect(result.error).toContain('脚本执行超时');
    expect(mocks.topWindow.AutoCardUpdaterAPI.setLateMarker).not.toHaveBeenCalled();
    expect(mocks.topWindow.AutoCardUpdaterAPI.lateMarker).toBe(false);
  });

  it('continue 失败策略记录错误并继续，block 失败策略阻断流程', async () => {
    addScript({
      id: 'script_continue_fail',
      name: 'continue-fail',
      source: 'throw new Error("continue boom");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, failurePolicy: 'continue', order: 1 }],
    });
    addScript({
      id: 'script_after_continue',
      name: 'after-continue',
      source: 'ctx.api.continued = true; return "continued";',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, order: 2 }],
    });

    const results = await runScriptHook_ACU('table_fill.after_commit');

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
    expect(mocks.topWindow.AutoCardUpdaterAPI.continued).toBe(true);

    mocks.settings.userScripts = [];
    addScript({
      id: 'script_block_fail',
      name: 'block-fail',
      source: 'throw new Error("block boom");',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, failurePolicy: 'block' }],
    });

    await expect(runScriptHook_ACU('table_fill.after_commit')).rejects.toThrow('block boom');
  });

  it('返回值按统一规则转字符串', () => {
    expect(stringifyScriptValue_ACU('x')).toBe('x');
    expect(stringifyScriptValue_ACU(null)).toBe('');
    expect(stringifyScriptValue_ACU(undefined)).toBe('');
    expect(stringifyScriptValue_ACU(1)).toBe('1');
    expect(stringifyScriptValue_ACU(false)).toBe('false');
    expect(stringifyScriptValue_ACU({ a: 1 })).toBe('{"a":1}');
    expect(stringifyScriptValue_ACU([1, 2])).toBe('[1,2]');
  });
});

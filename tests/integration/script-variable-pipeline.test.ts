import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    userScripts: [] as any[],
    scriptLogs: [] as any[],
  },
  topWindow: {
    AutoCardUpdaterAPI: {
      querySql: vi.fn(),
    },
    SillyTavern: {
      getContext: vi.fn(() => ({ chatId: 'chat-a', characterId: 'char-a', name2: '角色A' })),
    },
  } as any,
  saveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  globalMeta: {
    userScriptsGlobal: [] as any[],
    scriptLogsGlobal: [] as any[],
  } as any,
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
  getCurrentCharacterFallback_ACU: vi.fn(() => ({ avatar: 'char-a', name: '角色A' })),
}));

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => false),
}));

import { replaceAcuTemplateVariables_ACU } from '../../src/service/runtime/template-vars';
import { clearAllScriptOutputs_ACU, setScriptOutput_ACU } from '../../src/service/scripts/script-output-context';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.globalMeta.userScriptsGlobal = [];
  mocks.globalMeta.scriptLogsGlobal = [];
  mocks.settings.userScripts = mocks.globalMeta.userScriptsGlobal;
  mocks.settings.scriptLogs = mocks.globalMeta.scriptLogsGlobal;
  clearAllScriptOutputs_ACU();
});

describe('脚本变量通用替换入口', () => {
  it('支持 {[script "脚本名"]}', async () => {
    mocks.settings.userScripts.push({
      id: 'script_plain',
      name: '纯文本脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return "plain";',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await replaceAcuTemplateVariables_ACU('结果：{[script "纯文本脚本"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：plain');
  });

  it('执行 {[script "脚本名" {...}]} 并替换返回值', async () => {
    mocks.settings.userScripts.push({
      id: 'script_hello',
      name: '问候脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return `hello ${ctx.input.name}`;',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await replaceAcuTemplateVariables_ACU('结果：{[script "问候脚本" {"name":"ACU"}]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
      sourceContext: { promptType: 'test' },
    });

    expect(result).toBe('结果：hello ACU');
  });

  it('支持 {[script id="script_xxx" input={...}]}', async () => {
    mocks.settings.userScripts.push({
      id: 'script_by_id',
      name: '可改名脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return ctx.input.limit + 1;',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await replaceAcuTemplateVariables_ACU('结果：{[script id="script_by_id" input={"limit":4}]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：5');
  });

  it('严格校验未知脚本参数并记录日志', async () => {
    const result = await replaceAcuTemplateVariables_ACU('结果：{[script id="missing" nope="x"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：');
    expect(mocks.settings.scriptLogs.some((log: any) => log.message.includes('未知 script 参数: nope'))).toBe(true);
  });

  it('脚本执行失败时支持 error 占位', async () => {
    const result = await replaceAcuTemplateVariables_ACU('结果：{[script id="missing" error="ERR"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：ERR');
  });

  it('读取 {[script_output "key"]} 的挂载点输出', async () => {
    setScriptOutput_ACU('request', {
      key: 'summary',
      value: { a: 1 },
      scope: {},
    });

    const result = await replaceAcuTemplateVariables_ACU('摘要：{[script_output "summary"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('摘要：{"a":1}');
  });

  it('script_output 缺失时支持 error 占位', async () => {
    const result = await replaceAcuTemplateVariables_ACU('摘要：{[script_output key="missing" error="EMPTY"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('摘要：EMPTY');
  });

  it('支持显式读取 chat/session 生命周期的 script_output', async () => {
    setScriptOutput_ACU('chat', {
      key: 'chatSummary',
      value: 'chat-value',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    });
    setScriptOutput_ACU('session', {
      key: 'sessionSummary',
      value: 'session-value',
      scope: { characterId: 'char-a' },
    });

    const result = await replaceAcuTemplateVariables_ACU('聊天：{[script_output key="chatSummary" ttl="chat"]} 会话：{[script_output key="sessionSummary" ttl="session"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('聊天：chat-value 会话：session-value');
  });

  it('脚本变量输出默认不做二次变量替换', async () => {
    mocks.settings.userScripts.push({
      id: 'script_nested',
      name: '嵌套脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return "{[script \\\"不存在\\\"]}";',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await replaceAcuTemplateVariables_ACU('结果：{[script "嵌套脚本"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：{[script "不存在"]}');
  });

  it('脚本变量解析错误时输出空并记录日志', async () => {
    const result = await replaceAcuTemplateVariables_ACU('结果：{[script "坏输入" {bad json}]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：');
    expect(mocks.settings.scriptLogs.some((log: any) => log.level === 'error' && log.message.includes('坏输入'))).toBe(true);
    expect(mocks.saveSettings).toHaveBeenCalled();
  });

  it('脚本变量解析错误时使用变量内 error 占位', async () => {
    const result = await replaceAcuTemplateVariables_ACU('结果：{[script "坏输入" {bad json} error="BAD_VAR"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('结果：BAD_VAR');
    expect(mocks.settings.scriptLogs.some((log: any) => log.level === 'error' && log.message.includes('坏输入'))).toBe(true);
  });

  it('非脚本变量的 script 前缀标记保持原样，不被误吞', async () => {
    const result = await replaceAcuTemplateVariables_ACU('保留：{[scripture]} 和 {[script_name "x"]}', {
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
    });

    expect(result).toBe('保留：{[scripture]} 和 {[script_name "x"]}');
    expect(mocks.settings.scriptLogs).toHaveLength(0);
  });
});

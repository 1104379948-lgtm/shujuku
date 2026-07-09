import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    userScripts: [] as any[],
    scriptLogs: [] as any[],
  },
  topWindow: {
    AutoCardUpdaterAPI: {},
    SillyTavern: {
      getContext: vi.fn(() => ({ characterId: 'char-a', name2: '角色A' })),
    },
  } as any,
}));

vi.mock('../../src/service/runtime/state-manager', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    settings_ACU: mocks.settings,
    currentChatFileIdentifier_ACU: 'chat-a',
    generationGate_ACU: { lastUserSendIntentAt: 0, lastUserMessageText: '' },
  };
});

vi.mock('../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(() => ({ saved: true, storageType: 'memory' })),
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

import {
  beginScriptRequestCycle_ACU,
  clearAllScriptOutputs_ACU,
  clearScriptChatOutputs_ACU,
  getCurrentScriptRequestCycleId_ACU,
  getScriptOutput_ACU,
  setScriptOutput_ACU,
} from '../../src/service/scripts/script-output-context';
import {
  endScriptRequestCycle_ACU as endScriptRequestContextCycle_ACU,
} from '../../src/service/scripts/script-request-context';
import { upsertUserScript_ACU } from '../../src/service/scripts/script-store';
import { runScriptHook_ACU } from '../../src/service/scripts/script-runner';
import { replaceAcuTemplateVariables_ACU } from '../../src/service/runtime/template-vars/acu-template-vars';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.userScripts = [];
  mocks.settings.scriptLogs = [];
  clearAllScriptOutputs_ACU();
  beginScriptRequestCycle_ACU('request_a');
});

describe('ScriptOutputContext 阶段三能力', () => {
  it('request 输出只在当前请求周期读取，不串到其他 requestId', () => {
    setScriptOutput_ACU('request', {
      key: 'summary',
      value: 'A',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    }, { requestId: 'request_a' });
    setScriptOutput_ACU('request', {
      key: 'summary',
      value: 'B',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    }, { requestId: 'request_b' });

    expect(getScriptOutput_ACU('summary', 'request', { requestId: 'request_a' })?.value).toBe('A');
    expect(getScriptOutput_ACU('summary', 'request', { requestId: 'request_b' })?.value).toBe('B');
    expect(getScriptOutput_ACU('missing', 'request', { requestId: 'request_a' })).toBeUndefined();
  });

  it('main_reply 开始本轮发送 request 时清空上一轮 request 输出', () => {
    setScriptOutput_ACU('request', {
      key: 'k',
      value: 'old',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    });
    expect(getScriptOutput_ACU('k')?.value).toBe('old');

    const before = getCurrentScriptRequestCycleId_ACU();
    beginScriptRequestCycle_ACU('send_request_b');
    const after = getCurrentScriptRequestCycleId_ACU();

    expect(after).not.toBe(before);
    expect(after).toBe('send_request_b');
    expect(getScriptOutput_ACU('k')).toBeUndefined();
  });

  it('chat 输出可清空，session 输出保留到页面会话内', () => {
    setScriptOutput_ACU('chat', {
      key: 'chatKey',
      value: 'chat',
      scope: { characterId: 'char-a' },
    });
    setScriptOutput_ACU('session', {
      key: 'sessionKey',
      value: 'session',
      scope: { characterId: 'char-a' },
    });

    clearScriptChatOutputs_ACU();

    expect(getScriptOutput_ACU('chatKey', 'chat', { scope: { chatId: 'chat-a', characterId: 'char-a' } })).toBeUndefined();
    expect(getScriptOutput_ACU('sessionKey', 'session', { scope: { chatId: 'chat-b', characterId: 'char-a' } })?.value).toBe('session');
  });

  it('hook 脚本 outputKey 保存到对应 requestId 的 request 输出上下文', async () => {
    upsertUserScript_ACU({
      id: 'script_output',
      name: '输出脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return ctx.event.value;',
      bindings: [{ hook: 'table_fill.before_request', enabled: true, outputKey: 'hookSummary', outputTtl: 'request' }],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, false);

    await runScriptHook_ACU('table_fill.before_request', {
      eventPayload: { requestId: 'request_hook', value: 'hook-value' },
    });

    expect(getScriptOutput_ACU('hookSummary', 'request', { requestId: 'request_hook' })?.value).toBe('hook-value');
    expect(getScriptOutput_ACU('hookSummary', 'request', { requestId: 'other_request' })).toBeUndefined();
  });

  it('main_reply.before_generation outputKey 可被同一正文模板读取，after_response 后清理 request', async () => {
    upsertUserScript_ACU({
      id: 'script_main_reply_output',
      name: '正文输出脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return ctx.event.value;',
      bindings: [
        { hook: 'main_reply.before_generation', enabled: true, outputKey: 'replyHint', outputTtl: 'request' },
        { hook: 'main_reply.after_response', enabled: true },
      ],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, false);
    const requestContext = {
      requestId: beginScriptRequestCycle_ACU('main_reply_output_request'),
      source: { promptType: 'main_reply', sourceType: 'generation_started' },
    };

    await runScriptHook_ACU('main_reply.before_generation', {
      eventPayload: { requestId: requestContext.requestId, value: '正文动态提示' },
      sourceContext: { requestId: requestContext.requestId, promptType: 'main_reply', sourceType: 'generation_started' },
      requestContext,
    });
    const rendered = await replaceAcuTemplateVariables_ACU('正文模板 {[script_output "replyHint"]}', {
      sourceContext: { requestId: requestContext.requestId, promptType: 'main_reply', sourceType: 'tavern_prompt_template' },
      requestContext,
    });

    expect(rendered).toBe('正文模板 正文动态提示');
    expect(getScriptOutput_ACU('replyHint', 'request', { requestId: requestContext.requestId })?.value).toBe('正文动态提示');

    await runScriptHook_ACU('main_reply.after_response', {
      eventPayload: { requestId: requestContext.requestId, aiResponse: 'AI 回复' },
      sourceContext: { requestId: requestContext.requestId, promptType: 'main_reply', sourceType: 'generation_ended' },
      requestContext,
    });
    endScriptRequestContextCycle_ACU(requestContext.requestId);

    expect(getScriptOutput_ACU('replyHint', 'request', { requestId: requestContext.requestId })).toBeUndefined();
  });

  it('request-context begin 和 end 会同步 output bucket 生命周期', () => {
    const id = beginScriptRequestCycle_ACU('request_from_context');
    setScriptOutput_ACU('request', {
      key: 'contextKey',
      value: 'context-value',
      scope: {},
    }, { requestId: id });

    expect(getScriptOutput_ACU('contextKey', 'request', { requestId: 'request_from_context' })?.value).toBe('context-value');

    endScriptRequestContextCycle_ACU('request_from_context');

    expect(getScriptOutput_ACU('contextKey', 'request', { requestId: 'request_from_context' })).toBeUndefined();
  });

  it('默认 request 周期切换后不会复用旧 Map 导致显式 request 被清空', () => {
    setScriptOutput_ACU('request', {
      key: 'defaultA',
      value: 'default-a',
      scope: {},
    });
    setScriptOutput_ACU('request', {
      key: 'explicitA',
      value: 'explicit-a',
      scope: {},
    }, { requestId: 'explicit_a' });

    beginScriptRequestCycle_ACU('request_b');
    setScriptOutput_ACU('request', {
      key: 'defaultB',
      value: 'default-b',
      scope: {},
    });

    expect(getScriptOutput_ACU('defaultA', 'request', { requestId: 'request_a' })?.value).toBe('default-a');
    expect(getScriptOutput_ACU('explicitA', 'request', { requestId: 'explicit_a' })?.value).toBe('explicit-a');
    expect(getScriptOutput_ACU('defaultB')?.value).toBe('default-b');
    expect(getScriptOutput_ACU('defaultB', 'request', { requestId: 'request_a' })).toBeUndefined();
  });

  it('默认 script_output 只读 request，不回退 chat 或 session', () => {
    setScriptOutput_ACU('chat', {
      key: 'shared',
      value: 'chat-value',
      scope: {},
    });
    setScriptOutput_ACU('session', {
      key: 'shared',
      value: 'session-value',
      scope: {},
    });

    expect(getScriptOutput_ACU('shared')).toBeUndefined();
    expect(getScriptOutput_ACU('shared', 'chat')).toBeUndefined();
    expect(getScriptOutput_ACU('shared', 'session')).toBeUndefined();
  });

  it('chat 输出按当前聊天和角色隔离，session 输出按角色隔离且跨聊天可读', () => {
    setScriptOutput_ACU('chat', {
      key: 'scoped',
      value: 'A',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    });
    setScriptOutput_ACU('chat', {
      key: 'scoped',
      value: 'B',
      scope: { chatId: 'chat-b', characterId: 'char-b' },
    });
    setScriptOutput_ACU('session', {
      key: 'sessionScoped',
      value: 'session-A',
      scope: { chatId: 'chat-a', characterId: 'char-a' },
    });
    setScriptOutput_ACU('session', {
      key: 'sessionScoped',
      value: 'session-B',
      scope: { chatId: 'chat-b', characterId: 'char-b' },
    });

    expect(getScriptOutput_ACU('scoped', 'chat', { scope: { chatId: 'chat-a', characterId: 'char-a' } })?.value).toBe('A');
    expect(getScriptOutput_ACU('scoped', 'chat', { scope: { chatId: 'chat-b', characterId: 'char-b' } })?.value).toBe('B');
    expect(getScriptOutput_ACU('scoped', 'chat', { scope: { chatId: 'chat-c', characterId: 'char-a' } })).toBeUndefined();
    expect(getScriptOutput_ACU('sessionScoped', 'session', { scope: { chatId: 'chat-c', characterId: 'char-a' } })?.value).toBe('session-A');
    expect(getScriptOutput_ACU('sessionScoped', 'session', { scope: { chatId: 'chat-a', characterId: 'char-b' } })?.value).toBe('session-B');
    expect(getScriptOutput_ACU('sessionScoped', 'session', { scope: { chatId: 'chat-a', characterId: 'char-c' } })).toBeUndefined();
  });

  it('chat/session 输出缺少保存 scope 时不能被带 scope 的读取方匹配', () => {
    setScriptOutput_ACU('chat', {
      key: 'unscopedChat',
      value: 'chat-value',
      scope: {},
    });
    setScriptOutput_ACU('session', {
      key: 'unscopedSession',
      value: 'session-value',
      scope: {},
    });

    expect(getScriptOutput_ACU('unscopedChat', 'chat', { scope: { chatId: 'chat-a' } })).toBeUndefined();
    expect(getScriptOutput_ACU('unscopedSession', 'session', { scope: { characterId: 'char-a' } })).toBeUndefined();
  });

  it('同一 outputKey 在同一输出 bucket 内重复写入会被拒绝', () => {
    setScriptOutput_ACU('request', {
      key: 'summary',
      value: 'A',
      scope: {},
    }, { requestId: 'request_a' });
    expect(() => setScriptOutput_ACU('request', {
      key: 'summary',
      value: 'B',
      scope: {},
    }, { requestId: 'request_a' })).toThrow('脚本输出 key 重复: summary');

    expect(getScriptOutput_ACU('summary', 'request', { requestId: 'request_a' })?.value).toBe('A');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    userScripts: [] as any[],
    scriptLogs: [] as any[],
  },
  saveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  globalMeta: {
    userScriptsGlobal: [] as any[],
    scriptLogsGlobal: [] as any[],
  } as any,
  logWarn: vi.fn(),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: mocks.settings,
  currentChatFileIdentifier_ACU: 'chat-a',
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

vi.mock('../../src/shared/utils', () => ({
  logWarn_ACU: mocks.logWarn,
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: {} },
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterFallback_ACU: vi.fn(() => ({ avatar: 'char-a', name: '角色A' })),
}));

import {
  exportUserScripts_ACU,
  getUserScripts_ACU,
  importUserScripts_ACU,
  USER_SCRIPT_EXPORT_FORMAT_ACU,
  upsertUserScript_ACU,
} from '../../src/service/scripts/script-store';
import { runScriptVariable_ACU } from '../../src/service/scripts/script-runner';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.globalMeta.userScriptsGlobal = [];
  mocks.globalMeta.scriptLogsGlobal = [];
  mocks.settings.userScripts = mocks.globalMeta.userScriptsGlobal;
  mocks.settings.scriptLogs = mocks.globalMeta.scriptLogsGlobal;
});

describe('ScriptStore 阶段一能力', () => {
  it('导出 acu_user_script_v1，包含配置、绑定和函数体源码', () => {
    const saved = upsertUserScript_ACU({
      id: 'script_local',
      name: '导出脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return 1;',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, outputKey: 'x' }],
      scope: { type: 'global' },
      order: 10,
      timeoutSeconds: 0.5,
      createdAt: 1,
      updatedAt: 1,
      defaultVariableInput: { limit: 1 },
    }, false);

    const exported = exportUserScripts_ACU([saved.id]);

    expect(exported.format).toBe(USER_SCRIPT_EXPORT_FORMAT_ACU);
    expect(exported.scripts).toHaveLength(1);
    expect(exported.scripts[0]).toMatchObject({
      name: '导出脚本',
      enabled: true,
      source: 'return 1;',
      defaultVariableInput: { limit: 1 },
    });
    expect((exported.scripts[0] as any).id).toBeUndefined();
  });

  it('导入时生成新 id、保留 enabled、名称重复追加后缀且不执行脚本', () => {
    upsertUserScript_ACU({
      id: 'script_existing',
      name: '重复脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return "existing";',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, false);

    const imported = importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        id: 'script_from_file',
        name: '重复脚本',
        enabled: false,
        language: 'javascript',
        source: 'throw new Error("should not run");',
        bindings: [],
        scope: { type: 'global' },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false);

    expect(imported).toHaveLength(1);
    expect(imported[0].id).not.toBe('script_from_file');
    expect(imported[0].enabled).toBe(false);
    expect(imported[0].name).toBe('重复脚本 (2)');
    expect(mocks.settings.scriptLogs).toHaveLength(0);
  });

  it('导入缺少 enabled 字段时拒绝导入，不猜测启用状态', () => {
    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '缺 enabled',
        language: 'javascript',
        source: 'return 1;',
        bindings: [],
        scope: { type: 'global' },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false)).toThrow('scripts[0].enabled');
  });

  it('名称重名变量调用输出空并记录日志', async () => {
    const base = {
      enabled: true,
      version: 1,
      language: 'javascript' as const,
      source: 'return "ok";',
      bindings: [],
      scope: { type: 'global' as const },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    upsertUserScript_ACU({ ...base, id: 'script_a', name: '重名' }, false);
    upsertUserScript_ACU({ ...base, id: 'script_b', name: '重名' }, false);

    const result = await runScriptVariable_ACU({ raw: '{[script "重名"]}', kind: 'execute', scriptName: '重名' });

    expect(result.success).toBe(false);
    expect(result.value).toBe('');
    expect(result.error).toBe('script_name_not_unique');
    expect(mocks.settings.scriptLogs.some((log: any) => log.message.includes('脚本名称不唯一'))).toBe(true);
  });

  it('同一脚本内重复 outputKey 会拒绝保存', () => {
    expect(() => upsertUserScript_ACU({
      id: 'script_duplicate_output',
      name: '重复输出',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return 1;',
      bindings: [
        { hook: 'table_fill.before_request', enabled: true, outputKey: 'same' },
        { hook: 'main_reply.before_generation', enabled: true, outputKey: 'same' },
      ],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, false)).toThrow('脚本输出 key 重复: same');
  });

  it('导出包是深拷贝快照，修改导出对象不会污染内存脚本', () => {
    const saved = upsertUserScript_ACU({
      id: 'script_snapshot',
      name: '快照脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return 1;',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, config: { limit: 1 } }],
      scope: { type: 'character', characterNames: ['角色A'] },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
      defaultVariableInput: { limit: 1 },
    }, false);

    const exported = exportUserScripts_ACU([saved.id]);
    (exported.scripts[0].bindings as any[])[0].config.limit = 99;
    (exported.scripts[0].scope as any).characterNames.push('角色B');
    (exported.scripts[0].defaultVariableInput as any).limit = 99;

    expect(mocks.settings.userScripts[0].bindings[0].config.limit).toBe(1);
    expect(mocks.settings.userScripts[0].scope.characterNames).toEqual(['角色A']);
    expect(mocks.settings.userScripts[0].defaultVariableInput.limit).toBe(1);
  });

  it('读取脚本列表返回快照，调用方不能绕过保存校验修改内部状态', () => {
    upsertUserScript_ACU({
      id: 'script_snapshot_list',
      name: '列表快照脚本',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return 1;',
      bindings: [{ hook: 'table_fill.after_commit', enabled: true, config: { limit: 1 } }],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, false);

    const scripts = getUserScripts_ACU();
    scripts.push({ ...scripts[0], id: 'script_injected', name: '注入脚本' });
    (scripts[0].bindings[0].config as any).limit = 99;

    expect(mocks.settings.userScripts).toHaveLength(1);
    expect(mocks.settings.userScripts[0].bindings[0].config.limit).toBe(1);
  });

  it('不同角色卡脚本可复用 outputKey，但全局脚本会与角色卡脚本冲突', () => {
    const base = {
      enabled: true,
      version: 1,
      language: 'javascript' as const,
      source: 'return 1;',
      bindings: [{ hook: 'table_fill.before_request' as const, enabled: true, outputKey: 'same' }],
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    upsertUserScript_ACU({ ...base, id: 'script_char_a', name: '角色A脚本', scope: { type: 'character', characterNames: ['角色A'] } }, false);
    expect(() => upsertUserScript_ACU({ ...base, id: 'script_char_b', name: '角色B脚本', scope: { type: 'character', characterNames: ['角色B'] } }, false)).not.toThrow();
    expect(() => upsertUserScript_ACU({ ...base, id: 'script_global', name: '全局脚本', scope: { type: 'global' } }, false)).toThrow('脚本输出 key 重复: same');
  });

  it('角色卡脚本作用范围有交集时拒绝重复 outputKey', () => {
    const base = {
      enabled: true,
      version: 1,
      language: 'javascript' as const,
      source: 'return 1;',
      bindings: [{ hook: 'table_fill.before_request' as const, enabled: true, outputKey: 'same' }],
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    upsertUserScript_ACU({ ...base, id: 'script_char_ab', name: '角色AB脚本', scope: { type: 'character', characterNames: ['角色A', '角色B'] } }, false);
    expect(() => upsertUserScript_ACU({ ...base, id: 'script_char_a', name: '角色A脚本', scope: { type: 'character', characterNames: ['角色A'] } }, false)).toThrow('脚本输出 key 重复: same');
  });

  it('导入时拒绝非法 hook，避免静默改写脚本包', () => {
    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '非法 hook',
        enabled: true,
        language: 'javascript',
        source: 'return 1;',
        bindings: [{ hook: 'bad.hook', enabled: true, outputKey: 'x' }],
        scope: { type: 'global' },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false)).toThrow('scripts[0].bindings[0].hook');
  });

  it('导入时拒绝绑定里的非 schema 字段', () => {
    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '非法绑定字段',
        enabled: true,
        language: 'javascript',
        source: 'return 1;',
        bindings: [{ hook: 'table_fill.after_commit', enabled: true, extra: true }],
        scope: { type: 'global' },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false)).toThrow('scripts[0].bindings[0].extra');
  });

  it('导入时拒绝非法 scope 和 timeout，不靠默认值兜底', () => {
    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '非法 scope',
        enabled: true,
        language: 'javascript',
        source: 'return 1;',
        bindings: [],
        scope: { type: 'bad' },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false)).toThrow('scripts[0].scope.type');

    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '缺角色名',
        enabled: true,
        language: 'javascript',
        source: 'return 1;',
        bindings: [],
        scope: { type: 'character', characterNames: [] },
        order: 100,
        timeoutSeconds: 1,
      }],
    }, false)).toThrow('scripts[0].scope.characterNames');

    expect(() => importUserScripts_ACU({
      format: USER_SCRIPT_EXPORT_FORMAT_ACU,
      scripts: [{
        name: '非法 timeout',
        enabled: true,
        language: 'javascript',
        source: 'return 1;',
        timeoutSeconds: -1,
        bindings: [],
        scope: { type: 'global' },
        order: 100,
      }],
    }, false)).toThrow('scripts[0].timeoutSeconds');
  });

  it('读取脚本配置不会迁移或 normalize 写回开发期坏配置', () => {
    mocks.globalMeta.userScriptsGlobal = [{ id: 'bad_script', name: '坏配置', source: 'return 1;' }];
    mocks.settings.userScripts = mocks.globalMeta.userScriptsGlobal;

    const scripts = getUserScripts_ACU();

    expect(scripts).toEqual([{ id: 'bad_script', name: '坏配置', source: 'return 1;' }]);
    expect(mocks.globalMeta.userScriptsGlobal).toEqual([{ id: 'bad_script', name: '坏配置', source: 'return 1;' }]);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('普通保存拒绝非法 hook、scope 和 timeout，不靠 normalize 静默兜底', () => {
    const base = {
      id: 'script_invalid_save',
      name: '非法保存',
      enabled: true,
      version: 1,
      language: 'javascript' as const,
      source: 'return 1;',
      bindings: [],
      scope: { type: 'global' as const },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    expect(() => upsertUserScript_ACU({ ...base, bindings: [{ hook: 'bad.hook' as any, enabled: true }] }, false)).toThrow('scripts[0].bindings[0].hook');
    expect(() => upsertUserScript_ACU({ ...base, scope: { type: 'bad' as any } }, false)).toThrow('scripts[0].scope.type');
    expect(() => upsertUserScript_ACU({ ...base, timeoutSeconds: -1 }, false)).toThrow('scripts[0].timeoutSeconds');
  });

  it('持久化保存失败时抛错，不能表现为已保存', () => {
    mocks.saveSettings.mockReturnValueOnce({ saved: false, code: 'settings_loading' });

    expect(() => upsertUserScript_ACU({
      id: 'script_save_fail',
      name: '保存失败',
      enabled: true,
      version: 1,
      language: 'javascript',
      source: 'return 1;',
      bindings: [],
      scope: { type: 'global' },
      order: 100,
      timeoutSeconds: 1,
      createdAt: 1,
      updatedAt: 1,
    }, true)).toThrow('脚本配置保存失败: settings_loading');
  });
});

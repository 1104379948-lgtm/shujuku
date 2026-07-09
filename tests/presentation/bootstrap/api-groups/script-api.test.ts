import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  topWindow: {} as any,
  upsertUserScript: vi.fn(),
  deleteUserScript: vi.fn(),
  importUserScripts: vi.fn(),
  runScriptHook: vi.fn(),
  runScriptManual: vi.fn(),
  runScriptVariable: vi.fn(),
}));

vi.mock('../../../../src/shared/env', () => ({ topLevelWindow_ACU: mocks.topWindow }));
vi.mock('../../../../src/service/scripts', () => ({
  clearAllScriptOutputs_ACU: vi.fn(),
  clearScriptChatOutputs_ACU: vi.fn(),
  clearScriptRequestOutputs_ACU: vi.fn(),
  deleteUserScript_ACU: (...args: any[]) => mocks.deleteUserScript(...args),
  exportUserScripts_ACU: vi.fn(() => ({ format: 'acu-user-scripts-v1', scripts: [] })),
  getScriptLogs_ACU: vi.fn(() => []),
  getUserScripts_ACU: vi.fn(() => []),
  importUserScripts_ACU: (...args: any[]) => mocks.importUserScripts(...args),
  runScriptHook_ACU: (...args: any[]) => mocks.runScriptHook(...args),
  runScriptManual_ACU: (...args: any[]) => mocks.runScriptManual(...args),
  runScriptVariable_ACU: (...args: any[]) => mocks.runScriptVariable(...args),
  upsertUserScript_ACU: (...args: any[]) => mocks.upsertUserScript(...args),
}));
vi.mock('../../../../src/presentation/bootstrap/api-groups/callback-api', () => ({ createCallbackApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/core-data-api', () => ({ createCoreDataApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/table-crud-api', () => ({ createTableCrudApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/table-lock-api', () => ({ createTableLockApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/template-preset-api', () => ({ createTemplatePresetApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/plot-preset-api', () => ({ createPlotPresetApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/data-admin-api', () => ({ createDataAdminApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/settings-config-api', () => ({ createSettingsConfigApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/worldbook-ai-api', () => ({ createWorldbookAiApi: vi.fn(() => ({})) }));
vi.mock('../../../../src/presentation/bootstrap/api-groups/sql-api', () => ({ createSqlApi: vi.fn(() => ({})) }));

import { createScriptApi } from '../../../../src/presentation/bootstrap/api-groups/script-api';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.topWindow.AutoCardUpdaterAPI = undefined;
});

describe('createScriptApi', () => {
  it('saveUserScript returns stable success payload', () => {
    mocks.upsertUserScript.mockReturnValue({ id: 'script_a', name: 'A' });
    const api = createScriptApi({} as any);
    expect(api.saveUserScript({ name: 'A' })).toEqual({ success: true, script: { id: 'script_a', name: 'A' }, id: 'script_a', saved: true });
  });

  it('saveUserScript returns stable error payload', () => {
    mocks.upsertUserScript.mockImplementation(() => { throw new Error('bad hook'); });
    const api = createScriptApi({} as any);
    expect(api.saveUserScript({ name: 'A' })).toEqual({ success: false, error: 'bad hook' });
  });

  it('importUserScripts returns count and ids', () => {
    mocks.importUserScripts.mockReturnValue([{ id: 'script_a' }, { id: 'script_b' }]);
    const api = createScriptApi({} as any);
    expect(api.importUserScripts({ format: 'acu-user-scripts-v1', scripts: [] })).toEqual({
      success: true,
      scripts: [{ id: 'script_a' }, { id: 'script_b' }],
      importedCount: 2,
      ids: ['script_a', 'script_b'],
    });
  });

  it('deleteUserScript returns deletion status', () => {
    mocks.deleteUserScript.mockReturnValue(true);
    const api = createScriptApi({} as any);
    expect(api.deleteUserScript('script_a')).toEqual({ success: true, deleted: true, scriptId: 'script_a' });
  });

  it('runScriptHook is exposed as debug/compat API with stable payload', async () => {
    mocks.runScriptHook.mockResolvedValue([{ scriptId: 'script_a', success: true, durationMs: 1 }]);
    const api = createScriptApi({} as any);

    await expect(api.runScriptHook('table_fill.before_request', { sourceContext: { requestId: 'r1' } })).resolves.toMatchObject({
      success: true,
      mode: 'debug_compat',
      hook: 'table_fill.before_request',
      results: [{ scriptId: 'script_a', success: true, durationMs: 1 }],
    });
    expect(mocks.runScriptHook).toHaveBeenCalledWith('table_fill.before_request', expect.objectContaining({
      sourceContext: { requestId: 'r1', apiSource: 'debug_compat' },
    }));
  });

  it('runScriptManual returns stable success payload', async () => {
    mocks.runScriptManual.mockResolvedValue({ scriptId: 'script_a', success: true, value: 'ok', durationMs: 1 });
    const api = createScriptApi({} as any);
    await expect(api.runScriptManual('script_a')).resolves.toEqual({
      success: true,
      result: { scriptId: 'script_a', success: true, value: 'ok', durationMs: 1 },
    });
  });
});

describe('api-registry script API exposure', () => {
  it('mounts script API methods on AutoCardUpdaterAPI', async () => {
    await import('../../../../src/presentation/bootstrap/api-registry');
    expect(typeof mocks.topWindow.AutoCardUpdaterAPI.saveUserScript).toBe('function');
    expect(typeof mocks.topWindow.AutoCardUpdaterAPI.importUserScripts).toBe('function');
    expect(typeof mocks.topWindow.AutoCardUpdaterAPI.runScriptManual).toBe('function');
  });
});

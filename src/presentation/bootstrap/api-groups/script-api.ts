import type { ApiGroupContext } from './callback-api';
import {
  clearAllScriptOutputs_ACU,
  clearScriptChatOutputs_ACU,
  clearScriptRequestOutputs_ACU,
  deleteScriptLibrary_ACU,
  deleteUserScript_ACU,
  exportUserScripts_ACU,
  getScriptLibraries_ACU,
  getScriptLogs_ACU,
  getUserScripts_ACU,
  importUserScripts_ACU,
  runScriptHook_ACU,
  runScriptManual_ACU,
  runScriptVariable_ACU,
  upsertScriptLibrary_ACU,
  upsertUserScript_ACU,
} from '../../../service/scripts';

export function createScriptApi(_ctx: ApiGroupContext): Record<string, Function> {
  const ok = <T extends Record<string, unknown>>(payload: T) => ({ success: true, ...payload });
  const fail = (error: unknown) => ({ success: false, error: String((error as any)?.message || error) });
  return {
    listUserScripts: function() {
      return getUserScripts_ACU();
    },
    listScriptLibraries: function() {
      return getScriptLibraries_ACU();
    },
    saveScriptLibrary: function(library: any) {
      try {
        const saved = upsertScriptLibrary_ACU(library, true);
        return ok({ library: saved, id: saved.id, saved: true });
      } catch (error) {
        return fail(error);
      }
    },
    deleteScriptLibrary: function(libraryId: string) {
      try {
        return ok({ deleted: deleteScriptLibrary_ACU(libraryId, true), libraryId: String(libraryId || '') });
      } catch (error) {
        return fail(error);
      }
    },
    saveUserScript: function(script: any) {
      try {
        const saved = upsertUserScript_ACU(script, true);
        return ok({ script: saved, id: saved.id, saved: true });
      } catch (error) {
        return fail(error);
      }
    },
    deleteUserScript: function(scriptId: string) {
      try {
        return ok({ deleted: deleteUserScript_ACU(scriptId, true), scriptId: String(scriptId || '') });
      } catch (error) {
        return fail(error);
      }
    },
    exportUserScripts: function(scriptIds?: string[]) {
      return exportUserScripts_ACU(scriptIds);
    },
    importUserScripts: function(payload: unknown) {
      try {
        const scripts = importUserScripts_ACU(payload, true);
        return ok({ scripts, importedCount: scripts.length, ids: scripts.map(script => script.id) });
      } catch (error) {
        return fail(error);
      }
    },
    getScriptLogs: function(scriptId?: string) {
      return getScriptLogs_ACU(scriptId);
    },
    runScriptHook: async function(hook: any, options: any = {}) {
      try {
        const results = await runScriptHook_ACU(hook, {
          ...(options && typeof options === 'object' ? options : {}),
          sourceContext: {
            ...((options && typeof options === 'object' && options.sourceContext && typeof options.sourceContext === 'object') ? options.sourceContext : {}),
            apiSource: 'debug_compat',
          },
        });
        return ok({
          mode: 'debug_compat',
          warning: 'runScriptHook is a debug/compat API. Production lifecycle hooks are triggered by their owning business flows.',
          hook: String(hook || ''),
          results,
        });
      } catch (error) {
        return fail(error);
      }
    },
    runScriptVariable: async function(call: any, options: any = {}) {
      try {
        const result = await runScriptVariable_ACU(call, options);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
    runScriptManual: async function(scriptId: string, options: any = {}) {
      try {
        const result = await runScriptManual_ACU(scriptId, options);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
    clearScriptRequestOutputs: function() {
      clearScriptRequestOutputs_ACU();
    },
    clearScriptChatOutputs: function() {
      clearScriptChatOutputs_ACU();
    },
    clearAllScriptOutputs: function() {
      clearAllScriptOutputs_ACU();
    },
  };
}

import { getStorageProvider } from '../table/table-storage-strategy';
import { currentJsonTableData_ACU } from '../runtime/state-manager';
import { runScriptHook_ACU } from './script-runner';
import { getCurrentScriptScope_ACU } from './script-tavern-facade';
import { getCurrentScriptRequestContext_ACU, type ScriptRequestContext_ACU } from './script-request-context';

function getCurrentTableData_ACU(): Record<string, any> {
  const data = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
    ? currentJsonTableData_ACU
    : getStorageProvider().getCurrentData();
  return data && typeof data === 'object' ? data as Record<string, any> : {};
}

function getCurrentSheetKeys_ACU(): string[] {
  return Object.keys(getCurrentTableData_ACU())
    .filter(key => key.startsWith('sheet_'))
    .sort();
}

function getCurrentTableDisplayNames_ACU(sheetKeys: string[]): string[] {
  const data = getCurrentTableData_ACU();
  return sheetKeys
    .map(key => String((data as any)[key]?.name || key))
    .filter(Boolean)
    .sort();
}

export async function runChatLoadedScriptHook_ACU(): Promise<void> {
  const scope = getCurrentScriptScope_ACU();
  const requestContext: ScriptRequestContext_ACU = { ...getCurrentScriptRequestContext_ACU(), source: { sourceType: 'chat_loaded' } };
  await runScriptHook_ACU('chat.loaded', {
    eventPayload: {
      hook: 'chat.loaded',
      timestamp: Date.now(),
      requestId: requestContext.requestId,
      chatId: scope.chatId || '',
      characterId: scope.characterId || '',
      characterName: scope.characterName || '',
    },
    sourceContext: {
      requestId: requestContext.requestId,
      sourceType: 'chat_loaded',
    },
    requestContext,
  });
}

export async function runDbLoadedScriptHook_ACU(): Promise<void> {
  const provider = getStorageProvider();
  const sheetKeys = getCurrentSheetKeys_ACU();
  const tableDisplayNames = getCurrentTableDisplayNames_ACU(sheetKeys);
  const requestContext: ScriptRequestContext_ACU = { ...getCurrentScriptRequestContext_ACU(), source: { sourceType: 'db_loaded' } };
  await runScriptHook_ACU('db.loaded', {
    eventPayload: {
      hook: 'db.loaded',
      timestamp: Date.now(),
      requestId: requestContext.requestId,
      sheetKeys,
      tableNames: tableDisplayNames,
      tableDisplayNames,
      storageMode: provider.mode,
    },
    sourceContext: {
      requestId: requestContext.requestId,
      sourceType: 'db_loaded',
    },
    requestContext,
  });
}

export async function runManualTableSaveAfterCommitHook_ACU(changedSheets: string[], requestId?: string): Promise<void> {
  const currentRequestContext = getCurrentScriptRequestContext_ACU();
  const normalizedRequestId = String(requestId || '').trim() || currentRequestContext.requestId;
  const requestContext: ScriptRequestContext_ACU = { ...currentRequestContext, requestId: normalizedRequestId, source: { sourceType: 'manual_table_save_after_commit' } };
  await runScriptHook_ACU('manual_table_save.after_commit', {
    eventPayload: {
      hook: 'manual_table_save.after_commit',
      timestamp: Date.now(),
      requestId: normalizedRequestId,
      changedSheets: Array.isArray(changedSheets) ? [...new Set(changedSheets.map(String).filter(Boolean))].sort() : [],
      success: true,
    },
    sourceContext: {
      requestId: normalizedRequestId,
      sourceType: 'manual_table_save_after_commit',
    },
    requestContext,
  });
}

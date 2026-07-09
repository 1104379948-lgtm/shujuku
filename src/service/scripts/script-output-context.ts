import type {
  ScriptOutputAccessOptions_ACU,
  ScriptOutputBucket_ACU,
  ScriptOutputContext_ACU,
  ScriptOutputTtl_ACU,
  ScriptStoredOutput_ACU,
} from './script-types';
import {
  beginScriptRequestCycle_ACU as beginScriptRequestContext_ACU,
  getCurrentScriptRequestCycleId_ACU as getCurrentScriptRequestContextId_ACU,
  normalizeScriptRequestId_ACU,
  onScriptRequestLifecycle_ACU,
  endScriptRequestCycle_ACU as endScriptRequestContext_ACU,
} from './script-request-context';

const scriptOutputContext_ACU: ScriptOutputContext_ACU = {
  request: {
    currentCycleId: getCurrentScriptRequestContextId_ACU(),
    byCycleId: new Map(),
  },
  chat: new Map(),
  session: new Map(),
};

function getRequestOutputMap_ACU(requestId?: string, createIfMissing = true): ScriptOutputBucket_ACU | undefined {
  const cycleId = normalizeScriptRequestId_ACU(requestId);
  let map = scriptOutputContext_ACU.request.byCycleId.get(cycleId);
  if (!map && createIfMissing) {
    map = new Map<string, ScriptStoredOutput_ACU>();
    scriptOutputContext_ACU.request.byCycleId.set(cycleId, map);
  }
  return map;
}

function outputMapForTtl_ACU(ttl: ScriptOutputTtl_ACU = 'request', options: ScriptOutputAccessOptions_ACU = {}): ScriptOutputBucket_ACU {
  if (ttl === 'request') return getRequestOutputMap_ACU(options.requestId)!;
  if (ttl === 'chat') return scriptOutputContext_ACU.chat;
  if (ttl === 'session') return scriptOutputContext_ACU.session;
  return getRequestOutputMap_ACU(options.requestId)!;
}

function outputStorageKey_ACU(ttl: ScriptOutputTtl_ACU, key: string, scope?: ScriptStoredOutput_ACU['scope']): string {
  if (ttl === 'request') return key;
  const characterId = String(scope?.characterId || '').trim();
  if (ttl === 'session') return `${key}\u0000character:${characterId}`;
  const chatId = String(scope?.chatId || '').trim();
  return `${key}\u0000chat:${chatId}\u0000character:${characterId}`;
}

export function getCurrentScriptRequestCycleId_ACU(): string {
  return getCurrentScriptRequestContextId_ACU();
}

export function beginScriptRequestCycleForOutputs_ACU(requestId?: string): string {
  const cycleId = beginScriptRequestContext_ACU(requestId);
  return cycleId;
}

export function endScriptRequestCycleForOutputs_ACU(requestId?: string): void {
  endScriptRequestContext_ACU(requestId);
}

export function setScriptOutput_ACU(ttl: ScriptOutputTtl_ACU | undefined, output: ScriptStoredOutput_ACU, options: ScriptOutputAccessOptions_ACU = {}): void {
  const normalizedTtl = ttl || 'request';
  const map = outputMapForTtl_ACU(normalizedTtl, options);
  const storageKey = outputStorageKey_ACU(normalizedTtl, output.key, output.scope);
  if (map.has(storageKey)) {
    throw new Error(`脚本输出 key 重复: ${output.key}`);
  }
  map.set(storageKey, output);
}

export function getScriptOutput_ACU(key: string, ttl?: ScriptOutputTtl_ACU, options: ScriptOutputAccessOptions_ACU = {}): ScriptStoredOutput_ACU | undefined {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return undefined;
  if (ttl === 'chat' && (!String(options.scope?.chatId || '').trim() || !String(options.scope?.characterId || '').trim())) return undefined;
  if (ttl === 'session' && !String(options.scope?.characterId || '').trim()) return undefined;
  const matchesScope = (output: ScriptStoredOutput_ACU) => {
    if (!ttl || ttl === 'request') return true;
    const expectedChatId = ttl === 'chat' ? String(options.scope?.chatId || '').trim() : '';
    const expectedCharacterId = String(options.scope?.characterId || '').trim();
    const outputChatId = String(output.scope?.chatId || '').trim();
    const outputCharacterId = String(output.scope?.characterId || '').trim();
    if (expectedChatId && !outputChatId) return false;
    if (expectedCharacterId && !outputCharacterId) return false;
    if (expectedChatId && outputChatId && outputChatId !== expectedChatId) return false;
    if (expectedCharacterId && outputCharacterId && outputCharacterId !== expectedCharacterId) return false;
    return true;
  };
  const matchesOutput = (output?: ScriptStoredOutput_ACU) => output && matchesScope(output) ? output : undefined;
  if (ttl) {
    return matchesOutput(outputMapForTtl_ACU(ttl, options).get(outputStorageKey_ACU(ttl, normalizedKey, options.scope)));
  }
  return matchesOutput(getRequestOutputMap_ACU(options.requestId, false)?.get(normalizedKey));
}

export function clearScriptRequestOutputs_ACU(requestId?: string): void {
  if (requestId) {
    scriptOutputContext_ACU.request.byCycleId.delete(requestId);
    return;
  }
  scriptOutputContext_ACU.request.byCycleId.clear();
  scriptOutputContext_ACU.request.byCycleId.set(scriptOutputContext_ACU.request.currentCycleId, new Map<string, ScriptStoredOutput_ACU>());
}

export function clearScriptChatOutputs_ACU(): void {
  scriptOutputContext_ACU.chat.clear();
}

export function clearAllScriptOutputs_ACU(): void {
  clearScriptRequestOutputs_ACU();
  scriptOutputContext_ACU.chat.clear();
  scriptOutputContext_ACU.session.clear();
}

onScriptRequestLifecycle_ACU((event) => {
  if (event.type === 'begin') {
    scriptOutputContext_ACU.request.currentCycleId = event.requestId;
    if (!scriptOutputContext_ACU.request.byCycleId.has(event.requestId)) {
      scriptOutputContext_ACU.request.byCycleId.set(event.requestId, new Map<string, ScriptStoredOutput_ACU>());
    }
    return;
  }
  if (event.type === 'end') {
    scriptOutputContext_ACU.request.byCycleId.delete(event.requestId);
  }
});

scriptOutputContext_ACU.request.byCycleId.set(scriptOutputContext_ACU.request.currentCycleId, new Map<string, ScriptStoredOutput_ACU>());

export {
  beginScriptRequestCycleForOutputs_ACU as beginScriptRequestCycle_ACU,
  endScriptRequestCycleForOutputs_ACU as endScriptRequestCycle_ACU,
};

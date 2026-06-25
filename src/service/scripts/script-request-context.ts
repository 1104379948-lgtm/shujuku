export interface ScriptRequestContext_ACU {
  requestId: string;
  scope?: {
    chatId?: string;
    characterId?: string;
  };
  source?: Record<string, unknown>;
}

type ScriptRequestLifecycleEvent_ACU =
  | { type: 'begin'; requestId: string; context: ScriptRequestContext_ACU }
  | { type: 'end'; requestId: string };

const scriptRequestLifecycleListeners_ACU = new Set<(event: ScriptRequestLifecycleEvent_ACU) => void>();

function createScriptRequestId_ACU(): string {
  return `request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let currentScriptRequestContext_ACU: ScriptRequestContext_ACU = {
  requestId: `request_${Date.now().toString(36)}`,
};

function cloneScriptRequestContext_ACU(context: ScriptRequestContext_ACU): ScriptRequestContext_ACU {
  return { ...context, scope: { ...(context.scope || {}) }, source: { ...(context.source || {}) } };
}

function emitScriptRequestLifecycle_ACU(event: ScriptRequestLifecycleEvent_ACU): void {
  for (const listener of scriptRequestLifecycleListeners_ACU) {
    listener(event);
  }
}

export function onScriptRequestLifecycle_ACU(listener: (event: ScriptRequestLifecycleEvent_ACU) => void): () => void {
  scriptRequestLifecycleListeners_ACU.add(listener);
  return () => scriptRequestLifecycleListeners_ACU.delete(listener);
}

export function normalizeScriptRequestId_ACU(requestId?: string): string {
  const normalized = String(requestId || '').trim();
  return normalized || currentScriptRequestContext_ACU.requestId;
}

export function getCurrentScriptRequestContext_ACU(): ScriptRequestContext_ACU {
  return cloneScriptRequestContext_ACU(currentScriptRequestContext_ACU);
}

export function getCurrentScriptRequestCycleId_ACU(): string {
  return currentScriptRequestContext_ACU.requestId;
}

export function beginScriptRequestCycle_ACU(requestId?: string, context: Omit<Partial<ScriptRequestContext_ACU>, 'requestId'> = {}): string {
  currentScriptRequestContext_ACU = {
    requestId: String(requestId || '').trim() || createScriptRequestId_ACU(),
    scope: context.scope ? { ...context.scope } : undefined,
    source: context.source ? { ...context.source } : undefined,
  };
  emitScriptRequestLifecycle_ACU({ type: 'begin', requestId: currentScriptRequestContext_ACU.requestId, context: cloneScriptRequestContext_ACU(currentScriptRequestContext_ACU) });
  return currentScriptRequestContext_ACU.requestId;
}

export function endScriptRequestCycle_ACU(requestId?: string): void {
  const targetRequestId = normalizeScriptRequestId_ACU(requestId);
  emitScriptRequestLifecycle_ACU({ type: 'end', requestId: targetRequestId });
  if (targetRequestId === currentScriptRequestContext_ACU.requestId) {
    currentScriptRequestContext_ACU = { requestId: createScriptRequestId_ACU() };
    emitScriptRequestLifecycle_ACU({ type: 'begin', requestId: currentScriptRequestContext_ACU.requestId, context: cloneScriptRequestContext_ACU(currentScriptRequestContext_ACU) });
  }
}

export function resolveScriptRequestIdFromInputs_ACU(options: {
  requestContext?: ScriptRequestContext_ACU;
  sourceContext?: Record<string, unknown>;
  eventPayload?: unknown;
  requestId?: string;
} = {}): string {
  if (options.requestContext?.requestId) return normalizeScriptRequestId_ACU(options.requestContext.requestId);
  if (typeof options.requestId === 'string' && options.requestId.trim()) return options.requestId.trim();
  const sourceRequestId = options.sourceContext?.requestId;
  if (typeof sourceRequestId === 'string' && sourceRequestId.trim()) return sourceRequestId.trim();
  const eventPayload = options.eventPayload as any;
  if (typeof eventPayload?.requestId === 'string' && eventPayload.requestId.trim()) return eventPayload.requestId.trim();
  return currentScriptRequestContext_ACU.requestId;
}

import { topLevelWindow_ACU } from '../../shared/env';
import { logWarn_ACU } from '../../shared/utils';
import { addScriptLog_ACU, findScriptByIdForRuntime_ACU, findScriptsByName_ACU, findUniqueScriptByName_ACU, getUserScriptsForRuntime_ACU, persistScriptRuntimeState_ACU } from './script-store';
import { getScriptOutput_ACU, setScriptOutput_ACU } from './script-output-context';
import { createScriptTavernFacade_ACU, getCurrentScriptScope_ACU } from './script-tavern-facade';
import { resolveScriptRequestIdFromInputs_ACU, type ScriptRequestContext_ACU } from './script-request-context';
import type { ScriptBinding_ACU, ScriptHookName_ACU, ScriptRunResult_ACU, ScriptVariableCall_ACU, UserScriptDefinition_ACU } from './script-types';

function stringifyError_ACU(error: any): string {
  return String(error?.message || error || '未知脚本错误');
}

export function stringifyScriptValue_ACU(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function isScriptInCurrentScope_ACU(script: UserScriptDefinition_ACU): boolean {
  if (script.scope?.type !== 'character') return true;
  const names = Array.isArray(script.scope.characterNames) ? script.scope.characterNames.map(name => String(name).trim()).filter(Boolean) : [];
  if (names.length === 0) return false;
  const scope = getCurrentScriptScope_ACU();
  return !!scope.characterName && names.includes(String(scope.characterName).trim());
}

function sortHookEntries_ACU(entries: Array<{ script: UserScriptDefinition_ACU; binding: ScriptBinding_ACU }>) {
  return entries.sort((a, b) => {
    const scopeDelta = (a.script.scope?.type === 'character' ? 1 : 0) - (b.script.scope?.type === 'character' ? 1 : 0);
    if (scopeDelta !== 0) return scopeDelta;
    const bindingOrderDelta = (a.binding.order ?? 100) - (b.binding.order ?? 100);
    if (bindingOrderDelta !== 0) return bindingOrderDelta;
    const scriptOrderDelta = (a.script.order ?? 100) - (b.script.order ?? 100);
    if (scriptOrderDelta !== 0) return scriptOrderDelta;
    const nameDelta = String(a.script.name || '').localeCompare(String(b.script.name || ''));
    return nameDelta || String(a.script.id).localeCompare(String(b.script.id));
  });
}

function matchesFilterValue_ACU(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (Array.isArray(actual)) return expected.some(item => actual.includes(item));
    return expected.includes(actual);
  }
  if (Array.isArray(actual)) return actual.includes(expected);
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) => matchesFilterValue_ACU((actual as any)[key], value));
  }
  return actual === expected;
}

function matchesBindingFilter_ACU(binding: ScriptBinding_ACU, eventPayload: unknown): boolean {
  const filter = binding.filter;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return true;
  const event = eventPayload && typeof eventPayload === 'object' ? eventPayload as Record<string, unknown> : {};
  return Object.entries(filter).every(([key, expected]) => matchesFilterValue_ACU(event[key], expected));
}

function getRunRequestId_ACU(options: { eventPayload?: unknown; sourceContext?: Record<string, unknown>; requestContext?: ScriptRequestContext_ACU }): string {
  return resolveScriptRequestIdFromInputs_ACU(options);
}

async function executeUserScript_ACU(script: UserScriptDefinition_ACU, ctx: any, abortController: AbortController): Promise<unknown> {
  const source = `export default async function run(ctx) {\n${script.source || ''}\n}`;
  const canUseBlobImport = typeof window !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function';
  const blob = canUseBlobImport ? new Blob([source], { type: 'text/javascript' }) : null;
  const url = blob
    ? URL.createObjectURL(blob)
    : `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod?.default !== 'function') throw new Error('脚本模块没有默认 run 函数');
    const timeoutSeconds = Number.isFinite(script.timeoutSeconds) && script.timeoutSeconds > 0 ? script.timeoutSeconds : 1;
    const timeoutMs = timeoutSeconds * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`脚本执行超时: ${timeoutSeconds}s`));
      }, timeoutMs);
    });
    const scriptPromise = Promise.resolve(mod.default(ctx));
    scriptPromise.catch(() => {});
    try {
      return await Promise.race([scriptPromise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (blob) URL.revokeObjectURL(url);
  }
}

function createAbortAwareApi_ACU(api: any, signal: AbortSignal): any {
  if (!api || typeof api !== 'object') return api;
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        if (signal.aborted) throw new Error('脚本执行已中止，拒绝继续调用 API');
        return value.apply(target, args);
      };
    },
    set(target, prop, value, receiver) {
      if (signal.aborted) throw new Error('脚本执行已中止，拒绝继续修改 API 状态');
      return Reflect.set(target, prop, value, receiver);
    },
  });
}

async function runSingleScript_ACU(script: UserScriptDefinition_ACU, options: {
  callType: 'hook' | 'variable' | 'manual';
  hook?: ScriptHookName_ACU;
  binding?: ScriptBinding_ACU;
  eventPayload?: unknown;
  sourceContext?: Record<string, unknown>;
  requestContext?: ScriptRequestContext_ACU;
  input?: unknown;
  variable?: ScriptVariableCall_ACU;
  controller?: unknown;
}): Promise<ScriptRunResult_ACU> {
  const startedAt = Date.now();
  const runId = `script_run_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = getCurrentScriptScope_ACU();
  const abortController = new AbortController();
  const requestId = getRunRequestId_ACU(options);
  const logMeta = { callType: options.callType, hook: options.hook };
  const logger = (level: 'info' | 'warn' | 'error' | 'debug') => (...args: any[]) => {
    if (abortController.signal.aborted) return;
    addScriptLog_ACU({ scriptId: script.id, scriptName: script.name, level, runId, ...logMeta, message: args.map(arg => typeof arg === 'string' ? arg : stringifyScriptValue_ACU(arg)).join(' ') });
  };
  addScriptLog_ACU({ scriptId: script.id, scriptName: script.name, level: 'debug', runId, ...logMeta, message: `开始执行: ${options.callType}${options.hook ? `/${options.hook}` : ''}` });
  try {
    const ctx = {
      apiVersion: 1,
      hook: options.hook,
      callType: options.callType,
      variable: options.variable,
      config: options.binding?.config === undefined ? {} : options.binding.config,
      input: options.input === undefined ? {} : options.input,
      event: options.eventPayload || {},
      source: options.sourceContext || options.requestContext?.source || {},
      scope,
      outputs: {
        get(key: string, outputOptions: { ttl?: 'request' | 'chat' | 'session'; defaultValue?: unknown } = {}) {
          if (abortController.signal.aborted) throw new Error('脚本执行已中止，拒绝继续读取脚本输出');
          const output = getScriptOutput_ACU(key, outputOptions.ttl, { requestId, scope });
          return output ? output.value : outputOptions.defaultValue;
        },
      },
      controller: options.controller,
      api: createAbortAwareApi_ACU((topLevelWindow_ACU as any).AutoCardUpdaterAPI, abortController.signal),
      tavern: createScriptTavernFacade_ACU(),
      log: { info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('debug') },
      signal: abortController.signal,
    };
    const value = await executeUserScript_ACU(script, ctx, abortController);
    const durationMs = Date.now() - startedAt;
    script.lastRunAt = Date.now();
    script.lastError = undefined;
    addScriptLog_ACU({ scriptId: script.id, scriptName: script.name, level: 'debug', runId, ...logMeta, durationMs, message: `执行完成: ${durationMs}ms` });
    persistScriptRuntimeState_ACU();
    return { scriptId: script.id, scriptName: script.name, success: true, value, durationMs, runId };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = stringifyError_ACU(error);
    script.lastRunAt = Date.now();
    script.lastError = message;
    addScriptLog_ACU({ scriptId: script.id, scriptName: script.name, level: 'error', runId, ...logMeta, durationMs, error: message, message });
    persistScriptRuntimeState_ACU();
    return { scriptId: script.id, scriptName: script.name, success: false, error: message, durationMs, runId };
  }
}

export async function runScriptHook_ACU(hook: ScriptHookName_ACU, options: { eventPayload?: unknown; sourceContext?: Record<string, unknown>; requestContext?: ScriptRequestContext_ACU; input?: unknown; createController?: (entry: { script: UserScriptDefinition_ACU; binding: ScriptBinding_ACU }) => { controller: unknown; commit?: () => void; rollback?: () => void } } = {}) {
  const entries = sortHookEntries_ACU(getUserScriptsForRuntime_ACU()
    .filter(script => script.enabled !== false && isScriptInCurrentScope_ACU(script))
    .flatMap(script => (script.bindings || [])
      .filter(binding => binding.enabled !== false && binding.hook === hook && matchesBindingFilter_ACU(binding, options.eventPayload))
      .map(binding => ({ script, binding }))));
  const results: ScriptRunResult_ACU[] = [];
  for (const entry of entries) {
    const controllerRuntime = options.createController?.(entry);
    const result = await runSingleScript_ACU(entry.script, { callType: 'hook', hook, binding: entry.binding, ...options, controller: controllerRuntime?.controller });
    if (result.success) controllerRuntime?.commit?.();
    else controllerRuntime?.rollback?.();
    if (result.success && entry.binding.outputKey) {
      setScriptOutput_ACU(entry.binding.outputTtl || 'request', {
        key: entry.binding.outputKey,
        value: result.value,
        scope: getCurrentScriptScope_ACU(),
      }, {
        requestId: getRunRequestId_ACU(options),
      });
    }
    results.push(result);
    if (!result.success && entry.binding.failurePolicy === 'block') {
      throw new Error(result.error || `脚本执行失败: ${entry.script.name}`);
    }
  }
  return results;
}

export async function runScriptVariable_ACU(call: ScriptVariableCall_ACU, options: { sourceContext?: Record<string, unknown>; requestContext?: ScriptRequestContext_ACU } = {}) {
  let script: UserScriptDefinition_ACU | null | undefined = null;
  if (call.scriptId) script = findScriptByIdForRuntime_ACU(call.scriptId);
  else if (call.scriptName) {
    const matches = findScriptsByName_ACU(call.scriptName);
    if (matches.length > 1) {
      addScriptLog_ACU({
        scriptId: '',
        scriptName: call.scriptName,
        level: 'error',
        message: `脚本名称不唯一: ${call.scriptName}`,
      });
      persistScriptRuntimeState_ACU();
      logWarn_ACU(`[脚本变量] 脚本名称不唯一: ${call.scriptName}`);
      return { scriptId: '', scriptName: call.scriptName, success: false, value: '', error: 'script_name_not_unique', durationMs: 0 };
    }
    script = findUniqueScriptByName_ACU(call.scriptName);
  }
  if (!script || script.enabled === false || !isScriptInCurrentScope_ACU(script)) {
    logWarn_ACU(`[脚本变量] 未找到可执行脚本: ${call.scriptId || call.scriptName || call.raw}`);
    return { scriptId: call.scriptId || '', scriptName: call.scriptName || '', success: false, value: '', error: 'script_not_found', durationMs: 0 };
  }
  return runSingleScript_ACU(script, {
    callType: 'variable',
    variable: call,
    input: call.input === undefined ? script.defaultVariableInput : call.input,
    sourceContext: options.sourceContext,
    requestContext: options.requestContext,
  });
}

export async function runScriptManual_ACU(scriptId: string, options: { input?: unknown; hook?: ScriptHookName_ACU; bindingIndex?: number; eventPayload?: unknown; sourceContext?: Record<string, unknown>; requestContext?: ScriptRequestContext_ACU; writeOutput?: boolean } = {}) {
  const script = findScriptByIdForRuntime_ACU(scriptId);
  if (!script) {
    logWarn_ACU(`[脚本手动运行] 未找到脚本: ${scriptId}`);
    return { scriptId: scriptId || '', scriptName: '', success: false, value: '', error: 'script_not_found', durationMs: 0 };
  }
  const bindings = script.bindings || [];
  const binding = Number.isInteger(options.bindingIndex) && Number(options.bindingIndex) >= 0
    ? bindings[Number(options.bindingIndex)]
    : options.hook ? bindings.find(item => item.hook === options.hook) : undefined;
  const result = await runSingleScript_ACU(script, {
    callType: 'manual',
    hook: options.hook || binding?.hook,
    binding,
    eventPayload: options.eventPayload || (options.hook || binding?.hook ? { hook: options.hook || binding?.hook, timestamp: Date.now(), manual: true } : undefined),
    input: options.input === undefined ? {} : options.input,
    sourceContext: options.sourceContext || {},
    requestContext: options.requestContext,
  });
  if (result.success && binding?.outputKey && options.writeOutput === true) {
    setScriptOutput_ACU(binding.outputTtl || 'request', {
      key: binding.outputKey,
      value: result.value,
      scope: getCurrentScriptScope_ACU(),
    }, {
      requestId: getRunRequestId_ACU({ eventPayload: options.eventPayload, sourceContext: options.sourceContext, requestContext: options.requestContext }),
    });
  }
  return result;
}

export const ScriptRunner_ACU = {
  runHook: runScriptHook_ACU,
  runVariable: runScriptVariable_ACU,
  runManual: runScriptManual_ACU,
  stringifyValue: stringifyScriptValue_ACU,
};

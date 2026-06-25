import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { ensureGlobalScriptSettings_ACU } from '../../data/repositories/profile-repo';
import type { ScriptHookName_ACU, ScriptLogEntry_ACU, UserScriptDefinition_ACU } from './script-types';

const SCRIPT_LOG_LIMIT_ACU = 300;
const SCRIPT_LOG_MESSAGE_LIMIT_ACU = 2000;
export const USER_SCRIPT_EXPORT_FORMAT_ACU = 'acu_user_script_v1';

export interface UserScriptExportPackage_ACU {
  format: typeof USER_SCRIPT_EXPORT_FORMAT_ACU;
  scripts: Partial<UserScriptDefinition_ACU>[];
}

const VALID_SCRIPT_HOOKS_ACU = new Set<ScriptHookName_ACU>([
  'chat.loaded',
  'db.loaded',
  'plot.before_task_request',
  'plot.after_task_response',
  'plot.after_stage',
  'main_reply.before_generation',
  'main_reply.after_response',
  'table_fill.before_request',
  'table_fill.after_commit',
  'plot_worldbook.before_render',
  'table_fill_worldbook.before_render',
  'manual_table_save.after_commit',
]);

const VALID_OUTPUT_TTLS_ACU = new Set(['request', 'chat', 'session']);

function cloneScriptJson_ACU<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function ensureScriptSettings_ACU(): { userScripts: UserScriptDefinition_ACU[]; scriptLogs: ScriptLogEntry_ACU[] } {
  const global = ensureGlobalScriptSettings_ACU();
  settings_ACU.userScripts = global.userScripts;
  settings_ACU.scriptLogs = global.scriptLogs;
  return { userScripts: global.userScripts as UserScriptDefinition_ACU[], scriptLogs: global.scriptLogs as ScriptLogEntry_ACU[] };
}

function createScriptId_ACU(): string {
  return `script_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertFiniteNumberField_ACU(value: unknown, field: string, options: { positive?: boolean; required?: boolean } = {}): void {
  if (typeof value === 'undefined') {
    if (options.required) throw new Error(`脚本导入缺少字段: ${field}`);
    return;
  }
  if (!Number.isFinite(value) || (options.positive && Number(value) <= 0)) {
    throw new Error(`脚本导入字段无效: ${field}`);
  }
}

function assertBooleanField_ACU(value: unknown, field: string, options: { required?: boolean } = {}): void {
  if (typeof value === 'undefined') {
    if (options.required) throw new Error(`脚本导入缺少字段: ${field}`);
    return;
  }
  if (typeof value !== 'boolean') throw new Error(`脚本导入字段无效: ${field}`);
}

function assertStringField_ACU(value: unknown, field: string, options: { required?: boolean } = {}): void {
  if (typeof value === 'undefined') {
    if (options.required) throw new Error(`脚本导入缺少字段: ${field}`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`脚本导入字段无效: ${field}`);
}

function normalizeBindingTarget_ACU(target: any) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const normalized: { presetName?: string; stage?: number; taskId?: string } = {};
  if (typeof target.presetName !== 'undefined') normalized.presetName = String(target.presetName || '').trim();
  if (typeof target.stage !== 'undefined') {
    const stage = Number(target.stage);
    normalized.stage = Number.isFinite(stage) && stage > 0 ? Math.trunc(stage) : NaN;
  }
  if (typeof target.taskId !== 'undefined') normalized.taskId = String(target.taskId || '').trim();
  return normalized;
}

function validateBindingTarget_ACU(binding: any, prefix: string, hook: string): void {
  const target = binding.target;
  const isPlotTaskHook = hook === 'plot.before_task_request' || hook === 'plot.after_task_response';
  const isPlotStageHook = hook === 'plot.after_stage';
  if (!isPlotTaskHook && !isPlotStageHook) {
    if (typeof target !== 'undefined') {
      if (!isPlainObject_ACU(target)) throw new Error(`脚本导入字段无效: ${prefix}.target`);
      const allowedKeys = new Set(['presetName', 'stage', 'taskId']);
      for (const key of Object.keys(target as Record<string, unknown>)) {
        if (!allowedKeys.has(key)) throw new Error(`脚本导入字段无效: ${prefix}.target.${key}`);
      }
    }
    return;
  }

  if (!isPlainObject_ACU(target)) throw new Error(`脚本导入缺少字段: ${prefix}.target`);
  const allowedKeys = new Set(['presetName', 'stage', 'taskId']);
  for (const key of Object.keys(target as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) throw new Error(`脚本导入字段无效: ${prefix}.target.${key}`);
  }
  const normalized = normalizeBindingTarget_ACU(target);
  if (!normalized?.presetName) throw new Error(`脚本导入缺少字段: ${prefix}.target.presetName`);
  if (!Number.isFinite(normalized.stage) || Number(normalized.stage) <= 0) throw new Error(`脚本导入字段无效: ${prefix}.target.stage`);
  if (isPlotTaskHook && !normalized.taskId) throw new Error(`脚本导入缺少字段: ${prefix}.target.taskId`);
}

function assertSaveResult_ACU(result: unknown): void {
  if (result && typeof result === 'object' && (result as any).saved === false) {
    throw new Error(`脚本配置保存失败: ${(result as any).code || (result as any).reason || 'unknown'}`);
  }
}

function validateImportScope_ACU(scope: unknown, index: number): void {
  if (typeof scope === 'undefined') throw new Error(`脚本导入缺少字段: scripts[${index}].scope`);
  if (!isPlainObject_ACU(scope)) throw new Error(`脚本导入字段无效: scripts[${index}].scope`);
  const allowedKeys = new Set(['type', 'characterNames']);
  for (const key of Object.keys(scope as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) throw new Error(`脚本导入字段无效: scripts[${index}].scope.${key}`);
  }
  const type = (scope as any).type;
  if (type !== 'global' && type !== 'character') throw new Error(`脚本导入字段无效: scripts[${index}].scope.type`);
  if (typeof (scope as any).characterNames !== 'undefined') {
    if (!Array.isArray((scope as any).characterNames)) throw new Error(`脚本导入字段无效: scripts[${index}].scope.characterNames`);
    if (!(scope as any).characterNames.every((item: unknown) => typeof item === 'string')) throw new Error(`脚本导入字段无效: scripts[${index}].scope.characterNames`);
  }
  if (type === 'character') {
    const names = Array.isArray((scope as any).characterNames) ? (scope as any).characterNames.map((item: unknown) => String(item).trim()).filter(Boolean) : [];
    if (names.length === 0) throw new Error(`脚本导入字段无效: scripts[${index}].scope.characterNames`);
  }
}

function validateImportBinding_ACU(binding: unknown, scriptIndex: number, bindingIndex: number): void {
  const prefix = `scripts[${scriptIndex}].bindings[${bindingIndex}]`;
  if (!isPlainObject_ACU(binding)) throw new Error(`脚本导入字段无效: ${prefix}`);
  const allowedKeys = new Set(['hook', 'enabled', 'target', 'order', 'config', 'outputKey', 'outputTtl', 'failurePolicy']);
  for (const key of Object.keys(binding as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) throw new Error(`脚本导入字段无效: ${prefix}.${key}`);
  }
  const hook = String((binding as any).hook || '').trim();
  if (!VALID_SCRIPT_HOOKS_ACU.has(hook as ScriptHookName_ACU)) throw new Error(`脚本导入字段无效: ${prefix}.hook`);
  validateBindingTarget_ACU(binding, prefix, hook);
  assertBooleanField_ACU((binding as any).enabled, `${prefix}.enabled`, { required: true });
  assertFiniteNumberField_ACU((binding as any).order, `${prefix}.order`);
  assertStringField_ACU((binding as any).outputKey, `${prefix}.outputKey`);
  if (typeof (binding as any).outputTtl !== 'undefined' && !VALID_OUTPUT_TTLS_ACU.has((binding as any).outputTtl)) {
    throw new Error(`脚本导入字段无效: ${prefix}.outputTtl`);
  }
  if (typeof (binding as any).failurePolicy !== 'undefined' && !['continue', 'block'].includes((binding as any).failurePolicy)) {
    throw new Error(`脚本导入字段无效: ${prefix}.failurePolicy`);
  }
  cloneScriptJson_ACU((binding as any).config);
}

function validateImportScript_ACU(script: unknown, index: number): asserts script is Partial<UserScriptDefinition_ACU> {
  const prefix = `scripts[${index}]`;
  if (!isPlainObject_ACU(script)) throw new Error(`脚本导入字段无效: ${prefix}`);
  assertStringField_ACU((script as any).name, `${prefix}.name`, { required: true });
  assertStringField_ACU((script as any).description, `${prefix}.description`);
  assertBooleanField_ACU((script as any).enabled, `${prefix}.enabled`, { required: true });
  assertFiniteNumberField_ACU((script as any).version, `${prefix}.version`);
  if (typeof (script as any).language === 'undefined') throw new Error(`脚本导入缺少字段: ${prefix}.language`);
  if ((script as any).language !== 'javascript') throw new Error(`脚本导入字段无效: ${prefix}.language`);
  assertStringField_ACU((script as any).source, `${prefix}.source`, { required: true });
  assertFiniteNumberField_ACU((script as any).order, `${prefix}.order`, { required: true });
  assertFiniteNumberField_ACU((script as any).timeoutSeconds, `${prefix}.timeoutSeconds`, { positive: true, required: true });
  assertFiniteNumberField_ACU((script as any).createdAt, `${prefix}.createdAt`);
  assertFiniteNumberField_ACU((script as any).updatedAt, `${prefix}.updatedAt`);
  validateImportScope_ACU((script as any).scope, index);
  if (typeof (script as any).bindings === 'undefined') throw new Error(`脚本导入缺少字段: ${prefix}.bindings`);
  if (!Array.isArray((script as any).bindings)) throw new Error(`脚本导入字段无效: ${prefix}.bindings`);
  (script as any).bindings.forEach((binding: unknown, bindingIndex: number) => validateImportBinding_ACU(binding, index, bindingIndex));
  cloneScriptJson_ACU((script as any).defaultVariableInput);
}

export function validateUserScriptImportItem_ACU(script: unknown, index = 0): { valid: true } | { valid: false; error: string } {
  try {
    validateImportScript_ACU(script, index);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: String((error as any)?.message || error) };
  }
}

function createStoredUserScript_ACU(script: Partial<UserScriptDefinition_ACU>, options: { preserveIds?: boolean } = {}): UserScriptDefinition_ACU {
  const now = Date.now();
  const scope = script.scope?.type === 'character'
    ? { type: 'character' as const, characterNames: [...(script.scope.characterNames || [])] }
    : { type: 'global' as const };
  const bindings = (script.bindings || []).map(binding => ({
    hook: binding.hook,
    enabled: binding.enabled,
    target: cloneScriptJson_ACU(normalizeBindingTarget_ACU((binding as any).target)),
    order: binding.order,
    config: cloneScriptJson_ACU(binding.config),
    outputKey: binding.outputKey,
    outputTtl: binding.outputTtl,
    failurePolicy: binding.failurePolicy,
  }));
  return {
    id: options.preserveIds && script.id ? String(script.id) : createScriptId_ACU(),
    name: String(script.name || '').trim(),
    description: script.description,
    enabled: script.enabled === true,
    version: Number.isFinite(script.version) ? Number(script.version) : 1,
    language: 'javascript',
    source: String(script.source || ''),
    bindings: cloneScriptJson_ACU(bindings),
    scope: cloneScriptJson_ACU(scope),
    order: Number(script.order),
    timeoutSeconds: Number(script.timeoutSeconds),
    createdAt: Number.isFinite(script.createdAt) ? Number(script.createdAt) : now,
    updatedAt: now,
    lastRunAt: script.lastRunAt,
    lastError: script.lastError,
    defaultVariableInput: cloneScriptJson_ACU(script.defaultVariableInput),
  };
}

export function getUserScripts_ACU(): UserScriptDefinition_ACU[] {
  return cloneScriptJson_ACU(ensureScriptSettings_ACU().userScripts);
}

export function getUserScriptsForRuntime_ACU(): UserScriptDefinition_ACU[] {
  return ensureScriptSettings_ACU().userScripts;
}

export function getScriptLogs_ACU(scriptId?: string): ScriptLogEntry_ACU[] {
  const logs = ensureScriptSettings_ACU().scriptLogs;
  return cloneScriptJson_ACU(scriptId ? logs.filter(log => log.scriptId === scriptId) : logs);
}

export function addScriptLog_ACU(entry: Omit<ScriptLogEntry_ACU, 'id' | 'timestamp'> & { timestamp?: number }): void {
  const state = ensureScriptSettings_ACU();
  const message = String(entry.message || '');
  state.scriptLogs.push({
    ...entry,
    id: `script_log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp || Date.now(),
    message: message.length > SCRIPT_LOG_MESSAGE_LIMIT_ACU ? `${message.slice(0, SCRIPT_LOG_MESSAGE_LIMIT_ACU)}...` : message,
  });
  if (state.scriptLogs.length > SCRIPT_LOG_LIMIT_ACU) {
    state.scriptLogs.splice(0, state.scriptLogs.length - SCRIPT_LOG_LIMIT_ACU);
  }
}

export function persistScriptRuntimeState_ACU(): void {
  assertSaveResult_ACU(saveSettings_ACU());
}

export function saveUserScripts_ACU(scripts: UserScriptDefinition_ACU[], persist = true): void {
  scripts.forEach((script, index) => validateImportScript_ACU(script, index));
  const nextScripts = cloneScriptJson_ACU(scripts);
  validateScriptOutputKeys_ACU(nextScripts);
  const state = ensureScriptSettings_ACU();
  state.userScripts.splice(0, state.userScripts.length, ...nextScripts);
  if (persist) assertSaveResult_ACU(saveSettings_ACU());
}

export function upsertUserScript_ACU(script: UserScriptDefinition_ACU, persist = true): UserScriptDefinition_ACU {
  validateImportScript_ACU(script, 0);
  const scripts = [...getUserScriptsForRuntime_ACU()];
  const saved = createStoredUserScript_ACU(script, { preserveIds: !!script.id });
  const index = scripts.findIndex(item => item.id === saved.id);
  if (index >= 0) scripts[index] = saved;
  else scripts.push(saved);
  saveUserScripts_ACU(scripts, persist);
  return saved;
}

export function deleteUserScript_ACU(scriptId: string, persist = true): boolean {
  const scripts = getUserScriptsForRuntime_ACU();
  const next = scripts.filter(script => script.id !== scriptId);
  if (next.length === scripts.length) return false;
  saveUserScripts_ACU(next, persist);
  return true;
}

export function findScriptById_ACU(scriptId: string): UserScriptDefinition_ACU | undefined {
  const script = getUserScriptsForRuntime_ACU().find(script => script.id === scriptId);
  return script ? cloneScriptJson_ACU(script) : undefined;
}

export function findScriptByIdForRuntime_ACU(scriptId: string): UserScriptDefinition_ACU | undefined {
  return getUserScriptsForRuntime_ACU().find(script => script.id === scriptId);
}

export function findUniqueScriptByName_ACU(name: string): UserScriptDefinition_ACU | null {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;
  const matches = getUserScriptsForRuntime_ACU().filter(script => script.name === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

export function findScriptsByName_ACU(name: string): UserScriptDefinition_ACU[] {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return [];
  return getUserScriptsForRuntime_ACU().filter(script => script.name === normalizedName);
}

function createUniqueScriptName_ACU(baseName: string, existingNames: Set<string>): string {
  const normalizedBase = String(baseName || '未命名脚本').trim() || '未命名脚本';
  if (!existingNames.has(normalizedBase)) {
    existingNames.add(normalizedBase);
    return normalizedBase;
  }
  let index = 2;
  while (existingNames.has(`${normalizedBase} (${index})`)) index++;
  const nextName = `${normalizedBase} (${index})`;
  existingNames.add(nextName);
  return nextName;
}

export function exportUserScripts_ACU(scriptIds?: string[]): UserScriptExportPackage_ACU {
  const idSet = Array.isArray(scriptIds) && scriptIds.length > 0 ? new Set(scriptIds.map(String)) : null;
  const scripts = getUserScripts_ACU()
    .filter(script => !idSet || idSet.has(script.id))
    .map(script => ({
      name: script.name,
      description: script.description,
      enabled: script.enabled,
      language: script.language,
      source: script.source,
      scope: cloneScriptJson_ACU(script.scope),
      bindings: cloneScriptJson_ACU(script.bindings),
      defaultVariableInput: cloneScriptJson_ACU(script.defaultVariableInput),
      timeoutSeconds: script.timeoutSeconds,
      order: script.order,
    }));
  return { format: USER_SCRIPT_EXPORT_FORMAT_ACU, scripts };
}

export function importUserScripts_ACU(payload: unknown, persist = true): UserScriptDefinition_ACU[] {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || typeof parsed !== 'object' || (parsed as any).format !== USER_SCRIPT_EXPORT_FORMAT_ACU || !Array.isArray((parsed as any).scripts)) {
    throw new Error('脚本导入格式无效');
  }
  ((parsed as any).scripts as unknown[]).forEach(validateImportScript_ACU);

  const existing = [...getUserScripts_ACU()];
  const existingNames = new Set(existing.map(script => script.name));
  const imported = ((parsed as any).scripts as Partial<UserScriptDefinition_ACU>[]).map(script => {
    const saved = createStoredUserScript_ACU(script, { preserveIds: false });
    saved.name = createUniqueScriptName_ACU(saved.name, existingNames);
    saved.createdAt = Date.now();
    saved.updatedAt = Date.now();
    return saved;
  });
  saveUserScripts_ACU([...existing, ...imported], persist);
  return imported;
}

export function validateScriptOutputKeys_ACU(scripts = getUserScripts_ACU()): void {
  const seenGlobal = new Map<string, string>();
  const seenByCharacter = new Map<string, string>();
  const characterKeysByOutput = new Map<string, Set<string>>();
  for (const script of scripts) {
    const scope = script.scope;
    for (const binding of script.bindings || []) {
      const outputKey = String(binding?.outputKey || '').trim();
      if (!outputKey) continue;
      if (scope.type !== 'character') {
        if (seenGlobal.has(outputKey) || characterKeysByOutput.has(outputKey)) {
          throw new Error(`脚本输出 key 重复: ${outputKey}`);
        }
        seenGlobal.set(outputKey, script.id);
        continue;
      }
      if (seenGlobal.has(outputKey)) throw new Error(`脚本输出 key 重复: ${outputKey}`);
      const characterNames = (scope.characterNames || []).map(name => String(name).trim()).filter(Boolean);
      const outputCharacters = characterKeysByOutput.get(outputKey) || new Set<string>();
      for (const characterName of characterNames) {
        const scopeKey = `${characterName}:${outputKey}`;
        if (seenByCharacter.has(scopeKey)) {
          throw new Error(`脚本输出 key 重复: ${outputKey}`);
        }
        outputCharacters.add(characterName);
        seenByCharacter.set(scopeKey, script.id);
      }
      if (outputCharacters.size > 0) {
        characterKeysByOutput.set(outputKey, outputCharacters);
      } else if (seenGlobal.has(outputKey)) {
        throw new Error(`脚本输出 key 重复: ${outputKey}`);
      }
    }
  }
}

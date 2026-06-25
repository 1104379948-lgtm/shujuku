<template>
  <section class="acu-v2-script-page">
    <AcuPanel
      title="脚本管理"
      description="管理脚本、触发时机和执行日志。"
    >
      <template #actions>
        <AcuButton size="sm" @click="triggerImport">
          <i class="fa-solid fa-upload"></i>
          导入脚本包
        </AcuButton>
        <AcuButton size="sm" :disabled="!scripts.length" @click="exportAllScripts">
          <i class="fa-solid fa-download"></i>
          导出全部
        </AcuButton>
        <AcuButton size="sm" variant="primary" @click="createScript">
          <i class="fa-solid fa-plus"></i>
          新增脚本
        </AcuButton>
      </template>

      <input ref="importFileInput" class="acu-v2-script-page__file-input" type="file" accept=".json,application/json" @change="handleImportFile" />

      <section v-if="importPreview" class="acu-v2-script-page__import-preview" aria-label="脚本导入预览">
        <div class="acu-v2-script-page__import-head">
          <div>
            <strong>导入预览</strong>
            <p class="acu-v2-script-page__hint">格式 {{ importPreview.format }}，共 {{ importPreview.scripts.length }} 个脚本。</p>
          </div>
          <div class="acu-v2-script-page__toolbar">
            <AcuButton size="sm" variant="primary" :disabled="importPreviewHasErrors" @click="confirmImport">确认导入</AcuButton>
            <AcuButton size="sm" @click="clearImportPreview">取消</AcuButton>
          </div>
        </div>
        <div v-for="(item, index) in importPreviewItems" :key="index" class="acu-v2-script-page__import-item" :class="{ 'acu-v2-script-page__import-item--invalid': !item.valid }">
          <strong>{{ item.name }}</strong>
          <span v-if="!item.valid" class="acu-v2-script-page__error">{{ item.error }}</span>
          <span>{{ item.enabled ? '启用' : '禁用' }} · {{ item.scopeLabel }}</span>
          <span>变量：<code>{{ item.variableExample }}</code></span>
          <span>挂载点：{{ item.hooks }}</span>
          <span>输出 key：{{ item.outputKeys }}</span>
          <pre>{{ item.sourceSummary }}</pre>
        </div>
      </section>

      <div class="acu-v2-script-page__layout">
        <aside class="acu-v2-script-page__list" aria-label="脚本列表">
          <div v-if="!scripts.length" class="acu-v2-script-page__empty">暂无脚本，点击“新增脚本”开始。</div>
          <section v-for="group in scriptGroups" :key="group.key" class="acu-v2-script-page__script-group">
            <h3 class="acu-v2-script-page__script-group-title">{{ group.title }}</h3>
            <button
              v-for="script in group.scripts"
              :key="script.id"
              type="button"
              class="acu-v2-script-page__script-card"
              :class="{ 'acu-v2-script-page__script-card--active': script.id === selectedId }"
              @click="selectScript(script.id)"
            >
              <span class="acu-v2-script-page__script-title">{{ script.name }}</span>
              <span class="acu-v2-script-page__script-meta">
                {{ script.enabled ? '启用' : '禁用' }} · {{ scopeLabel(script) }} · order {{ script.order }}
              </span>
              <span class="acu-v2-script-page__script-meta">{{ bindingSummary(script) }}</span>
              <span class="acu-v2-script-page__script-meta">输出 key：{{ outputKeySummary(script) }}</span>
              <span class="acu-v2-script-page__script-meta">ID: {{ script.id }}</span>
              <span v-if="script.lastRunAt" class="acu-v2-script-page__script-meta">最近运行 {{ formatTime(script.lastRunAt) }}</span>
              <span v-if="script.lastError" class="acu-v2-script-page__script-error">{{ script.lastError }}</span>
            </button>
          </section>
        </aside>

        <main v-if="draft" class="acu-v2-script-page__editor" aria-label="脚本编辑页">
          <div class="acu-v2-script-page__toolbar">
            <AcuButton variant="primary" @click="saveDraft">保存脚本</AcuButton>
            <AcuButton @click="duplicateDraft">复制</AcuButton>
            <AcuButton @click="exportSelectedScript">导出当前</AcuButton>
            <AcuButton @click="moveDraft(-1)">上移</AcuButton>
            <AcuButton @click="moveDraft(1)">下移</AcuButton>
            <AcuButton variant="danger" @click="deleteDraft">删除</AcuButton>
          </div>

          <div class="acu-v2-script-page__grid">
            <label class="acu-v2-script-page__field">
              <span>名称</span>
              <input v-model="draft.name" type="text" />
            </label>
            <label class="acu-v2-script-page__field">
              <span>排序</span>
              <input v-model.number="draft.order" type="number" />
            </label>
            <label class="acu-v2-script-page__field">
              <span>超时 秒</span>
              <input v-model.number="draft.timeoutSeconds" type="number" min="0.1" step="0.1" />
            </label>
            <label class="acu-v2-script-page__checkbox">
              <input v-model="draft.enabled" type="checkbox" />
              <span>启用脚本</span>
            </label>
          </div>

          <label class="acu-v2-script-page__field">
            <span>描述</span>
            <input v-model="draft.description" type="text" />
          </label>

          <section class="acu-v2-script-page__section">
            <h3>作用域</h3>
            <div class="acu-v2-script-page__inline">
              <label class="acu-v2-script-page__radio"><input v-model="draft.scope.type" type="radio" value="global" /> 全局</label>
              <label class="acu-v2-script-page__radio"><input v-model="draft.scope.type" type="radio" value="character" /> 角色卡</label>
            </div>
            <label v-if="draft.scope.type === 'character'" class="acu-v2-script-page__field">
              <span>角色卡名称（逗号分隔）</span>
              <input :value="characterNamesText" type="text" @input="setCharacterNames(($event.target as HTMLInputElement).value)" />
            </label>
            <div v-if="draft.scope.type === 'character'" class="acu-v2-script-page__toolbar">
              <AcuButton size="sm" @click="bindCurrentCharacter">绑定当前角色</AcuButton>
              <span class="acu-v2-script-page__hint">当前角色卡名称：{{ currentCharacterName || '未读取到' }}</span>
            </div>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>函数体源码</h3>
            <textarea v-model="draft.source" class="acu-v2-script-page__source" spellcheck="false" placeholder="ctx.log.info('hello');&#10;return 'hello';"></textarea>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>默认变量输入 JSON</h3>
            <p class="acu-v2-script-page__hint">用于未显式传入 input 的 {[script ...]} 调用，也会随脚本包导入导出。</p>
            <textarea v-model="defaultVariableInputText" rows="3" placeholder="例如 {&quot;limit&quot;:5}"></textarea>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>绑定挂载点</h3>
            <div class="acu-v2-script-page__binding-actions">
              <AcuButton size="sm" @click="addBinding">新增绑定</AcuButton>
            </div>
            <div v-if="!draft.bindings.length" class="acu-v2-script-page__empty">未绑定挂载点；仍可通过变量或手动运行执行。</div>
            <div v-for="(binding, index) in draft.bindings" :key="index" class="acu-v2-script-page__binding">
              <label class="acu-v2-script-page__binding-field acu-v2-script-page__binding-field--hook">
                <span>触发时机</span>
                <select v-model="binding.hook">
                  <option v-for="hook in hookOptions" :key="hook" :value="hook">{{ hook }}</option>
                </select>
              </label>
              <label class="acu-v2-script-page__binding-field acu-v2-script-page__binding-field--enabled">
                <span>启用</span>
                <input v-model="binding.enabled" type="checkbox" />
              </label>
              <label class="acu-v2-script-page__binding-field">
                <span>顺序</span>
                <input v-model.number="binding.order" type="number" />
              </label>
              <label class="acu-v2-script-page__binding-field">
                <span>输出键</span>
                <input v-model="binding.outputKey" type="text" placeholder="可留空" />
              </label>
              <label class="acu-v2-script-page__binding-field">
                <span>输出保留</span>
                <select v-model="binding.outputTtl">
                  <option value="request">本次请求</option>
                  <option value="chat">当前聊天</option>
                  <option value="session">当前会话</option>
                </select>
              </label>
              <label class="acu-v2-script-page__binding-field">
                <span>失败策略</span>
                <select v-model="binding.failurePolicy">
                  <option value="continue">记录错误后继续</option>
                  <option value="block">阻断当前流程</option>
                </select>
              </label>
              <div v-if="isPlotBinding(binding)" class="acu-v2-script-page__plot-filter">
                <label>
                  <span>剧情预设名 presetName</span>
                  <select :value="plotFilterValue(binding, 'presetName')" @change="setPlotFilterValue(binding, 'presetName', ($event.target as HTMLSelectElement).value)">
                    <option value="">不限制预设</option>
                    <option v-for="option in presetOptionsForBinding(binding)" :key="option" :value="option">{{ option }}</option>
                  </select>
                </label>
                <label v-if="binding.hook === 'plot.before_task_request' || binding.hook === 'plot.after_task_response'">
                  <span>任务 ID taskId</span>
                  <select :value="plotFilterValue(binding, 'taskId')" @change="setPlotFilterValue(binding, 'taskId', ($event.target as HTMLSelectElement).value)">
                    <option value="">不限制任务</option>
                    <option v-for="task in taskOptionsForBinding(binding)" :key="task.id" :value="task.id">{{ task.label }}</option>
                  </select>
                </label>
                <label v-if="binding.hook === 'plot.after_stage'">
                  <span>阶段 stage</span>
                  <select :value="plotFilterValue(binding, 'stage')" @change="setPlotFilterValue(binding, 'stage', ($event.target as HTMLSelectElement).value)">
                    <option value="">不限制阶段</option>
                    <option v-for="stage in stageOptionsForBinding(binding)" :key="stage" :value="String(stage)">stage {{ stage }}</option>
                  </select>
                </label>
                <p class="acu-v2-script-page__hint">预设和全部脚本可以分别导出导入；这里会写入 filter，运行时按 presetName + taskId/stage 匹配。</p>
              </div>
              <label class="acu-v2-script-page__binding-field acu-v2-script-page__binding-field--json">
                <span>配置</span>
                <textarea v-model="bindingJsonTexts[index].config" rows="2" placeholder="例如 {&quot;limit&quot;:5}"></textarea>
              </label>
              <label class="acu-v2-script-page__binding-field acu-v2-script-page__binding-field--json">
                <span>过滤</span>
                <textarea v-model="bindingJsonTexts[index].filter" rows="2" placeholder="例如 {&quot;presetName&quot;:&quot;日常&quot;}"></textarea>
              </label>
              <AcuButton size="sm" variant="danger" @click="removeBinding(index)">移除</AcuButton>
            </div>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>怎么在提示词里用</h3>
            <div class="acu-v2-script-page__example-list">
              <div class="acu-v2-script-page__example-item">
                <strong>主动运行这个脚本</strong>
                <code>{[script "{{ draft.name }}"]}</code>
              </div>
              <div class="acu-v2-script-page__example-item">
                <strong>主动运行并传入 input</strong>
                <code>{[script id="{{ draft.id }}" input={"limit":5}]}</code>
              </div>
              <div v-if="firstOutputKey" class="acu-v2-script-page__example-item">
                <strong>读取挂载点输出</strong>
                <code>{[script_output "{{ firstOutputKey }}"]}</code>
              </div>
            </div>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>手动运行</h3>
            <label class="acu-v2-script-page__field">
              <span>测试挂载点</span>
              <select v-model="manualBindingIndex">
                <option value="">不指定挂载点</option>
                <option v-for="(binding, index) in draft.bindings" :key="`${binding.hook}-${index}`" :value="String(index)">{{ index + 1 }}. {{ binding.hook }}</option>
              </select>
            </label>
            <textarea v-model="manualInputText" rows="4" placeholder="输入 JSON，例如 {&quot;limit&quot;:5}"></textarea>
            <p v-if="jsonError" class="acu-v2-script-page__error">{{ jsonError }}</p>
            <div class="acu-v2-script-page__toolbar">
              <AcuButton variant="primary" :loading="manualRunning" @click="runManual">保存并手动运行</AcuButton>
            </div>
            <pre v-if="manualResult" class="acu-v2-script-page__result">{{ manualResult }}</pre>
          </section>

          <section class="acu-v2-script-page__section">
            <h3>执行日志</h3>
            <div v-if="!selectedLogGroups.length" class="acu-v2-script-page__empty">暂无日志</div>
            <div v-for="group in selectedLogGroups" :key="group.runId" class="acu-v2-script-page__log-group">
              <div class="acu-v2-script-page__log-group-head">
                <strong>{{ group.runId }}</strong>
                <span>{{ group.callLabel }}</span>
                <span>{{ formatTime(group.startedAt) }}</span>
                <span v-if="group.durationMs !== undefined">{{ group.durationMs }}ms</span>
                <span v-if="group.error" class="acu-v2-script-page__error">{{ group.error }}</span>
              </div>
              <div v-for="log in group.logs" :key="log.id" class="acu-v2-script-page__log-row">
                <span>{{ formatTime(log.timestamp) }}</span>
                <strong>{{ log.level }}</strong>
                <span>{{ logCallLabel(log) }}</span>
                <code>{{ log.message }}</code>
              </div>
            </div>
          </section>
        </main>
      </div>
    </AcuPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import {
  deleteUserScript_ACU,
  exportUserScripts_ACU,
  getScriptLogs_ACU,
  getUserScripts_ACU,
  importUserScripts_ACU,
  runScriptManual_ACU,
  saveUserScripts_ACU,
  stringifyScriptValue_ACU,
  upsertUserScript_ACU,
  USER_SCRIPT_EXPORT_FORMAT_ACU,
  validateUserScriptImportItem_ACU,
  type ScriptBinding_ACU,
  type ScriptHookName_ACU,
  type ScriptLogEntry_ACU,
  type UserScriptExportPackage_ACU,
  type UserScriptDefinition_ACU,
} from '../../service/scripts'; // arch-ok: script manager is a tool page for editing persisted user scripts
import { topLevelWindow_ACU } from '../../shared/env';
import { usePlotPresetStore } from '../stores/plot-preset-store';

const hookOptions: ScriptHookName_ACU[] = [
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
];

const scripts = ref<UserScriptDefinition_ACU[]>([]);
const logs = ref<ScriptLogEntry_ACU[]>([]);
const selectedId = ref('');
const draft = ref<UserScriptDefinition_ACU | null>(null);
const defaultVariableInputText = ref('');
const bindingJsonTexts = ref<Array<{ config: string; filter: string }>>([]);
const manualInputText = ref('');
const manualBindingIndex = ref<number | ''>('');
const jsonError = ref('');
const manualResult = ref('');
const manualRunning = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const importPreview = ref<UserScriptExportPackage_ACU | null>(null);
const currentCharacterName = ref('');
const plotPresetStore = usePlotPresetStore();

const selectedLogs = computed(() => logs.value.filter(log => log.scriptId === selectedId.value).slice().reverse());
const selectedLogGroups = computed(() => {
  const groups = new Map<string, ScriptLogEntry_ACU[]>();
  for (const log of logs.value.filter(item => item.scriptId === selectedId.value)) {
    const runId = log.runId || `log_${log.id}`;
    const group = groups.get(runId) || [];
    group.push(log);
    groups.set(runId, group);
  }
  return Array.from(groups.entries()).map(([runId, groupLogs]) => {
    const ordered = groupLogs.slice().sort((a, b) => a.timestamp - b.timestamp);
    const last = ordered[ordered.length - 1];
    const first = ordered[0];
    return {
      runId,
      logs: ordered,
      startedAt: first?.timestamp,
      durationMs: ordered.find(log => typeof log.durationMs === 'number')?.durationMs,
      error: ordered.find(log => log.error)?.error,
      callLabel: [first?.callType, first?.hook].filter(Boolean).join(' · ') || 'log',
      lastAt: last?.timestamp || first?.timestamp || 0,
    };
  }).sort((a, b) => b.lastAt - a.lastAt);
});
const characterNamesText = computed(() => (draft.value?.scope.characterNames || []).join(', '));
const firstOutputKey = computed(() => draft.value?.bindings.find(binding => binding.outputKey)?.outputKey || '');
const scriptGroups = computed(() => {
  const groups: Array<{ key: string; title: string; scripts: UserScriptDefinition_ACU[] }> = [];
  const globalScripts = scripts.value.filter(script => script.scope?.type !== 'character');
  if (globalScripts.length) groups.push({ key: 'global', title: '全局脚本', scripts: globalScripts });
  const byCharacter = new Map<string, UserScriptDefinition_ACU[]>();
  for (const script of scripts.value) {
    if (script.scope?.type !== 'character') continue;
    const names = (script.scope.characterNames || []).map(name => String(name).trim()).filter(Boolean);
    for (const name of names) {
      const list = byCharacter.get(name) || [];
      list.push(script);
      byCharacter.set(name, list);
    }
  }
  Array.from(byCharacter.keys()).sort((a, b) => a.localeCompare(b)).forEach(name => {
    groups.push({ key: `character:${name}`, title: `角色卡：${name}`, scripts: byCharacter.get(name) || [] });
  });
  return groups;
});
const importPreviewItems = computed(() => {
  const existingNames = new Set(scripts.value.map(script => script.name));
  return (importPreview.value?.scripts || []).map(script => {
  const validation = validateUserScriptImportItem_ACU(script, 0);
  const bindings = Array.isArray(script.bindings) ? script.bindings : [];
  const outputKeys = bindings.map(binding => binding?.outputKey).filter(Boolean).join(', ') || '无';
  const hooks = bindings.map(binding => binding?.hook).filter(Boolean).join(', ') || '无挂载点';
  const sourceName = String(script.name || '未命名脚本').trim() || '未命名脚本';
  const name = createPreviewUniqueName(sourceName, existingNames);
  const source = String(script.source || '');
  return {
    valid: validation.valid,
    error: validation.valid ? '' : validation.error,
    name,
    sourceName,
    enabled: script.enabled === true,
    scopeLabel: script.scope?.type === 'character' ? '角色卡' : '全局',
    variableExample: `{[script "${name.replace(/"/g, '\\"')}"]}`,
    hooks,
    outputKeys,
    sourceSummary: source ? source.slice(0, 300) : '(空源码)',
  };
  });
});
const importPreviewHasErrors = computed(() => importPreviewItems.value.some(item => !item.valid));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function refresh(): void {
  plotPresetStore.refreshFromSettings();
  scripts.value = getUserScripts_ACU().slice().sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  logs.value = getScriptLogs_ACU();
  currentCharacterName.value = resolveCurrentCharacterName_ACU();
  if (!selectedId.value && scripts.value[0]) selectedId.value = scripts.value[0].id;
  if (selectedId.value && !scripts.value.some(script => script.id === selectedId.value)) selectedId.value = scripts.value[0]?.id || '';
  draft.value = selectedId.value ? clone(scripts.value.find(script => script.id === selectedId.value) || null) : null;
  syncJsonTextFromDraft();
}

function resolveCurrentCharacterName_ACU(): string {
  try {
    const context = (topLevelWindow_ACU as any)?.SillyTavern?.getContext?.();
    const character = context?.characters?.[context?.characterId];
    return String(character?.name || context?.name2 || '').trim();
  } catch (_) {
    return '';
  }
}

function showScriptManagerError_ACU(prefix: string, error: unknown): void {
  const message = `${prefix}：${String((error as any)?.message || error)}`;
  jsonError.value = message;
  manualResult.value = message;
  alert(message);
}

function createDefaultScript(): UserScriptDefinition_ACU {
  const now = Date.now();
  return {
    id: '',
    name: '新脚本',
    description: '',
    enabled: true,
    version: 1,
    language: 'javascript',
    source: "ctx.log.info('hello');\nreturn 'hello';",
    bindings: [],
    scope: { type: 'global' },
    order: 100,
    timeoutSeconds: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function createScript(): void {
  try {
    const saved = upsertUserScript_ACU(createDefaultScript(), true);
    selectedId.value = saved.id;
    refresh();
  } catch (error) {
    showScriptManagerError_ACU('新增脚本失败', error);
  }
}

function selectScript(id: string): void {
  selectedId.value = id;
  jsonError.value = '';
  manualResult.value = '';
  refresh();
}

function saveDraft(): UserScriptDefinition_ACU | null {
  if (!draft.value) return null;
  if (!applyJsonTextToDraft()) return null;
  try {
    const saved = upsertUserScript_ACU(draft.value, true);
    selectedId.value = saved.id;
    refresh();
    return saved;
  } catch (error) {
    showScriptManagerError_ACU('保存脚本失败', error);
    return null;
  }
}

function deleteDraft(): void {
  if (!draft.value) return;
  if (!confirm(`删除脚本「${draft.value.name}」？`)) return;
  try {
    deleteUserScript_ACU(draft.value.id, true);
    selectedId.value = '';
    refresh();
  } catch (error) {
    showScriptManagerError_ACU('删除脚本失败', error);
  }
}

function duplicateDraft(): void {
  if (!draft.value) return;
  if (!applyJsonTextToDraft()) return;
  const copy = clone(draft.value);
  copy.id = '';
  copy.name = `${copy.name} 副本`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.lastRunAt = undefined;
  copy.lastError = undefined;
  try {
    const saved = upsertUserScript_ACU(copy, true);
    selectedId.value = saved.id;
    refresh();
  } catch (error) {
    showScriptManagerError_ACU('复制脚本失败', error);
  }
}

function moveDraft(delta: number): void {
  if (!draft.value) return;
  const next = getUserScripts_ACU().slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const index = next.findIndex(script => script.id === draft.value?.id);
  const swapIndex = index + delta;
  if (index < 0 || swapIndex < 0 || swapIndex >= next.length) return;
  const currentOrder = next[index].order;
  if (currentOrder === next[swapIndex].order) {
    next[index].order = next[swapIndex].order + (delta < 0 ? -1 : 1);
  } else {
    next[index].order = next[swapIndex].order;
    next[swapIndex].order = currentOrder;
  }
  try {
    saveUserScripts_ACU(next, true);
    refresh();
  } catch (error) {
    showScriptManagerError_ACU('调整排序失败', error);
  }
}

function addBinding(): void {
  if (!draft.value) return;
  draft.value.bindings.push({
    hook: 'table_fill.before_request',
    enabled: true,
    order: 100,
    outputTtl: 'request',
    failurePolicy: 'continue',
  });
  bindingJsonTexts.value.push({ config: '', filter: '' });
}

function removeBinding(index: number): void {
  draft.value?.bindings.splice(index, 1);
  bindingJsonTexts.value.splice(index, 1);
  if (manualBindingIndex.value !== '' && Number(manualBindingIndex.value) === index) manualBindingIndex.value = '';
}

function setCharacterNames(value: string): void {
  if (!draft.value) return;
  draft.value.scope.characterNames = value.split(',').map(item => item.trim()).filter(Boolean);
}

function bindCurrentCharacter(): void {
  if (!draft.value) return;
  const name = currentCharacterName.value || resolveCurrentCharacterName_ACU();
  if (!name) {
    jsonError.value = '未读取到当前角色卡名称，无法一键绑定。';
    return;
  }
  const names = new Set((draft.value.scope.characterNames || []).map(item => String(item).trim()).filter(Boolean));
  names.add(name);
  draft.value.scope.characterNames = Array.from(names);
  jsonError.value = '';
}

function isPlotBinding(binding: ScriptBinding_ACU): boolean {
  return binding.hook === 'plot.before_task_request' || binding.hook === 'plot.after_task_response' || binding.hook === 'plot.after_stage';
}

function ensureBindingFilterObject(binding: ScriptBinding_ACU): Record<string, unknown> {
  if (!binding.filter || typeof binding.filter !== 'object' || Array.isArray(binding.filter)) {
    binding.filter = {};
  }
  return binding.filter as Record<string, unknown>;
}

function findBindingIndex(binding: ScriptBinding_ACU): number {
  return draft.value?.bindings.indexOf(binding) ?? -1;
}

function syncBindingFilterText(binding: ScriptBinding_ACU): void {
  const index = findBindingIndex(binding);
  if (index < 0) return;
  if (!bindingJsonTexts.value[index]) bindingJsonTexts.value[index] = { config: '', filter: '' };
  bindingJsonTexts.value[index].filter = jsonText(binding.filter);
}

function plotFilterValue(binding: ScriptBinding_ACU, key: 'presetName' | 'taskId' | 'stage'): string {
  const filter = binding.filter && typeof binding.filter === 'object' && !Array.isArray(binding.filter)
    ? binding.filter as Record<string, unknown>
    : {};
  const value = filter[key];
  return value === undefined || value === null ? '' : String(value);
}

function presetOptionsForBinding(binding: ScriptBinding_ACU): string[] {
  const current = plotFilterValue(binding, 'presetName');
  const names = plotPresetStore.presets.map(preset => preset.name).filter(Boolean);
  if (current && !names.includes(current)) names.unshift(current);
  return names;
}

function selectedPlotPresetForBinding(binding: ScriptBinding_ACU) {
  const presetName = plotFilterValue(binding, 'presetName');
  if (!presetName) return null;
  return plotPresetStore.presets.find(preset => preset.name === presetName) || null;
}

function taskOptionsForBinding(binding: ScriptBinding_ACU): Array<{ id: string; label: string }> {
  const preset = selectedPlotPresetForBinding(binding);
  const tasks = Array.isArray(preset?.raw?.plotTasks) ? preset.raw.plotTasks : [];
  const options = tasks
    .map((task: any) => {
      const id = String(task?.id || '').trim();
      if (!id) return null;
      const name = String(task?.name || '').trim();
      const stage = Number.isFinite(Number(task?.stage)) ? `stage ${Number(task.stage)}` : 'stage ?';
      return { id, label: `${name || id} · ${id} · ${stage}` };
    })
    .filter(Boolean) as Array<{ id: string; label: string }>;
  const current = plotFilterValue(binding, 'taskId');
  if (current && !options.some(option => option.id === current)) options.unshift({ id: current, label: `${current}（当前脚本中保存，当前预设未找到）` });
  return options;
}

function stageOptionsForBinding(binding: ScriptBinding_ACU): number[] {
  const preset = selectedPlotPresetForBinding(binding);
  const tasks = Array.isArray(preset?.raw?.plotTasks) ? preset.raw.plotTasks : [];
  const stages = Array.from(new Set(tasks
    .map((task: any) => Number(task?.stage))
    .filter(stage => Number.isFinite(stage) && stage > 0)
    .map(stage => Math.trunc(stage))))
    .sort((a, b) => a - b);
  const current = Number(plotFilterValue(binding, 'stage'));
  if (Number.isFinite(current) && current > 0 && !stages.includes(Math.trunc(current))) stages.unshift(Math.trunc(current));
  return stages;
}

function setPlotFilterValue(binding: ScriptBinding_ACU, key: 'presetName' | 'taskId' | 'stage', rawValue: string): void {
  const filter = ensureBindingFilterObject(binding);
  const text = String(rawValue || '').trim();
  if (!text) {
    delete filter[key];
  } else if (key === 'stage') {
    const stage = Number(text);
    if (Number.isFinite(stage) && stage > 0) filter[key] = Math.trunc(stage);
  } else {
    filter[key] = text;
    if (key === 'presetName') {
      delete filter.taskId;
      delete filter.stage;
    }
  }
  if (Object.keys(filter).length === 0) binding.filter = undefined;
  syncBindingFilterText(binding);
}

function normalizeBindingFilterForHook(binding: ScriptBinding_ACU): void {
  if (!binding.filter || typeof binding.filter !== 'object' || Array.isArray(binding.filter)) return;
  const filter = binding.filter as Record<string, unknown>;
  if (binding.hook === 'plot.after_stage') {
    delete filter.taskId;
  } else if (binding.hook === 'plot.before_task_request' || binding.hook === 'plot.after_task_response') {
    delete filter.stage;
  } else {
    delete filter.presetName;
    delete filter.taskId;
    delete filter.stage;
  }
  if (Object.keys(filter).length === 0) binding.filter = undefined;
}

function parseJsonOrNull(value: string): unknown {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return JSON.parse(text);
}

function parseJsonWithFeedback(value: string, label: string): { ok: true; value: unknown } | { ok: false } {
  try {
    jsonError.value = '';
    return { ok: true, value: parseJsonOrNull(value) };
  } catch (error) {
    jsonError.value = `${label} JSON 无效：${String((error as any)?.message || error)}`;
    return { ok: false };
  }
}

function jsonText(value: unknown): string {
  return value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
}

function syncJsonTextFromDraft(): void {
  defaultVariableInputText.value = jsonText(draft.value?.defaultVariableInput);
  bindingJsonTexts.value = (draft.value?.bindings || []).map(binding => ({
    config: jsonText(binding.config),
    filter: jsonText(binding.filter),
  }));
}

function applyJsonTextToDraft(): boolean {
  if (!draft.value) return false;
  const defaultInput = parseJsonWithFeedback(defaultVariableInputText.value, '默认变量输入');
  if (!defaultInput.ok) return false;
  draft.value.defaultVariableInput = defaultInput.value;
  for (let index = 0; index < draft.value.bindings.length; index++) {
    const binding = draft.value.bindings[index];
    const raw = bindingJsonTexts.value[index] || { config: '', filter: '' };
    const config = parseJsonWithFeedback(raw.config, `第 ${index + 1} 个绑定配置`);
    if (!config.ok) return false;
    const filter = parseJsonWithFeedback(raw.filter, `第 ${index + 1} 个过滤条件`);
    if (!filter.ok) return false;
    binding.config = config.value;
    binding.filter = filter.value as Record<string, unknown> | undefined;
    normalizeBindingFilterForHook(binding);
  }
  jsonError.value = '';
  return true;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilenamePart(value: string): string {
  return String(value || 'script').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_').slice(0, 60) || 'script';
}

function createPreviewUniqueName(baseName: string, existingNames: Set<string>): string {
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

function exportSelectedScript(): void {
  if (!draft.value) return;
  try {
    downloadJson(`acu-user-script-${safeFilenamePart(draft.value.name)}.json`, exportUserScripts_ACU([draft.value.id]));
  } catch (error) {
    showScriptManagerError_ACU('导出当前脚本失败', error);
  }
}

function exportAllScripts(): void {
  try {
    downloadJson(`acu-user-scripts-${new Date().toISOString().slice(0, 10)}.json`, exportUserScripts_ACU());
  } catch (error) {
    showScriptManagerError_ACU('导出脚本失败', error);
  }
}

function triggerImport(): void {
  importFileInput.value?.click();
}

function validateImportPreview(payload: unknown): UserScriptExportPackage_ACU {
  if (!payload || typeof payload !== 'object' || (payload as any).format !== USER_SCRIPT_EXPORT_FORMAT_ACU || !Array.isArray((payload as any).scripts)) {
    throw new Error(`脚本包格式无效，需要 ${USER_SCRIPT_EXPORT_FORMAT_ACU}`);
  }
  return payload as UserScriptExportPackage_ACU;
}

function handleImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importPreview.value = validateImportPreview(JSON.parse(String(reader.result || '{}')));
    } catch (error) {
      alert(`导入失败：${String((error as any)?.message || error)}`);
      importPreview.value = null;
    } finally {
      input.value = '';
    }
  };
  reader.onerror = () => {
    alert('导入失败：无法读取文件');
    input.value = '';
  };
  reader.readAsText(file);
}

function clearImportPreview(): void {
  importPreview.value = null;
}

function confirmImport(): void {
  if (!importPreview.value) return;
  if (importPreviewHasErrors.value) {
    showScriptManagerError_ACU('导入失败', '脚本包存在字段级错误，请修正后重新导入');
    return;
  }
  try {
    const imported = importUserScripts_ACU(importPreview.value, true);
    selectedId.value = imported[0]?.id || selectedId.value;
    clearImportPreview();
    refresh();
  } catch (error) {
    alert(`导入失败：${String((error as any)?.message || error)}`);
  }
}

async function runManual(): Promise<void> {
  const saved = saveDraft();
  if (!saved) return;
  manualRunning.value = true;
  try {
    const parsedInput = parseJsonWithFeedback(manualInputText.value, '手动运行输入');
    if (!parsedInput.ok) return;
    const bindingIndex = manualBindingIndex.value === '' ? undefined : Number(manualBindingIndex.value);
    const binding = Number.isInteger(bindingIndex) ? saved.bindings[bindingIndex as number] : undefined;
    const result = await runScriptManual_ACU(saved.id, {
      hook: binding?.hook,
      bindingIndex,
      eventPayload: binding?.hook ? { hook: binding.hook, timestamp: Date.now(), manual: true } : undefined,
      input: parsedInput.value,
      sourceContext: { sourceType: 'script_manager_manual_run' },
    });
    manualResult.value = JSON.stringify({
      success: result.success,
      value: stringifyScriptValue_ACU(result.value),
      error: result.error,
      durationMs: result.durationMs,
      runId: result.runId,
      logs: getScriptLogs_ACU(saved.id)
        .filter(log => log.runId === result.runId)
        .map(log => ({ time: formatTime(log.timestamp), level: log.level, message: log.message })),
    }, null, 2);
  } catch (error) {
    manualResult.value = String((error as any)?.message || error);
  } finally {
    manualRunning.value = false;
    refresh();
  }
}

function bindingSummary(script: UserScriptDefinition_ACU): string {
  const hooks = (script.bindings || []).map(binding => binding.hook).filter(Boolean);
  return hooks.length ? hooks.join(', ') : '无挂载点';
}

function outputKeySummary(script: UserScriptDefinition_ACU): string {
  const keys = (script.bindings || []).map(binding => binding.outputKey).filter(Boolean);
  return keys.length ? keys.join(', ') : '无';
}

function scopeLabel(script: UserScriptDefinition_ACU): string {
  return script.scope?.type === 'character' ? '角色卡' : '全局';
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '从未';
  return new Date(timestamp).toLocaleString();
}

function logCallLabel(log: ScriptLogEntry_ACU): string {
  const parts = [log.runId ? `run ${log.runId.slice(-6)}` : 'run -'];
  if (log.callType) parts.push(log.callType);
  if (log.hook) parts.push(log.hook);
  if (typeof log.durationMs === 'number') parts.push(`${log.durationMs}ms`);
  if (log.error) parts.push('error');
  return parts.join(' · ');
}

onMounted(refresh);
</script>

<style scoped>
.acu-v2-script-page { min-height: 100%; padding: 20px; }
.acu-v2-script-page__file-input { display: none; }
.acu-v2-script-page__layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; min-height: 640px; }
.acu-v2-script-page__list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.acu-v2-script-page__script-group { display: flex; flex-direction: column; gap: 8px; }
.acu-v2-script-page__script-group-title { margin: 8px 0 0; color: var(--acu-text-3); font-size: 12px; font-weight: 700; }
.acu-v2-script-page__script-card { display: flex; flex-direction: column; gap: 4px; padding: 10px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); background: var(--acu-bg-1); color: var(--acu-text-1); text-align: left; cursor: pointer; }
.acu-v2-script-page__script-card--active { border-color: var(--acu-accent); box-shadow: 0 0 0 1px var(--acu-accent); }
.acu-v2-script-page__script-title { font-weight: 700; }
.acu-v2-script-page__script-meta { color: var(--acu-text-3); font-size: 12px; overflow-wrap: anywhere; }
.acu-v2-script-page__script-error { color: var(--acu-danger); font-size: 12px; overflow-wrap: anywhere; }
.acu-v2-script-page__error { color: var(--acu-danger); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
.acu-v2-script-page__editor { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.acu-v2-script-page__toolbar, .acu-v2-script-page__inline, .acu-v2-script-page__binding-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.acu-v2-script-page__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.acu-v2-script-page__field, .acu-v2-script-page__section { display: flex; flex-direction: column; gap: 6px; }
.acu-v2-script-page__field span, .acu-v2-script-page__section h3 { color: var(--acu-text-2); font-size: 13px; margin: 0; }
.acu-v2-script-page input, .acu-v2-script-page select, .acu-v2-script-page textarea { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); background: var(--acu-bg-1); color: var(--acu-text-1); padding: 8px; font: inherit; }
.acu-v2-script-page__checkbox, .acu-v2-script-page__radio { display: inline-flex; gap: 6px; align-items: center; color: var(--acu-text-2); }
.acu-v2-script-page__checkbox input, .acu-v2-script-page__radio input { width: auto; }
.acu-v2-script-page__source { min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.acu-v2-script-page__binding { display: grid; grid-template-columns: minmax(220px, 1fr) 72px 90px minmax(140px, 1fr) 120px 150px auto; gap: 10px; align-items: end; padding: 10px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); }
.acu-v2-script-page__binding-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--acu-text-2); font-size: 12px; }
.acu-v2-script-page__binding-field span { color: var(--acu-text-3); font-size: 11px; }
.acu-v2-script-page__binding-field--enabled { align-items: center; }
.acu-v2-script-page__binding-field--enabled input { width: auto; min-width: auto; }
.acu-v2-script-page__binding-field--json { grid-column: span 3; }
.acu-v2-script-page__plot-filter { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 10px; border: 1px dashed var(--acu-border-2); border-radius: var(--acu-radius-sm); background: var(--acu-bg-2); }
.acu-v2-script-page__plot-filter label { display: flex; flex-direction: column; gap: 4px; color: var(--acu-text-2); font-size: 12px; }
.acu-v2-script-page__plot-filter .acu-v2-script-page__hint { grid-column: 1 / -1; margin: 0; }
.acu-v2-script-page__import-preview { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; padding: 12px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); background: var(--acu-bg-1); }
.acu-v2-script-page__import-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.acu-v2-script-page__import-head p { margin: 4px 0 0; }
.acu-v2-script-page__import-item { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); color: var(--acu-text-2); }
.acu-v2-script-page__import-item pre { max-height: 140px; margin: 0; padding: 8px; overflow: auto; border-radius: var(--acu-radius-sm); background: var(--acu-bg-2); color: var(--acu-text-1); }
.acu-v2-script-page__example-list { display: grid; gap: 10px; }
.acu-v2-script-page__example-item { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); background: var(--acu-bg-1); }
.acu-v2-script-page__example-item p { margin: 0; }
.acu-v2-script-page__section code, .acu-v2-script-page__result { display: block; padding: 8px; border-radius: var(--acu-radius-sm); background: var(--acu-bg-2); color: var(--acu-text-1); overflow: auto; }
.acu-v2-script-page__hint, .acu-v2-script-page__empty { color: var(--acu-text-3); font-size: 12px; }
.acu-v2-script-page__log-row { display: grid; grid-template-columns: 170px 70px minmax(180px, 1fr) minmax(0, 1fr); gap: 8px; padding: 8px; border-bottom: 1px solid var(--acu-border-2); color: var(--acu-text-2); }
.acu-v2-script-page__log-row code { overflow-wrap: anywhere; }
.acu-v2-script-page__log-group { border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); overflow: hidden; background: var(--acu-bg-1); }
.acu-v2-script-page__log-group + .acu-v2-script-page__log-group { margin-top: 8px; }
.acu-v2-script-page__log-group-head { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(180px, 1fr) 170px 80px minmax(0, 1fr); gap: 8px; padding: 8px; background: var(--acu-bg-2); color: var(--acu-text-2); }
@media (max-width: 980px) { .acu-v2-script-page__layout { grid-template-columns: 1fr; } .acu-v2-script-page__grid { grid-template-columns: 1fr 1fr; } .acu-v2-script-page__binding { grid-template-columns: 1fr; } .acu-v2-script-page__binding-field--json { grid-column: auto; } }
</style>

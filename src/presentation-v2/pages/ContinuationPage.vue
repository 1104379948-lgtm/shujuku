<template>
  <section class="acu-v2-continuation-page">
    <AcuPanel title="智能续写任务" description="阶段大纲、轮次游标和宿主生成归属均以当前聊天首楼的续写状态为准。">
      <template v-if="!runtime.task.value">
        <AcuTextarea
          :model-value="runtime.originInstruction.value"
          :rows="5"
          :disabled="runtime.busy.value"
          placeholder="输入本次智能续写的初始剧情要求..."
          @update:model-value="runtime.originInstruction.value = $event"
        />
        <div class="acu-v2-continuation-page__actions">
          <AcuButton
            variant="primary"
            :loading="runtime.busy.value"
            :disabled="!runtime.originInstruction.value.trim()"
            @click="runtime.createTask"
          >创建阶段大纲</AcuButton>
        </div>
      </template>
      <template v-else>
        <dl class="acu-v2-continuation-page__status-grid">
          <div><dt>任务状态</dt><dd>{{ runtime.statusText.value }}</dd></div>
          <div><dt>当前阶段</dt><dd>{{ runtime.activeStage.value ? `第 ${runtime.activeStage.value.stageNumber} 阶段` : '无' }}</dd></div>
          <div><dt>完成轮次</dt><dd>{{ runtime.activeStage.value?.completedTurns ?? 0 }}</dd></div>
          <div><dt>大纲 revision</dt><dd>{{ runtime.activeStage.value?.activeRevision ?? '-' }}</dd></div>
          <div><dt>总倒计时</dt><dd>{{ deadlineText }}</dd></div>
        </dl>
        <p class="acu-v2-continuation-page__instruction">{{ runtime.task.value.originInstruction }}</p>
        <p v-if="runtime.activeNode.value" class="acu-v2-continuation-page__instruction">当前节点：{{ runtime.activeNode.value.title }}</p>
        <p v-if="runtime.activeTurn.value" class="acu-v2-continuation-page__instruction">当前轮次目标：{{ runtime.activeTurn.value.goal }}</p>
      </template>
    </AcuPanel>

    <AcuPanel title="运行控制" description="继续时仅发送本轮内部 AI 生成的最终普通文本；宿主结果未被唯一归属前不会推进游标。">
      <div class="acu-v2-continuation-page__actions">
        <AcuButton
          v-if="runtime.canContinue.value"
          variant="primary"
          :loading="runtime.busy.value"
          @click="runtime.continueTask"
        >继续当前轮次</AcuButton>
        <AcuButton
          v-if="runtime.task.value?.pendingHostTurn?.status === 'retry_ready'"
          variant="primary"
          :loading="runtime.busy.value"
          @click="runtime.retryCurrentTurn"
        >重试当前轮次</AcuButton>
        <AcuButton
          v-if="runtime.task.value && !runtime.isAwaitingHostResult.value"
          :loading="runtime.busy.value"
          @click="replan"
        >重新规划剩余阶段</AcuButton>
        <AcuButton
          v-if="runtime.task.value && !runtime.isAwaitingHostResult.value"
          variant="danger"
          :loading="runtime.busy.value"
          @click="runtime.stopTask"
        >停止智能续写</AcuButton>
      </div>
      <p v-if="runtime.isAwaitingHostResult.value" class="acu-v2-continuation-page__notice">
        当前轮次正在等待宿主生成结束事件，不能重复发送或重规划。
      </p>
      <AcuTextarea
        v-if="runtime.task.value && !runtime.isAwaitingHostResult.value"
        :model-value="replanInstruction"
        :rows="3"
        placeholder="可选：说明本次重新规划要调整的方向..."
        @update:model-value="replanInstruction = $event"
      />
    </AcuPanel>

    <AcuPanel v-if="runtime.task.value" title="阶段大纲与执行回执" description="阶段历史默认折叠；当前阶段与其当前 revision 展开。">
      <details
        v-for="stage in runtime.task.value.stages"
        :key="stage.stageId"
        class="acu-v2-continuation-page__stage"
        :open="stage.stageId === runtime.task.value.activeStageId"
      >
        <summary>第 {{ stage.stageNumber }} 阶段 · {{ stage.status }} · {{ stage.completedTurns }} / {{ stage.revisions.find(item => item.revision === stage.activeRevision)?.outline.totalTurns ?? 0 }} 轮</summary>
        <p v-if="stage.chronicleRange" class="acu-v2-continuation-page__meta">AM 范围：{{ stage.chronicleRange.first }} → {{ stage.chronicleRange.last }}</p>
        <details
          v-for="revision in stage.revisions"
          :key="revision.revision"
          class="acu-v2-continuation-page__revision"
          :open="revision.revision === stage.activeRevision"
        >
          <summary>revision {{ revision.revision }} · {{ revision.reason }} · {{ revision.frozen ? '已冻结' : '待确认' }}</summary>
          <p class="acu-v2-continuation-page__meta">{{ revision.outline.title }}：{{ revision.outline.goal }}</p>
          <ol class="acu-v2-continuation-page__outline">
            <li v-for="node in revision.outline.nodes" :key="node.id">
              <strong>{{ node.title }}</strong>：{{ node.goal }}
              <ol><li v-for="turn in node.turns" :key="turn.id">{{ turn.goal }}</li></ol>
            </li>
          </ol>
        </details>
      </details>
      <ol class="acu-v2-continuation-page__timeline">
        <li v-for="entry in runtime.task.value.timeline" :key="entry.id">
          {{ new Date(entry.at).toLocaleString() }} · {{ entry.kind }}<span v-if="entry.errorCode"> · {{ entry.errorCode }}</span>
        </li>
      </ol>
    </AcuPanel>

    <AcuPanel v-if="runtime.task.value && runtime.task.value.status === 'awaiting_outline_review' && runtime.activeRevision.value" title="大纲预览" description="保存前会在领域层重新执行严格 Schema 与 revision 校验；页面不直接写入聊天数组。">
      <AcuTextarea :model-value="outlineDraft" :rows="16" @update:model-value="outlineDraft = $event" />
      <p v-if="outlineDraftError" class="acu-v2-continuation-page__error">{{ outlineDraftError }}</p>
      <div class="acu-v2-continuation-page__actions">
        <AcuButton variant="primary" :loading="runtime.busy.value" @click="acceptOutlineDraft">确认大纲并继续</AcuButton>
      </div>
    </AcuPanel>

    <AcuPanel v-if="runtime.task.value && !runtime.isAwaitingHostResult.value" title="放弃并新建" description="未完成任务默认只能继续；放弃必须显式确认。">
      <AcuTextarea :model-value="replacementInstruction" :rows="3" placeholder="输入新任务的初始剧情要求..." @update:model-value="replacementInstruction = $event" />
      <AcuCheckbox v-model="confirmAbandon" label="我确认放弃当前未完成任务并创建新任务" />
      <div class="acu-v2-continuation-page__actions">
        <AcuButton variant="danger" :disabled="!confirmAbandon || !replacementInstruction.trim()" :loading="runtime.busy.value" @click="abandonAndCreate">放弃并创建新任务</AcuButton>
      </div>
    </AcuPanel>

    <AcuPanel v-if="settingsDraft" title="续写设置" description="设置先在页面草稿中编辑；点击保存后才经首楼权威状态落盘。宿主生成进行中不能保存。">
      <div class="acu-v2-continuation-page__settings-grid">
        <label>阶段规模<select v-model="settingsDraft.stageSize"><option value="short">短（3–5）</option><option value="standard">标准（6–10）</option><option value="long">长（11–20）</option><option value="custom">自定义</option></select></label>
        <label v-if="settingsDraft.stageSize === 'custom'">最少轮次<AcuInput v-model="settingsDraft.customTurnMin" type="number" :min="1" :max="50" /></label>
        <label v-if="settingsDraft.stageSize === 'custom'">最多轮次<AcuInput v-model="settingsDraft.customTurnMax" type="number" :min="1" :max="50" /></label>
        <label>自动阶段上限<AcuInput v-model="settingsDraft.maxAutomaticStages" type="number" :min="1" /></label>
        <label>正文重试次数<AcuInput v-model="settingsDraft.generationRetryLimit" type="number" :min="0" /></label>
        <label>内部 AI 重试次数<AcuInput v-model="settingsDraft.internalAiRetryLimit" type="number" :min="0" /></label>
        <label>轮次延迟（秒）<AcuInput v-model="settingsDraft.loopDelaySeconds" type="number" :min="0" /></label>
        <label>重试延迟（秒）<AcuInput v-model="settingsDraft.retryDelaySeconds" type="number" :min="0" /></label>
        <label>总时长（分钟，0 为不设总时长）<AcuInput v-model="settingsDraft.totalDurationMinutes" type="number" :min="0" /></label>
        <label>最近剧情轮数<AcuInput v-model="settingsDraft.contextTurnCount" type="number" :min="0" /></label>
        <label>循环标签<AcuInput v-model="settingsDraft.loopTags" type="text" /></label>
        <label>API 预设<select v-model="settingsDraft.apiPresetMode"><option value="current">跟随当前 API</option><option value="fixed">固定预设</option></select></label>
        <label v-if="settingsDraft.apiPresetMode === 'fixed'">固定预设名称<AcuInput v-model="settingsDraft.fixedApiPresetName" type="text" /></label>
      </div>
      <div class="acu-v2-continuation-page__toggles">
        <AcuCheckbox v-model="settingsDraft.outlinePreview" label="创建后先预览大纲" />
        <AcuCheckbox v-model="settingsDraft.autoNextStage" label="自动规划下一阶段" />
      </div>
      <AcuRulePairList v-model="settingsDraft.contextExtractRules" label="上下文提取规则" />
      <AcuRulePairList v-model="settingsDraft.contextExcludeRules" label="上下文排除规则" />
      <p v-if="settingsError" class="acu-v2-continuation-page__error">{{ settingsError }}</p>
      <div class="acu-v2-continuation-page__actions"><AcuButton variant="primary" :loading="runtime.busy.value" @click="saveSettings">保存续写设置</AcuButton></div>
    </AcuPanel>

    <AcuPanel v-if="settingsDraft" title="伪 Role 提示词" description="仅启用段参与内部调用；占位符会按实际出现按需解析。">
      <h3>阶段大纲提示词</h3>
      <AcuPromptSegments :segments="settingsDraft.outlinePrompt" :role-options="continuationRoleOptions" :show-slot="false" :show-enabled="true" :allow-move="true" @add="addPrompt('outlinePrompt')" @delete="index => deletePrompt('outlinePrompt', index)" @move="(index, delta) => movePrompt('outlinePrompt', index, delta)" @update="(index, patch) => updatePrompt('outlinePrompt', index, patch)" />
      <div class="acu-v2-continuation-page__actions"><AcuButton @click="restorePrompt('outline')">恢复大纲提示词默认值</AcuButton></div>
      <h3>轮次指令提示词</h3>
      <AcuPromptSegments :segments="settingsDraft.turnInstructionPrompt" :role-options="continuationRoleOptions" :show-slot="false" :show-enabled="true" :allow-move="true" @add="addPrompt('turnInstructionPrompt')" @delete="index => deletePrompt('turnInstructionPrompt', index)" @move="(index, delta) => movePrompt('turnInstructionPrompt', index, delta)" @update="(index, patch) => updatePrompt('turnInstructionPrompt', index, patch)" />
      <div class="acu-v2-continuation-page__actions"><AcuButton @click="restorePrompt('turn_instruction')">恢复轮次指令默认值</AcuButton></div>
      <p class="acu-v2-continuation-page__meta">可用占位符：$ORIGIN_INSTRUCTION、$1、$LAST_STAGE_CHRONICLES、$EARLIER_STAGE_SUMMARIES、$RECENT_STORY、$STAGE_HISTORY、$COMPLETED_STAGE_PART、$REPLAN_INSTRUCTION、$TURN_RANGE、$REMAINING_TURNS、$CURRENT_STAGE、$CURRENT_NODE、$CURRENT_TURN_GOAL、$TURN_NUMBER、$NODE_TURN_NUMBER、$VALIDATION_ERRORS。</p>
    </AcuPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  buildDefaultContinuationOutlinePrompt_ACU,
  buildDefaultContinuationTurnInstructionPrompt_ACU,
} from '../../service/continuation/defaults';
import { restoreContinuationPromptDefault_ACU } from '../../service/continuation/prompt-template';
import type { ContinuationPromptSegment_ACU, ContinuationSettings_ACU, StageOutline_ACU } from '../../service/continuation/model';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import AcuInput from '../components/_lib/AcuInput.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPromptSegments from '../components/_lib/AcuPromptSegments.vue';
import AcuRulePairList from '../components/_lib/AcuRulePairList.vue';
import AcuTextarea from '../components/_lib/AcuTextarea.vue';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { useContinuationRuntime } from '../composables/useContinuationRuntime';

const runtime = useContinuationRuntime();
const settingsDraft = ref<ContinuationSettings_ACU | null>(null);
const outlineDraft = ref('');
const outlineDraftError = ref('');
const settingsError = ref('');
const replacementInstruction = ref('');
const confirmAbandon = ref(false);
const replanInstruction = ref('');
const clock = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const deadlineText = computed(() => {
  const deadlineAt = runtime.task.value?.deadlineAt;
  if (deadlineAt === null || deadlineAt === undefined) return '未设置';
  const remainingSeconds = Math.max(0, Math.ceil((deadlineAt - clock.value) / 1_000));
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

const continuationRoleOptions = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

function cloneSettings(settings: ContinuationSettings_ACU): ContinuationSettings_ACU {
  return {
    ...settings,
    contextExtractRules: settings.contextExtractRules.map(rule => ({ ...rule })),
    contextExcludeRules: settings.contextExcludeRules.map(rule => ({ ...rule })),
    outlinePrompt: settings.outlinePrompt.map(segment => ({ ...segment })),
    turnInstructionPrompt: settings.turnInstructionPrompt.map(segment => ({ ...segment })),
  };
}

function syncOutlineDraft(): void {
  outlineDraft.value = runtime.activeRevision.value
    ? JSON.stringify(runtime.activeRevision.value.outline, null, 2)
    : '';
  outlineDraftError.value = '';
}

function parseOutlineDraft(): StageOutline_ACU | null {
  try {
    const parsed: unknown = JSON.parse(outlineDraft.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('大纲必须是 JSON 对象');
    return parsed as StageOutline_ACU;
  } catch (error) {
    outlineDraftError.value = error instanceof Error ? error.message : '大纲 JSON 无法解析';
    return null;
  }
}

async function acceptOutlineDraft(): Promise<void> {
  const outline = parseOutlineDraft();
  if (!outline) return;
  if (await runtime.acceptOutline(outline)) syncOutlineDraft();
}

async function replan(): Promise<void> {
  const succeeded = await runtime.replanRemainingWithInstruction(replanInstruction.value);
  if (succeeded) replanInstruction.value = '';
}

async function abandonAndCreate(): Promise<void> {
  if (!confirmAbandon.value || !replacementInstruction.value.trim()) return;
  if (await runtime.abandonAndCreate(replacementInstruction.value)) {
    replacementInstruction.value = '';
    confirmAbandon.value = false;
  }
}

function requiredInteger(value: unknown, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error(`${label} 必须是整数`);
  return numeric;
}

function normalizeSettingsDraft(): ContinuationSettings_ACU {
  if (!settingsDraft.value) throw new Error('续写设置尚未加载');
  const source = settingsDraft.value;
  const customTurnMin = source.stageSize === 'custom' ? requiredInteger(source.customTurnMin, '最少轮次') : null;
  const customTurnMax = source.stageSize === 'custom' ? requiredInteger(source.customTurnMax, '最多轮次') : null;
  if (source.stageSize === 'custom' && (customTurnMin < 1 || customTurnMax < customTurnMin || customTurnMax > 50)) {
    throw new Error('自定义阶段轮次必须是 1 到 50 的递增整数范围');
  }
  const normalized = {
    ...cloneSettings(source),
    customTurnMin,
    customTurnMax,
    maxAutomaticStages: requiredInteger(source.maxAutomaticStages, '自动阶段上限'),
    generationRetryLimit: requiredInteger(source.generationRetryLimit, '正文重试次数'),
    internalAiRetryLimit: requiredInteger(source.internalAiRetryLimit, '内部 AI 重试次数'),
    loopDelaySeconds: requiredInteger(source.loopDelaySeconds, '轮次延迟'),
    retryDelaySeconds: requiredInteger(source.retryDelaySeconds, '重试延迟'),
    totalDurationMinutes: requiredInteger(source.totalDurationMinutes, '总时长'),
    contextTurnCount: requiredInteger(source.contextTurnCount, '最近剧情轮数'),
  };
  if (normalized.maxAutomaticStages < 1 || normalized.generationRetryLimit < 0 || normalized.internalAiRetryLimit < 0 || normalized.loopDelaySeconds < 0 || normalized.retryDelaySeconds < 0 || normalized.totalDurationMinutes < 0 || normalized.contextTurnCount < 0) {
    throw new Error('续写设置中的数值不能低于允许范围');
  }
  if (normalized.apiPresetMode === 'fixed' && !normalized.fixedApiPresetName.trim()) throw new Error('固定 API 预设名称不能为空');
  return normalized;
}

async function saveSettings(): Promise<void> {
  try {
    const candidate = normalizeSettingsDraft();
    if (await runtime.saveSettings(candidate)) {
      settingsDraft.value = cloneSettings(candidate);
      settingsError.value = '';
    }
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '续写设置无效';
  }
}

type PromptKey = 'outlinePrompt' | 'turnInstructionPrompt';

function addPrompt(key: PromptKey): void {
  if (!settingsDraft.value) return;
  settingsDraft.value[key].push({ role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true });
}

function deletePrompt(key: PromptKey, index: number): void {
  if (!settingsDraft.value || settingsDraft.value[key][index]?.deletable === false) return;
  settingsDraft.value[key].splice(index, 1);
}

function movePrompt(key: PromptKey, index: number, delta: -1 | 1): void {
  const prompts = settingsDraft.value?.[key];
  const target = index + delta;
  if (!prompts || target < 0 || target >= prompts.length) return;
  [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
}

function updatePrompt(key: PromptKey, index: number, patch: Partial<ContinuationPromptSegment_ACU>): void {
  const current = settingsDraft.value?.[key][index];
  if (current) settingsDraft.value![key][index] = { ...current, ...patch };
}

function restorePrompt(kind: 'outline' | 'turn_instruction'): void {
  if (!settingsDraft.value) return;
  settingsDraft.value = restoreContinuationPromptDefault_ACU(settingsDraft.value, kind);
}

onMounted(() => {
  void runtime.initialize();
  countdownTimer = setInterval(() => { clock.value = Date.now(); }, 1_000);
});
onBeforeUnmount(() => {
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
});
watch(useChatChangedTick(), runtime.refresh);
watch(runtime.settings, settings => { settingsDraft.value = settings ? cloneSettings(settings) : null; }, { immediate: true });
watch(() => `${runtime.activeStage.value?.stageId ?? ''}:${runtime.activeRevision.value?.revision ?? ''}`, syncOutlineDraft, { immediate: true });
</script>

<style scoped>
.acu-v2-continuation-page { min-height: 100%; padding: 20px; display: grid; gap: 18px; }
.acu-v2-continuation-page__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.acu-v2-continuation-page__status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0; }
.acu-v2-continuation-page__status-grid div { border-left: 2px solid color-mix(in srgb, var(--acu-text-3) 28%, transparent); padding-left: 10px; }
.acu-v2-continuation-page__status-grid dt { color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-continuation-page__status-grid dd { margin: 3px 0 0; color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); }
.acu-v2-continuation-page__instruction, .acu-v2-continuation-page__notice { margin: 14px 0 0; color: var(--acu-text-2); white-space: pre-wrap; }
.acu-v2-continuation-page__notice { color: var(--acu-text-3); }
.acu-v2-continuation-page__error { color: var(--acu-danger, #d65b5b); white-space: pre-wrap; }
.acu-v2-continuation-page__meta { color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-page__stage, .acu-v2-continuation-page__revision { margin-top: 10px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 6px; }
.acu-v2-continuation-page__stage > summary, .acu-v2-continuation-page__revision > summary { cursor: pointer; color: var(--acu-text-1); }
.acu-v2-continuation-page__outline, .acu-v2-continuation-page__timeline { display: grid; gap: 8px; padding-left: 22px; color: var(--acu-text-2); }
.acu-v2-continuation-page__settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.acu-v2-continuation-page__settings-grid label { display: grid; gap: 5px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-page__settings-grid select { min-height: 30px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 30%, transparent); border-radius: 4px; background: var(--acu-bg-2); color: var(--acu-text-1); }
.acu-v2-continuation-page__toggles { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0; }
@media (max-width: 860px) { .acu-v2-continuation-page { padding: 14px; } .acu-v2-continuation-page__status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .acu-v2-continuation-page__settings-grid { grid-template-columns: 1fr; } }
</style>

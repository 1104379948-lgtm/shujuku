<template>
  <div class="acu-v2-continuation-materials">
    <div class="acu-v2-continuation-materials__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="acu-v2-continuation-materials__tab"
        :class="{ 'acu-v2-continuation-materials__tab--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
      <div class="acu-v2-continuation-materials__tab-actions">
        <AcuButton :loading="busy" @click="reload">刷新</AcuButton>
        <AcuButton variant="danger" :loading="busy" @click="requestClear">一键清空</AcuButton>
      </div>
    </div>

    <p v-if="clearPending" class="acu-v2-continuation-materials__confirm">
      清空会删除当前续写任务、主 Agent 的会话记录与本地资料快照（伏笔、信息差、长期约束）。
      小说正文楼层不受影响，清空后可以从当前剧情重新开始规划。
      <span class="acu-v2-continuation-materials__confirm-actions">
        <AcuButton variant="danger" :loading="busy" @click="confirmClear">确认清空</AcuButton>
        <AcuButton @click="clearPending = false">取消</AcuButton>
      </span>
    </p>

    <!-- 阶段大纲：当前阶段可编辑，历史阶段只读折叠 -->
    <template v-if="activeTab === 'outline'">
      <p v-if="!task" class="acu-v2-continuation-materials__empty">还没有续写任务，也就没有阶段大纲。</p>
      <template v-else>
        <div v-if="activeRevision" class="acu-v2-continuation-materials__editor">
          <p class="acu-v2-continuation-materials__meta">
            当前：第 {{ activeStage?.stageNumber }} 阶段 · revision {{ activeRevision.revision }} · 已完成 {{ activeStage?.completedTurns ?? 0 }} 轮。
            已完成轮次与正在执行的轮次不可删除或替换，总轮数必须留在阶段规模范围内。
          </p>
          <AcuTextarea :model-value="outlineDraft" :rows="16" @update:model-value="onOutlineInput" />
          <p v-if="outlineError" class="acu-v2-continuation-materials__error">{{ outlineError }}</p>
          <div class="acu-v2-continuation-materials__actions">
            <AcuButton :disabled="!outlineDirty" @click="syncOutlineDraft">放弃修改</AcuButton>
            <AcuButton variant="primary" :loading="busy" :disabled="!outlineDirty" @click="saveOutline">保存大纲</AcuButton>
          </div>
        </div>
        <p v-else class="acu-v2-continuation-materials__empty">当前没有已冻结的阶段大纲可编辑。</p>

        <details v-for="stage in task.stages" :key="stage.stageId" class="acu-v2-continuation-materials__block">
          <summary>第 {{ stage.stageNumber }} 阶段 · {{ stage.status }} · {{ stage.completedTurns }} / {{ stageTotalTurns(stage) }} 轮</summary>
          <p v-if="stage.chronicleRange" class="acu-v2-continuation-materials__meta">纪要范围：{{ stage.chronicleRange.first }} → {{ stage.chronicleRange.last }}</p>
          <div v-for="revision in stage.revisions" :key="revision.revision">
            <p class="acu-v2-continuation-materials__meta">
              revision {{ revision.revision }} · {{ revision.reason }} · {{ revision.frozen ? '已冻结' : '待确认' }} · {{ revision.outline.title }}
            </p>
            <ol class="acu-v2-continuation-materials__list">
              <li v-for="node in revision.outline.nodes" :key="node.id">
                <strong>{{ node.title }}</strong>：{{ node.goal }}
                <ol><li v-for="turn in node.turns" :key="turn.id">{{ turn.goal }}</li></ol>
              </li>
            </ol>
          </div>
        </details>
      </template>
    </template>

    <!-- 资料快照：伏笔 / 信息差 / 长期约束，先给可读概览再给 JSON 编辑 -->
    <template v-else-if="activeTab === 'modules'">
      <p class="acu-v2-continuation-materials__meta">
        本地资料由子代理结算写入，也可以在这里手动修正。保存会走与子代理相同的结构校验并推进修订号，
        任何一条记录缺少 id 或关键文本都会整份拒绝，不会静默丢条目。
      </p>
      <p v-if="materials.snapshot.value" class="acu-v2-continuation-materials__meta">
        结算水位：楼层 {{ materials.snapshot.value.settledThroughIndex }} ·
        伏笔 {{ materials.snapshot.value.hooks.length }} 条 ·
        信息差 {{ materials.snapshot.value.infoGap.length }} 条 ·
        长期约束 {{ materials.snapshot.value.constraints.length }} 条 ·
        修订号 {{ materials.snapshot.value.revisions.hooks }}/{{ materials.snapshot.value.revisions.infoGap }}/{{ materials.snapshot.value.revisions.constraints }}
      </p>
      <AcuTextarea :model-value="materials.draft.value" :rows="18" @update:model-value="materials.updateDraft" />
      <p v-if="materials.error.value" class="acu-v2-continuation-materials__error">{{ materials.error.value }}</p>
      <div class="acu-v2-continuation-materials__actions">
        <AcuButton :disabled="!materials.dirty.value" @click="materials.reload">放弃修改</AcuButton>
        <AcuButton variant="primary" :loading="materials.saving.value" :disabled="!materials.dirty.value" @click="materials.save">保存资料</AcuButton>
      </div>
    </template>

    <!-- 事件时间线：只读 -->
    <template v-else>
      <p v-if="!task?.timeline.length" class="acu-v2-continuation-materials__empty">还没有事件记录。</p>
      <ol v-else class="acu-v2-continuation-materials__timeline">
        <li v-for="entry in reversedTimeline" :key="entry.id">
          {{ new Date(entry.at).toLocaleString() }} · {{ entry.kind }}<span v-if="entry.errorCode"> · {{ entry.errorCode }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import { useContinuationMaterials } from '../composables/useContinuationMaterials';
import type { ContinuationStage_ACU, ContinuationTask_ACU, StageOutline_ACU, StageRevision_ACU } from '../../service/continuation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  task: ContinuationTask_ACU | null;
  activeStage: ContinuationStage_ACU | null;
  activeRevision: StageRevision_ACU | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  (event: 'save-outline', outline: StageOutline_ACU): void;
  (event: 'clear'): void;
}>();

const TABS = [
  { id: 'outline', label: '阶段大纲' },
  { id: 'modules', label: '本地资料' },
  { id: 'timeline', label: '事件时间线' },
] as const;

type TabId = typeof TABS[number]['id'];

const activeTab = ref<TabId>('outline');
const materials = useContinuationMaterials();
const outlineDraft = ref('');
const outlineError = ref('');
const outlineDirty = ref(false);
const clearPending = ref(false);

const reversedTimeline = computed(() => (props.task ? [...props.task.timeline].reverse() : []));

function stageTotalTurns(stage: ContinuationStage_ACU): number {
  return stage.revisions.find(item => item.revision === stage.activeRevision)?.outline.totalTurns ?? 0;
}

function syncOutlineDraft(): void {
  outlineDraft.value = props.activeRevision ? JSON.stringify(props.activeRevision.outline, null, 2) : '';
  outlineError.value = '';
  outlineDirty.value = false;
}

function onOutlineInput(value: string): void {
  outlineDraft.value = value;
  outlineDirty.value = true;
}

function saveOutline(): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outlineDraft.value);
  } catch (error) {
    outlineError.value = error instanceof Error ? `大纲 JSON 无法解析：${error.message}` : '大纲 JSON 无法解析';
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    outlineError.value = '大纲必须是 JSON 对象';
    return;
  }
  outlineError.value = '';
  emit('save-outline', parsed as StageOutline_ACU);
}

function reload(): void {
  materials.reload();
  syncOutlineDraft();
}

function requestClear(): void {
  clearPending.value = true;
}

function confirmClear(): void {
  clearPending.value = false;
  emit('clear');
}

onMounted(reload);

/** 权威大纲变更（Agent 改写、保存成功）后重置草稿；用户正在编辑时不覆盖他的输入。 */
watch(() => `${props.activeStage?.stageId ?? ''}:${props.activeRevision?.revision ?? ''}`, () => {
  if (!outlineDirty.value) syncOutlineDraft();
}, { immediate: true });

defineExpose({ reload });
</script>

<style scoped>
.acu-v2-continuation-materials { display: grid; gap: 12px; }
.acu-v2-continuation-materials__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acu-v2-continuation-materials__tab { padding: 5px 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 999px; background: transparent; color: var(--acu-text-2); cursor: pointer; font: inherit; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__tab--active { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 55%, transparent); background: color-mix(in srgb, var(--acu-primary, #5b8def) 14%, transparent); color: var(--acu-text-1); }
.acu-v2-continuation-materials__tab-actions { display: flex; gap: 6px; margin-left: auto; }
.acu-v2-continuation-materials__confirm { margin: 0; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 40%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--acu-danger, #d65b5b) 7%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__confirm-actions { display: inline-flex; gap: 6px; margin-left: 8px; vertical-align: middle; }
.acu-v2-continuation-materials__editor { display: grid; gap: 8px; }
.acu-v2-continuation-materials__empty { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-materials__error { margin: 0; color: var(--acu-danger, #d65b5b); white-space: pre-wrap; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.acu-v2-continuation-materials__block { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 6px; }
.acu-v2-continuation-materials__block > summary { cursor: pointer; color: var(--acu-text-1); }
.acu-v2-continuation-materials__list, .acu-v2-continuation-materials__timeline { display: flex; flex-direction: column; gap: 6px; padding-left: 22px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
/* 带 max-height 的滚动列表不用 grid：行会被压缩到最小贡献导致条目压扁（同会话流的修复）。 */
.acu-v2-continuation-materials__timeline { max-height: 320px; overflow-y: auto; }
.acu-v2-continuation-materials__timeline > li { flex: 0 0 auto; }

/* 手机窄屏：刷新/清空按钮换到独立一行靠右，避免和页签挤成两行半。 */
@media (max-width: 640px) {
  .acu-v2-continuation-materials__tab-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
  .acu-v2-continuation-materials__confirm-actions { display: flex; margin: 8px 0 0; }
}
</style>

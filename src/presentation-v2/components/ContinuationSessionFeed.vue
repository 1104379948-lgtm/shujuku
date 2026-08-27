<template>
  <div ref="feedElement" class="acu-v2-session-feed">
    <p v-if="!entries.length" class="acu-v2-session-feed__empty">
      还没有运行记录。点击「继续当前轮次」后，主 Agent 的思考、派工、大纲操作与交付过程会实时显示在这里。
    </p>
    <template v-for="entry in entries" :key="entry.id">
      <!-- 运行分隔条：一次运行（或恢复）的起点 -->
      <div v-if="entry.kind === 'run_started' || entry.kind === 'run_resumed'" class="acu-v2-session-feed__run-divider">
        <span class="acu-v2-session-feed__run-divider-badge">{{ entry.kind === 'run_resumed' ? '恢复运行' : '开始运行' }}</span>
        <span class="acu-v2-session-feed__run-divider-title">{{ entry.title }}</span>
        <span class="acu-v2-session-feed__time">{{ formatTime(entry.at) }}</span>
      </div>

      <!-- 用户消息：右对齐气泡，和 coding agent 的对话界面一致 -->
      <div v-else-if="entry.kind === 'user_message'" class="acu-v2-session-feed__user">
        <div class="acu-v2-session-feed__user-bubble">
          <p class="acu-v2-session-feed__user-text">{{ entry.detail || entry.title }}</p>
          <span class="acu-v2-session-feed__time">{{ formatTime(entry.at) }}</span>
        </div>
      </div>

      <!-- 思考条目：弱化渲染，像 coding agent 的推理气泡 -->
      <div v-else-if="entry.kind === 'thought'" class="acu-v2-session-feed__thought">
        <span class="acu-v2-session-feed__thought-label">{{ entry.title }}</span>
        <p v-if="entry.detail" class="acu-v2-session-feed__thought-text">{{ entry.detail }}</p>
      </div>

      <!-- 工具调用卡片：派工 / 大纲 / 重试 / 交付 / 终态 -->
      <div
        v-else
        class="acu-v2-session-feed__card"
        :class="[`acu-v2-session-feed__card--${entry.kind}`, `acu-v2-session-feed__card--${entry.status}`]"
      >
        <button type="button" class="acu-v2-session-feed__card-head" @click="toggle(entry)">
          <span class="acu-v2-session-feed__status" :class="`acu-v2-session-feed__status--${entry.status}`">
            <span v-if="entry.status === 'running'" class="acu-v2-session-feed__spinner" />
            <template v-else-if="entry.status === 'failed'">✕</template>
            <template v-else>✓</template>
          </span>
          <span class="acu-v2-session-feed__badge">{{ kindLabel(entry) }}</span>
          <span class="acu-v2-session-feed__title">{{ entry.title }}</span>
          <span class="acu-v2-session-feed__time">{{ formatTime(entry.at) }}</span>
          <span v-if="entry.detail" class="acu-v2-session-feed__chevron" :class="{ 'acu-v2-session-feed__chevron--open': isExpanded(entry) }">▾</span>
        </button>
        <p v-if="entry.detail && !isExpanded(entry)" class="acu-v2-session-feed__preview" @click="toggle(entry)">{{ entry.detail }}</p>
        <p v-if="entry.detail && isExpanded(entry)" class="acu-v2-session-feed__detail">{{ entry.detail }}</p>
      </div>
    </template>
    <div v-if="running" class="acu-v2-session-feed__running">
      <span class="acu-v2-session-feed__pulse" />主 Agent 正在工作…
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { AgentSessionEntry_ACU } from '../../service/continuation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  entries: AgentSessionEntry_ACU[];
  running: boolean;
}>();

const feedElement = ref<HTMLElement | null>(null);
/** 用户手动展开/收起的覆盖表；未覆盖时按条目类型取默认展开态。 */
const expandedOverrides = ref<Record<number, boolean>>({});

const KIND_LABELS: Record<AgentSessionEntry_ACU['kind'], string> = {
  run_started: '开始',
  run_resumed: '恢复',
  user_message: '你',
  thought: '思考',
  main_action: '主 Agent',
  protocol_retry: '重试',
  delegation: '子代理',
  outline_op: '大纲',
  finalize: '交付',
  block: '阻断',
  run_failed: '失败',
  run_completed: '完成',
};

function kindLabel(entry: AgentSessionEntry_ACU): string {
  if (entry.kind === 'delegation' && entry.agentName) return entry.agentName;
  if (entry.kind === 'outline_op' && entry.agentName) return entry.agentName;
  return KIND_LABELS[entry.kind];
}

/** 失败与终态条目默认展开（用户需要立刻看到原因/结果），过程性条目默认折叠。 */
function defaultExpanded(entry: AgentSessionEntry_ACU): boolean {
  if (entry.status === 'failed') return true;
  return entry.kind === 'finalize' || entry.kind === 'run_completed' || entry.kind === 'run_failed' || entry.kind === 'block';
}

function isExpanded(entry: AgentSessionEntry_ACU): boolean {
  return expandedOverrides.value[entry.id] ?? defaultExpanded(entry);
}

function toggle(entry: AgentSessionEntry_ACU): void {
  if (!entry.detail) return;
  expandedOverrides.value = { ...expandedOverrides.value, [entry.id]: !isExpanded(entry) };
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}

watch(() => props.entries.length, async () => {
  await nextTick();
  const element = feedElement.value;
  if (element) element.scrollTop = element.scrollHeight;
});
</script>

<style scoped>
/* 纵向列表必须用 flex 列而不是 grid：容器带 max-height 时 grid 会把行压缩到最小贡献，
   而卡片（overflow: hidden）的最小贡献是 0——条目会被纵向压扁成一条条细线。
   flex 列 + 子项 flex: none 保证每个条目始终保持内容高度，超出部分滚动。 */
.acu-v2-session-feed { display: flex; flex-direction: column; gap: 6px; max-height: 460px; overflow-y: auto; padding: 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--acu-bg-2) 60%, transparent); }
.acu-v2-session-feed > * { flex: 0 0 auto; }
.acu-v2-session-feed__empty { margin: 0; padding: 18px 8px; color: var(--acu-text-3); text-align: center; font-size: var(--acu-font-size-body, 12px); }

/* 运行分隔条 */
.acu-v2-session-feed__run-divider { display: flex; align-items: center; gap: 8px; padding: 4px 2px; margin-top: 4px; }
.acu-v2-session-feed__run-divider::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--acu-text-3) 24%, transparent); }
.acu-v2-session-feed__run-divider-badge { flex: none; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-primary, #5b8def) 18%, transparent); color: var(--acu-primary, #5b8def); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__run-divider-title { color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }

/* 用户消息气泡 */
.acu-v2-session-feed__user { display: flex; justify-content: flex-end; padding: 4px 2px; }
.acu-v2-session-feed__user-bubble { max-width: 82%; padding: 7px 11px; border-radius: 10px 10px 2px 10px; background: color-mix(in srgb, var(--acu-primary, #5b8def) 16%, var(--acu-bg-2)); border: 1px solid color-mix(in srgb, var(--acu-primary, #5b8def) 28%, transparent); }
.acu-v2-session-feed__user-text { margin: 0; color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-session-feed__user-bubble .acu-v2-session-feed__time { display: block; margin: 3px 0 0; text-align: right; }

/* 思考条目 */
.acu-v2-session-feed__thought { padding: 2px 4px 2px 10px; border-left: 2px solid color-mix(in srgb, var(--acu-text-3) 30%, transparent); }
.acu-v2-session-feed__thought-label { color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__thought-text { margin: 2px 0 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); font-style: italic; white-space: pre-wrap; word-break: break-word; }

/* 工具调用卡片 */
.acu-v2-session-feed__card { border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 8px; background: var(--acu-bg-2); animation: acu-v2-session-feed-in 0.18s ease-out; overflow: hidden; }
.acu-v2-session-feed__card--delegation, .acu-v2-session-feed__card--outline_op, .acu-v2-session-feed__card--protocol_retry { margin-left: 16px; }
.acu-v2-session-feed__card--finalize, .acu-v2-session-feed__card--run_completed { border-left: 3px solid color-mix(in srgb, var(--acu-success, #4fa36c) 75%, transparent); background: color-mix(in srgb, var(--acu-success, #4fa36c) 7%, var(--acu-bg-2)); }
.acu-v2-session-feed__card--failed { border-left: 3px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 75%, transparent); background: color-mix(in srgb, var(--acu-danger, #d65b5b) 6%, var(--acu-bg-2)); }
.acu-v2-session-feed__card--running { border-left: 3px solid color-mix(in srgb, var(--acu-primary, #5b8def) 60%, transparent); }
.acu-v2-session-feed__card-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none; background: transparent; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.acu-v2-session-feed__status { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; }
.acu-v2-session-feed__status--done { background: color-mix(in srgb, var(--acu-success, #4fa36c) 20%, transparent); color: var(--acu-success, #4fa36c); }
.acu-v2-session-feed__status--failed { background: color-mix(in srgb, var(--acu-danger, #d65b5b) 20%, transparent); color: var(--acu-danger, #d65b5b); }
.acu-v2-session-feed__status--running { background: transparent; }
.acu-v2-session-feed__spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--acu-primary, #5b8def) 30%, transparent); border-top-color: var(--acu-primary, #5b8def); border-radius: 50%; animation: acu-v2-session-feed-spin 0.8s linear infinite; }
.acu-v2-session-feed__badge { flex: none; padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__title { color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acu-v2-session-feed__time { margin-left: auto; flex: none; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__chevron { flex: none; color: var(--acu-text-3); font-size: 10px; transition: transform 0.15s ease; }
.acu-v2-session-feed__chevron--open { transform: rotate(180deg); }
.acu-v2-session-feed__preview { margin: 0; padding: 0 10px 7px 34px; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.acu-v2-session-feed__detail { margin: 0; padding: 0 10px 8px 34px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }

.acu-v2-session-feed__running { display: flex; align-items: center; gap: 8px; padding: 6px 10px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-session-feed__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--acu-primary, #5b8def); animation: acu-v2-session-feed-pulse 1.1s ease-in-out infinite; }
/* 手机窄屏：高度跟随视口而不是固定 460px；层级缩进与详情缩进收窄，
   横向空间留给正文；用户气泡放宽到近整行。 */
@media (max-width: 640px) {
  .acu-v2-session-feed { max-height: 62vh; padding: 8px; }
  .acu-v2-session-feed__card--delegation, .acu-v2-session-feed__card--outline_op, .acu-v2-session-feed__card--protocol_retry { margin-left: 8px; }
  .acu-v2-session-feed__card-head { padding: 7px 8px; gap: 6px; }
  .acu-v2-session-feed__preview { padding: 0 8px 7px 12px; }
  .acu-v2-session-feed__detail { padding: 0 8px 8px 12px; }
  .acu-v2-session-feed__user-bubble { max-width: 94%; }
}

@keyframes acu-v2-session-feed-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes acu-v2-session-feed-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes acu-v2-session-feed-spin { to { transform: rotate(360deg); } }
</style>

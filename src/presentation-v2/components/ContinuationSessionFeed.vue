<template>
  <div ref="feedElement" class="acu-v2-session-feed">
    <p v-if="!entries.length" class="acu-v2-session-feed__empty">
      还没有运行记录。点击「继续当前轮次」后，主 Agent 的思考、派工、大纲操作与交付过程会实时显示在这里。
    </p>
    <div
      v-for="entry in entries"
      :key="entry.id"
      class="acu-v2-session-feed__entry"
      :class="[`acu-v2-session-feed__entry--${entry.kind}`, { 'acu-v2-session-feed__entry--failed': !entry.ok }]"
    >
      <div class="acu-v2-session-feed__head">
        <span class="acu-v2-session-feed__badge">{{ kindLabel(entry) }}</span>
        <span class="acu-v2-session-feed__title">{{ entry.title }}</span>
        <span class="acu-v2-session-feed__time">{{ formatTime(entry.at) }}</span>
      </div>
      <p v-if="entry.detail" class="acu-v2-session-feed__detail">{{ entry.detail }}</p>
    </div>
    <div v-if="running" class="acu-v2-session-feed__running">
      <span class="acu-v2-session-feed__pulse" />主 Agent 正在工作…
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { AgentSessionEntry_ACU } from '../../service/continuation/agent/agent-session-log';

const props = defineProps<{
  entries: AgentSessionEntry_ACU[];
  running: boolean;
}>();

const feedElement = ref<HTMLElement | null>(null);

const KIND_LABELS: Record<AgentSessionEntry_ACU['kind'], string> = {
  run_started: '开始',
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
  return KIND_LABELS[entry.kind];
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
.acu-v2-session-feed { display: grid; gap: 8px; max-height: 420px; overflow-y: auto; padding: 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--acu-bg-2) 60%, transparent); }
.acu-v2-session-feed__empty { margin: 0; padding: 18px 8px; color: var(--acu-text-3); text-align: center; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-session-feed__entry { padding: 8px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); background: var(--acu-bg-2); animation: acu-v2-session-feed-in 0.18s ease-out; }
.acu-v2-session-feed__entry--run_started { border-left: 3px solid color-mix(in srgb, var(--acu-primary, #5b8def) 70%, transparent); }
.acu-v2-session-feed__entry--main_action { border-left: 3px solid color-mix(in srgb, var(--acu-primary, #5b8def) 45%, transparent); }
.acu-v2-session-feed__entry--delegation { margin-left: 18px; border-left: 3px solid color-mix(in srgb, var(--acu-text-3) 40%, transparent); }
.acu-v2-session-feed__entry--outline_op { margin-left: 18px; border-left: 3px solid color-mix(in srgb, #b98add 65%, transparent); }
.acu-v2-session-feed__entry--protocol_retry { margin-left: 18px; }
.acu-v2-session-feed__entry--finalize { border-left: 3px solid color-mix(in srgb, var(--acu-success, #4fa36c) 75%, transparent); background: color-mix(in srgb, var(--acu-success, #4fa36c) 8%, var(--acu-bg-2)); }
.acu-v2-session-feed__entry--run_completed { border-left: 3px solid color-mix(in srgb, var(--acu-success, #4fa36c) 75%, transparent); }
.acu-v2-session-feed__entry--failed { border-left: 3px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 75%, transparent); background: color-mix(in srgb, var(--acu-danger, #d65b5b) 6%, var(--acu-bg-2)); }
.acu-v2-session-feed__head { display: flex; align-items: baseline; gap: 8px; }
.acu-v2-session-feed__badge { flex: none; padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__title { color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); }
.acu-v2-session-feed__time { margin-left: auto; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-session-feed__detail { margin: 6px 0 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-session-feed__running { display: flex; align-items: center; gap: 8px; padding: 6px 10px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-session-feed__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--acu-primary, #5b8def); animation: acu-v2-session-feed-pulse 1.1s ease-in-out infinite; }
@keyframes acu-v2-session-feed-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes acu-v2-session-feed-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
</style>

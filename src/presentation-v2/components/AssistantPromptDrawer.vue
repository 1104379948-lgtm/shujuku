<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑 AI 改表助手提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <AcuInfoBanner tone="info">
      提示词段按顺序拼接进 AI 请求。可用占位符：
      <code>{{ placeholder }}</code>
      表示在运行时替换为两份本地语法文档的原文嵌入内容。
    </AcuInfoBanner>

    <div class="acu-assistant-prompt-drawer__toolbar">
      <AcuFileButton size="sm" accept="application/json,.json" @file="$emit('import-file', $event)">
        <i class="fa-solid fa-download"></i> 导入 JSON
      </AcuFileButton>
      <AcuButton size="sm" @click="$emit('export')">
        <i class="fa-solid fa-upload"></i> 导出 JSON
      </AcuButton>
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :show-slot="false"
      :rows="8"
      empty-text="暂无提示词段。点击下方按钮添加第一段。"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-assistant-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuFileButton from './_lib/AcuFileButton.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments, { type PromptSegment } from './_lib/AcuPromptSegments.vue';
import { useDialogStore } from '../stores/dialog-store';
import { TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU } from '../../service/template-assistant/service';

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: { kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'import-file', file: File): void;
  (e: 'export'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const placeholder = TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU;
const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-assistant-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-assistant-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>

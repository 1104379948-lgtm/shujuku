import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  isAgentSessionRunning_ACU,
  readAgentSessionLog_ACU,
  subscribeAgentSessionLog_ACU,
  type AgentSessionEntry_ACU,
} from '../../service/continuation/agent/agent-session-log';

/**
 * 订阅智能续写 Agent 的会话日志。
 * 返回响应式的会话条目与运行标记，供会话流面板实时渲染；组件卸载时自动退订。
 */
export function useContinuationSession() {
  const entries = ref<AgentSessionEntry_ACU[]>(readAgentSessionLog_ACU());
  const running = ref(isAgentSessionRunning_ACU());
  let unsubscribe: (() => void) | null = null;

  function sync(): void {
    entries.value = readAgentSessionLog_ACU();
    running.value = isAgentSessionRunning_ACU();
  }

  onMounted(() => {
    unsubscribe = subscribeAgentSessionLog_ACU(sync);
    sync();
  });
  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { entries, running };
}

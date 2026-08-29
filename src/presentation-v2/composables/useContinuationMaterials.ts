import { ref } from 'vue';
import {
  readAgentModuleSnapshot_ACU,
  replaceAgentModuleSnapshotByUser_ACU,
} from '../../service/continuation/agent/agent-module-store';
import { ContinuationValidationError_ACU } from '../../service/continuation/model';
import type { AgentModuleSnapshot_ACU } from '../../service/continuation/agent/agent-model';
import { useToastStore } from '../stores/toast-store';

function errorMessage_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : '资料操作失败';
}

/** 用户可编辑的三项资料。schemaVersion 等运行时字段不进草稿，避免用户改坏结构版本。 */
function toDraft_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  return JSON.stringify({ hooks: snapshot.hooks, infoGap: snapshot.infoGap, constraints: snapshot.constraints }, null, 2);
}

/**
 * 本地资料快照的阅览与编辑。
 *
 * 读取直接走楼层锚定存储（资料不在首楼信封里，与任务生命周期无关）；保存走领域层的
 * 用户写入路径，由它执行结构校验并推进修订号，页面不自行拼装快照对象。
 */
export function useContinuationMaterials() {
  const toast = useToastStore();
  const snapshot = ref<AgentModuleSnapshot_ACU | null>(null);
  const draft = ref('');
  const error = ref('');
  const saving = ref(false);
  const dirty = ref(false);

  function reload(): void {
    try {
      const current = readAgentModuleSnapshot_ACU();
      snapshot.value = current;
      draft.value = toDraft_ACU(current);
      error.value = '';
      dirty.value = false;
    } catch (caught) {
      snapshot.value = null;
      draft.value = '';
      error.value = errorMessage_ACU(caught);
    }
  }

  function updateDraft(value: string): void {
    draft.value = value;
    dirty.value = true;
  }

  async function save(): Promise<boolean> {
    if (saving.value) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft.value);
    } catch (caught) {
      error.value = caught instanceof Error ? `资料 JSON 无法解析：${caught.message}` : '资料 JSON 无法解析';
      return false;
    }
    saving.value = true;
    try {
      const saved = await replaceAgentModuleSnapshotByUser_ACU(parsed);
      snapshot.value = saved;
      draft.value = toDraft_ACU(saved);
      error.value = '';
      dirty.value = false;
      toast.success('资料已保存，修订号已推进。');
      return true;
    } catch (caught) {
      error.value = errorMessage_ACU(caught);
      return false;
    } finally {
      saving.value = false;
    }
  }

  return { snapshot, draft, dirty, error, saving, reload, save, updateDraft };
}

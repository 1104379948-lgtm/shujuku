import { computed, type Ref } from 'vue';
import { getChatArray_ACU } from '../../service/chat/chat-service';
import {
  currentJsonTableData_ACU,
  getCurrentIsolationKey_ACU,
} from '../../service/runtime/state-manager';
import { collectCheckpointGenerationStatusV2_ACU } from '../../service/table/storage-frame-v2-persist';

export function useFormFillCheckpointStatus(refreshTick: Ref<number>, settingsFingerprint: Ref<string>) {
  return computed(() => {
    void refreshTick.value;
    void settingsFingerprint.value;
    return collectCheckpointGenerationStatusV2_ACU(
      getChatArray_ACU(),
      getCurrentIsolationKey_ACU(),
      currentJsonTableData_ACU || null,
    );
  });
}

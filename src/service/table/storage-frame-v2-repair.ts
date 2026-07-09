import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { normalizeV2OperationLogToSingleTableRecords_ACU } from './storage-frame-v2-normalize';

export async function repairCurrentChatV2OperationLogToSingleTableRecords_ACU(
  mode: 'on_import' | 'repair' = 'repair',
): Promise<{ success: boolean; changed: boolean; errors: string[] }> {
  const result = normalizeV2OperationLogToSingleTableRecords_ACU({
    chat: getChatArray_ACU(),
    isolationKey: getCurrentIsolationKey_ACU(),
    mode,
  });
  if (result.errors.length > 0) return { success: false, changed: false, errors: result.errors };
  if (result.changed) await saveChatToHost_ACU();
  return { success: true, changed: result.changed, errors: [] };
}

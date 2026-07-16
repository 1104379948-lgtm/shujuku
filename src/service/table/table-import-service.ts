import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { getChatArray_ACU } from '../chat/chat-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { sanitizeChatSheetsObject_ACU } from '../template/chat-scope';
import { ensureStorageProviderReady_ACU } from './table-storage-strategy';
import { replaceRuntimeDataStrict_ACU, runRuntimeDataReplaceCommit_ACU } from './table-update-commit';

export interface ImportTableJsonCommitResult_ACU {
  success: boolean;
  messageIndex?: number;
  tableData?: TableDataObject_ACU;
  sheetKeys?: string[];
  hasSummaryTables?: boolean;
  persisted?: boolean;
  error?: string;
}

export interface ImportTableJsonOptions_ACU {
  /** true: 外部导入并写入聊天持久化；false: 删除楼层/备份恢复后只恢复运行时，不制造新的 V2 持久化事件。 */
  persist?: boolean;
}

function resolveLatestAiMessageIndex_ACU(): number {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return -1;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i] && !chat[i].is_user) return i;
  }
  return -1;
}

export async function importTableJsonThroughCommit_ACU(
  jsonString: string,
  options: ImportTableJsonOptions_ACU = {},
): Promise<ImportTableJsonCommitResult_ACU> {
  const newData = JSON.parse(jsonString);
  if (!newData || !newData.mate || !Object.keys(newData).some(k => k.startsWith('sheet_'))) {
    return { success: false, error: '导入的JSON缺少关键结构 (mate, sheet_*)。' };
  }

  const importedTableData = sanitizeChatSheetsObject_ACU(newData, { ensureMate: true }) as TableDataObject_ACU;
  const sheetKeys = Object.keys(importedTableData).filter(k => k.startsWith('sheet_'));
  const persist = options.persist !== false;

  if (!persist) {
    try {
      const provider = await ensureStorageProviderReady_ACU();
      const runtimeData = await replaceRuntimeDataStrict_ACU(provider, importedTableData);
      const runtimeSheetKeys = Object.keys(runtimeData).filter(k => k.startsWith('sheet_'));
      const hasSummaryTables = runtimeSheetKeys.some(k => {
          const table = (runtimeData as any)?.[k];
          return Boolean(table?.name && isSummaryOrOutlineTable_ACU(table.name));
        });
      return {
        success: true,
        tableData: runtimeData,
        sheetKeys: runtimeSheetKeys,
        hasSummaryTables,
        persisted: false,
      };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  const targetMessageIndex = resolveLatestAiMessageIndex_ACU();

  const commitResult = await runRuntimeDataReplaceCommit_ACU<boolean>({
    source: 'import',
    reason: 'importTableAsJson',
    isolationKey: getCurrentIsolationKey_ACU(),
    writeSet: [{ kind: 'all' }],
    revisionWriteSet: [{ kind: 'all' }],
    initialData: currentJsonTableData_ACU,
    targetMessageIndex,
    targetSheetKeys: sheetKeys,
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    replacementData: importedTableData,
    replacementReason: 'import',
    mapValue: () => true,
  });

  if (!commitResult.success || !commitResult.tableData) {
    return { success: false, error: commitResult.error || '导入数据提交失败。' };
  }

  const hasSummaryTables = Object.keys(commitResult.tableData)
    .filter(k => k.startsWith('sheet_'))
    .some(k => {
      const table = (commitResult.tableData as any)?.[k];
      return Boolean(table?.name && isSummaryOrOutlineTable_ACU(table.name));
    });

  return {
    success: true,
    messageIndex: commitResult.messageIndex ?? targetMessageIndex,
    tableData: commitResult.tableData,
    sheetKeys: Object.keys(commitResult.tableData).filter(k => k.startsWith('sheet_')),
    hasSummaryTables,
    persisted: true,
  };
}

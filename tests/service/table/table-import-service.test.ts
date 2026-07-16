import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChatArray: vi.fn(),
  getCurrentIsolationKey: vi.fn(() => ''),
  sanitizeChatSheetsObject: vi.fn((data: any) => data),
  provider: { mode: 'native', getCurrentData: vi.fn() },
  replaceRuntimeDataStrict: vi.fn(),
  runRuntimeDataReplaceCommit: vi.fn(),
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: mocks.getChatArray,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: { mate: { type: 'acu', version: 1 } },
  getCurrentIsolationKey_ACU: mocks.getCurrentIsolationKey,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  sanitizeChatSheetsObject_ACU: mocks.sanitizeChatSheetsObject,
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => mocks.provider),
}));

vi.mock('../../../src/service/table/table-update-commit', () => ({
  replaceRuntimeDataStrict_ACU: mocks.replaceRuntimeDataStrict,
  runRuntimeDataReplaceCommit_ACU: mocks.runRuntimeDataReplaceCommit,
}));

vi.mock('../../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要') || name.includes('总结')),
}));

import { importTableJsonThroughCommit_ACU } from '../../../src/service/table/table-import-service';

describe('importTableJsonThroughCommit_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChatArray.mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    mocks.runRuntimeDataReplaceCommit.mockImplementation(async (options: any) => {
      return {
        success: true,
        value: options.mapValue(options.replacementData),
        tableData: options.replacementData,
        messageIndex: options.targetMessageIndex,
      };
    });
  });

  it('外部导入会写入聊天持久化，但不推进自动更新楼层标记', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
      sheet_1: { name: '背包', content: [['row_id', '物品']] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(true);
    expect(mocks.runRuntimeDataReplaceCommit).toHaveBeenCalledWith(expect.objectContaining({
      source: 'import',
      reason: 'importTableAsJson',
      targetMessageIndex: 1,
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: null,
      trackingSheetKeys: [],
      trackAsUpdate: false,
      replacementData: importedData,
      replacementReason: 'import',
    }));
  });

  it('删除楼层/备份恢复模式只恢复运行时，不写新的持久化事件', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
    };
    mocks.replaceRuntimeDataStrict.mockResolvedValue(importedData);

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData), { persist: false });

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.tableData).toEqual(importedData);
    expect(mocks.replaceRuntimeDataStrict).toHaveBeenCalledWith(mocks.provider, importedData);
    expect(mocks.runRuntimeDataReplaceCommit).not.toHaveBeenCalled();
  });
});

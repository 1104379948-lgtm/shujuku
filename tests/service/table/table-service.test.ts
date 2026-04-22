/**
 * tests/service/table/table-service.test.ts
 * 表格数据操作 service 层 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockCurrentJsonTableDataRef,
  mockGetCurrentIsolationKey,
  mockSetCurrentJsonTableData,
  mockGetChatArray,
  mockSaveChatToHost,
  mockParseTableTemplateJson,
  mockIsSummaryOrOutlineTable,
  mockApplyTemplateScopeForCurrentChat,
  mockGetChatSheetGuideData,
  mockSetChatSheetGuideData,
  mockBuildChatSheetGuideData,
  mockGetSortedSheetKeys,
  mockSanitizeSheetForStorage,
  mockAttachSeedRows,
  mockEnsureChatSheetGuideSeeded,
  mockDeleteAllGeneratedEntries,
  mockMergeAllIndependentTables,
  mockCloneIsolatedData,
  mockWriteIsolatedTagData,
  mockWriteMessageIdentity,
  mockWriteLegacyCompatData,
  mockWriteLegacyStandardAndSummary,
  mockReadIsolatedTagData,
  mockReadLegacyIndependentData,
  mockIsLegacyMatchForIsolation,
} = vi.hoisted(() => {
  const mockCurrentJsonTableDataRef = {
    value: {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
      sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
    } as any,
  };
  return {
    mockSettings: {
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    } as any,
    mockCurrentJsonTableDataRef,
    mockGetCurrentIsolationKey: vi.fn(() => ''),
    mockSetCurrentJsonTableData: vi.fn((value: any) => { mockCurrentJsonTableDataRef.value = value; }),
    mockGetChatArray: vi.fn(),
    mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
    mockParseTableTemplateJson: vi.fn(),
    mockIsSummaryOrOutlineTable: vi.fn((name: string) => name.includes('纪要') || name.includes('总结') || name.includes('大纲')),
    mockApplyTemplateScopeForCurrentChat: vi.fn(),
    mockGetChatSheetGuideData: vi.fn(() => null),
    mockSetChatSheetGuideData: vi.fn(),
    mockBuildChatSheetGuideData: vi.fn(() => null),
    mockGetSortedSheetKeys: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
    mockSanitizeSheetForStorage: vi.fn((sheet: any) => sheet),
    mockAttachSeedRows: vi.fn(),
    mockEnsureChatSheetGuideSeeded: vi.fn().mockResolvedValue(null),
    mockDeleteAllGeneratedEntries: vi.fn().mockResolvedValue(undefined),
    mockMergeAllIndependentTables: vi.fn(),
    mockCloneIsolatedData: vi.fn(() => ({})),
    mockWriteIsolatedTagData: vi.fn(),
    mockWriteMessageIdentity: vi.fn(),
    mockWriteLegacyCompatData: vi.fn(),
    mockWriteLegacyStandardAndSummary: vi.fn(),
    mockReadIsolatedTagData: vi.fn(() => null),
    mockReadLegacyIndependentData: vi.fn(() => null),
    mockIsLegacyMatchForIsolation: vi.fn(() => false),
  };
});

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: mockIsSummaryOrOutlineTable,
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: mockApplyTemplateScopeForCurrentChat,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  attachSeedRowsToCurrentDataFromGuide_ACU: mockAttachSeedRows,
  buildChatSheetGuideDataFromData_ACU: mockBuildChatSheetGuideData,
  ensureChatSheetGuideSeeded_ACU: mockEnsureChatSheetGuideSeeded,
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideData,
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
  sanitizeSheetForStorage_ACU: mockSanitizeSheetForStorage,
  setChatSheetGuideDataForIsolationKey_ACU: mockSetChatSheetGuideData,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: mockDeleteAllGeneratedEntries,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  mergeAllIndependentTables_ACU: mockMergeAllIndependentTables,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: mockCloneIsolatedData,
  writeIsolatedTagData_ACU: mockWriteIsolatedTagData,
  writeMessageIdentity_ACU: mockWriteMessageIdentity,
  writeLegacyCompatData_ACU: mockWriteLegacyCompatData,
  writeLegacyStandardAndSummary_ACU: mockWriteLegacyStandardAndSummary,
  readIsolatedTagData_ACU: mockReadIsolatedTagData,
  readLegacyIndependentData_ACU: mockReadLegacyIndependentData,
  isLegacyMatchForIsolation_ACU: mockIsLegacyMatchForIsolation,
}));

import {
  saveIndependentTableToChatHistory_ACU,
  checkIfFirstTimeInit_ACU,
  loadOrCreateJsonTableFromChatHistory_ACU,
} from '../../../src/service/table/table-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentJsonTableDataRef.value = {
    sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
  };
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockCloneIsolatedData.mockReturnValue({});
  mockGetChatSheetGuideData.mockReturnValue(null);
  mockSaveChatToHost.mockResolvedValue(undefined);
});

// ═══ saveIndependentTableToChatHistory_ACU ═══
describe('saveIndependentTableToChatHistory_ACU', () => {
  it('currentJsonTableData 为 null 时返回 saved=false', async () => {
    mockCurrentJsonTableDataRef.value = null;
    const result = await saveIndependentTableToChatHistory_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('null');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('聊天记录为空时返回 saved=false', async () => {
    mockGetChatArray.mockReturnValue([]);
    const result = await saveIndependentTableToChatHistory_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('无 AI 消息时返回 saved=false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    const result = await saveIndependentTableToChatHistory_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('no AI message');
  });

  it('正常保存到最后一条 AI 消息，写入隔离数据和 legacy 数据', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
      aiMsg,
    ]);

    const result = await saveIndependentTableToChatHistory_ACU();

    expect(result.saved).toBe(true);
    expect(result.messageIndex).toBe(1);
    // 验证隔离数据写入
    expect(mockWriteIsolatedTagData).toHaveBeenCalledTimes(1);
    expect(mockWriteMessageIdentity).toHaveBeenCalledTimes(1);
    expect(mockWriteLegacyCompatData).toHaveBeenCalledTimes(1);
    expect(mockWriteLegacyStandardAndSummary).toHaveBeenCalledTimes(1);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('指定 targetMessageIndex 时保存到指定 AI 消息', async () => {
    const aiMsg0: any = { is_user: false, mes: 'AI回复0' };
    const aiMsg1: any = { is_user: false, mes: 'AI回复1' };
    mockGetChatArray.mockReturnValue([aiMsg0, { is_user: true }, aiMsg1]);

    const result = await saveIndependentTableToChatHistory_ACU(0);

    expect(result.saved).toBe(true);
    expect(result.messageIndex).toBe(0);
  });

  it('指定 targetSheetKeys 时只保存部分表，并记录 modifiedKeys', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: ['sheet_0'], updateGroupKeys: [] },
    });

    const result = await saveIndependentTableToChatHistory_ACU(-1, ['sheet_1'], ['group_A']);

    expect(result.saved).toBe(true);
    // writeIsolatedTagData 应被调用，且 tagData 中 modifiedKeys 包含 sheet_1
    expect(mockWriteIsolatedTagData).toHaveBeenCalledTimes(1);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.modifiedKeys).toContain('sheet_0');
    expect(writtenTagData.modifiedKeys).toContain('sheet_1');
    expect(writtenTagData.updateGroupKeys).toContain('group_A');
  });
});

// ═══ checkIfFirstTimeInit_ACU ═══
describe('checkIfFirstTimeInit_ACU', () => {
  it('空聊天记录返回 true', async () => {
    mockGetChatArray.mockReturnValue([]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });

  it('有隔离数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue({
      independentData: { sheet_0: { name: '表', content: [] } },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('有 legacy 数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue(null);
    mockIsLegacyMatchForIsolation.mockReturnValue(true);
    mockReadLegacyIndependentData.mockReturnValue({
      sheet_0: { name: '表', content: [] },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('只有用户消息时返回 true', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });
});

// ═══ loadOrCreateJsonTableFromChatHistory_ACU ═══
describe('loadOrCreateJsonTableFromChatHistory_ACU', () => {
  it('空聊天记录时触发初始化，返回 source=initialized', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });
    // initializeJsonTableInChatHistory 内部会调用 _set_currentJsonTableData_ACU
    // 然后检查 currentJsonTableData_ACU 是否为 null
    // 由于 mockSetCurrentJsonTableData 会更新 mockCurrentJsonTableDataRef.value
    // 所以 parseTableTemplateJson 返回非 null 时，initialized=true

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
    expect(mockApplyTemplateScopeForCurrentChat).toHaveBeenCalledTimes(1);
    expect(mockDeleteAllGeneratedEntries).toHaveBeenCalledTimes(1);
  });

  it('有合并数据时返回 source=merged', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    const mergedData = {
      sheet_0: { name: '合并表', content: [['row_id', '列1'], ['1', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('merged');
    expect(result.loaded).toBe(true);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(mergedData);
  });

  it('无合并数据时触发初始化', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
  });

  it('模板解析失败时返回 loaded=false', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockImplementation(() => { throw new Error('模板格式错误'); });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.loaded).toBe(false);
    expect(result.error).toBeDefined();
  });
});
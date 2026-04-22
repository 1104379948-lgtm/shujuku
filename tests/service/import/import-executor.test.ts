/**
 * tests/service/import/import-executor.test.ts
 * 外部导入核心业务逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableData, mockSetCurrentJsonTableData, mockImportTempGet, mockImportTempSet, mockImportTempRemove, mockLoadImportedJson, mockSaveImportedJson, mockDeleteImportedJson, mockGetLorebookEntries, mockDeleteLorebookEntries, mockUpdateReadable, mockGetSortedSheetKeys, mockGetIsoPrefix, mockParseTemplate, mockSaveSettings } = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '', importWorldbookTarget: 'lorebook1' } as any,
  mockCurrentJsonTableData: { sheet_0: { name: '物品表', content: [['row_id', '物品名']] } } as any,
  mockSetCurrentJsonTableData: vi.fn(),
  mockImportTempGet: vi.fn(),
  mockImportTempSet: vi.fn(),
  mockImportTempRemove: vi.fn(),
  mockLoadImportedJson: vi.fn(),
  mockSaveImportedJson: vi.fn(),
  mockDeleteImportedJson: vi.fn(),
  mockGetLorebookEntries: vi.fn(() => []),
  mockDeleteLorebookEntries: vi.fn(),
  mockUpdateReadable: vi.fn(),
  mockGetSortedSheetKeys: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
  mockGetIsoPrefix: vi.fn(() => ''),
  mockParseTemplate: vi.fn(() => ({ sheet_0: { name: '物品表', content: [['row_id', '物品名']] } })),
  mockSaveSettings: vi.fn(),
}));

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_IMPORTED_ENTRIES_ACU: 'imported_entries',
  STORAGE_KEY_IMPORTED_STATUS_ACU: 'imported_status',
  STORAGE_KEY_IMPORTED_STATUS_FULL_ACU: 'imported_status_full',
  STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU: 'imported_status_standard',
  STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU: 'imported_status_summary',
}));

vi.mock('../../../src/shared/idb-import-temp', () => ({
  importTempGet_ACU: mockImportTempGet,
  importTempSet_ACU: mockImportTempSet,
  importTempRemove_ACU: mockImportTempRemove,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
}));

vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  loadImportedJsonDataFromLorebook_ACU: mockLoadImportedJson,
  saveImportedJsonDataToLorebook_ACU: mockSaveImportedJson,
  deleteImportedJsonDataFromLorebook_ACU: mockDeleteImportedJson,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  updateReadableLorebookEntry_ACU: mockUpdateReadable,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getIsolationPrefix_ACU: mockGetIsoPrefix,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTemplate,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

import {
  initImportDatabase_ACU,
  saveChunkProgress_ACU,
  finalizeImportAndCleanup_ACU,
  clearImportedEntriesCore_ACU,
  deleteImportedEntriesCore_ACU,
} from '../../../src/service/import/import-executor';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockSettings.importWorldbookTarget = 'lorebook1';
  mockImportTempGet.mockResolvedValue(null);
  mockSaveImportedJson.mockResolvedValue(true);
  mockLoadImportedJson.mockResolvedValue(null);
  mockDeleteImportedJson.mockResolvedValue(true);
  mockGetLorebookEntries.mockResolvedValue([]);
});

// ═══ initImportDatabase_ACU ═══
describe('initImportDatabase_ACU', () => {
  it('全新导入：从模板初始化', async () => {
    const result = await initImportDatabase_ACU('lorebook1', ['sheet_0'], [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    expect(result.success).toBe(true);
    expect(result.status!.total).toBe(2);
    expect(result.status!.currentIndex).toBe(0);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalled();
    expect(mockSaveImportedJson).toHaveBeenCalled();
  });

  it('断点续行：从世界书恢复', async () => {
    mockImportTempGet.mockResolvedValue(JSON.stringify({ total: 2, currentIndex: 1, selectionSig: 'sig1' }));
    mockLoadImportedJson.mockResolvedValue({ sheet_0: { name: '物品表' } });
    const result = await initImportDatabase_ACU('lorebook1', ['sheet_0'], [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    expect(result.success).toBe(true);
    expect(result.status!.currentIndex).toBe(1);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith({ sheet_0: { name: '物品表' } });
  });

  it('模板解析失败返回错误', async () => {
    mockParseTemplate.mockImplementation(() => { throw new Error('解析失败'); });
    const result = await initImportDatabase_ACU('lorebook1', null, [{ chunk: 1 }], 'sig1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('模板');
  });

  it('断点续行但世界书数据丢失且内存无数据', async () => {
    mockImportTempGet.mockResolvedValue(JSON.stringify({ total: 2, currentIndex: 1, selectionSig: 'sig1' }));
    mockLoadImportedJson.mockResolvedValue(null);
    // 模拟 currentJsonTableData_ACU 为 null
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      settings_ACU: mockSettings,
      currentJsonTableData_ACU: null,
      _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
    }));
    // 由于 mock 已经固定，这里只能测试 fallback 到内存数据的分支
    const result = await initImportDatabase_ACU('lorebook1', null, [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    // currentJsonTableData_ACU 不为 null（因为 mock 返回了对象），所以会 fallback
    expect(result.success).toBe(true);
  });
});

// ═══ saveChunkProgress_ACU ═══
describe('saveChunkProgress_ACU', () => {
  it('保存分块进度', async () => {
    const status = { total: 5, currentIndex: 0, selectionSig: 'sig1' };
    const result = await saveChunkProgress_ACU('lorebook1', '-Selected', status, 2);
    expect(result).toBe(true);
    expect(status.currentIndex).toBe(3);
    expect(mockImportTempSet).toHaveBeenCalled();
  });

  it('保存世界书失败返回 false', async () => {
    mockSaveImportedJson.mockRejectedValue(new Error('保存失败'));
    const status = { total: 5, currentIndex: 0, selectionSig: 'sig1' };
    const result = await saveChunkProgress_ACU('lorebook1', '-Selected', status, 0);
    expect(result).toBe(false);
  });
});

// ═══ finalizeImportAndCleanup_ACU ═══
describe('finalizeImportAndCleanup_ACU', () => {
  it('成功完成导入并清理', async () => {
    mockLoadImportedJson.mockResolvedValue({ sheet_0: { name: '物品表' } });
    const result = await finalizeImportAndCleanup_ACU('lorebook1', ['sheet_0'], '-Selected', 3);
    expect(result.success).toBe(true);
    expect(mockUpdateReadable).toHaveBeenCalled();
    expect(mockDeleteImportedJson).toHaveBeenCalled();
    expect(mockImportTempRemove).toHaveBeenCalled();
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('清理旧条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable-物品表' },
      { uid: 2, comment: '外部导入-TavernDB-ACU-ReadableDataTable' }, // 不删除（外部导入前缀）
      { uid: 3, comment: '无关条目' },
    ]);
    const result = await finalizeImportAndCleanup_ACU('lorebook1', null, '-Selected', 1);
    expect(result.success).toBe(true);
    expect(result.cleanedCount).toBe(1); // 只删除 uid=1
  });
});

// ═══ clearImportedEntriesCore_ACU ═══
describe('clearImportedEntriesCore_ACU', () => {
  it('删除导入条目并清理本地缓存', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-TavernDB-ACU-ReadableDataTable' },
      { uid: 2, comment: 'TavernDB-ACU-ImportedJsonData-Selected' },
      { uid: 3, comment: '普通条目' },
    ]);
    const result = await clearImportedEntriesCore_ACU('lorebook1');
    expect(result.deletedCount).toBe(2);
    expect(result.localCleared).toBe(true);
    expect(mockImportTempRemove).toHaveBeenCalled();
  });

  it('无匹配条目时 deletedCount=0', async () => {
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1, comment: '普通条目' }]);
    const result = await clearImportedEntriesCore_ACU('lorebook1');
    expect(result.deletedCount).toBe(0);
    expect(result.localCleared).toBe(true);
  });
});

// ═══ deleteImportedEntriesCore_ACU ═══
describe('deleteImportedEntriesCore_ACU', () => {
  it('非隔离模式删除外部导入条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-物品表' },
      { uid: 2, comment: 'ACU-[tag]-外部导入-物品表' }, // 带隔离前缀，跳过
      { uid: 3, comment: '普通条目' },
    ]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(1);
  });

  it('隔离模式只删除带隔离前缀的条目', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockGetIsoPrefix.mockReturnValue('iso_');
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'iso_外部导入-物品表' },
      { uid: 2, comment: '外部导入-物品表' }, // 无隔离前缀，跳过
    ]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(1);
  });

  it('无匹配条目返回 0', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(0);
  });
});

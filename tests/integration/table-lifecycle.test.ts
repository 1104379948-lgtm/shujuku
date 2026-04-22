/**
 * tests/integration/table-lifecycle.test.ts
 * I1 集成测试：表格数据完整生命周期
 * 验证 load → modify → save → reload 的数据一致性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 构造可变 chat 数组模拟真实存储 ──
const { mockChat, mockSettings, mockCurrentJsonTableDataRef } = vi.hoisted(() => ({
  mockChat: [] as any[],
  mockSettings: {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  } as any,
  mockCurrentJsonTableDataRef: { value: null as any },
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChat),
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要') || name.includes('总结')),
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => ({
    sheet_0: { name: '背包物品表', content: [['row_id', '物品名', '数量']], sourceData: { note: '背包' } },
    sheet_1: { name: '纪要表', content: [['row_id', '事件']], sourceData: { note: '纪要' } },
  })),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableDataRef.value = v; }),
}));

vi.mock('../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  buildChatSheetGuideDataFromData_ACU: vi.fn(() => ({ sheet_0: { headers: ['物品名', '数量'] } })),
  ensureChatSheetGuideSeeded_ACU: vi.fn().mockResolvedValue(null),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
  sanitizeSheetForStorage_ACU: vi.fn((sheet: any) => JSON.parse(JSON.stringify(sheet))),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
}));

vi.mock('../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn().mockResolvedValue(undefined),
}));

// 让 mergeAllIndependentTables_ACU 真实地从 chat 数组中读取数据
vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  mergeAllIndependentTables_ACU: vi.fn(async () => {
    // 模拟从 chat 中合并：找最后一条 AI 消息的 IsolatedData
    for (let i = mockChat.length - 1; i >= 0; i--) {
      const msg = mockChat[i];
      if (msg.is_user) continue;
      const isolated = msg.TavernDB_ACU_IsolatedData;
      if (isolated && isolated[''] && isolated[''].independentData) {
        return JSON.parse(JSON.stringify(isolated[''].independentData));
      }
    }
    return null;
  }),
}));

// 使用真实的 chat-message-data-repo（不 mock）
// 但需要 mock 它的依赖 json-helpers
vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

import {
  saveIndependentTableToChatHistory_ACU,
  loadOrCreateJsonTableFromChatHistory_ACU,
} from '../../src/service/table/table-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockChat.length = 0;
  mockCurrentJsonTableDataRef.value = null;
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
});

describe('I1: 表格数据完整生命周期', () => {
  it('空聊天 → 初始化 → 保存 → 重新加载 → 数据一致', async () => {
    // 1. 空聊天初始化
    const loadResult1 = await loadOrCreateJsonTableFromChatHistory_ACU();
    expect(loadResult1.loaded).toBe(true);
    expect(loadResult1.source).toBe('initialized');
    expect(mockCurrentJsonTableDataRef.value).not.toBeNull();
    expect(mockCurrentJsonTableDataRef.value.sheet_0).toBeDefined();

    // 2. 模拟添加一条 AI 消息
    mockChat.push({ is_user: false, mes: 'AI回复' });

    // 3. 修改数据
    mockCurrentJsonTableDataRef.value.sheet_0.content.push(['1', '铁剑', '3']);

    // 4. 保存
    const saveResult = await saveIndependentTableToChatHistory_ACU();
    expect(saveResult.saved).toBe(true);
    expect(saveResult.messageIndex).toBe(0);

    // 5. 验证 chat 消息上写入了数据
    const aiMsg = mockChat[0];
    expect(aiMsg.TavernDB_ACU_IsolatedData).toBeDefined();
    expect(aiMsg.TavernDB_ACU_IsolatedData[''].independentData.sheet_0).toBeDefined();

    // 6. 重新加载
    mockCurrentJsonTableDataRef.value = null;
    const loadResult2 = await loadOrCreateJsonTableFromChatHistory_ACU();
    expect(loadResult2.loaded).toBe(true);
    expect(loadResult2.source).toBe('merged');

    // 7. 验证数据一致性
    expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toContainEqual(['1', '铁剑', '3']);
  });

  it('多次保存后数据不丢失', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });

    // 第一次保存
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    };
    await saveIndependentTableToChatHistory_ACU();

    // 修改数据
    mockCurrentJsonTableDataRef.value.sheet_0.content.push(['2', '药水']);

    // 第二次保存
    await saveIndependentTableToChatHistory_ACU();

    // 验证最终数据
    const aiMsg = mockChat[0];
    const savedData = aiMsg.TavernDB_ACU_IsolatedData[''].independentData.sheet_0;
    expect(savedData.content).toHaveLength(3); // header + 2 rows
    expect(savedData.content[2]).toEqual(['2', '药水']);
  });

  it('保存时写入 legacy 兼容字段', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复' });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    };

    await saveIndependentTableToChatHistory_ACU();

    const aiMsg = mockChat[0];
    // 验证 legacy 字段
    expect(aiMsg.TavernDB_ACU_IndependentData).toBeDefined();
    expect(aiMsg.TavernDB_ACU_ModifiedKeys).toBeDefined();
    expect(aiMsg.TavernDB_ACU_UpdateGroupKeys).toBeDefined();
  });

  it('隔离模式下数据按标签隔离', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    const { getCurrentIsolationKey_ACU } = await import('../../src/service/runtime/state-manager');
    vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('tag_A');

    mockChat.push({ is_user: false, mes: 'AI回复' });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    };

    await saveIndependentTableToChatHistory_ACU();

    const aiMsg = mockChat[0];
    // 验证数据写入了 tag_A 标签下
    expect(aiMsg.TavernDB_ACU_IsolatedData['tag_A']).toBeDefined();
    expect(aiMsg.TavernDB_ACU_IsolatedData['tag_A'].independentData.sheet_0).toBeDefined();
    expect(aiMsg.TavernDB_ACU_Identity).toBe('tag_A');
  });
});
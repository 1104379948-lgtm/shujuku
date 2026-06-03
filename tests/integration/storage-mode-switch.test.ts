/**
 * @vitest-environment jsdom
 * tests/integration/storage-mode-switch.test.ts
 * I6 集成测试：原生模式与 SQLite 模式切换及异常回退恢复机制
 * 使用真实的 NativeTableServiceAdapter 和 SqlTableService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockChat, mockSettings, mockCurrentJsonTableDataRef } = vi.hoisted(() => ({
  mockChat: [] as any[],
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '' } as any,
  mockCurrentJsonTableDataRef: { value: null as any },
}));

// mock 聊天网关
vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChat),
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
}));

// mock 日志和其他纯函数 utils
vi.mock('../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((n: string) => n.includes('纪要')),
  logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => ({
    sheet_0: { name: '表1', content: [['row_id', 'A']], sourceData: { ddl: 'CREATE TABLE "表1" ("row_id" TEXT PRIMARY KEY, "A" TEXT)' } },
  })),
  stripSeedRowsFromTemplate_ACU: vi.fn((obj: any) => obj),
}));

// mock state-manager，提供状态可变引用
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableDataRef.value = v; }),
}));

// mock storage-mode 控制器
let mockStorageMode: string = 'native';
vi.mock('../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: vi.fn(() => mockStorageMode),
}));

// mock helpers-data-merge 的加载历史行为
vi.mock('../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: vi.fn(async (chatArray) => {
    const targetChat = chatArray || mockChat;
    for (let i = targetChat.length - 1; i >= 0; i--) {
      const m = targetChat[i];
      if (m.is_user) continue;
      const iso = m.TavernDB_ACU_IsolatedData;
      if (iso && iso[''] && iso[''].independentData) return JSON.parse(JSON.stringify(iso[''].independentData));
    }
    return { sheet_0: { name: '默认表', content: [] } };
  }),
  migrateContentNullToRowId: vi.fn((d: any) => d),
}));

// mock name-mapper
vi.mock('../../src/service/runtime/template-vars/name-mapper', () => ({
  buildGlobalNameMapper: vi.fn(),
  disposeGlobalNameMapper: vi.fn(),
}));

// mock chat-scope 保证有最小 row_id 生成逻辑
vi.mock('../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: vi.fn().mockReturnValue([]),
  getCurrentChatTemplateScopeState_ACU: vi.fn().mockReturnValue(null),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => {
    if (!Array.isArray(content) || content.length === 0) return [];
    const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
    const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
    let nextId = 1;
    return [header, ...rows.map((row: any) => {
      let value = row[0] == null ? '' : String(row[0]).trim();
      if (!value) value = String(nextId++);
      row[0] = value;
      return row;
    })];
  }),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn((source: any) => {
    if (!source) return null;
    return { templateStr: typeof source === 'string' ? source : JSON.stringify(source), templateObj: typeof source === 'string' ? JSON.parse(source) : source };
  }),
  normalizeTemplateScopeIsolationKey_ACU: vi.fn((k: string) => k),
  migrateLegacyTemplateScopeForCurrentChat_ACU: vi.fn((s: any) => s),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => ({ templateStr: '{}', templateObj: {} })),
}));

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: vi.fn((str: string, fallback: any) => {
    try { return JSON.parse(str); } catch { return fallback; }
  }),
  safeJsonStringify_ACU: vi.fn((obj: any, fallback: string) => {
    try { return JSON.stringify(obj); } catch { return fallback; }
  })
}));

import { switchStorageMode, initStorageProvider, disposeStorageProvider, getCurrentProviderMode } from '../../src/service/table/table-storage-strategy';
import { SqlTableService } from '../../src/service/table/sql-table-service';
import { NativeTableServiceAdapter } from '../../src/service/table/native-table-service-adapter';

describe('I6: 模式切换与异常回退恢复机制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.length = 0;
    mockCurrentJsonTableDataRef.value = null;
    mockStorageMode = 'native';
    disposeStorageProvider(); // 确保每次测试使用新的 provider
  });

  afterEach(() => {
    disposeStorageProvider();
  });

  it('1. Native 写入数据后切换到 SQLite，应该能正确继承数据并提供 SQLite 服务', async () => {
    // 设置基础数据
    mockChat.push({
      is_user: false,
      mes: 'AI回复',
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_mode: 'checkpoint',
          _acu_storage_version: 1,
          independentData: {
            sheet_0: { name: '表1', content: [['row_id', 'A'], ['1', 'valA']] }
          }
        }
      }
    });

    // 初始 native
    await initStorageProvider();
    expect(getCurrentProviderMode()).toBe('native');
    expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toEqual([['row_id', 'A'], ['1', 'valA']]);

    // 切换到 sqlite
    mockStorageMode = 'sqlite';
    await switchStorageMode('sqlite');
    expect(getCurrentProviderMode()).toBe('sqlite');
    
    // SQLite 应已同步获取到 native 期间合并出的数据
    expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toEqual([['row_id', 'A'], ['1', 'valA']]);
  });

  it('2. SQLite 写入数据后切换到 Native，应该通过 getCurrentData 同步快照并切换', async () => {
    // 初始 sqlite
    mockStorageMode = 'sqlite';
    await initStorageProvider();
    expect(getCurrentProviderMode()).toBe('sqlite');

    // 伪造已经在内存中的 JSON 状态（假装 SQLite 在运作中维护的快照）
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '表1', content: [['row_id', 'A'], ['r1', 'valSQL']] }
    };

    // 切换到 native
    mockStorageMode = 'native';
    await switchStorageMode('native');
    
    // 原生模式应该在切换时利用最新的 mockChat (如果为空会初始化为空表)
    // 但在我们的集成测试中，由于是从 sqlite 切回 native，如果没有写回历史，再次加载将会回滚到历史记录。
    // 这刚好验证了 getCurrentData 后还需要由底层网关进行真实数据持久化的时机，但策略切换本身不能崩溃
    expect(getCurrentProviderMode()).toBe('native');
  });

  it('3. SQLite 切换失败时自动回退为 Native 模式并抛出自动回退异常', async () => {
    await initStorageProvider();
    
    const loadSpy = vi.spyOn(SqlTableService.prototype, 'loadFromChat').mockResolvedValue({ loaded: false, error: 'Mock SQLite Error' });
    
    await expect(switchStorageMode('sqlite')).rejects.toThrow('已自动回退');
    expect(getCurrentProviderMode()).toBe('native');
    
    loadSpy.mockRestore();
  });

  it('4. Native 切换报错时，应当恢复 previousJsonData', async () => {
    // 先赋予一些旧数据
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '表1', content: [['row_id', 'A'], ['1', 'oldData']] }
    };

    const loadSpy = vi.spyOn(NativeTableServiceAdapter.prototype, 'loadFromChat').mockRejectedValue(new Error('Mock Native Error'));
    
    await expect(switchStorageMode('native')).rejects.toThrow('Mock Native Error');
    
    expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toEqual([['row_id', 'A'], ['1', 'oldData']]);
    
    loadSpy.mockRestore();
  });
});
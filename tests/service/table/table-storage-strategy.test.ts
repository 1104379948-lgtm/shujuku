/**
 * tests/service/table/table-storage-strategy.test.ts
 * 表格存储策略选择器单元测试
 *
 * 策略：通过模块级可变变量控制 mock provider 的 loadFromChat 行为，
 * 验证 initStorageProvider/switchStorageMode/reloadStorageProvider 的编排逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

// mock storage-mode
let mockStorageMode: string = 'native';
let mockChatId = 'test-chat';
let mockIsolationKey = '';
let mockRuntimeRevision = 'runtime-revision-0';
vi.mock('../../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: vi.fn(() => mockStorageMode),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mockChatId; },
  getCurrentIsolationKey_ACU: vi.fn(() => mockIsolationKey),
}));

const mockCaptureTableRuntimeRevision = vi.fn(() => mockRuntimeRevision);
const mockInvalidateTableRuntimeRevision = vi.fn(() => {
  const match = /^(.*?)(\d+)$/.exec(mockRuntimeRevision);
  mockRuntimeRevision = match
    ? `${match[1]}${Number(match[2]) + 1}`
    : `${mockRuntimeRevision}-next`;
  return mockRuntimeRevision;
});
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: (...args: any[]) => mockCaptureTableRuntimeRevision(...args),
  invalidateTableRuntimeRevision_ACU: (...args: any[]) => mockInvalidateTableRuntimeRevision(...args),
}));

const mockBuildInitialTableRuntimeSnapshot = vi.fn().mockReturnValue({
  data: { mate: {}, sheet_0: { content: [['row_id']] } },
});
const mockLoadOrCreateJsonTableFromChatHistory = vi.fn().mockResolvedValue({
  loaded: true,
  source: 'merged',
  data: { mate: {} },
});
vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: (...args: any[]) => mockLoadOrCreateJsonTableFromChatHistory(...args),
  buildInitialTableRuntimeSnapshot_ACU: (...args: any[]) => mockBuildInitialTableRuntimeSnapshot(...args),
}));

// ═══════════════════════════════════════════════════════════════
// 可变控制变量：控制 SQLite provider 的 loadFromChat 行为
// ═══════════════════════════════════════════════════════════════
let sqliteLoadResult: { loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string } = { loaded: true, source: 'merged' };
let sqliteLoadShouldThrow: Error | null = null;
let sqliteLoadFromDataOverrides: Array<() => Promise<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string }>> = [];
let runtimeActivationShouldThrow: Error | null = null;
let nativeLoadFromDataShouldThrow: Error | null = null;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

// 记录所有创建的 provider 实例，用于验证 dispose 等调用
let allCreatedProviders: Array<ReturnType<typeof createMockProvider>> = [];

function createMockProvider(mode: 'native' | 'sqlite') {
  const provider = {
    mode,
    loadFromChat: vi.fn(async () => {
      if (mode === 'sqlite' && sqliteLoadShouldThrow) {
        throw sqliteLoadShouldThrow;
      }
      if (mode === 'sqlite') {
        return { ...sqliteLoadResult };
      }
      return { loaded: true, source: 'merged' as const };
    }),
    loadFromData: vi.fn(async () => {
      if (mode === 'native' && nativeLoadFromDataShouldThrow) {
        throw nativeLoadFromDataShouldThrow;
      }
      const override = sqliteLoadFromDataOverrides.shift();
      if (override) return override();
      if (mode === 'sqlite' && sqliteLoadShouldThrow) {
        throw sqliteLoadShouldThrow;
      }
      if (mode === 'sqlite') {
        return { ...sqliteLoadResult };
      }
      return { loaded: true, source: 'merged' as const };
    }),
    saveToChat: vi.fn().mockResolvedValue({ saved: true }),
    isReady: vi.fn().mockReturnValue(true),
    getCurrentData: vi.fn().mockReturnValue({ mate: {} }),
    applyEdits: vi.fn().mockReturnValue({ success: true, modifiedKeys: [], appliedEdits: 1 }),
    executeQuery: vi.fn(),
    executeMutation: vi.fn(),
    beginRuntimeCandidate_ACU: vi.fn(),
    activateRuntimeStatePublication_ACU: vi.fn(() => {
      if (runtimeActivationShouldThrow) {
        throw runtimeActivationShouldThrow;
      }
    }),
    activateNameMapperPublication_ACU: vi.fn(),
    deactivateNameMapperPublication_ACU: vi.fn(),
    dispose: vi.fn(),
  };
  allCreatedProviders.push(provider);
  return provider;
}

// mock SqlTableService 和 NativeTableServiceAdapter
vi.mock('../../../src/service/table/sql-table-service', () => ({
  SqlTableService: vi.fn(() => createMockProvider('sqlite')),
}));

vi.mock('../../../src/service/table/native-table-service-adapter', () => ({
  NativeTableServiceAdapter: vi.fn(() => createMockProvider('native')),
}));

import {
  getStorageProvider,
  getActiveStorageProvider,
  initStorageProvider,
  ensureStorageProviderReady_ACU,
  switchStorageMode,
  reloadStorageProvider,
  disposeStorageProvider,
  getCurrentProviderMode,
} from '../../../src/service/table/table-storage-strategy';

describe('table-storage-strategy', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStorageMode = 'native';
    mockChatId = 'test-chat';
    mockIsolationKey = '';
    mockRuntimeRevision = 'runtime-revision-0';
    sqliteLoadResult = { loaded: true, source: 'merged' };
    sqliteLoadShouldThrow = null;
    runtimeActivationShouldThrow = null;
    nativeLoadFromDataShouldThrow = null;
    sqliteLoadFromDataOverrides = [];
    allCreatedProviders = [];
    mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: { mate: {} } });
    mockBuildInitialTableRuntimeSnapshot.mockReturnValue({
      data: { mate: {}, sheet_0: { content: [['row_id']] } },
    });
    // 重置模块内部状态
    await initStorageProvider();
    // 清空记录，让后续测试从干净状态开始
    allCreatedProviders = [];
    mockLoadOrCreateJsonTableFromChatHistory.mockClear();
  });

  // ═══════════════════════════════════════════════════════════════
  // getStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('getStorageProvider', () => {
    it('返回当前 Provider', () => {
      const provider = getStorageProvider();
      expect(provider).toBeDefined();
      expect(provider.mode).toBe('native');
    });

    it('设置变化时仍返回现有 active runtime，不同步创建未 hydrate 实例', async () => {
      const activeProvider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;
      mockStorageMode = 'sqlite';

      const provider = getStorageProvider();

      expect(provider).toBe(activeProvider);
      expect(provider.mode).toBe('native');
      expect(activeProvider.dispose).not.toHaveBeenCalled();
      expect(allCreatedProviders).toHaveLength(createdCount);
    });

    it('SQLite 首次失败发布 native fallback 后，getter 不替换 fallback', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'hydrate failed' };
      await initStorageProvider();
      const fallbackProvider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;

      expect(getStorageProvider()).toBe(fallbackProvider);
      expect(fallbackProvider.mode).toBe('native');
      expect(allCreatedProviders).toHaveLength(createdCount);
    });

    it('未初始化时 fail-closed，不创建裸 provider', () => {
      disposeStorageProvider();
      const createdCount = allCreatedProviders.length;

      expect(() => getStorageProvider()).toThrow('表格存储运行时未就绪');
      expect(allCreatedProviders).toHaveLength(createdCount);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getActiveStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('getActiveStorageProvider', () => {
    it('返回已初始化实例，且设置变化不会触发重建', () => {
      const provider = getActiveStorageProvider();
      const createdCount = allCreatedProviders.length;

      mockStorageMode = 'sqlite';

      expect(getActiveStorageProvider()).toBe(provider);
      expect(provider?.mode).toBe('native');
      expect(allCreatedProviders).toHaveLength(createdCount);
    });

    it('dispose 后返回 null，不执行惰性初始化', async () => {
      await initStorageProvider();
      const provider = getActiveStorageProvider();

      disposeStorageProvider();

      expect(provider?.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // initStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('initStorageProvider', () => {
    it('native 模式初始化', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('sqlite 模式初始化', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('sqlite');
    });

    it('sqlite 初始化使用本轮 canonical 回放快照，而非 provider 自行回放聊天', async () => {
      mockStorageMode = 'sqlite';
      const canonicalData = { mate: {}, sheet_0: { content: [['row_id'], ['1']] } };
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: canonicalData });

      await initStorageProvider();

      const provider = getActiveStorageProvider()!;
      expect(provider.mode).toBe('sqlite');
      expect(provider.loadFromData).toHaveBeenCalledWith(canonicalData, { source: 'merged' });
      expect(provider.loadFromChat).not.toHaveBeenCalled();
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledWith({ detached: true });
    });

    it('native 初始化也使用 detached canonical 快照，不直接发布公共状态', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();
      expect(provider.loadFromData).toHaveBeenCalledWith({ mate: {} }, { source: 'merged' });
      expect(provider.loadFromChat).not.toHaveBeenCalled();
    });

    it('detached 无持久化快照时显式构造首次 canonical snapshot', async () => {
      const initialData = { mate: {}, sheet_0: { content: [['row_id', 'name']] } };
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: false, source: 'empty', data: null });
      mockBuildInitialTableRuntimeSnapshot.mockReturnValue({ data: initialData });

      await initStorageProvider();

      const provider = getActiveStorageProvider()!;
      expect(mockBuildInitialTableRuntimeSnapshot).toHaveBeenCalledOnce();
      expect(provider.loadFromData).toHaveBeenCalledWith(initialData, { source: 'initialized' });
      expect(provider.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
    });

    it('明确仅表头 snapshot 不触发首次初始化 builder', async () => {
      const persistedEmptyData = { mate: {}, sheet_0: { content: [['row_id', 'name']] } };
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: persistedEmptyData });

      await initStorageProvider();

      const provider = getActiveStorageProvider()!;
      expect(mockBuildInitialTableRuntimeSnapshot).not.toHaveBeenCalled();
      expect(provider.loadFromData).toHaveBeenCalledWith(persistedEmptyData, { source: 'merged' });
    });

    it('SQLite 加载失败时 fallback 到 native', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'sql.js 加载失败' };

      await initStorageProvider();
      // fallback 后应该是 native 模式
      expect(getCurrentProviderMode()).toBe('native');
      const fallbackProvider = getActiveStorageProvider()!;
      expect(fallbackProvider.loadFromData).toHaveBeenCalledOnce();
      expect(fallbackProvider.loadFromChat).not.toHaveBeenCalled();
      expect(fallbackProvider.isReady()).toBe(true);
    });

    it('候选 runtime state activation 抛错时保留旧 runtime 并释放候选', async () => {
      const activeProvider = getActiveStorageProvider()!;
      mockStorageMode = 'sqlite';
      runtimeActivationShouldThrow = new Error('JSON publication failed');

      await initStorageProvider();

      const candidate = allCreatedProviders.at(-1)!;
      expect(candidate.mode).toBe('sqlite');
      expect(candidate.beginRuntimeCandidate_ACU).toHaveBeenCalledOnce();
      expect(candidate.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(activeProvider.dispose).not.toHaveBeenCalled();
    });

    it('SQLite 初始化异常时 fallback 到 native', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadShouldThrow = new Error('WASM 加载失败');

      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('销毁旧实例后创建新实例', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const oldProvider = getStorageProvider();
      let activeProviderDuringDispose: unknown = null;
      oldProvider.dispose.mockImplementation(() => {
        activeProviderDuringDispose = getActiveStorageProvider();
      });

      await initStorageProvider();
      // 旧 provider 应该被 dispose
      expect(oldProvider.dispose).toHaveBeenCalled();
      expect(activeProviderDuringDispose).toBe(getActiveStorageProvider());
      expect(activeProviderDuringDispose).not.toBe(oldProvider);
    });

    it('旧 Provider dispose 抛错不把已成功发布的新 runtime 伪装为初始化失败', async () => {
      const oldProvider = getActiveStorageProvider()!;
      oldProvider.dispose.mockImplementation(() => {
        throw new Error('old dispose failed');
      });

      await expect(initStorageProvider()).resolves.toBeUndefined();

      const nextProvider = getActiveStorageProvider()!;
      expect(nextProvider).not.toBe(oldProvider);
      expect(nextProvider.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
      expect(nextProvider.dispose).not.toHaveBeenCalled();
      expect(oldProvider.dispose).toHaveBeenCalledOnce();
      expect(getStorageProvider()).toBe(nextProvider);
    });
  });

  describe('ensureStorageProviderReady_ACU', () => {
    it('SQLite fallback 后拒绝 SQL 写入，但保留已确认健康的 native runtime', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: '旧数据 hydrate 失败' };

      await initStorageProvider();
      const fallbackProvider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;

      await expect(ensureStorageProviderReady_ACU()).rejects.toThrow('sqlite 存储运行时未就绪');

      const activeProvider = getActiveStorageProvider()!;
      expect(activeProvider).toBe(fallbackProvider);
      expect(activeProvider.mode).toBe('native');
      expect(activeProvider.isReady()).toBe(true);
      expect(allCreatedProviders).toHaveLength(createdCount + 1);
      const attemptedSqliteProvider = allCreatedProviders.at(-1)!;
      expect(attemptedSqliteProvider.loadFromData).toHaveBeenCalledOnce();
    });

    it('已 ready 的 SQLite 直接返回原实例，不再次回放或 hydrate', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const provider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;

      await expect(ensureStorageProviderReady_ACU()).resolves.toBe(provider);

      expect(allCreatedProviders).toHaveLength(createdCount);
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // switchStorageMode
  // ═══════════════════════════════════════════════════════════════
  describe('switchStorageMode', () => {
    it('从 native 切换到 sqlite', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');

      await switchStorageMode('sqlite');
      expect(getCurrentProviderMode()).toBe('sqlite');
    });

    it('同模式切换跳过（不重新创建）', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();

      await switchStorageMode('native');
      // 不应该 dispose（因为跳过了）
      expect(provider.dispose).not.toHaveBeenCalled();
    });

    it('切换时销毁旧 Provider', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      await switchStorageMode('sqlite');
      expect(oldProvider.dispose).toHaveBeenCalled();
    });

    it('SQLite 切换失败时 fallback 并抛出错误', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      // 设置 SQLite 加载失败
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'WASM 错误' };

      await expect(switchStorageMode('sqlite')).rejects.toThrow('已自动回退');
      // fallback 后应该是 native
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('SQLite 切换异常时 fallback', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      sqliteLoadShouldThrow = new Error('意外错误');

      await expect(switchStorageMode('sqlite')).rejects.toThrow('意外错误');
      // 应该有可用的 provider
      expect(getCurrentProviderMode()).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // reloadStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('reloadStorageProvider', () => {
    it('native 模式重新加载', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      await reloadStorageProvider();
      const provider = getStorageProvider();
      expect(provider).not.toBe(oldProvider);
      expect(provider.loadFromData).toHaveBeenCalledOnce();
      expect(provider.loadFromChat).not.toHaveBeenCalled();
    });

    it('sqlite 模式重建数据库', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      allCreatedProviders = []; // 清空记录

      const oldProvider = getStorageProvider();

      await reloadStorageProvider();
      // sqlite 模式需要 dispose 旧实例并重建
      expect(oldProvider.dispose).toHaveBeenCalled();
      // 应该创建了新的 provider
      expect(allCreatedProviders.length).toBeGreaterThan(0);
    });

    it('连续 SQLite reload 仅保留最新实例并依次发布 mapper', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const first = getActiveStorageProvider()!;

      await reloadStorageProvider();
      const second = getActiveStorageProvider()!;
      await reloadStorageProvider();
      const third = getActiveStorageProvider()!;

      expect(second).not.toBe(first);
      expect(third).not.toBe(second);
      expect(first.dispose).toHaveBeenCalled();
      expect(second.dispose).toHaveBeenCalled();
      expect(third.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
    });

    it('并发 reload 乱序完成时，过期候选不得覆盖最新 runtime 或 mapper', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const initialProvider = getActiveStorageProvider()!;
      allCreatedProviders = [];

      const firstHydrate = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty' }>();
      const secondHydrate = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty' }>();
      sqliteLoadFromDataOverrides.push(
        () => firstHydrate.promise,
        () => secondHydrate.promise,
      );

      const firstReload = reloadStorageProvider();
      await Promise.resolve();
      await Promise.resolve();
      const firstCandidate = allCreatedProviders[0]!;

      const secondReload = reloadStorageProvider();
      await Promise.resolve();
      await Promise.resolve();
      const secondCandidate = allCreatedProviders[1]!;

      secondHydrate.resolve({ loaded: true, source: 'merged' });
      await secondReload;
      expect(getActiveStorageProvider()).toBe(secondCandidate);
      expect(initialProvider.dispose).toHaveBeenCalledOnce();

      firstHydrate.resolve({ loaded: true, source: 'merged' });
      await firstReload;
      expect(getActiveStorageProvider()).toBe(secondCandidate);
      expect(firstCandidate.dispose).toHaveBeenCalledOnce();
      expect(firstCandidate.beginRuntimeCandidate_ACU).toHaveBeenCalledOnce();
      expect(firstCandidate.activateRuntimeStatePublication_ACU).not.toHaveBeenCalled();
      expect(secondCandidate.beginRuntimeCandidate_ACU).toHaveBeenCalledOnce();
      expect(secondCandidate.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
    });

    it('候选 replay 期间 runtime revision 变化时拒绝旧快照进入 hydrate', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeProvider = getActiveStorageProvider()!;
      allCreatedProviders = [];
      const replay = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; data: any }>();
      mockLoadOrCreateJsonTableFromChatHistory.mockImplementationOnce(() => replay.promise);

      const reload = initStorageProvider();
      await Promise.resolve();
      const candidate = allCreatedProviders[0]!;
      mockRuntimeRevision = 'runtime-revision-committed-during-replay';
      replay.resolve({
        loaded: true,
        source: 'merged',
        data: { mate: {}, sheet_0: { content: [['row_id'], ['stale']] } },
      });
      await reload;

      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(candidate.loadFromData).not.toHaveBeenCalled();
      expect(candidate.activateRuntimeStatePublication_ACU).not.toHaveBeenCalled();
      expect(candidate.dispose).toHaveBeenCalledOnce();
    });

    it('候选 hydrate 期间聊天切换时丢弃候选，不覆盖当前 runtime', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeProvider = getActiveStorageProvider()!;
      allCreatedProviders = [];
      const hydrate = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty' }>();
      sqliteLoadFromDataOverrides.push(() => hydrate.promise);

      const reload = initStorageProvider();
      await Promise.resolve();
      await Promise.resolve();
      const candidate = allCreatedProviders[0]!;
      mockChatId = 'other-chat';
      hydrate.resolve({ loaded: true, source: 'merged' });
      await reload;

      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(candidate.activateRuntimeStatePublication_ACU).not.toHaveBeenCalled();
    });

    it('候选 hydrate 期间隔离标识切换时丢弃候选', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeProvider = getActiveStorageProvider()!;
      allCreatedProviders = [];
      const hydrate = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty' }>();
      sqliteLoadFromDataOverrides.push(() => hydrate.promise);

      const reload = initStorageProvider();
      await Promise.resolve();
      await Promise.resolve();
      const candidate = allCreatedProviders[0]!;
      mockIsolationKey = 'branch-b';
      hydrate.resolve({ loaded: true, source: 'merged' });
      await reload;

      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(candidate.activateRuntimeStatePublication_ACU).not.toHaveBeenCalled();
    });

    it('候选 hydrate 期间同作用域 runtime revision 变化时丢弃候选', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeProvider = getActiveStorageProvider()!;
      allCreatedProviders = [];
      const hydrate = createDeferred<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty' }>();
      sqliteLoadFromDataOverrides.push(() => hydrate.promise);

      const reload = initStorageProvider();
      await Promise.resolve();
      await Promise.resolve();
      const candidate = allCreatedProviders[0]!;
      mockRuntimeRevision = 'runtime-revision-external-change';
      hydrate.resolve({ loaded: true, source: 'merged' });
      await reload;

      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(candidate.activateRuntimeStatePublication_ACU).not.toHaveBeenCalled();
    });

    it('SQLite reload 候选失败时保留已发布的健康 runtime 与 mapper', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeProvider = getActiveStorageProvider()!;
      expect(activeProvider.mode).toBe('sqlite');

      // 设置重新加载时失败
      sqliteLoadShouldThrow = new Error('重新加载失败');

      await reloadStorageProvider();

      expect(getActiveStorageProvider()).toBe(activeProvider);
      expect(getCurrentProviderMode()).toBe('sqlite');
      expect(activeProvider.dispose).not.toHaveBeenCalled();
      expect(activeProvider.activateRuntimeStatePublication_ACU).toHaveBeenCalledOnce();
      expect(allCreatedProviders.at(-1)?.mode).toBe('sqlite');
      expect(allCreatedProviders.at(-1)?.dispose).toHaveBeenCalledOnce();
    });

    it('SQLite 首次失败且 native fallback 也失败时只创建一次 fallback，并各释放一次', async () => {
      disposeStorageProvider();
      allCreatedProviders = [];
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'sqlite hydrate failed' };
      nativeLoadFromDataShouldThrow = new Error('native fallback failed');

      await expect(initStorageProvider()).rejects.toThrow('native fallback failed');

      expect(allCreatedProviders).toHaveLength(2);
      const [sqliteCandidate, nativeFallback] = allCreatedProviders;
      expect(sqliteCandidate.mode).toBe('sqlite');
      expect(nativeFallback.mode).toBe('native');
      expect(sqliteCandidate.dispose).toHaveBeenCalledOnce();
      expect(nativeFallback.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // disposeStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('disposeStorageProvider', () => {
    it('销毁后 getCurrentProviderMode 返回 null', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('sqlite');

      disposeStorageProvider();
      expect(getCurrentProviderMode()).toBeNull();
    });

    it('销毁后 getStorageProvider fail-closed，必须显式异步重建', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      disposeStorageProvider();
      expect(oldProvider.dispose).toHaveBeenCalled();
      expect(() => getStorageProvider()).toThrow('表格存储运行时未就绪');

      await initStorageProvider();
      expect(getStorageProvider()).not.toBe(oldProvider);
    });

    it('未初始化时 dispose 不抛错', () => {
      disposeStorageProvider(); // 先清空
      expect(() => disposeStorageProvider()).not.toThrow();
    });

    it('native 模式下 dispose 也能正常工作', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();

      disposeStorageProvider();
      expect(provider.dispose).toHaveBeenCalled();
      expect(getCurrentProviderMode()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentProviderMode
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentProviderMode', () => {
    it('初始化后返回当前模式', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('切换后返回新模式', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      await switchStorageMode('sqlite');
      expect(getCurrentProviderMode()).toBe('sqlite');
    });
  });
});

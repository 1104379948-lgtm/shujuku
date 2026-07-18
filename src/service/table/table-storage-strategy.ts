/**
 * service/table/table-storage-strategy.ts — 表格存储策略选择器
 *
 * 根据用户设置选择 native 或 sqlite 模式的 Provider。
 * 提供全局单例访问点，是上层代码获取 Provider 的唯一入口。
 */

import type { ITableStorageProvider, StorageMode } from '../../shared/table-storage-provider';
import { getCurrentStorageMode } from './storage-mode';
import { NativeTableServiceAdapter } from './native-table-service-adapter';
import { SqlTableService } from './sql-table-service';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { loadOrCreateJsonTableFromChatHistory_ACU } from './table-service';
import { invalidateTableRuntimeRevision_ACU } from './table-write-transaction';

/** 当前活跃的 Provider 实例 */
let currentProvider: ITableStorageProvider | null = null;

export type SqlRuntimeState_ACU = 'idle' | 'initializing' | 'ready' | 'fallback' | 'failed';

export type SqlRuntimeStatus_ACU = {
  configuredMode: StorageMode;
  activeMode: StorageMode | null;
  state: SqlRuntimeState_ACU;
  retryable: boolean;
  error?: string;
};

let lifecycleGeneration = 0;
let sqlRuntimeState: Omit<SqlRuntimeStatus_ACU, 'configuredMode' | 'activeMode'> = {
  state: 'idle',
  retryable: false,
};
let initializationFlight: {
  generation: number;
  mode: StorageMode;
  promise: Promise<void>;
} | null = null;

/**
 * 获取当前存储提供者
 * 如果尚未初始化，会根据当前设置自动创建
 */
export function getStorageProvider(): ITableStorageProvider {
  const mode = getCurrentStorageMode();
  if (!currentProvider || currentProvider.mode !== mode) {
    if (currentProvider) {
      logDebug_ACU(`[StorageStrategy] Provider 模式变化，重建: ${currentProvider.mode} → ${mode}`);
      currentProvider.dispose();
    }
    // 懒初始化：根据当前模式创建 Provider
    currentProvider = createProvider(mode);
    logDebug_ACU(`[StorageStrategy] 懒初始化 Provider: ${mode}`);
  }
  return currentProvider;
}

/**
 * 获取当前已激活的 Provider，不会按设置懒初始化或重建实例。
 * 用于需要观察 SQLite fallback 后实际运行时状态的恢复与诊断流程。
 */
export function getActiveStorageProvider(): ITableStorageProvider | null {
  return currentProvider;
}

/** 同步只读 SQL 仅消费已激活且就绪的 SQLite Provider，不触发懒初始化。 */
export function getReadySqliteProvider_ACU(): ITableStorageProvider | null {
  if (getCurrentStorageMode() !== 'sqlite') return null;
  if (currentProvider?.mode !== 'sqlite' || !currentProvider.isReady()) return null;
  return currentProvider;
}

export function getSqlRuntimeStatus_ACU(): SqlRuntimeStatus_ACU {
  return {
    configuredMode: getCurrentStorageMode(),
    activeMode: currentProvider?.mode ?? null,
    ...sqlRuntimeState,
  };
}

export function isSqlRuntimeReady_ACU(): boolean {
  return getReadySqliteProvider_ACU() !== null;
}

export async function ensureStorageProviderReady_ACU(): Promise<ITableStorageProvider> {
  const expectedMode = getCurrentStorageMode();
  const activeProvider = getActiveStorageProvider();
  if (activeProvider?.mode === expectedMode && activeProvider.isReady()) return activeProvider;
  await initStorageProvider();
  const initializedProvider = getActiveStorageProvider();
  if (!initializedProvider || initializedProvider.mode !== expectedMode || !initializedProvider.isReady()) {
    throw new Error(`[StorageStrategy] ${expectedMode} 存储运行时未就绪，已阻止 SQL 写入。`);
  }
  return initializedProvider;
}

/**
 * 初始化存储提供者（应用启动时调用）
 * 根据当前设置创建 Provider 并执行 loadFromChat
 */
export async function initStorageProvider(): Promise<void> {
  const mode = getCurrentStorageMode();
  const generation = lifecycleGeneration;
  logDebug_ACU(`[StorageStrategy] 初始化 Provider: ${mode}`);

  if (initializationFlight?.generation === generation && initializationFlight.mode === mode) {
    return initializationFlight.promise;
  }

  setSqlRuntimeState_ACU(mode === 'sqlite' ? 'initializing' : 'idle', mode === 'sqlite');
  const promise = initializeAndActivateProvider_ACU(mode, generation, false);
  initializationFlight = { generation, mode, promise };
  try {
    await promise;
  } finally {
    if (initializationFlight?.promise === promise) initializationFlight = null;
  }
}

/**
 * 切换存储模式（用户在设置中切换时调用）
 * 1. 销毁旧 Provider
 * 2. 创建新 Provider
 * 3. 重新加载数据
 *
 * @param mode 目标模式
 */
export async function switchStorageMode(mode: StorageMode): Promise<void> {
  const currentMode = currentProvider?.mode;
  if (currentMode === mode) {
    logDebug_ACU(`[StorageStrategy] 已经是 ${mode} 模式，无需切换`);
    return;
  }

  logDebug_ACU(`[StorageStrategy] 切换模式: ${currentMode || 'none'} → ${mode}`);

  const generation = invalidateProviderLifecycle_ACU();
  setSqlRuntimeState_ACU(mode === 'sqlite' ? 'initializing' : 'idle', mode === 'sqlite');
  await initializeAndActivateProvider_ACU(mode, generation, true);
}

/**
 * 立即销毁当前 Provider 实例，释放内存数据库资源
 * 用于换卡/换聊天时在状态重置之前立即清理旧数据库，
 * 避免 1200ms 延迟窗口内的数据不一致问题。
 *
 * 销毁后 getStorageProvider() 会触发懒初始化创建新实例。
 * 调用方应在适当时机调用 reloadStorageProvider() 重建并加载数据。
 */
export function disposeStorageProvider(): void {
  invalidateProviderLifecycle_ACU();
  if (currentProvider) {
    logDebug_ACU(`[StorageStrategy] 销毁当前 Provider: ${currentProvider.mode}`);
    currentProvider.dispose();
    currentProvider = null;
  }
  setSqlRuntimeState_ACU('idle', getCurrentStorageMode() === 'sqlite');
}

/**
 * 重新加载数据（楼层删除、回滚等场景）
 * 不切换模式，只重新从聊天消息加载
 */
export async function reloadStorageProvider(): Promise<void> {
  invalidateTableRuntimeRevision_ACU({ reason: 'reloadStorageProvider' });
  invalidateProviderLifecycle_ACU();
  const mode = getCurrentStorageMode();
  logDebug_ACU(`[StorageStrategy] 重新加载数据: ${mode}`);
  await initStorageProvider();
}

/**
 * 获取当前 Provider 的模式
 * 如果未初始化返回 null
 */
export function getCurrentProviderMode(): StorageMode | null {
  return currentProvider?.mode ?? null;
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/** 根据模式创建 Provider 实例 */
function createProvider(mode: StorageMode): ITableStorageProvider {
  switch (mode) {
    case 'sqlite':
      return new SqlTableService();
    case 'native':
    default:
      return new NativeTableServiceAdapter();
  }
}

async function loadProviderForCurrentChat_ACU(
  provider: ITableStorageProvider,
  mode: StorageMode,
): Promise<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string }> {
  if (mode !== 'sqlite') return provider.loadFromChat();

  const replay = await loadOrCreateJsonTableFromChatHistory_ACU();
  if (typeof provider.loadFromData !== 'function') {
    throw new Error('[StorageStrategy] SQLite provider 未实现 canonical snapshot hydrate。');
  }
  return provider.loadFromData(replay.data || null);
}

async function initializeAndActivateProvider_ACU(
  mode: StorageMode,
  generation: number,
  throwOnSqliteFailure: boolean,
): Promise<void> {
  const nextProvider = createProvider(mode);
  try {
    const result = await loadProviderForCurrentChat_ACU(nextProvider, mode);
    logDebug_ACU(`[StorageStrategy] 数据加载完成: loaded=${result.loaded}, source=${result.source}`);

    if (!isLifecycleCurrent_ACU(generation, mode)) {
      nextProvider.dispose();
      logDebug_ACU(`[StorageStrategy] 丢弃过期 Provider 初始化结果: mode=${mode}, generation=${generation}`);
      return;
    }

    if (mode === 'sqlite' && !result.loaded && result.error) {
      logError_ACU(`[StorageStrategy] SQLite 加载失败，自动 fallback 到原生模式: ${result.error}`);
      nextProvider.dispose();
      replaceActiveProvider_ACU(createProvider('native'));
      setSqlRuntimeState_ACU('fallback', true, result.error);
      if (throwOnSqliteFailure) {
        throw new Error(`SQLite 模式切换失败: ${result.error}。已自动回退到原生模式。`);
      }
      return;
    }

    replaceActiveProvider_ACU(nextProvider);
    setSqlRuntimeState_ACU(mode === 'sqlite' ? 'ready' : 'idle', false);
  } catch (e: any) {
    if (!isLifecycleCurrent_ACU(generation, mode)) {
      nextProvider.dispose();
      logDebug_ACU(`[StorageStrategy] 忽略过期 Provider 初始化异常: mode=${mode}, generation=${generation}`);
      return;
    }

    if (e?.message?.includes('已自动回退')) throw e;

    const message = e?.message || String(e);
    logError_ACU(`[StorageStrategy] 初始化失败: ${message}`);
    nextProvider.dispose();
    if (mode === 'sqlite') {
      logError_ACU('[StorageStrategy] SQLite 初始化异常，fallback 到原生模式');
      replaceActiveProvider_ACU(createProvider('native'));
      setSqlRuntimeState_ACU('fallback', true, message);
      if (!throwOnSqliteFailure) return;
    } else {
      setSqlRuntimeState_ACU('failed', true, message);
    }
    throw e;
  }
}

function invalidateProviderLifecycle_ACU(): number {
  lifecycleGeneration += 1;
  initializationFlight = null;
  return lifecycleGeneration;
}

function isLifecycleCurrent_ACU(generation: number, mode: StorageMode): boolean {
  void mode;
  return generation === lifecycleGeneration;
}

function setSqlRuntimeState_ACU(state: SqlRuntimeState_ACU, retryable: boolean, error?: string): void {
  sqlRuntimeState = error ? { state, retryable, error } : { state, retryable };
}

function replaceActiveProvider_ACU(nextProvider: ITableStorageProvider): void {
  const previousProvider = currentProvider;
  currentProvider = nextProvider;
  previousProvider?.dispose();
}

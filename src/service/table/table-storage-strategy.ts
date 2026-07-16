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
import { buildInitialTableRuntimeSnapshot_ACU, loadOrCreateJsonTableFromChatHistory_ACU } from './table-service';
import { captureTableRuntimeRevisionForWriteSet_ACU, invalidateTableRuntimeRevision_ACU } from './table-write-transaction';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';

/** 当前活跃的 Provider 实例 */
let currentProvider: ITableStorageProvider | null = null;
/** 每次运行时替换请求递增；过期异步候选不得发布。 */
let providerGeneration_ACU = 0;

interface ProviderRuntimeScope_ACU {
  chatId: string;
  isolationKey: string;
  requestedMode: StorageMode;
  providerMode: StorageMode;
  configuredMode: StorageMode;
  generation: number;
  runtimeRevision: string | null;
}

/**
 * 获取当前存储提供者
 * 仅返回已经激活且就绪的 runtime。同步调用方不能隐式创建需要异步 hydrate 的裸实例。
 */
export function getStorageProvider(): ITableStorageProvider {
  if (!currentProvider || !currentProvider.isReady()) {
    throw new Error('[StorageStrategy] 表格存储运行时未就绪；请先完成异步初始化。');
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
  const generation = ++providerGeneration_ACU;
  logDebug_ACU(`[StorageStrategy] 初始化 Provider: ${mode}`);

  try {
    await initializeAndPublishProvider_ACU(mode, generation);
  } catch (e: any) {
    logError_ACU(`[StorageStrategy] 初始化失败: ${e?.message}`);
    throw e;
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

  const generation = ++providerGeneration_ACU;
  try {
    const fallbackError = await initializeAndPublishProvider_ACU(mode, generation);
    if (fallbackError) throw new Error(`SQLite 模式切换失败: ${fallbackError}。已自动回退到原生模式。`);
  } catch (e: any) {
    if (e.message?.includes('已自动回退')) throw e;

    logError_ACU(`[StorageStrategy] 切换异常: ${e?.message}`);
    throw e;
  }
}

/**
 * 立即销毁当前 Provider 实例，释放内存数据库资源
 * 用于换卡/换聊天时在状态重置之前立即清理旧数据库，
 * 避免 1200ms 延迟窗口内的数据不一致问题。
 *
 * 销毁后同步 getter 会 fail-closed；调用方必须通过 init/reload/ensure 完成异步重建。
 */
export function disposeStorageProvider(): void {
  providerGeneration_ACU += 1;
  if (currentProvider) {
    logDebug_ACU(`[StorageStrategy] 销毁当前 Provider: ${currentProvider.mode}`);
    currentProvider.dispose();
    currentProvider = null;
  }
}

/**
 * 重新加载数据（楼层删除、回滚等场景）
 * 不切换模式，只重新从聊天消息加载
 */
export async function reloadStorageProvider(): Promise<void> {
  invalidateTableRuntimeRevision_ACU({ reason: 'reloadStorageProvider' });
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

function normalizeRuntimeChatId_ACU(value: unknown): string | null {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return normalized && normalized !== 'unknown_chat_init' ? normalized : null;
}

function captureProviderRuntimeScope_ACU(
  requestedMode: StorageMode,
  providerMode: StorageMode,
  generation: number,
  includeRevision: boolean,
): ProviderRuntimeScope_ACU {
  const chatId = normalizeRuntimeChatId_ACU(currentChatFileIdentifier_ACU);
  if (!chatId) {
    throw new Error('[StorageStrategy] 当前聊天标识不可用，拒绝初始化表格存储运行时。');
  }
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  return {
    chatId,
    isolationKey,
    requestedMode,
    providerMode,
    configuredMode: getCurrentStorageMode(),
    generation,
    runtimeRevision: includeRevision
      ? captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }], { chatKey: chatId, isolationKey })
      : null,
  };
}

function isProviderRuntimeScopeCurrent_ACU(scope: ProviderRuntimeScope_ACU, checkRevision: boolean): boolean {
  if (
    scope.generation !== providerGeneration_ACU
    || scope.configuredMode !== getCurrentStorageMode()
  ) return false;
  const chatId = normalizeRuntimeChatId_ACU(currentChatFileIdentifier_ACU);
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  if (chatId !== scope.chatId || isolationKey !== scope.isolationKey) return false;
  if (!checkRevision || scope.runtimeRevision === null) return true;
  return captureTableRuntimeRevisionForWriteSet_ACU(
    [{ kind: 'all' }],
    { chatKey: scope.chatId, isolationKey: scope.isolationKey },
  ) === scope.runtimeRevision;
}

async function hydrateCandidateForCurrentChat_ACU(
  provider: ITableStorageProvider,
  scope: ProviderRuntimeScope_ACU,
): Promise<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string } | null> {
  const replay = await loadOrCreateJsonTableFromChatHistory_ACU({ detached: true });
  if (!isProviderRuntimeScopeCurrent_ACU(scope, true)) return null;

  if (typeof provider.loadFromData !== 'function') {
    throw new Error(`[StorageStrategy] ${provider.mode} provider 未实现 canonical snapshot hydrate。`);
  }

  let data = replay.data ?? null;
  let source: 'merged' | 'initialized' = 'merged';
  if (data === null) {
    const initialSnapshot = buildInitialTableRuntimeSnapshot_ACU();
    if (!isProviderRuntimeScopeCurrent_ACU(scope, true)) return null;
    if (!initialSnapshot.data) {
      return {
        loaded: false,
        source: 'empty',
        error: initialSnapshot.error || '当前聊天没有可用的表格初始化快照。',
      };
    }
    data = initialSnapshot.data;
    source = 'initialized';
  }

  const result = await provider.loadFromData(data, { source });
  if (!isProviderRuntimeScopeCurrent_ACU(scope, true)) return null;
  return result;
}

async function handleSqliteCandidateFailure_ACU(message: string, generation: number): Promise<string> {
  if (hasReadyActiveProvider_ACU()) {
    logError_ACU(`[StorageStrategy] SQLite 候选失败，保留当前 ${currentProvider!.mode} runtime: ${message}`);
    return message;
  }
  logError_ACU(`[StorageStrategy] SQLite 候选失败，自动 fallback 到原生模式: ${message}`);
  await initializeNativeFallback_ACU(generation, 'sqlite');
  return message;
}

async function initializeAndPublishProvider_ACU(
  mode: StorageMode,
  generation: number,
): Promise<string | null> {
  const candidate = createProvider(mode);
  candidate.beginRuntimeCandidate_ACU?.();
  let disposed = false;
  const disposeCandidate = () => {
    if (disposed) return;
    disposed = true;
    candidate.dispose();
  };
  let scope: ProviderRuntimeScope_ACU | null = null;
  let result: { loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string } | null;
  try {
    scope = captureProviderRuntimeScope_ACU(mode, candidate.mode, generation, true);
    result = await hydrateCandidateForCurrentChat_ACU(candidate, scope);
  } catch (e: any) {
    disposeCandidate();
    if (scope && !isProviderRuntimeScopeCurrent_ACU(scope, true)) return null;
    if (mode !== 'sqlite') throw e;
    return handleSqliteCandidateFailure_ACU(e?.message || String(e), generation);
  }

  if (!result) {
    disposeCandidate();
    logDebug_ACU(`[StorageStrategy] 丢弃作用域或 revision 已变化的 Provider 候选: generation=${generation}`);
    return null;
  }
  logDebug_ACU(`[StorageStrategy] 数据加载完成: loaded=${result.loaded}, source=${result.source}`);
  if (!result.loaded && result.error) {
    disposeCandidate();
    if (!scope || !isProviderRuntimeScopeCurrent_ACU(scope, true)) return null;
    if (mode === 'sqlite') {
      return handleSqliteCandidateFailure_ACU(result.error, generation);
    }
    throw new Error(result.error);
  }
  if (!scope) return null;
  if (!publishProviderIfCurrent_ACU(candidate, scope)) return null;
  return null;
}

async function initializeNativeFallback_ACU(generation: number, requestedMode: StorageMode): Promise<void> {
  const fallback = createProvider('native');
  fallback.beginRuntimeCandidate_ACU?.();
  let disposed = false;
  const disposeFallback = () => {
    if (disposed) return;
    disposed = true;
    fallback.dispose();
  };
  let scope: ProviderRuntimeScope_ACU | null = null;
  try {
    scope = captureProviderRuntimeScope_ACU(requestedMode, fallback.mode, generation, true);
    const result = await hydrateCandidateForCurrentChat_ACU(fallback, scope);
    if (!result) {
      disposeFallback();
      return;
    }
    if (!result.loaded && result.error) {
      throw new Error(result.error);
    }
    publishProviderIfCurrent_ACU(fallback, scope);
  } catch (e) {
    disposeFallback();
    throw e;
  }
}

function hasReadyActiveProvider_ACU(): boolean {
  return currentProvider?.isReady() === true;
}

function publishProviderIfCurrent_ACU(nextProvider: ITableStorageProvider, scope: ProviderRuntimeScope_ACU): boolean {
  if (nextProvider.mode !== scope.providerMode) {
    nextProvider.dispose();
    throw new Error(`[StorageStrategy] Provider 模式与候选作用域不匹配: provider=${nextProvider.mode}, scope=${scope.providerMode}`);
  }
  if (!isProviderRuntimeScopeCurrent_ACU(scope, true)) {
    nextProvider.dispose();
    logDebug_ACU(`[StorageStrategy] 丢弃过期 Provider 候选: generation=${scope.generation}`);
    return false;
  }
  const previousProvider = currentProvider;
  try {
    nextProvider.activateRuntimeStatePublication_ACU?.();
  } catch (e: any) {
    nextProvider.dispose();
    logError_ACU(`[StorageStrategy] Provider runtime 发布失败，保留当前 runtime: ${e?.message || String(e)}`);
    return false;
  }
  currentProvider = nextProvider;
  if (previousProvider && previousProvider !== nextProvider) {
    try {
      previousProvider.dispose();
    } catch (e: any) {
      logError_ACU(`[StorageStrategy] 旧 Provider 清理失败，新 runtime 保持有效: ${e?.message || String(e)}`);
    }
  }
  return true;
}

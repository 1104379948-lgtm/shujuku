import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import {
    deleteSummaryVectorFlushTask_ACU,
    deleteSummaryVectorFlushTaskStrict_ACU,
    getSummaryVectorFlushTask_ACU,
    getSummaryVectorFlushTaskStrict_ACU,
    invalidateSummaryVectorFlushTaskStrict_ACU,
    listSummaryVectorFlushTasks_ACU,
    markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU,
    SummaryVectorFlushGenerationInvalidatedError_ACU,
    upsertSummaryVectorFlushTask_ACU,
    type SummaryVectorIndexFlushTaskMode_ACU,
    type SummaryVectorIndexFlushTaskRecord_ACU,
} from '../../data/storage/vector-index-hot-cache';
import {
    archiveSummaryVectorIndexNow_ACU,
    buildSummaryVectorIndexArchiveScopeKey_ACU,
    findSummaryTable_ACU,
    type SummaryVectorIndexArchiveResult_ACU,
} from './summary-vector-index-archive-service';
import { clearSummaryVectorIndexDirtyForRealign_ACU } from './summary-vector-index-realign-state';
import { logSummaryVectorIndexIdentityEvent_ACU } from './summary-vector-index-storage-service';

const SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU = 2500;
const SUMMARY_VECTOR_INDEX_FLUSHING_STALE_MS_ACU = 60_000;
const summaryVectorFlushTimers_ACU = new Map<string, ReturnType<typeof setTimeout>>();
const summaryVectorFlushRunning_ACU = new Set<string>();

export interface SummaryVectorIndexFlushQueueOptions_ACU {
    targetMessageIndex?: number;
    mode?: SummaryVectorIndexFlushTaskMode_ACU;
    debounceMs?: number;
    reason?: string;
    isolationKey?: string;
    sourceTableKey?: string;
}

export interface SummaryVectorIndexFlushQueueResult_ACU {
    queued: boolean;
    skipped?: boolean;
    reason?: string;
    scopeKey?: string;
    debounceUntil?: number;
}

export interface SummaryVectorIndexFlushNowResult_ACU {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    result?: SummaryVectorIndexArchiveResult_ACU;
    error?: string;
}

function normalizeKeyPart_ACU(value: any): string {
    return String(value || '').trim();
}

/** 与 archive lock、realign state 复用同一三元 canonical scope。 */
export function buildSummaryVectorIndexFlushScopeKey_ACU(
    chatKey: string,
    isolationKey: string,
    sourceTableKey: string,
): string {
    return buildSummaryVectorIndexArchiveScopeKey_ACU({
        chatKey: normalizeKeyPart_ACU(chatKey) || 'current-chat',
        isolationKey: normalizeKeyPart_ACU(isolationKey) || 'default',
        sourceTableKey: normalizeKeyPart_ACU(sourceTableKey) || 'summary',
    });
}

function normalizeErrorMessage_ACU(error: unknown): string {
    if (error instanceof Error) return error.message || error.name || '未知错误';
    if (typeof error === 'string') return error;
    try {
        const text = JSON.stringify(error);
        return text && text !== '{}' ? text : String(error || '未知错误');
    } catch {
        return String(error || '未知错误');
    }
}

function shouldClearSummaryVectorIndexDirtyAfterFlush_ACU(result: SummaryVectorIndexArchiveResult_ACU): boolean {
    if (!result.success) return false;
    if (result.skipped && result.reason === 'summary_table_not_found') {
        return false;
    }
    return true;
}

function clearFlushTimer_ACU(scopeKey: string): void {
    const timer = summaryVectorFlushTimers_ACU.get(scopeKey);
    if (timer) clearTimeout(timer);
    summaryVectorFlushTimers_ACU.delete(scopeKey);
}

async function markFlushTaskFailure_ACU(task: SummaryVectorIndexFlushTaskRecord_ACU, error: string, terminal = false): Promise<void> {
    await upsertSummaryVectorFlushTask_ACU({
        scopeKey: task.scopeKey,
        chatKey: task.chatKey,
        isolationKey: task.isolationKey,
        sourceTableKey: task.sourceTableKey,
        targetMessageIndex: task.targetMessageIndex,
        generation: task.generation,
        mode: task.mode,
        status: terminal ? 'failed_terminal' : 'failed_retryable',
        requestedAt: task.requestedAt,
        debounceUntil: Date.now() + SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU,
        lastError: error,
    });
    logSummaryVectorIndexIdentityEvent_ACU(terminal ? 'warn' : 'debug', 'flush', terminal ? 'failed_terminal' : 'failed_retryable', {
        scopeFingerprint: task.scopeKey,
        error,
    });
}

function scheduleFlushTaskTimer_ACU(task: SummaryVectorIndexFlushTaskRecord_ACU): void {
    clearFlushTimer_ACU(task.scopeKey);
    const delay = Math.max(0, Math.min(Math.max(0, task.debounceUntil - Date.now()), 2_147_483_647));
    logDebug_ACU(`[交火向量索引] 防抖定时器已设置：scope=${task.scopeKey}, delay=${delay}ms, mode=${task.mode}`);
    const timer = setTimeout(() => {
        logDebug_ACU(`[交火向量索引] 防抖定时器触发：scope=${task.scopeKey}, 开始执行 flush`);
        summaryVectorFlushTimers_ACU.delete(task.scopeKey);
        void flushSummaryVectorIndexTaskNow_ACU(task.scopeKey);
    }, delay);
    summaryVectorFlushTimers_ACU.set(task.scopeKey, timer);
}

async function resumeQueuedFlushTaskAfterRunner_ACU(scopeKey: string, completedGeneration: number): Promise<void> {
    const current = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    if (!current
        || current.generation === completedGeneration
        || current.status === 'invalidated'
        || current.status === 'ready'
        || current.status === 'failed_terminal') {
        return;
    }
    if (current.status === 'queued' || current.status === 'dirty' || current.status === 'failed_retryable') {
        scheduleFlushTaskTimer_ACU(current);
        logDebug_ACU(`[交火向量索引] 旧 flush 完成后已接力调度新 generation：scope=${scopeKey}, generation=${current.generation}`);
    }
}

export async function enqueueSummaryVectorIndexFlush_ACU(options: SummaryVectorIndexFlushQueueOptions_ACU = {}): Promise<SummaryVectorIndexFlushQueueResult_ACU> {
    const selectedSummary = findSummaryTable_ACU();
    const sourceTableKey = normalizeKeyPart_ACU(options.sourceTableKey || selectedSummary?.summaryKey);
    const isolationKey = normalizeKeyPart_ACU(options.isolationKey || getCurrentIsolationKey_ACU());
    if (!selectedSummary?.summaryKey || !sourceTableKey || sourceTableKey !== normalizeKeyPart_ACU(selectedSummary.summaryKey)) {
        return { queued: false, skipped: true, reason: 'summary_table_not_found' };
    }
    const chatKey = normalizeKeyPart_ACU(currentChatFileIdentifier_ACU);
    if (!chatKey) {
        return { queued: false, skipped: true, reason: 'flush_scope_unresolved' };
    }

    const now = Date.now();
    const rawDebounceMs = options.debounceMs == null
        ? SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU
        : Number(options.debounceMs);
    const debounceMs = Number.isFinite(rawDebounceMs)
        ? Math.max(0, rawDebounceMs)
        : SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU;
    const scopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    const existingTask = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    // flushing 表示旧 runner 已捕获当前 generation。新的写入必须进入下一代，
    // 否则旧 runner 成功收尾会与新任务共享 generation，无法安全区分归属。
    const generation = existingTask?.status === 'invalidated' || existingTask?.status === 'flushing'
        ? existingTask.generation + 1
        : existingTask?.generation;
    const task = await upsertSummaryVectorFlushTask_ACU({
        scopeKey,
        chatKey,
        isolationKey,
        sourceTableKey,
        targetMessageIndex: options.targetMessageIndex,
        generation,
        mode: options.mode === 'append' ? 'append' : 'sync',
        status: 'queued',
        requestedAt: now,
        debounceUntil: now + debounceMs,
    });
    if (!task) {
        return { queued: false, skipped: true, reason: 'flush_task_persist_failed', scopeKey };
    }
    scheduleFlushTaskTimer_ACU(task);
    logDebug_ACU(`[交火向量索引] 已加入防抖 flush 队列：scope=${scopeKey}, mode=${task.mode}, debounceMs=${debounceMs}, reason=${options.reason || ''}`);
    return { queued: true, scopeKey, debounceUntil: task.debounceUntil };
}

export async function flushSummaryVectorIndexTaskNow_ACU(scopeKey: string): Promise<SummaryVectorIndexFlushNowResult_ACU> {
    const task = await getSummaryVectorFlushTask_ACU(scopeKey);
    if (!task) return { success: true, skipped: true, reason: 'flush_task_not_found' };
    if (task.status === 'invalidated') return { success: true, skipped: true, reason: 'flush_scope_invalidated' };
    const expectedGeneration = Math.max(0, Number(task.generation) || 0);
    if (summaryVectorFlushRunning_ACU.has(task.scopeKey)) {
        return { success: true, skipped: true, reason: 'flush_already_running' };
    }

    const activeChatKey = normalizeKeyPart_ACU(currentChatFileIdentifier_ACU);
    if (task.chatKey !== activeChatKey) {
        const message = `flush scope 与当前聊天上下文不一致：task=${task.chatKey}, active=${activeChatKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        logWarn_ACU('[交火向量索引] 跳过防抖 flush，当前上下文不匹配:', message);
        return { success: false, reason: 'flush_scope_mismatch', error: message };
    }
    const expectedScopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(task.chatKey, task.isolationKey, task.sourceTableKey);
    if (!task.isolationKey || task.scopeKey !== expectedScopeKey) {
        // legacy scope：老版本代码遗留、无法通过当前三元 canonical 校验的任务。
        // 保留只会永远命中告警噪音；直接删除即可，dirty state 由后续正常写路径重建。
        const message = `旧版 flush task 缺少可验证三元 scope，已从队列中清理：task=${task.scopeKey}`;
        clearFlushTimer_ACU(task.scopeKey);
        await deleteSummaryVectorFlushTask_ACU(task.scopeKey);
        logSummaryVectorIndexIdentityEvent_ACU('debug', 'flush', 'legacy_scope_purged', {
            scopeFingerprint: task.scopeKey,
            error: message,
        });
        logDebug_ACU('[交火向量索引] 已清理身份不完整的旧版 flush task:', message);
        return { success: true, skipped: true, reason: 'flush_legacy_scope_purged' };
    }
    const activeIsolationKey = normalizeKeyPart_ACU(getCurrentIsolationKey_ACU());
    if (task.isolationKey !== activeIsolationKey) {
        const message = `flush isolation 与当前上下文不一致：task=${task.isolationKey}, active=${activeIsolationKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        return { success: false, reason: 'flush_scope_mismatch', error: message };
    }

    const selectedSummary = findSummaryTable_ACU();
    if (!selectedSummary?.summaryKey || normalizeKeyPart_ACU(selectedSummary.summaryKey) !== task.sourceTableKey) {
        const message = `flush scope 对应纪要表不可用：sourceTableKey=${task.sourceTableKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        logWarn_ACU('[交火向量索引] 跳过防抖 flush，纪要表不可用:', message);
        return { success: false, reason: 'summary_table_not_found_for_flush', error: message };
    }

    summaryVectorFlushRunning_ACU.add(task.scopeKey);
    clearFlushTimer_ACU(task.scopeKey);
    try {
        await upsertSummaryVectorFlushTask_ACU({
            scopeKey: task.scopeKey,
            chatKey: task.chatKey,
            isolationKey: task.isolationKey,
            sourceTableKey: task.sourceTableKey,
            targetMessageIndex: task.targetMessageIndex,
            mode: task.mode,
            status: 'flushing',
            generation: expectedGeneration,
            requestedAt: task.requestedAt,
            debounceUntil: task.debounceUntil,
        });
        // [spv3.6.9] force=true：填表完成后必须强制写入外部文件，跳过"无变更"检测
        // 因为填表后数据已变化，但 fingerprint 比对可能误判为无变更
        const result = await archiveSummaryVectorIndexNow_ACU({
            targetMessageIndex: task.targetMessageIndex,
            mode: task.mode,
            saveChatAfterWrite: true,
            force: true,
            isolationKey: task.isolationKey,
            sourceTableKey: task.sourceTableKey,
            expectedFlushScopeKey: task.scopeKey,
            expectedFlushGeneration: expectedGeneration,
        });
        if (result.skipped && result.reason === 'flush_scope_invalidated') {
            return { success: true, skipped: true, reason: 'flush_scope_invalidated', result };
        }
        if (result.success) {
            const completed = await markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU(task.scopeKey, expectedGeneration);
            if (completed && shouldClearSummaryVectorIndexDirtyAfterFlush_ACU(result)) {
                clearSummaryVectorIndexDirtyForRealign_ACU(task.scopeKey);
            }
            logDebug_ACU(`[交火向量索引] 防抖 flush 完成：scope=${task.scopeKey}, skipped=${result.skipped}, reason=${result.reason || ''}`);
            return { success: true, skipped: result.skipped, reason: result.reason, result };
        }
        const error = result.errors?.join('; ') || result.reason || 'summary_vector_index_flush_failed';
        await markFlushTaskFailure_ACU(task, error, result.reason === 'summary_vector_index_config_invalid' || result.reason === 'target_message_invalid' || result.reason === 'target_message_not_found');
        logWarn_ACU('[交火向量索引] 防抖 flush 失败:', error);
        return { success: false, reason: result.reason, result, error };
    } catch (error) {
        const message = normalizeErrorMessage_ACU(error);
        if (error instanceof SummaryVectorFlushGenerationInvalidatedError_ACU) return { success: true, skipped: true, reason: 'flush_scope_invalidated' };
        await markFlushTaskFailure_ACU(task, message, false);
        logWarn_ACU('[交火向量索引] 防抖 flush 异常:', message);
        return { success: false, reason: 'flush_exception', error: message };
    } finally {
        summaryVectorFlushRunning_ACU.delete(task.scopeKey);
        await resumeQueuedFlushTaskAfterRunner_ACU(task.scopeKey, expectedGeneration);
    }
}

/**
 * 持久化失效当前 scope 的 flush task，并同步取消内存定时器。
 * 墓碑携带单调 generation；旧 runner 在真正发布聊天 pointer 前必须校验代次。
 */
export async function clearSummaryVectorIndexFlushQueueForCurrentScope_ACU(params: {
    isolationKey: string;
    sourceTableKey: string;
}): Promise<number> {
    const chatKey = normalizeKeyPart_ACU(currentChatFileIdentifier_ACU);
    const isolationKey = normalizeKeyPart_ACU(params.isolationKey);
    const sourceTableKey = normalizeKeyPart_ACU(params.sourceTableKey);
    if (!chatKey) throw new Error('清理交火向量 flush 队列失败：当前聊天标识为空');
    if (!sourceTableKey) throw new Error('清理交火向量 flush 队列失败：纪要表标识为空');

    const scopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    clearFlushTimer_ACU(scopeKey);
    const tombstone = await invalidateSummaryVectorFlushTaskStrict_ACU({
        scopeKey,
        chatKey,
        isolationKey,
        sourceTableKey,
    });
    logDebug_ACU(`[交火向量索引] 已持久化 flush 失效墓碑：scope=${scopeKey}, generation=${tombstone.generation}`);
    return 1;
}

export async function restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU(): Promise<number> {
    const chatKey = normalizeKeyPart_ACU(currentChatFileIdentifier_ACU);
    if (!chatKey) return 0;
    const isolationKey = normalizeKeyPart_ACU(getCurrentIsolationKey_ACU());
    const selectedSummary = findSummaryTable_ACU();
    const sourceTableKey = normalizeKeyPart_ACU(selectedSummary?.summaryKey);
    if (!sourceTableKey) return 0;
    const tasks = await listSummaryVectorFlushTasks_ACU({
        chatKey,
        isolationKey,
        sourceTableKey,
    });
    const activeScopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    let restored = 0;
    let purgedLegacy = 0;
    const now = Date.now();
    for (const task of tasks) {
        if (task.status === 'invalidated') continue;
        // 启动期主动清理身份不完整的旧版 task：
        // list 已按三元字段过滤到当前 active scope，但更早版本的 scopeKey 算法可能与当前不一致，
        // 保留只会成为长期告警噪音；dirty state 会由后续正常写路径重新入队。
        if (!task.isolationKey || task.scopeKey !== activeScopeKey) {
            clearFlushTimer_ACU(task.scopeKey);
            await deleteSummaryVectorFlushTask_ACU(task.scopeKey);
            logSummaryVectorIndexIdentityEvent_ACU('debug', 'flush', 'legacy_scope_purged', {
                scopeFingerprint: task.scopeKey,
                error: `restore 时发现身份不完整的旧版 flush task：task=${task.scopeKey}`,
            });
            purgedLegacy += 1;
            continue;
        }
        if (task.status === 'ready' || task.status === 'failed_terminal') continue;
        if (task.status === 'flushing' && now - task.updatedAt > SUMMARY_VECTOR_INDEX_FLUSHING_STALE_MS_ACU) {
            await markFlushTaskFailure_ACU(task, '上次 flush 在执行中断后超时，已重新排队。', false);
            const refreshed = await getSummaryVectorFlushTask_ACU(task.scopeKey);
            if (refreshed) {
                scheduleFlushTaskTimer_ACU(refreshed);
                restored += 1;
            }
            continue;
        }
        scheduleFlushTaskTimer_ACU(task);
        restored += 1;
    }
    if (restored > 0) {
        logDebug_ACU(`[交火向量索引] 已恢复当前 scope 防抖 flush 队列：scope=${activeScopeKey}, count=${restored}`);
    }
    if (purgedLegacy > 0) {
        logDebug_ACU(`[交火向量索引] 启动期清理身份不完整的旧版 flush task：count=${purgedLegacy}`);
    }
    return restored;
}

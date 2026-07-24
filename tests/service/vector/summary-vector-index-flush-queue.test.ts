import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chatKey: 'chat-a',
  isolationKey: 'iso-a',
  summaryKey: 'summary-a',
  task: null as any,
  upsert: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  archive: vi.fn(),
  logIdentityEvent: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.chatKey; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  deleteSummaryVectorFlushTask_ACU: (...args: any[]) => h.remove(...args),
  getSummaryVectorFlushTask_ACU: (...args: any[]) => h.get(...args),
  listSummaryVectorFlushTasks_ACU: (...args: any[]) => h.list(...args),
  upsertSummaryVectorFlushTask_ACU: (...args: any[]) => h.upsert(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  buildSummaryVectorIndexArchiveScopeKey_ACU: (parts: any) => JSON.stringify([parts.chatKey || 'current-chat', parts.isolationKey || 'default', parts.sourceTableKey || 'summary']),
  findSummaryTable_ACU: () => h.summaryKey ? { summaryKey: h.summaryKey, table: {} } : null,
  archiveSummaryVectorIndexNow_ACU: (...args: any[]) => h.archive(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  logSummaryVectorIndexIdentityEvent_ACU: (...args: any[]) => h.logIdentityEvent(...args),
}));

import {
  buildSummaryVectorIndexFlushScopeKey_ACU,
  flushSummaryVectorIndexTaskNow_ACU,
  restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU,
} from '../../../src/service/vector/summary-vector-index-flush-queue';
import {
  clearSummaryVectorIndexDirtyForRealign_ACU,
  isSummaryVectorIndexDirtyForRealign_ACU,
  markSummaryVectorIndexDirtyForRealign_ACU,
} from '../../../src/service/vector/summary-vector-index-realign-state';

function task(scopeKey: string, overrides: any = {}) {
  return { scopeKey, chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary-a', targetMessageIndex: 3, mode: 'sync', status: 'queued', requestedAt: 1, debounceUntil: Date.now(), attemptCount: 0, updatedAt: Date.now(), ...overrides };
}

describe('summary-vector-index flush queue scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.chatKey = 'chat-a'; h.isolationKey = 'iso-a'; h.summaryKey = 'summary-a';
    h.get.mockImplementation(async () => h.task);
    h.upsert.mockImplementation(async (input: any) => ({ ...input, attemptCount: 0, updatedAt: Date.now() }));
    h.list.mockResolvedValue([]); h.remove.mockResolvedValue(undefined);
    h.archive.mockResolvedValue({ success: true, skipped: false, errors: [] });
  });

  it('三元 scope 彼此独立，成功 flush 只清理自身 dirty state', async () => {
    const scopeA = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    const scopeB = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-b', 'summary-a');
    expect(scopeA).not.toBe(scopeB);
    markSummaryVectorIndexDirtyForRealign_ACU(scopeA, 'runtime_stale_rows');
    markSummaryVectorIndexDirtyForRealign_ACU(scopeB, 'runtime_stale_rows');
    h.task = task(scopeA);

    await expect(flushSummaryVectorIndexTaskNow_ACU(scopeA)).resolves.toMatchObject({ success: true });
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ isolationKey: 'iso-a', sourceTableKey: 'summary-a' }));
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeA)).toBe(false);
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeB)).toBe(true);
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeB);
  });

  it('scope key 对分隔符输入无碰撞，防止任务与 dirty state 串扰', () => {
    const scopeA = buildSummaryVectorIndexFlushScopeKey_ACU('a::b', 'c', 'd');
    const scopeB = buildSummaryVectorIndexFlushScopeKey_ACU('a', 'b::c', 'd');
    expect(scopeA).not.toBe(scopeB);
    markSummaryVectorIndexDirtyForRealign_ACU(scopeA, 'runtime_stale_rows');
    markSummaryVectorIndexDirtyForRealign_ACU(scopeB, 'runtime_stale_rows');
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeA);
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeB)).toBe(true);
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeB);
  });

  it('自动清理旧版缺少可验证三元 scope 的任务，不执行 archive', async () => {
    h.task = task('flush::chat-a', { isolationKey: '' });
    await expect(flushSummaryVectorIndexTaskNow_ACU('flush::chat-a')).resolves.toMatchObject({
      success: true,
      skipped: true,
      reason: 'flush_legacy_scope_purged',
    });
    expect(h.archive).not.toHaveBeenCalled();
    expect(h.remove).toHaveBeenCalledWith('flush::chat-a');
    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'debug',
      'flush',
      'legacy_scope_purged',
      expect.objectContaining({ scopeFingerprint: 'flush::chat-a' }),
    );
  });

  it('执行时 active isolation 漂移会拒绝任务，不执行 archive', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-b', 'summary-a');
    h.task = task(scope, { isolationKey: 'iso-b' });
    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ reason: 'flush_scope_mismatch' });
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('不可恢复的 flush 失败记录 terminal identity event', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({ success: false, reason: 'target_message_invalid', errors: ['target invalid'] });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'target_message_invalid',
    });

    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'warn',
      'flush',
      'failed_terminal',
      expect.objectContaining({ scopeFingerprint: scope, error: 'target invalid' }),
    );
  });

  it('恢复只查询当前 active 三元 scope', async () => {
    await expect(restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU()).resolves.toBe(0);
    expect(h.list).toHaveBeenCalledWith({ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
  });
});

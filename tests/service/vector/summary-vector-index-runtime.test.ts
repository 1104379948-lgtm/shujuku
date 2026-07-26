import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [{ is_user: true, mes: 'latest user' } as any],
  config: {} as any,
  rows: [] as any[],
  chunks: [] as any[],
  entries: [] as any[],
  createEmbeddings: vi.fn(),
  callAI: vi.fn(),
  setEntries: vi.fn(),
  createEntries: vi.fn(),
  loadChunks: vi.fn(),
  clearMissing: vi.fn(),
  enqueueFlush: vi.fn(),
  missingError: false,
  invalidError: false,
  summaryTable: null as any,
  preparedRows: [] as any[],
}));

vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => h.chat }));
vi.mock('../../../src/service/ai/api-call', () => ({callAIWithPreset_ACU: (...a: any[]) => h.callAI(...a) }));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({ createEmbeddings_ACU: (...a: any[]) => h.createEmbeddings(...a) }));
vi.mock('../../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: () => ({ zeroTkOccupyMode: false, summaryVectorIndexModeEnabled: true }) }));
vi.mock('../../../src/data/repositories/profile-repo', () => ({ globalMeta_ACU: { summaryVectorIndexModeGlobal: true } }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ getInjectionTargetLorebook_ACU: async () => 'book', getIsolationPrefix_ACU: () => '' }));
vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  isWorldbookApiAvailable_ACU: () => true,
  getLorebookEntries_ACU: async () => h.entries,
  setLorebookEntries_ACU: (...a: any[]) => h.setEntries(...a),
  createLorebookEntries_ACU: (...a: any[]) => h.createEntries(...a),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => h.config,
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => ({
    summaryVectorIndexState: { rows: h.rows, chunks: h.chunks, manifest: { indexId: 'idx', sourceTableKey: 'summary-source', snapshot: { activeRowKeys: h.rows.map((r) => r.rowKey) } } },
    layers: [{ messageIndex: 0, isolationKey: 'iso-source', summaryVectorIndexState: { manifest: { indexId: 'idx', sourceTableKey: 'summary-source' } } }],
  }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => h.summaryTable,
  buildPreparedRows_ACU: () => h.preparedRows,
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: (...a: any[]) => h.loadChunks(...a),
  logSummaryVectorIndexIdentityEvent_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU: vi.fn(),
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU: (...a: any[]) => h.clearMissing(...a),
  isInvalidExternalVectorFileError_ACU: () => h.invalidError,
  isMissingExternalVectorFileError_ACU: () => h.missingError,
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  enqueueSummaryVectorIndexFlush_ACU: (...a: any[]) => h.enqueueFlush(...a),
}));

import { processSummaryVectorIndexBeforeGeneration_ACU } from '../../../src/service/vector/summary-vector-index-runtime';


function row_ACU(key: string, order: number, summary: string): any {
  return {
    rowKey: key,
    rowOrder: order,
    timeSpan: `t-${order}`,
    location: `loc-${order}`,
    summary,
    indexCode: `IDX-${order}`,
    status: 'active',
  };
}

function chunk_ACU(row: any, text: string, vector: number[] = [0, 1]): any {
  return {
    chunkId: `chunk-${row.rowKey}`,
    rowKey: row.rowKey,
    sequence: 0,
    text,
    textHash: `hash-${row.rowKey}`,
    vector,
  };
}

function defaultConfig_ACU(overrides: Record<string, any> = {}): any {
  return {
    embeddingEndpoint: 'https://embedding.test',
    embeddingApiKey: 'key',
    embeddingModel: 'model',
    keywordContextPairCount: 1,
    keywordPromptGroup: [],
    keywordGenerationMaxAttempts: 1,
    keywordApiPreset: '',
    summaryIndexKeywordMinRows: 1,
    summaryIndexRecentFixedInjectCount: 0,
    summaryIndexMinScore: 0.95,
    summaryIndexCandidateLimit: 10,
    summaryIndexHybridRetrievalEnabled: true,
    summaryIndexBm25CandidateLimit: 10,
    summaryIndexRrfK: 60,
    topK: 10,
    rerankEndpoint: '',
    rerankModel: '',
    rerankApiKey: '',
    rerankInstruction: '',
    ...overrides,
  };
}

function createdContent_ACU(): string {
  return String(h.createEntries.mock.calls.at(-1)?.[1]?.[0]?.content || '');
}

function setFixture_ACU(overrides: Record<string, any> = {}): void {
  const oldRow = row_ACU('old', 1, 'old sparse summary');
  const denseRow = row_ACU('dense', 2, 'dense summary');
  const recentRow = row_ACU('recent', 3, 'recent fixed summary');
  h.rows = [oldRow, denseRow, recentRow];
  h.chunks = [
    chunk_ACU(oldRow, 'ancient secret relic under bridge', [0, 1]),
    chunk_ACU(denseRow, 'unrelated dense vector row', [1, 0]),
    chunk_ACU(recentRow, 'secret relic but recent row must be fixed only', [0, 1]),
  ];
  h.config = defaultConfig_ACU(overrides);
}


describe('processSummaryVectorIndexBeforeGeneration_ACU hybrid retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.chat = [{ is_user: true, mes: 'latest user' } as any];
    h.entries = [];
    h.callAI.mockResolvedValue('<keywords>secret relic</keywords>');
    h.createEmbeddings.mockResolvedValue([{ index: 0, embedding: [1, 0] }]);
    h.createEntries.mockResolvedValue(undefined);
    h.setEntries.mockResolvedValue(undefined);
    h.loadChunks.mockImplementation(async () => h.chunks);
    h.clearMissing.mockResolvedValue(true);
    h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope', debounceUntil: Date.now() });
    h.missingError = false;
    h.invalidError = false;
    h.summaryTable = null;
    h.preparedRows = [];
    vi.stubGlobal('fetch', vi.fn());
    setFixture_ACU();
  });

  it('hybrid 开启时 BM25 能补足 dense 阈值过滤掉的候选', async () => {
    h.config.summaryIndexMinScore = 0.95;
    h.config.summaryIndexRecentFixedInjectCount = 0;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'hybrid-bm25' });

    expect(result.success).toBe(true);
    expect(result.denseCandidateCount).toBe(1);
    expect(result.sparseCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.fusionCandidateCount).toBeGreaterThanOrEqual(2);
    const content = createdContent_ACU();
    expect(content).toContain('old sparse summary');
    expect(content).toContain('dense summary');
  });

  it('hybrid 关闭时保持纯 dense 路径，不注入 BM25-only 候选', async () => {
    h.config.summaryIndexHybridRetrievalEnabled = false;
    h.config.summaryIndexMinScore = 0.95;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'dense-only' });

    expect(result.success).toBe(true);
    expect(result.sparseCandidateCount).toBe(0);
    expect(result.fusionCandidateCount).toBe(1);
    const content = createdContent_ACU();
    expect(content).not.toContain('old sparse summary');
    expect(content).toContain('dense summary');
  });

  it('dense 为空但 BM25 命中时不跳过并正常注入', async () => {
    h.chunks = h.chunks.map((chunk: any) => ({ ...chunk, vector: [0, 1] }));
    h.config.summaryIndexMinScore = 0.95;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'sparse-only' });

    expect(result.success).toBe(true);
    expect(result.denseCandidateCount).toBe(0);
    expect(result.sparseCandidateCount).toBeGreaterThanOrEqual(1);
    expect(createdContent_ACU()).toContain('old sparse summary');
  });

  it('最近固定行不参与候选池，但最终合并进覆盖内容', async () => {
    h.config.summaryIndexRecentFixedInjectCount = 1;
    h.config.topK = 1;
    h.chunks = [
      h.chunks[0],
      { ...h.chunks[1], text: 'plain dense vector row', vector: [0, 1] },
      h.chunks[2],
    ];

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'recent-fixed' });

    expect(result.success).toBe(true);
    expect(result.injectedCount).toBe(2);
    const content = createdContent_ACU();
    expect(content).toContain('old sparse summary');
    expect(content).toContain('recent fixed summary');
  });

  it('rerank 失败时回退到原候选排序并继续写入世界书', async () => {
    h.config.rerankEndpoint = 'https://rerank.test';
    h.config.rerankModel = 'rerank-model';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rerank down'); }));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'rerank-fallback' });

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createdContent_ACU()).toContain('old sparse summary');
  });
});

describe('processSummaryVectorIndexBeforeGeneration_ACU missing snapshot recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.chat = [{ is_user: false, mes: 'assistant' } as any];
    h.rows = [row_ACU('r1', 1, 'summary')];
    h.chunks = [];
    h.config = defaultConfig_ACU();
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: missing 读取失败 404: Not Found'));
    h.clearMissing.mockResolvedValue({ chatStateCleared: true, cacheCleared: true });
    h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope', debounceUntil: Date.now() });
    h.missingError = true;
    h.invalidError = false;
    h.summaryTable = null;
    h.preparedRows = [];
  });

  it('删除匹配的失效指针后交给 UI 走普通即时重建路径', async () => {
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-one', source: 'missing-test' });

    expect(h.clearMissing).toHaveBeenCalledWith({
      messageIndex: 0,
      isolationKey: 'iso-source',
      indexId: 'idx',
      sourceTableKey: 'summary-source',
    });
    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_rebuild_required' });
  });

  it('失效指针未安全删除时拒绝盲目重建', async () => {
    h.clearMissing.mockResolvedValue({ chatStateCleared: false, cacheCleared: true });
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-two', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_failed' });
  });

  it('实时行已变化但严格删除失败时不会提前入队 stale rebuild', async () => {
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = [{ rowKey: 'different-row', sourceFingerprint: 'new' }];
    h.clearMissing.mockResolvedValue({ chatStateCleared: false, cacheCleared: true });

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-three', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reason: 'external_vector_files_missing_state_clear_failed' });
  });

  it('严格保存抛错时返回稳定原因且不入队', async () => {
    h.clearMissing.mockRejectedValue(new Error('save failed'));
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-four', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_save_failed' });
  });
});

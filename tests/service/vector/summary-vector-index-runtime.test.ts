import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFetch,
  mockCreateEmbeddings,
  mockCallAIWithPreset,
  mockGetCurrentWorldbookConfig,
  mockGlobalMeta,
  mockGetEffectiveSummaryVectorIndexConfig,
  mockValidateSummaryVectorIndexConfig,
  mockGetLatestSummaryVectorIndexSnapshotState,
  mockLoadSummaryVectorIndexChunksFromManifest,
  mockIsWorldbookApiAvailable,
  mockGetInjectionTargetLorebook,
  mockGetIsolationPrefix,
  mockGetLorebookEntries,
  mockCreateLorebookEntries,
  mockSetLorebookEntries,
} = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockCreateEmbeddings: vi.fn(),
  mockCallAIWithPreset: vi.fn(),
  mockGetCurrentWorldbookConfig: vi.fn(),
  mockGlobalMeta: { summaryVectorIndexModeGlobal: true } as any,
  mockGetEffectiveSummaryVectorIndexConfig: vi.fn(),
  mockValidateSummaryVectorIndexConfig: vi.fn(),
  mockGetLatestSummaryVectorIndexSnapshotState: vi.fn(),
  mockLoadSummaryVectorIndexChunksFromManifest: vi.fn(),
  mockIsWorldbookApiAvailable: vi.fn(),
  mockGetInjectionTargetLorebook: vi.fn(),
  mockGetIsolationPrefix: vi.fn(),
  mockGetLorebookEntries: vi.fn(),
  mockCreateLorebookEntries: vi.fn(),
  mockSetLorebookEntries: vi.fn(),
}));

vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: mockCreateEmbeddings,
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
  };
});

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mockGlobalMeta,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getInjectionTargetLorebook_ACU: mockGetInjectionTargetLorebook,
  getIsolationPrefix_ACU: mockGetIsolationPrefix,
}));

vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  createLorebookEntries_ACU: mockCreateLorebookEntries,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  isWorldbookApiAvailable_ACU: mockIsWorldbookApiAvailable,
  setLorebookEntries_ACU: mockSetLorebookEntries,
}));

vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: mockGetEffectiveSummaryVectorIndexConfig,
  validateSummaryVectorIndexConfig_ACU: mockValidateSummaryVectorIndexConfig,
}));

vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: mockGetLatestSummaryVectorIndexSnapshotState,
}));

vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: mockLoadSummaryVectorIndexChunksFromManifest,
}));

vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU: vi.fn(),
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU: vi.fn(),
  isInvalidExternalVectorFileError_ACU: vi.fn(() => false),
  isMissingExternalVectorFileError_ACU: vi.fn(() => false),
}));

vi.stubGlobal('fetch', mockFetch);

import { DEFAULT_RERANK_INSTRUCTION_ACU } from '../../../src/shared/defaults';
import { processSummaryVectorIndexBeforeGeneration_ACU } from '../../../src/service/vector/summary-vector-index-runtime';

function makeConfig(rerankInstruction = DEFAULT_RERANK_INSTRUCTION_ACU) {
  return {
    enabled: true,
    threshold: 1,
    archiveTriggerCount: 1,
    archiveBatchSize: 1,
    archiveMaxConcurrency: 1,
    topK: 1,
    minScore: 0,
    embeddingEndpoint: 'https://embedding.example.com/embeddings',
    embeddingApiKey: '',
    embeddingModel: 'embedding-model',
    rerankEndpoint: 'https://rerank.example.com/rerank',
    rerankApiKey: 'rerank-key',
    rerankModel: 'bge-reranker-v2-m3',
    rerankInstruction,
    vectorNamespace: 'chat',
    entryComment: 'entry-comment',
    entryKey: 'entry-key',
    summaryIndexKeywordMinRows: 1,
    summaryChunkSentenceCount: 2,
    summaryPromptGroupId: 'summary-default',
    archiveWithoutSummary: false,
    summaryPromptGroup: [],
    keywordApiPreset: 'keyword-preset',
    keywordContextPairCount: 0,
    keywordGenerationMaxAttempts: 1,
    keywordPromptGroup: [
      { role: 'system', content: '提取关键词', deletable: false },
    ],
    recallCandidateLimit: 10,
    recentFixedInjectCount: 0,
    summaryIndexMinScore: 0,
    summaryIndexCandidateLimit: 10,
    summaryIndexChunkSentenceCount: 2,
    summaryIndexArchiveMaxConcurrency: 1,
    summaryIndexRecentFixedInjectCount: 0,
  };
}

function makeSnapshot() {
  const rows = [
    {
      rowKey: 'row-1',
      rowId: '1',
      rowOrder: 1,
      timeSpan: '第一天',
      location: '控制室',
      summary: '角色讨论向量召回',
      indexCode: 'AM01',
      vectorSourceText: '角色讨论向量召回',
      chunkIds: ['chunk-1'],
      status: 'active',
    },
  ];
  const chunks = [
    {
      chunkId: 'chunk-1',
      rowKey: 'row-1',
      rowOrder: 1,
      text: '候选概要文本',
      vector: [1, 0, 0],
      sequence: 0,
    },
  ];

  return {
    summaryVectorIndexState: {
      snapshotMessageId: 'msg-1',
      sourceTableKey: 'summary',
      sourceTableName: '纪要',
      indexedAt: '2026-05-21T00:00:00.000Z',
      rowCount: 1,
      chunkCount: 1,
      skippedRowCount: 0,
      rows,
      chunks,
      manifest: {
        indexId: 'idx-1',
        snapshot: { activeRowKeys: ['row-1'] },
      },
    },
    layers: [{ messageIndex: 1, isolationKey: '', indexId: 'idx-1' }],
  };
}

describe('summary-vector-index-runtime Rerank instruction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobalMeta.summaryVectorIndexModeGlobal = true;
    mockGetCurrentWorldbookConfig.mockReturnValue({ summaryVectorIndexModeEnabled: true, zeroTkOccupyMode: false });
    mockValidateSummaryVectorIndexConfig.mockReturnValue({ valid: true, errors: [] });
    mockGetLatestSummaryVectorIndexSnapshotState.mockReturnValue(makeSnapshot());
    mockLoadSummaryVectorIndexChunksFromManifest.mockResolvedValue(makeSnapshot().summaryVectorIndexState.chunks);
    mockCreateEmbeddings.mockResolvedValue([{ index: 0, embedding: [1, 0, 0] }]);
    mockCallAIWithPreset.mockResolvedValue('<keywords>向量,召回</keywords>');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.99 }] }),
    });
    mockIsWorldbookApiAvailable.mockReturnValue(true);
    mockGetInjectionTargetLorebook.mockResolvedValue('target-lorebook');
    mockGetIsolationPrefix.mockReturnValue('');
    mockGetLorebookEntries.mockResolvedValue([]);
    mockCreateLorebookEntries.mockResolvedValue(undefined);
    mockSetLorebookEntries.mockResolvedValue(undefined);
  });

  it('默认 rerankInstruction 启用时，真实运行链路的 Rerank 请求体携带 instruction', async () => {
    mockGetEffectiveSummaryVectorIndexConfig.mockReturnValue(makeConfig());

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({
      userInput: '用户询问向量召回',
      source: 'instruction-default-enabled',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'bge-reranker-v2-m3',
      query: '用户询问向量召回\n关键词：向量，召回',
      documents: ['候选概要文本'],
      instruction: DEFAULT_RERANK_INSTRUCTION_ACU,
    });
  });

  it('rerankInstruction 为空白时，真实运行链路不发送 instruction 字段', async () => {
    mockGetEffectiveSummaryVectorIndexConfig.mockReturnValue(makeConfig('   '));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({
      userInput: '用户询问空白指令',
      source: 'instruction-blank',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'bge-reranker-v2-m3',
      query: '用户询问空白指令\n关键词：向量，召回',
      documents: ['候选概要文本'],
    });
    expect(body).not.toHaveProperty('instruction');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, mockGetHostRequestHeaders } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetHostRequestHeaders: vi.fn(() => ({ 'X-Host': 'SillyTavern' })),
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  getHostRequestHeaders_ACU: mockGetHostRequestHeaders,
}));

vi.stubGlobal('fetch', mockFetch);

import { createRerankScores_ACU } from '../../../src/data/gateways/vector-rerank-gateway';

describe('vector-rerank-gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHostRequestHeaders.mockReturnValue({ 'X-Host': 'SillyTavern' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ index: 0, relevance_score: 0.91 }],
      }),
    });
  });

  it('低层网关未传 rerankInstruction 时不发送 instruction 字段，保持调用方显式控制', async () => {
    const result = await createRerankScores_ACU({
      endpoint: 'https://rerank.example.com/rerank/',
      apiKey: 'sk-test',
      model: 'bge-reranker-v2-m3',
      query: '当前查询',
      documents: ['候选文档'],
    });

    expect(result).toEqual([{ index: 0, relevanceScore: 0.91 }]);
    expect(mockFetch).toHaveBeenCalledWith('https://rerank.example.com/rerank', expect.objectContaining({
      method: 'POST',
      headers: {
        'X-Host': 'SillyTavern',
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test',
      },
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'bge-reranker-v2-m3',
      query: '当前查询',
      documents: ['候选文档'],
    });
    expect(body).not.toHaveProperty('instruction');
  });

  it('rerankInstruction 非空时发送 instruction 字段', async () => {
    await createRerankScores_ACU({
      endpoint: 'https://rerank.example.com/rerank',
      model: 'bge-reranker-v2-m3',
      query: '当前查询',
      documents: ['候选文档'],
      rerankInstruction: '  请判断查询与文档的相关性。\n按相关性降序排序。  ',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.instruction).toBe('请判断查询与文档的相关性。\n按相关性降序排序。');
  });

  it('rerankInstruction 为空白时不发送 instruction 字段', async () => {
    await createRerankScores_ACU({
      endpoint: 'https://rerank.example.com/rerank',
      model: 'bge-reranker-v2-m3',
      query: '当前查询',
      documents: ['候选文档'],
      rerankInstruction: '   ',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('instruction');
  });
});

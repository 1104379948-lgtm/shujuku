import { describe, expect, it } from 'vitest';

import { DEFAULT_RERANK_INSTRUCTION_ACU } from '../../../src/shared/defaults';
import {
  getDefaultVectorMemoryConfig_ACU,
  normalizeVectorMemoryConfig_ACU,
} from '../../../src/service/vector/vector-memory-config';

describe('vector-memory-config rerankInstruction', () => {
  it('默认配置启用 rerankInstruction，旧配置缺字段时回填默认指令', () => {
    const defaults = getDefaultVectorMemoryConfig_ACU();
    expect(defaults.rerankInstruction).toBe(DEFAULT_RERANK_INSTRUCTION_ACU);

    const normalized = normalizeVectorMemoryConfig_ACU({
      rerankEndpoint: 'https://rerank.example.com',
      rerankModel: 'bge-reranker-v2-m3',
    });

    expect(normalized.rerankInstruction).toBe(DEFAULT_RERANK_INSTRUCTION_ACU);
  });

  it('归一化 rerankInstruction 时 trim 外层空白并保留内部换行', () => {
    const normalized = normalizeVectorMemoryConfig_ACU({
      rerankInstruction: '  请判断查询与文档的相关性。\n只返回相关性排序。  ',
    });

    expect(normalized.rerankInstruction).toBe('请判断查询与文档的相关性。\n只返回相关性排序。');
  });

  it('非字符串 rerankInstruction 回退默认指令，避免非法配置关闭默认发送', () => {
    const normalized = normalizeVectorMemoryConfig_ACU({
      rerankInstruction: { text: 'invalid' },
    });

    expect(normalized.rerankInstruction).toBe(DEFAULT_RERANK_INSTRUCTION_ACU);
  });
});

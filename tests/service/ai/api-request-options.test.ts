import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
}));

import {
  applyApiRequestOptionsToBody_ACU,
  mergeCustomIncludeHeaders_ACU,
  normalizeApiRequestOptions_ACU,
  parseApiExcludedBodyParams_ACU,
  parseApiExtraBodyParams_ACU,
  parseApiExtraHeaders_ACU,
} from '../../../src/service/ai/api-request-options';

describe('api-request-options', () => {
  it('归一化缺省配置时保持旧行为', () => {
    expect(normalizeApiRequestOptions_ACU({})).toEqual({
      extraBodyParams: '',
      excludedBodyParams: '',
      extraHeaders: '',
      thinkingEnabled: false,
      thinkingEffort: 'none',
    });
  });

  it('解析 JSON 与简单 YAML 主体参数', () => {
    expect(parseApiExtraBodyParams_ACU('{"top_k":20,"temperature":0.7}')).toEqual({ top_k: 20, temperature: 0.7 });
    expect(parseApiExtraBodyParams_ACU('top_k: 20\nflag: true\nname: test')).toEqual({ top_k: 20, flag: true, name: 'test' });
  });

  it('解析排除主体参数数组和行列表', () => {
    expect(parseApiExcludedBodyParams_ACU('["reasoning_effort","thinking"]')).toEqual(['reasoning_effort', 'thinking']);
    expect(parseApiExcludedBodyParams_ACU('- top_p\n- presence_penalty')).toEqual(['top_p', 'presence_penalty']);
  });

  it('解析附加请求头并合并 Authorization', () => {
    expect(parseApiExtraHeaders_ACU('CustomHeader: 自定义值')).toEqual({ CustomHeader: '自定义值' });
    expect(mergeCustomIncludeHeaders_ACU('sk-test', 'CustomHeader: 自定义值')).toBe('Authorization: Bearer sk-test\nCustomHeader: 自定义值');
  });

  it('附加主体参数保护关键字段并允许排除字段后置删除', () => {
    const body = applyApiRequestOptionsToBody_ACU({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4',
      reasoning_effort: 'medium',
    }, {
      extraBodyParams: 'messages: hacked\ntop_k: 20',
      excludedBodyParams: 'reasoning_effort',
    });

    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('gpt-4');
    expect(body.top_k).toBe(20);
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('思维链开启时注入 thinking 和 reasoning_effort，关闭时不注入 thinking', () => {
    expect(applyApiRequestOptionsToBody_ACU({}, { thinkingEnabled: true, thinkingEffort: 'max' })).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    });

    expect(applyApiRequestOptionsToBody_ACU({}, { thinkingEnabled: true, thinkingEffort: 'none' })).toEqual({});

    expect(applyApiRequestOptionsToBody_ACU({}, { thinkingEnabled: false, thinkingEffort: 'max' })).toEqual({});
  });
});

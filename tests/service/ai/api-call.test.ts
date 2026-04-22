/**
 * tests/service/ai/api-call.test.ts
 * AI 调用编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockIsGenerateRawAvailable, mockGenerateRaw, mockSendConnectionManager, mockGetHeaders, mockHandleApiResponse } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 },
    tavernProfile: 'default',
    plotApiPreset: '',
    streamingEnabled: false,
    apiPresets: [] as any[],
  } as any,
  mockIsGenerateRawAvailable: vi.fn(() => true),
  mockGenerateRaw: vi.fn(),
  mockSendConnectionManager: vi.fn(),
  mockGetHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
  mockHandleApiResponse: vi.fn(),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: mockIsGenerateRawAvailable,
  generateRaw_ACU: mockGenerateRaw,
  sendConnectionManagerRequest_ACU: mockSendConnectionManager,
  getHostRequestHeaders_ACU: mockGetHeaders,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callApi_ACU,
  getApiConfigByPreset_ACU,
  callAIWithPreset_ACU,
  callCustomOpenAI_ACU_Direct,
} from '../../../src/service/ai/api-call';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.apiMode = 'custom';
  mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 };
  mockSettings.tavernProfile = 'default';
  mockSettings.plotApiPreset = '';
  mockSettings.streamingEnabled = false;
  mockSettings.apiPresets = [];
});

// ═══ getApiConfigByPreset_ACU ═══
describe('getApiConfigByPreset_ACU', () => {
  it('空预设名返回当前配置', () => {
    const config = getApiConfigByPreset_ACU('');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig).toBe(mockSettings.apiConfig);
  });

  it('找到预设时返回预设配置', () => {
    mockSettings.apiPresets = [
      { name: '预设A', apiMode: 'tavern', apiConfig: { url: 'http://a.com' }, tavernProfile: 'profileA' },
    ];
    const config = getApiConfigByPreset_ACU('预设A');
    expect(config.apiMode).toBe('tavern');
    expect(config.tavernProfile).toBe('profileA');
  });

  it('预设不存在时回退到当前配置', () => {
    mockSettings.apiPresets = [];
    const config = getApiConfigByPreset_ACU('不存在');
    expect(config.apiMode).toBe('custom');
  });
});

// ═══ callApi_ACU ═══
describe('callApi_ACU', () => {
  it('tavern 模式使用 generateRaw', async () => {
    mockSettings.plotApiPreset = '';
    mockSettings.apiConfig = { useMainApi: true };
    mockGenerateRaw.mockResolvedValue('AI 回复');
    const result = await callApi_ACU([{ role: 'user', content: '你好' }], {});
    expect(result).toBe('AI 回复');
    expect(mockGenerateRaw).toHaveBeenCalled();
  });

  it('generateRaw 不可用时抛错', async () => {
    mockSettings.apiConfig = { useMainApi: true };
    mockIsGenerateRawAvailable.mockReturnValue(false);
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('generateRaw');
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('response') });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callApi_ACU([{ role: 'user', content: '你好' }], {});
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('自定义 API 未配置 URL 时抛错', async () => {
    mockSettings.apiConfig = { url: '', model: 'gpt-4' };
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('URL或模型未配置');
  });

  it('fetch 返回非 ok 时抛错', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4' };
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Internal Error') });
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('500');
  });

  it('handleApiResponse 返回 null 时抛错', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue(null);
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('无效响应');
  });
});

// ═══ callAIWithPreset_ACU ═══
describe('callAIWithPreset_ACU', () => {
  it('空消息数组返回 null', async () => {
    const result = await callAIWithPreset_ACU([]);
    expect(result).toBeNull();
  });

  it('非数组返回 null', async () => {
    const result = await callAIWithPreset_ACU(null as any);
    expect(result).toBeNull();
  });

  it('tavern 模式调用 sendConnectionManagerRequest', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: 'AI 回复' } }] },
    });
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('tavern 模式返回无效响应时返回 null', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({});
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBeNull();
  });

  it('useMainApi 模式使用 generateRaw', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { useMainApi: true };
    mockIsGenerateRawAvailable.mockReturnValue(true);
    mockGenerateRaw.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('指定预设名使用对应预设', async () => {
    mockSettings.apiPresets = [
      { name: '预设B', apiMode: 'tavern', apiConfig: {}, tavernProfile: 'profileB' },
    ];
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: '预设B回复' } }] },
    });
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '预设B');
    expect(result).toBe('预设B回复');
  });
});

// ═══ callCustomOpenAI_ACU_Direct ═══
describe('callCustomOpenAI_ACU_Direct', () => {
  it('tavern 模式直接发送消息', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: '直接回复' } }] },
    });
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('直接回复');
    expect(mockSendConnectionManager).toHaveBeenCalled();
  });
  it('custom 模式且 useMainApi 时使用 generateRaw', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig.useMainApi = true;
    mockGenerateRaw.mockResolvedValue('generateRaw回复');
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('generateRaw回复');
  });
  it('custom 模式且非 useMainApi 时使用 fetch', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig.useMainApi = false;
    mockHandleApiResponse.mockResolvedValue('fetch回复');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('fetch回复');
  });
});
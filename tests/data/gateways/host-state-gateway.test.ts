/**
 * tests/data/gateways/host-state-gateway.test.ts
 * 宿主运行时状态访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSillyTavern, mockTopLevelWindow, mockGetCurrentCharData } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockTopLevelWindow: {} as any,
  mockGetCurrentCharData: vi.fn(() => null),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
}));

vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharData_ACU: mockGetCurrentCharData,
}));

import {
  getUserName_ACU,
  getPersonaDescription_ACU,
  getCurrentCharacterFallback_ACU,
  getCharDescription_ACU,
} from '../../../src/data/gateways/host-state-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
  Object.keys(mockTopLevelWindow).forEach(k => delete mockTopLevelWindow[k]);
  mockGetCurrentCharData.mockReturnValue(null);
});

describe('getUserName_ACU', () => {
  it('不可用时返回默认值 "用户"', () => {
    expect(getUserName_ACU()).toBe('用户');
  });

  it('可用时返回用户名', () => {
    mockSillyTavern.name1 = '冈部伦太郎';
    expect(getUserName_ACU()).toBe('冈部伦太郎');
  });
});

describe('getPersonaDescription_ACU', () => {
  it('所有来源不可用时返回空字符串', () => {
    expect(getPersonaDescription_ACU()).toBe('');
  });

  it('从 SillyTavern.getContext() 获取', () => {
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({
        powerUserSettings: { persona_description: '疯狂科学家' },
      }),
    };
    expect(getPersonaDescription_ACU()).toBe('疯狂科学家');
  });

  it('从 power_user 获取（降级）', () => {
    mockTopLevelWindow.power_user = { persona_description: '助手' };
    expect(getPersonaDescription_ACU()).toBe('助手');
  });

  it('从 SillyTavern_API_ACU 获取（最终降级）', () => {
    mockSillyTavern.powerUserSettings = { persona_description: 'API描述' };
    expect(getPersonaDescription_ACU()).toBe('API描述');
  });
});

describe('getCurrentCharacterFallback_ACU', () => {
  it('所有来源不可用时返回 null', () => {
    expect(getCurrentCharacterFallback_ACU()).toBeNull();
  });

  it('优先使用 TavernHelper.getCharData', () => {
    const charData = { name: '角色A', description: '描述A' };
    mockGetCurrentCharData.mockReturnValue(charData);
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });

  it('TavernHelper 不可用时降级到 SillyTavern_API', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    const charData = { name: '角色B' };
    mockSillyTavern.characters = { 0: charData };
    mockSillyTavern.this_chid = 0;
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });

  it('降级到 SillyTavern.getContext()', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    const charData = { name: '角色C' };
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ characters: { 0: charData }, characterId: 0 }),
    };
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });
});

describe('getCharDescription_ACU', () => {
  it('所有来源不可用时返回空字符串', () => {
    expect(getCharDescription_ACU()).toBe('');
  });

  it('从角色数据获取描述', () => {
    mockGetCurrentCharData.mockReturnValue({ description: '天才少女科学家' });
    expect(getCharDescription_ACU()).toBe('天才少女科学家');
  });

  it('从 data.description 获取', () => {
    mockGetCurrentCharData.mockReturnValue({ data: { description: '嵌套描述' } });
    expect(getCharDescription_ACU()).toBe('嵌套描述');
  });

  it('降级到 stContext.name2_description', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ name2_description: '最终降级描述' }),
    };
    expect(getCharDescription_ACU()).toBe('最终降级描述');
  });
});
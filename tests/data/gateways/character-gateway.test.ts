/**
 * tests/data/gateways/character-gateway.test.ts
 * 角色数据读取网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockLogWarn } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  getCurrentCharData_ACU,
  getCharLorebooks_ACU,
  getChatMessages_ACU,
} from '../../../src/data/gateways/character-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
});

describe('getCurrentCharData_ACU', () => {
  it('API 不可用返回 null', () => {
    expect(getCurrentCharData_ACU()).toBeNull();
  });

  it('API 可用返回角色数据', () => {
    const charData = { name: '角色A', description: '描述' };
    mockTavernHelper.getCharData = vi.fn().mockReturnValue(charData);
    expect(getCurrentCharData_ACU()).toEqual(charData);
  });

  it('传入 target 参数', () => {
    mockTavernHelper.getCharData = vi.fn().mockReturnValue({ name: '角色B' });
    getCurrentCharData_ACU('specific');
    expect(mockTavernHelper.getCharData).toHaveBeenCalledWith('specific');
  });
});

describe('getCharLorebooks_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getCharLorebooks_ACU()).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回世界书列表', async () => {
    const data = { primary: ['book1'], additional: ['book2'] };
    mockTavernHelper.getCharLorebooks = vi.fn().mockResolvedValue(data);
    expect(await getCharLorebooks_ACU({ type: 'all' })).toEqual(data);
  });
});

describe('getChatMessages_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getChatMessages_ACU()).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回消息数组', async () => {
    const messages = [{ mes: '消息1' }, { mes: '消息2' }];
    mockTavernHelper.getChatMessages = vi.fn().mockResolvedValue(messages);
    expect(await getChatMessages_ACU('all', {})).toEqual(messages);
  });
});
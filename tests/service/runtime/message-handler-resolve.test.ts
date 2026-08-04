/**
 * tests/service/runtime/message-handler-resolve.test.ts
 * resolveGeneratedAiMessageIndex_ACU 纯函数表驱动测试
 */
import { describe, expect, it } from 'vitest';
import {
  resolveGeneratedAiMessageIndex_ACU,
  isAiMessage_ACU,
  countAiMessages_ACU,
  type AutoFillIntent_ACU,
} from '../../../src/service/runtime/message-handler';

function makeIntent(partial: Partial<AutoFillIntent_ACU> = {}): AutoFillIntent_ACU {
  return {
    eventMessageId: 1,
    chatKey: 'chat-a',
    isolationKey: '',
    capturedAt: Date.now(),
    capturedChatLength: 2,
    capturedAiFloorCount: 1,
    ...partial,
  };
}

const user = { is_user: true, mes: '用户' };
const ai = { is_user: false, mes: 'AI', name: '角色A' };
const narrator = { is_user: false, mes: '旁白', extra: { type: 'narrator' } };

function chatWith(messages: any[]): any[] {
  return messages;
}

describe('isAiMessage_ACU', () => {
  it('识别 AI 楼层', () => {
    expect(isAiMessage_ACU(ai)).toBe(true);
  });
  it('排除用户楼层', () => {
    expect(isAiMessage_ACU(user)).toBe(false);
  });
  it('排除 narrator 系统旁白', () => {
    expect(isAiMessage_ACU(narrator)).toBe(false);
  });
  it('排除 null/非对象', () => {
    expect(isAiMessage_ACU(null)).toBe(false);
    expect(isAiMessage_ACU(undefined)).toBe(false);
    expect(isAiMessage_ACU('x')).toBe(false);
  });
});

describe('countAiMessages_ACU', () => {
  it('统计 AI 楼层数（排除用户与旁白）', () => {
    expect(countAiMessages_ACU([user, ai, narrator, ai])).toBe(2);
  });
  it('非数组返回 0', () => {
    expect(countAiMessages_ACU(null as any)).toBe(0);
  });
});

describe('resolveGeneratedAiMessageIndex_ACU', () => {
  it('精确命中：eventMessageId 指向 AI 楼层 → resolved', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength:1, capturedAiFloorCount: 1 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('用户锚点 + 捕获后延迟追加 AI → 从捕获边界解析唯一候选', () => {
    // 捕获时 chat 为 [user, user]，长度为 2，AI 数 0；防抖后追加了 AI
    const liveChat = chatWith([user, user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 2 });
  });

  it('锚点后区间兜底：捕获长度不可靠但 AI 总数增加时解析', () => {
    // eventMessageId=0 是用户，捕获长度=1 但 liveChat 更长；AI 总数从 0 增至 1
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 0, capturedChatLength: 0, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('系统消息干扰：捕获后追加 narrator + AI → 只解析 AI', () => {
    const liveChat = chatWith([user, user, narrator, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 3 });
  });

  it('双 AI 歧义：捕获后出现两个合格 AI 候选 → ambiguous，不猜', () => {
    const liveChat = chatWith([user, user, ai, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result.kind).toBe('ambiguous');
    expect(result.kind === 'ambiguous' && result.candidates).toEqual([2, 3]);
  });

  it('尚未物化：AI 楼层始终未出现 → pending_materialization', () => {
    const liveChat = chatWith([user, user]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'pending_materialization', candidates: [] });
  });

  it('越界 eventMessageId 且无新增候选 → pending', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 99, capturedChatLength: 2, capturedAiFloorCount: 1 }) });
    expect(result.kind).toBe('pending_materialization');
  });

  it('捕获长度超过 liveChat 长度时不越界解析', () => {
    const liveChat = chatWith([user]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 5, capturedAiFloorCount: 1 }) });
    expect(result.kind).toBe('pending_materialization');
  });

  it('liveChat 非数组或 intent 缺失 → invalid_intent', () => {
    expect(resolveGeneratedAiMessageIndex_ACU({ liveChat: null as any, intent: makeIntent() }).kind).toBe('invalid_intent');
    expect(resolveGeneratedAiMessageIndex_ACU({ liveChat: [], intent: null as any }).kind).toBe('invalid_intent');
  });
});

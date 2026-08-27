import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CONVERSATION_TEXT_LIMIT_ACU,
  appendAgentConversation_ACU,
  appendAgentConversationToChat_ACU,
  buildEmptyAgentConversation_ACU,
  clearAgentConversationField_ACU,
  lastAnnouncedTurnKey_ACU,
  readAgentConversation_ACU,
  renderAgentConversationMessages_ACU,
  validateAgentConversationSnapshot_ACU,
  writeAgentConversation_ACU,
} from '../../../../src/service/continuation/agent/agent-conversation-store';
import { AGENT_CONVERSATION_FIELD_ACU, AGENT_CONVERSATION_SCHEMA_VERSION_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

const saveChat = vi.fn(async () => undefined);

function useChat(chat: any[]): void {
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
}

function snapshotWith(messages: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU, nextId: 1, updatedAt: 0, messages, ...overrides };
}

beforeEach(() => { saveChat.mockClear(); saveChat.mockResolvedValue(undefined); });

describe('会话快照校验', () => {
  it('结构非法整份作废，个别条目非法只丢该条', () => {
    expect(validateAgentConversationSnapshot_ACU(null)).toBeNull();
    expect(validateAgentConversationSnapshot_ACU({ schemaVersion: 99, messages: [] })).toBeNull();
    expect(validateAgentConversationSnapshot_ACU(snapshotWith('not-an-array' as any))).toBeNull();

    const snapshot = validateAgentConversationSnapshot_ACU(snapshotWith([
      { id: 1, kind: 'user', text: '有效', digest: '你的消息', turnKey: 't1', at: 5 },
      { id: 2, kind: 'unknown-kind', text: '种类非法' },
      { id: 3, kind: 'agent', text: '   ' },
      { id: 0, kind: 'agent', text: 'id 非法' },
      { id: 7, kind: 'agent', text: '也有效' },
    ]));
    expect(snapshot!.messages.map(message => message.id)).toEqual([1, 7]);
    // nextId 必须超过已有最大 id，否则追加会撞号。
    expect(snapshot!.nextId).toBe(8);
  });
});

describe('会话读取与落盘', () => {
  it('从尾向前取最近的合法快照，跳过被污染的楼层', () => {
    useChat([
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([{ id: 1, kind: 'user', text: '早期' }]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([{ id: 1, kind: 'user', text: '较新' }]) },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: { schemaVersion: 'broken' } },
    ]);
    expect(readAgentConversation_ACU().messages[0].text).toBe('较新');
  });

  it('全程无命中时返回空会话', () => {
    useChat([{ mes: 'a' }, { mes: 'b' }]);
    expect(readAgentConversation_ACU()).toMatchObject({ messages: [], nextId: 1 });
  });

  it('写盘失败时还原楼层字段，不留半成品', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    saveChat.mockRejectedValueOnce(new Error('host refused'));
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [{ kind: 'user', text: '第一句', digest: '', turnKey: '' }]);

    await expect(writeAgentConversation_ACU(chat, 0, snapshot)).rejects.toBeInstanceOf(ContinuationValidationError_ACU);
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_CONVERSATION_FIELD_ACU)).toBe(false);
  });

  it('目标楼层不可用时以专用错误码拒绝', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    await expect(writeAgentConversation_ACU(chat, 5, buildEmptyAgentConversation_ACU()))
      .rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });
  });

  it('追加到当前聊天时写入末楼；空聊天不写盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    useChat(chat);
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '别揭穿守门人', digest: '你的消息', turnKey: '' }])).toBe(true);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].messages[0].text).toBe('别揭穿守门人');
    expect(saveChat).toHaveBeenCalledOnce();

    // 空条目不触发写盘。
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '   ', digest: '', turnKey: '' }])).toBe(false);
    expect(saveChat).toHaveBeenCalledOnce();

    useChat([]);
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '无处可放', digest: '', turnKey: '' }])).toBe(false);
  });

  it('一键清空只删会话字段，正文与其他字段保持原样', async () => {
    const chat: any[] = [
      { mes: '正文一', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([]), other: 'keep' },
      { mes: '正文二' },
    ];
    useChat(chat);
    expect(await clearAgentConversationField_ACU()).toBe(true);
    expect(chat[0]).toEqual({ mes: '正文一', other: 'keep' });
    expect(chat[1]).toEqual({ mes: '正文二' });
    // 没有字段可删时不写盘。
    saveChat.mockClear();
    expect(await clearAgentConversationField_ACU()).toBe(false);
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('会话追加与渲染', () => {
  it('追加分配递增 id，空文本被忽略且返回原引用', () => {
    const empty = buildEmptyAgentConversation_ACU();
    expect(appendAgentConversation_ACU(empty, [{ kind: 'user', text: '  ', digest: '', turnKey: '' }])).toBe(empty);

    const next = appendAgentConversation_ACU(empty, [
      { kind: 'turn', text: '新的一轮', digest: '第 1 轮', turnKey: 't1' },
      { kind: 'agent', text: '我的输出', digest: '交付写作指导', turnKey: 't1' },
    ]);
    expect(next.messages.map(message => message.id)).toEqual([1, 2]);
    expect(next.nextId).toBe(3);
  });

  it('超长文本被截断并如实标注', () => {
    const long = 'x'.repeat(AGENT_CONVERSATION_TEXT_LIMIT_ACU + 500);
    const next = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [{ kind: 'tool', text: long, digest: '', turnKey: '' }]);
    expect(next.messages[0].text.length).toBeLessThan(long.length);
    expect(next.messages[0].text).toContain('已截断');
  });

  it('渲染时只有主 Agent 自己的输出是 assistant，其余带来源前缀走 user', () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'user', text: '别揭穿', digest: '', turnKey: 't1' },
      { kind: 'turn', text: '开始新的一轮', digest: '', turnKey: 't1' },
      { kind: 'agent', text: '{"action":"finalize"}', digest: '', turnKey: 't1' },
      { kind: 'tool', text: '派工成功', digest: '', turnKey: 't1' },
      { kind: 'handoff', text: '早期浓缩', digest: '', turnKey: '' },
    ]);
    expect(renderAgentConversationMessages_ACU(snapshot)).toEqual([
      { role: 'user', content: '【用户】\n别揭穿' },
      { role: 'user', content: '【新的一轮】\n开始新的一轮' },
      { role: 'assistant', content: '{"action":"finalize"}' },
      { role: 'user', content: '【工具结果】\n派工成功' },
      { role: 'user', content: '【早期会话交接报告】\n早期浓缩' },
    ]);
  });

  it('最后一次换轮通告的游标可被查出，没有通告时为空串', () => {
    expect(lastAnnouncedTurnKey_ACU(buildEmptyAgentConversation_ACU())).toBe('');
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'turn', text: '第一轮', digest: '', turnKey: 't1' },
      { kind: 'turn', text: '第二轮', digest: '', turnKey: 't2' },
      { kind: 'agent', text: '输出', digest: '', turnKey: 't2' },
    ]);
    expect(lastAnnouncedTurnKey_ACU(snapshot)).toBe('t2');
  });
});

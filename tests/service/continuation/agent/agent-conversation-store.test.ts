import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CONVERSATION_TEXT_LIMIT_ACU,
  appendAgentConversation_ACU,
  appendAgentConversationToChat_ACU,
  appendPreparedAgentConversationMessages_ACU,
  buildEmptyAgentConversation_ACU,
  clearAgentConversationField_ACU,
  lastAnnouncedTurnKey_ACU,
  readAgentConversation_ACU,
  renderAgentConversationMessages_ACU,
  validateAgentConversationSnapshot_ACU,
  writeAgentConversationCompactionMark_ACU,
} from '../../../../src/service/continuation/agent/agent-conversation-store';
import {
  AGENT_CONVERSATION_FIELD_ACU,
  AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
  AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU,
  type AgentConversationMessage_ACU,
} from '../../../../src/service/continuation/agent/agent-model';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

const saveChat = vi.fn(async () => undefined);

function useChat(chat: any[]): void {
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
}

function snapshotWith(messages: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU, nextId: 1, updatedAt: 0, messages, ...overrides };
}

function floorRecordWith(segment: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU, updatedAt: 0, segment, ...overrides };
}

function message_ACU(id: number, kind: AgentConversationMessage_ACU['kind'], text: string, extra: Partial<AgentConversationMessage_ACU> = {}): AgentConversationMessage_ACU {
  return { id, kind, text, digest: '', turnKey: '', at: 0, ...extra };
}

// mockReset 而不是 mockClear：once 队列里的失败实现必须一并清掉，否则会泄漏到下一个用例。
beforeEach(() => { saveChat.mockReset(); saveChat.mockResolvedValue(undefined); });

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

describe('会话分段读取', () => {
  it('按楼层顺序拼接各段，删掉楼层即自动回退', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'user', '第一句')]) },
      { mes: 'b' },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(2, 'agent', '第二句')]) },
    ];
    const full = readAgentConversation_ACU(chat);
    expect(full.messages.map(item => item.text)).toEqual(['第一句', '第二句']);
    expect(full.nextId).toBe(3);

    // 末楼被删（Swipe/删楼）后该段消失，会话回退到更早状态。
    const rolledBack = readAgentConversation_ACU(chat.slice(0, 2));
    expect(rolledBack.messages.map(item => item.text)).toEqual(['第一句']);
  });

  it('v1 全量快照充当基线段：之前的段被替换，其后楼层的段继续拼接', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'user', '旧段')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([message_ACU(5, 'user', 'v1 基线')]) },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(6, 'agent', '后续段')]) },
    ];
    const snapshot = readAgentConversation_ACU(chat);
    expect(snapshot.messages.map(item => item.text)).toEqual(['v1 基线', '后续段']);
    expect(snapshot.nextId).toBe(7);
  });

  it('压缩标记做非破坏投影：交接消息置前，删掉承载楼即撤销压缩', () => {
    const early = { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'turn', '早期通告', { turnKey: 't1' }), message_ACU(2, 'agent', '早期输出', { turnKey: 't1' })]) };
    const late = { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(3, 'agent', '最近输出')], { compaction: { compactedThroughId: 2, report: '交接报告内容', at: 1 } }) };

    const projected = readAgentConversation_ACU([early, late]);
    expect(projected.messages.map(item => item.kind)).toEqual(['handoff', 'agent']);
    expect(projected.messages[0].text).toBe('交接报告内容');
    expect(projected.nextId).toBe(4);

    // 标记只存在于被删掉的楼层上时，原始消息原样回来。
    const restored = readAgentConversation_ACU([early]);
    expect(restored.messages.map(item => item.text)).toEqual(['早期通告', '早期输出']);
  });

  it('全程无命中时返回空会话', () => {
    useChat([{ mes: 'a' }, { mes: 'b' }]);
    expect(readAgentConversation_ACU()).toMatchObject({ messages: [], nextId: 1 });
  });
});

describe('会话落盘', () => {
  it('段追加写入末楼并跳过已存在的 id；空聊天不写盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    useChat(chat);
    expect(await appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).toBe(true);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].segment).toHaveLength(1);
    expect(saveChat).toHaveBeenCalledOnce();

    // 同 id 重复追加不写盘（重复 flush 幂等）。
    expect(await appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).toBe(false);
    expect(saveChat).toHaveBeenCalledOnce();

    expect(await appendPreparedAgentConversationMessages_ACU([], [message_ACU(2, 'user', '无处可放')])).toBe(false);
  });

  it('压缩标记写入末楼；已有更大的标记时保持不动', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    expect(await writeAgentConversationCompactionMark_ACU(chat, { compactedThroughId: 5, report: '报告一', at: 1 })).toBe(true);
    expect(chat[0][AGENT_CONVERSATION_FIELD_ACU].compaction.compactedThroughId).toBe(5);
    expect(await writeAgentConversationCompactionMark_ACU(chat, { compactedThroughId: 3, report: '更小的标记', at: 2 })).toBe(false);
    expect(chat[0][AGENT_CONVERSATION_FIELD_ACU].compaction.report).toBe('报告一');
  });

  it('写盘失败时还原楼层字段，不留半成品', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    saveChat.mockRejectedValueOnce(new Error('host refused'));
    await expect(appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).rejects.toBeInstanceOf(ContinuationValidationError_ACU);
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_CONVERSATION_FIELD_ACU)).toBe(false);
  });

  it('追加到当前聊天时写入末楼；空条目与空聊天都不写盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    useChat(chat);
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '别揭穿守门人', digest: '你的消息', turnKey: '' }])).toBe(true);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].segment[0].text).toBe('别揭穿守门人');
    expect(saveChat).toHaveBeenCalledOnce();

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

  it('同一 readKey 被重读后，旧工具结果投影成过期占位，只保留最新一条全文', () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'tool', text: '旧版角色表内容', digest: '', turnKey: 't1', readKey: '$TABLE:角色表' },
      { kind: 'agent', text: '中间输出', digest: '', turnKey: 't1' },
      { kind: 'tool', text: '新版角色表内容', digest: '', turnKey: 't2', readKey: '$TABLE:角色表' },
    ]);
    const rendered = renderAgentConversationMessages_ACU(snapshot);
    expect(rendered[0].content).toContain('已过期');
    expect(rendered[0].content).not.toContain('旧版角色表内容');
    expect(rendered[2].content).toContain('新版角色表内容');
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

/**
 * service/continuation/agent/agent-conversation-store.ts — 主 Agent 自身会话记录的楼层锚定存储
 *
 * 主 Agent 现在像标准 coding agent 一样看得到自己的对话：用户的输入、它历次迭代的原始输出、
 * 运行时回灌的工具结果，按真实 role 顺序累积成消息序列。小说正文不在这里，它由
 * `$STORY_TEXT` 占位符独立摘取（只取 AI 楼层）。
 *
 * 存储策略与资料快照 (`agent-module-store`) 完全同构：全量写入末楼的独立字段，读取时从尾
 * 向前找最近的合法快照。删楼、Swipe、编辑替换都会让该楼层连同会话一起消失，自动回退到上一个
 * 快照，因此这里同样不需要失效协调机制。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_CONVERSATION_FIELD_ACU,
  AGENT_CONVERSATION_MESSAGE_KINDS_ACU,
  AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
  type AgentConversationAppend_ACU,
  type AgentConversationMessage_ACU,
  type AgentConversationMessageKind_ACU,
  type AgentConversationSnapshot_ACU,
} from './agent-model';

/** 单条会话消息的字符上限。模型原始输出与工具结果都可能很长，超出即截断并如实标注。 */
export const AGENT_CONVERSATION_TEXT_LIMIT_ACU = 8000;

/** 各非 assistant 种类在发送给模型时的标题前缀，让模型能区分「谁在说话」。 */
const KIND_PREFIXES_ACU: Record<AgentConversationMessageKind_ACU, string> = {
  user: '【用户】',
  agent: '',
  tool: '【工具结果】',
  turn: '【新的一轮】',
  handoff: '【早期会话交接报告】',
};

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKind_ACU(value: unknown): value is AgentConversationMessageKind_ACU {
  return typeof value === 'string' && (AGENT_CONVERSATION_MESSAGE_KINDS_ACU as readonly string[]).includes(value);
}

function truncateText_ACU(text: string): string {
  if (text.length <= AGENT_CONVERSATION_TEXT_LIMIT_ACU) return text;
  return `${text.slice(0, AGENT_CONVERSATION_TEXT_LIMIT_ACU)}\n（本条内容超出 ${AGENT_CONVERSATION_TEXT_LIMIT_ACU} 字上限，已截断）`;
}

export function buildEmptyAgentConversation_ACU(): AgentConversationSnapshot_ACU {
  return { schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU, nextId: 1, updatedAt: 0, messages: [] };
}

function validateMessage_ACU(raw: unknown): AgentConversationMessage_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (!isKind_ACU(raw.kind)) return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text.trim()) return null;
  const id = typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : 0;
  if (!id) return null;
  return {
    id,
    kind: raw.kind,
    text,
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    turnKey: typeof raw.turnKey === 'string' ? raw.turnKey : '',
    at: typeof raw.at === 'number' && raw.at >= 0 ? raw.at : 0,
  };
}

/**
 * 校验一份持久化会话。整体结构非法返回 null，让读取端继续向前寻找上一个合法快照；
 * 个别条目非法只丢该条（某一楼层的字段可能被外部工具局部污染）。
 * @param raw 楼层字段上的原始值
 * @returns 合法快照或 null
 */
export function validateAgentConversationSnapshot_ACU(raw: unknown): AgentConversationSnapshot_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_CONVERSATION_SCHEMA_VERSION_ACU) return null;
  if (!Array.isArray(raw.messages)) return null;
  const messages = raw.messages.flatMap(item => { const message = validateMessage_ACU(item); return message ? [message] : []; });
  const highestId = messages.reduce((max, message) => Math.max(max, message.id), 0);
  const declaredNextId = typeof raw.nextId === 'number' && Number.isInteger(raw.nextId) && raw.nextId > 0 ? raw.nextId : 1;
  return {
    schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
    // nextId 必须严格大于已有最大 id，否则追加会撞号导致 UI 的 key 冲突。
    nextId: Math.max(declaredNextId, highestId + 1),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    messages,
  };
}

/**
 * 读取当前生效的会话快照。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 最近的合法会话；全程无命中时返回空会话
 */
export function readAgentConversation_ACU(chat?: any[]): AgentConversationSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    const snapshot = validateAgentConversationSnapshot_ACU((message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU]);
    if (!snapshot) continue;
    return snapshot;
  }
  return buildEmptyAgentConversation_ACU();
}

/**
 * 把会话快照写入指定楼层并真实提交到宿主。
 * @param chat 聊天数组
 * @param targetIndex 承载会话的楼层下标，通常是末楼
 * @param snapshot 待写入的全量会话
 */
export async function writeAgentConversation_ACU(chat: any[], targetIndex: number, snapshot: AgentConversationSnapshot_ACU): Promise<void> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 会话记录的目标楼层不可用', false, { targetIndex }));
  }
  const container = message as Record<string, unknown>;
  const hadPrevious = Object.prototype.hasOwnProperty.call(container, AGENT_CONVERSATION_FIELD_ACU);
  const previous = container[AGENT_CONVERSATION_FIELD_ACU];
  try {
    container[AGENT_CONVERSATION_FIELD_ACU] = { ...snapshot, updatedAt: Date.now() };
    await saveChatToHostStrict_ACU();
  } catch (error) {
    if (hadPrevious) container[AGENT_CONVERSATION_FIELD_ACU] = previous;
    else delete container[AGENT_CONVERSATION_FIELD_ACU];
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 会话记录写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * 追加若干条会话消息。
 * @param snapshot 当前会话
 * @param appends 待追加的消息；text 为空的条目被忽略
 * @returns 新的会话快照；没有有效条目时原样返回，调用方据此跳过落盘
 */
export function appendAgentConversation_ACU(snapshot: AgentConversationSnapshot_ACU, appends: readonly AgentConversationAppend_ACU[]): AgentConversationSnapshot_ACU {
  const usable = appends.filter(item => String(item.text ?? '').trim());
  if (!usable.length) return snapshot;
  let nextId = snapshot.nextId;
  const at = Date.now();
  const added = usable.map(item => ({
    id: nextId++,
    kind: item.kind,
    text: truncateText_ACU(String(item.text)),
    digest: String(item.digest ?? ''),
    turnKey: String(item.turnKey ?? ''),
    at,
  }));
  return { ...snapshot, nextId, messages: [...snapshot.messages, ...added] };
}

/**
 * 追加消息到当前聊天的持久会话并落盘。供循环之外的调用方（用户输入、重规划说明）使用。
 * @param appends 待追加的消息
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否真的写入；没有楼层可承载或没有有效条目时为 false
 */
export async function appendAgentConversationToChat_ACU(appends: readonly AgentConversationAppend_ACU[], chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const targetIndex = messages.length - 1;
  if (targetIndex < 0) return false;
  const snapshot = readAgentConversation_ACU(messages);
  const next = appendAgentConversation_ACU(snapshot, appends);
  if (next === snapshot) return false;
  await writeAgentConversation_ACU(messages, targetIndex, next);
  return true;
}

/**
 * 渲染会话消息为发送给模型的消息序列。
 * @param snapshot 当前会话
 * @returns `{ role, content }` 数组；主 Agent 自己的输出是 assistant，其余一律 user
 */
export function renderAgentConversationMessages_ACU(snapshot: AgentConversationSnapshot_ACU): Array<{ role: string; content: string }> {
  return snapshot.messages.map(message => {
    const prefix = KIND_PREFIXES_ACU[message.kind];
    return {
      role: message.kind === 'agent' ? 'assistant' : 'user',
      content: prefix ? `${prefix}\n${message.text}` : message.text,
    };
  });
}

/**
 * 找出会话里最后一次轮次通告的游标指纹。
 * @param snapshot 当前会话
 * @returns 最后一条 turn 消息的 turnKey；没有通告过则为空串
 */
export function lastAnnouncedTurnKey_ACU(snapshot: AgentConversationSnapshot_ACU): string {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index].kind === 'turn') return snapshot.messages[index].turnKey;
  }
  return '';
}

/**
 * 从全部楼层清除会话字段。用于「一键清空」，只删扩展字段，绝不触碰正文。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否有楼层被改动
 */
export async function clearAgentConversationField_ACU(chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    delete (message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU];
    changed = true;
  }
  if (changed) await saveChatToHostStrict_ACU();
  return changed;
}

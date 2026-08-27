/**
 * service/continuation/agent/agent-module-store.ts — 楼层锚定的叙事资料快照存储
 *
 * 存储策略：全量快照写入被结算范围最后一楼的独立字段，读取时从尾向前找最近的合法快照。
 * 删楼、Swipe、编辑替换都会让该楼层连同快照一起消失，资料自动回退到上一个快照，
 * 因此这里不需要任何失效协调机制。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_BLOCK_CHAR_LIMIT_ACU,
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_HOT_HOOK_LIMIT_ACU,
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  type AgentConstraintEntry_ACU,
  type AgentHookEntry_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentModuleSnapshot_ACU,
} from './agent-model';

const IMPORTANCE_WEIGHTS_ACU: Record<string, number> = { high: 3, mid: 2, low: 1 };

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText_ACU(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readIndex_ACU(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
}

function readEnum_ACU(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function buildEmptyAgentModuleSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: -1,
    updatedAt: 0,
    revisions: { hooks: 0, infoGap: 0, constraints: 0 },
    hooks: [],
    infoGap: [],
    constraints: [],
  };
}

function validateHookEntry_ACU(raw: unknown): AgentHookEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const summary = readText_ACU(raw.summary).trim();
  if (!id || !summary) return null;
  return {
    id,
    summary,
    status: readEnum_ACU(raw.status, AGENT_HOOK_STATUSES_ACU, 'planted') as AgentHookEntry_ACU['status'],
    importance: readEnum_ACU(raw.importance, AGENT_HOOK_IMPORTANCES_ACU, 'mid') as AgentHookEntry_ACU['importance'],
    plantedIndex: readIndex_ACU(raw.plantedIndex),
    updatedIndex: readIndex_ACU(raw.updatedIndex),
    plannedPayoff: readText_ACU(raw.plannedPayoff),
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function validateInfoGapEntry_ACU(raw: unknown): AgentInfoGapEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const topic = readText_ACU(raw.topic).trim();
  if (!id || !topic) return null;
  const knowledge = Array.isArray(raw.characterKnowledge) ? raw.characterKnowledge : [];
  const revealStatus = readEnum_ACU(raw.revealStatus, AGENT_REVEAL_STATUSES_ACU, 'unrevealed') as AgentInfoGapEntry_ACU['revealStatus'];
  const revealIndex = readIndex_ACU(raw.revealIndex);
  return {
    id,
    topic,
    objectiveFact: readText_ACU(raw.objectiveFact),
    readerKnown: readText_ACU(raw.readerKnown),
    characterKnowledge: knowledge.flatMap(item => {
      if (!isRecord_ACU(item)) return [];
      const name = readText_ACU(item.name).trim();
      return name ? [{ name, knows: readText_ACU(item.knows) }] : [];
    }),
    revealStatus,
    // 未揭示的条目不允许携带揭示楼层，这是模型把计划写成事实的典型症状。
    revealIndex: revealStatus === 'unrevealed' || revealIndex < 0 ? null : revealIndex,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function validateConstraintEntry_ACU(raw: unknown): AgentConstraintEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const text = readText_ACU(raw.text).trim();
  if (!id || !text) return null;
  return { id, text, reason: readText_ACU(raw.reason), createdIndex: readIndex_ACU(raw.createdIndex) };
}

/**
 * 校验一份持久化快照。非法返回 null 而不抛错，让读取端可以继续向前寻找上一个合法快照，
 * 因为某一楼层的字段可能只是被外部工具污染，不代表整条链路不可用。
 */
export function validateAgentModuleSnapshot_ACU(raw: unknown): AgentModuleSnapshot_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_ACU) return null;
  if (!isRecord_ACU(raw.revisions)) return null;
  if (!Array.isArray(raw.hooks) || !Array.isArray(raw.infoGap) || !Array.isArray(raw.constraints)) return null;
  const settledThroughIndex = readIndex_ACU(raw.settledThroughIndex);
  if (settledThroughIndex < 0) return null;
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    revisions: {
      hooks: Math.max(0, readIndex_ACU(raw.revisions.hooks)),
      infoGap: Math.max(0, readIndex_ACU(raw.revisions.infoGap)),
      constraints: Math.max(0, readIndex_ACU(raw.revisions.constraints)),
    },
    hooks: raw.hooks.flatMap(item => { const entry = validateHookEntry_ACU(item); return entry ? [entry] : []; }),
    infoGap: raw.infoGap.flatMap(item => { const entry = validateInfoGapEntry_ACU(item); return entry ? [entry] : []; }),
    constraints: raw.constraints.flatMap(item => { const entry = validateConstraintEntry_ACU(item); return entry ? [entry] : []; }),
  };
}

/**
 * 读取当前生效的资料快照。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 最近的合法快照；全程无命中时返回 settledThroughIndex = -1 的空快照
 */
export function readAgentModuleSnapshot_ACU(chat?: any[]): AgentModuleSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) continue;
    const snapshot = validateAgentModuleSnapshot_ACU((message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU]);
    if (!snapshot) continue;
    // 删楼后残留快照记录的水位可能指向已不存在的楼层，必须钳制，否则未结算区间会算成负数。
    const highestIndex = messages.length - 1;
    return snapshot.settledThroughIndex > highestIndex ? { ...snapshot, settledThroughIndex: highestIndex } : snapshot;
  }
  return buildEmptyAgentModuleSnapshot_ACU();
}

/**
 * 把快照写入指定楼层并真实提交到宿主。
 * @param chat 聊天数组
 * @param targetIndex 承载快照的楼层下标，通常是被结算范围的最后一楼
 * @param snapshot 待写入的全量快照
 */
export async function writeAgentModuleSnapshot_ACU(chat: any[], targetIndex: number, snapshot: AgentModuleSnapshot_ACU): Promise<void> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照的目标楼层不可用', false, { targetIndex }));
  }
  const container = message as Record<string, unknown>;
  const hadPrevious = Object.prototype.hasOwnProperty.call(container, AGENT_MODULE_FIELD_ACU);
  const previous = container[AGENT_MODULE_FIELD_ACU];
  try {
    container[AGENT_MODULE_FIELD_ACU] = { ...snapshot, settledThroughIndex: targetIndex, updatedAt: Date.now() };
    await saveChatToHostStrict_ACU();
  } catch (error) {
    if (hadPrevious) container[AGENT_MODULE_FIELD_ACU] = previous;
    else delete container[AGENT_MODULE_FIELD_ACU];
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

function rejectSnapshotEdit_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', message, false, details));
}

/**
 * 用户手动改写资料快照。
 *
 * 与子代理写入的关键区别是「不容忍静默丢条目」：校验器为了容错会丢掉结构非法的单条记录，
 * 那对模型输出是合理的降级，但对用户编辑是数据丢失——用户会以为自己保存成功了。因此这里
 * 逐类比对条目数，只要有条目被丢弃就整份拒绝并指出是哪一类。
 * @param raw 用户编辑后的快照对象（可只带 hooks / infoGap / constraints）
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 落盘后的快照
 */
export async function replaceAgentModuleSnapshotByUser_ACU(raw: unknown, chat?: any[]): Promise<AgentModuleSnapshot_ACU> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const targetIndex = messages.length - 1;
  if (targetIndex < 0) rejectSnapshotEdit_ACU('当前聊天没有可承载资料快照的楼层');
  if (!isRecord_ACU(raw)) rejectSnapshotEdit_ACU('资料快照必须是 JSON 对象');
  const current = readAgentModuleSnapshot_ACU(messages);
  const merged = {
    ...current,
    ...raw,
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: targetIndex,
    // 手动编辑同样推进修订号：否则携带旧修订号的子代理写集会通过并覆盖用户刚保存的内容。
    revisions: {
      hooks: current.revisions.hooks + 1,
      infoGap: current.revisions.infoGap + 1,
      constraints: current.revisions.constraints + 1,
    },
  };
  const validated = validateAgentModuleSnapshot_ACU(merged);
  if (!validated) rejectSnapshotEdit_ACU('资料快照结构非法：hooks / infoGap / constraints 必须是数组');
  const checks: Array<[string, unknown, readonly unknown[]]> = [
    ['伏笔账本 hooks', merged.hooks, validated.hooks],
    ['信息差 infoGap', merged.infoGap, validated.infoGap],
    ['长期约束 constraints', merged.constraints, validated.constraints],
  ];
  for (const [label, input, accepted] of checks) {
    const inputLength = Array.isArray(input) ? input.length : 0;
    if (inputLength !== accepted.length) {
      rejectSnapshotEdit_ACU(`${label} 中有 ${inputLength - accepted.length} 条记录不符合结构要求（id 与关键文本字段不能为空），整份编辑未保存`, { label, inputLength, acceptedLength: accepted.length });
    }
  }
  await writeAgentModuleSnapshot_ACU(messages, targetIndex, validated);
  return validated;
}

/**
 * 从全部楼层清除资料快照字段。用于「一键清空」，只删扩展字段，绝不触碰正文。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否有楼层被改动
 */
export async function clearAgentModuleField_ACU(chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) continue;
    delete (message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU];
    changed = true;
  }
  if (changed) await saveChatToHostStrict_ACU();
  return changed;
}

function truncateAgentBlock_ACU(text: string): string {
  if (text.length <= AGENT_BLOCK_CHAR_LIMIT_ACU) return text;
  return `${text.slice(0, AGENT_BLOCK_CHAR_LIMIT_ACU)}\n（本资料块超出 ${AGENT_BLOCK_CHAR_LIMIT_ACU} 字上限，已截断；未展示部分不代表不存在）`;
}

function compareHooks_ACU(left: AgentHookEntry_ACU, right: AgentHookEntry_ACU): number {
  const weight = (IMPORTANCE_WEIGHTS_ACU[right.importance] ?? 0) - (IMPORTANCE_WEIGHTS_ACU[left.importance] ?? 0);
  return weight !== 0 ? weight : right.plantedIndex - left.plantedIndex;
}

/**
 * 渲染伏笔账本的热上下文。
 * @param snapshot 当前快照
 * @returns 自然语言文本；活跃条目超过上限时如实标注未展示数量
 */
export function renderAgentHooksLedger_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  // 修订号必须放在首行：材料超长被截断时也不会丢失并发校验依据。
  const head = `当前修订号=${snapshot.revisions.hooks}`;
  const active = snapshot.hooks.filter(hook => !hook.retired);
  if (!active.length) return `${head}\n当前没有活跃伏笔。`;
  const sorted = [...active].sort(compareHooks_ACU);
  const shown = sorted.slice(0, AGENT_HOT_HOOK_LIMIT_ACU);
  const lines = shown.map(hook => [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
  ].filter(Boolean).join('\n'));
  const hidden = sorted.length - shown.length;
  const tail = hidden > 0 ? `\n另有 ${hidden} 条活跃伏笔未进入本次热上下文，需要时请派工读取完整账本。` : '';
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}${tail}`);
}

/**
 * 渲染认知与信息差时间线。
 * @param snapshot 当前快照
 * @returns 自然语言文本，包含客观事实、读者已知、各角色知晓与揭示状态
 */
export function renderAgentInfoGap_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.infoGap}`;
  const active = snapshot.infoGap.filter(entry => !entry.retired);
  if (!active.length) return `${head}\n当前没有登记的信息差条目。`;
  const lines = active.map(entry => [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
  ].filter(Boolean).join('\n'));
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

/**
 * 渲染长期约束清单。
 * @param snapshot 当前快照
 * @returns 自然语言文本，每条包含约束内容与登记理由
 */
export function renderAgentConstraints_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.constraints}`;
  if (!snapshot.constraints.length) return `${head}\n当前没有登记的长期约束。`;
  const lines = snapshot.constraints.map(item => `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}`);
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

function renderHookFull_ACU(hook: AgentHookEntry_ACU): string {
  return [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}${hook.retired ? ' 已退休' : ''}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
    hook.retired && hook.retiredReason ? `  退休原因：${hook.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderInfoGapFull_ACU(entry: AgentInfoGapEntry_ACU): string {
  return [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}${entry.retired ? '，已退休' : ''}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
    entry.retired && entry.retiredReason ? `  退休原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderConstraintFull_ACU(item: AgentConstraintEntry_ACU): string {
  return `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}（登记楼层=${item.createdIndex}）`;
}

interface AgentModuleReadSpec_ACU<Entry extends { id: string }> {
  label: string;
  revision: number;
  entries: readonly Entry[];
  render: (entry: Entry) => string;
}

interface RetirableEntry_ACU {
  id: string;
  retired?: boolean;
}

function renderModuleEntries_ACU<Entry extends RetirableEntry_ACU>(spec: AgentModuleReadSpec_ACU<Entry>, ids?: readonly string[]): string {
  const head = `当前修订号=${spec.revision}`;
  if (!ids || !ids.length) {
    // 全量读默认只列活跃条目；退休条目可被搜索命中并按 ID 精读，避免全量视图被历史噪音撑大。
    const active = spec.entries.filter(entry => entry.retired !== true);
    const retiredCount = spec.entries.length - active.length;
    if (!active.length) return `${head}\n${spec.label}当前没有活跃条目。${retiredCount ? `另有 ${retiredCount} 条已退休条目，可用 search 命中后按 ID 精读。` : ''}`;
    const tail = retiredCount ? `\n另有 ${retiredCount} 条已退休条目未列出，可用 search 命中后按 ID 精读。` : '';
    return `${head}\n${spec.label}活跃条目 ${active.length} 条：\n${active.map(spec.render).join('\n')}${tail}`;
  }
  const wanted = ids.map(id => id.trim()).filter(Boolean);
  const found = spec.entries.filter(entry => wanted.includes(entry.id));
  const missing = wanted.filter(id => !spec.entries.some(entry => entry.id === id));
  const lines: string[] = [head];
  if (found.length) lines.push(...found.map(spec.render));
  if (missing.length) lines.push(`以下 ID 不存在于${spec.label}：${missing.join('、')}。可先读全量或 search 确认可用 ID。`);
  if (!found.length && !missing.length) lines.push('未指定有效 ID。');
  return lines.join('\n');
}

/**
 * 按 ID 精读伏笔账本（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$HOOKS_LEDGER` / `$HOOKS_LEDGER:ID1,ID2`。
 */
export function renderAgentHooksByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '伏笔账本', revision: snapshot.revisions.hooks, entries: snapshot.hooks, render: renderHookFull_ACU }, ids);
}

/**
 * 按 ID 精读信息差时间线（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$INFO_GAP` / `$INFO_GAP:ID1,ID2`。
 */
export function renderAgentInfoGapByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '信息差时间线', revision: snapshot.revisions.infoGap, entries: snapshot.infoGap, render: renderInfoGapFull_ACU }, ids);
}

/**
 * 按 ID 精读长期约束；不传 ID 则输出全量，支撑 `$CONSTRAINTS` / `$CONSTRAINTS:ID1,ID2`。
 */
export function renderAgentConstraintsByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '长期约束清单', revision: snapshot.revisions.constraints, entries: snapshot.constraints, render: renderConstraintFull_ACU }, ids);
}

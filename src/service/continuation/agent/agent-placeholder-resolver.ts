/**
 * service/continuation/agent/agent-placeholder-resolver.ts — 读写集占位符解析
 *
 * 读集 token 只是资料接口标识符，不是提示词 token：解析结果统一汇成一块材料文本，
 * 通过单个 `$AGENT_READ_MATERIALS` 注入子代理提示词。这样动态表名（$TABLE:xxx）
 * 不需要扩展提示词渲染器的固定 token 表。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import { AGENT_STORY_WINDOW_DEFAULT_ACU, isAgentWritableModule_ACU, type AgentModuleSnapshot_ACU, type AgentWritableModule_ACU } from './agent-model';
import { renderAgentConstraints_ACU, renderAgentHooksLedger_ACU, renderAgentInfoGap_ACU } from './agent-module-store';
import { renderAgentTableByAliases_ACU, renderAgentTableByName_ACU } from './agent-tables';

export const AGENT_TABLE_TOKEN_PREFIX_ACU = '$TABLE:';

/** 每条虚拟/模块/表占位符对应的人类可读标题，进入材料块的分节标题。 */
const READ_TOKEN_TITLES_ACU: Record<string, string> = {
  $STORY_TEXT: '已经发生的小说正文（只含 AI 楼层）',
  $HISTORY_UNSETTLED: '尚未结算的真实历史',
  $HISTORY_RECENT: '最近已被采用的真实剧情',
  $OUTLINE_WINDOW: '当前大纲窗口',
  $CURRENT_TURN_GOAL: '本轮目标',
  $USER_INTENT: '用户的初始要求',
  $HOOKS_LEDGER: '伏笔账本',
  $INFO_GAP: '认知与信息差时间线',
  $ACTIVE_CONSTRAINTS: '长期约束',
  $TABLE_GLOBAL: '全局数据表',
  $TABLE_CHARACTERS: '角色表',
  $TABLE_CHRONICLES: '纪要表',
};

export interface AgentResolveContext_ACU {
  chat: any[];
  moduleSnapshot: AgentModuleSnapshot_ACU;
  settledThroughIndex: number;
  execution: ContinuationAgentExecutionContext_ACU;
  originInstruction: string;
  recentTurnCount: number;
  /** 已结算正文最多注入多少楼；缺省用 AGENT_STORY_WINDOW_DEFAULT_ACU。0 表示已结算段完全不注入。 */
  storyWindowFloors?: number;
  tableData?: unknown;
}

function messageRole_ACU(message: any): string {
  return message && message.is_user ? '用户' : 'AI';
}

function messageText_ACU(message: any): string {
  return String(message?.mes ?? '').trim();
}

/**
 * 渲染已经发生的小说正文。
 *
 * 只取 AI 楼层——用户楼是操作指令而不是小说内容，把它当正文注入会让模型把指令误读成剧情。
 * 分「已结算」「尚未结算」两段：已结算段按窗口取最近若干楼（更早部分已经沉淀进资料模块与纪要），
 * 未结算段全量注入（它还没被任何资料模块吸收，是本轮必须亲自读的部分）。
 * @param context 解析上下文
 * @returns 分段的逐楼正文；没有 AI 楼层时如实说明
 */
export function renderAgentStoryText_ACU(context: AgentResolveContext_ACU): string {
  const chat = Array.isArray(context.chat) ? context.chat : [];
  const highestIndex = chat.length - 1;
  if (highestIndex < 0) return '当前聊天还没有任何楼层，也就没有已经发生的正文。';
  // 删楼后残留的水位可能指向已不存在的楼层，必须钳制，否则未结算段起点会越过末楼输出空段。
  const settledThrough = Math.min(context.settledThroughIndex, highestIndex);
  const floors = chat
    .map((message, index) => ({ index, text: messageText_ACU(message) }))
    .filter(item => chat[item.index] && !chat[item.index].is_user && item.text);
  if (!floors.length) return '当前聊天还没有 AI 产出的正文楼层。';

  const window = Math.max(0, context.storyWindowFloors ?? AGENT_STORY_WINDOW_DEFAULT_ACU);
  const settled = floors.filter(item => item.index <= settledThrough);
  const unsettled = floors.filter(item => item.index > settledThrough);
  const shownSettled = window > 0 ? settled.slice(-window) : [];
  const hiddenSettled = settled.length - shownSettled.length;
  const render = (items: Array<{ index: number; text: string }>) => items.map(item => `【楼层 ${item.index}】\n${item.text}`).join('\n\n');

  const sections: string[] = [];
  const settledHead = hiddenSettled > 0
    ? `## 已结算正文（只列最近 ${shownSettled.length} 楼；更早的 ${hiddenSettled} 楼未注入，其事实已沉淀进资料模块与纪要，需要时派工读取）`
    : '## 已结算正文';
  if (shownSettled.length) sections.push(`${settledHead}\n${render(shownSettled)}`);
  else if (settled.length) sections.push(`${settledHead}\n（本次未注入任何已结算正文。）`);
  sections.push(unsettled.length
    ? `## 尚未结算的最新正文（全量）\n${render(unsettled)}`
    : '## 尚未结算的最新正文\n没有尚未结算的正文楼层；上一轮已结算到当前最后一楼。');
  return sections.join('\n\n');
}

/**
 * 渲染尚未结算的真实历史。
 * @param context 解析上下文
 * @returns 逐楼文本；无未结算楼层时如实标注
 */
export function renderAgentUnsettledHistory_ACU(context: AgentResolveContext_ACU): string {
  const start = context.settledThroughIndex + 1;
  const lines: string[] = [];
  for (let index = start; index < context.chat.length; index += 1) {
    const text = messageText_ACU(context.chat[index]);
    if (text) lines.push(`【楼层 ${index}｜${messageRole_ACU(context.chat[index])}】\n${text}`);
  }
  return lines.length ? lines.join('\n\n') : '没有尚未结算的真实历史；上一轮已结算到当前最后一楼。';
}

/**
 * 渲染最近已被采用的真实剧情。
 * @param context 解析上下文
 * @returns 最近若干轮 AI 楼层正文
 */
export function renderAgentRecentHistory_ACU(context: AgentResolveContext_ACU): string {
  const aiFloors = context.chat
    .map((message, index) => ({ message, index }))
    .filter(item => item.message && !item.message.is_user && messageText_ACU(item.message));
  const recent = aiFloors.slice(-Math.max(1, context.recentTurnCount));
  if (!recent.length) return '当前聊天还没有可用的历史正文。';
  return recent.map(item => `【楼层 ${item.index}】\n${messageText_ACU(item.message)}`).join('\n\n');
}

/**
 * 渲染当前大纲窗口：本阶段目标、当前节点与本节点全部轮次目标。
 * 大纲缺失或当前阶段已完成时如实说明状态，并指出必须先派工大纲子代理。
 * @param context 解析上下文
 * @returns 自然语言文本
 */
export function renderAgentOutlineWindow_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) {
    return '当前任务还没有阶段大纲。必须先派工 outline-architect 创建首个阶段大纲，才能规划本轮；在大纲创建前 finalize 会被拒绝。';
  }
  if (execution.stage.status === 'completed') {
    return `第 ${execution.stage.stageNumber} 阶段已全部完成（共 ${execution.stage.completedTurns} 轮）。下一阶段大纲尚未创建，需要派工 outline-architect 继续大纲；在此之前 finalize 会被拒绝。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待用户确认或游标无效）。本轮无法交付写作指导。`;
  }
  const turns = execution.node.turns
    .map((turn, index) => `${index + 1}. ${turn.goal}${turn.id === execution.turn!.id ? '  ← 本轮' : ''}`)
    .join('\n');
  return [
    `阶段 ${execution.stage.stageNumber}：${execution.revision.outline.title}`,
    `阶段目标：${execution.revision.outline.goal}`,
    `当前节点：${execution.node.title}`,
    `节点目标：${execution.node.goal}`,
    `阶段内轮次进度：第 ${execution.turnNumber} / ${execution.revision.outline.totalTurns} 轮`,
    '本节点逐轮目标：',
    turns,
    '注意：大纲是计划，不是已经发生的事实。',
  ].join('\n');
}

/**
 * 解析一个读集 token 的内容。
 * @param token 读集标识符，支持虚拟/模块/保底表/`$TABLE:<表名>` 四类
 * @param context 解析上下文
 * @returns { title, text } 分节标题与正文；未知 token 的 text 会明确说明不可读
 */
export function resolveAgentReadToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const normalized = String(token ?? '').trim();
  if (normalized.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU)) {
    const name = normalized.slice(AGENT_TABLE_TOKEN_PREFIX_ACU.length).trim();
    return { title: `表格「${name}」`, text: renderAgentTableByName_ACU(name, context.tableData) };
  }
  const title = READ_TOKEN_TITLES_ACU[normalized] ?? normalized;
  switch (normalized) {
    case '$STORY_TEXT': return { title, text: renderAgentStoryText_ACU(context) };
    case '$HISTORY_UNSETTLED': return { title, text: renderAgentUnsettledHistory_ACU(context) };
    case '$HISTORY_RECENT': return { title, text: renderAgentRecentHistory_ACU(context) };
    case '$OUTLINE_WINDOW': return { title, text: renderAgentOutlineWindow_ACU(context) };
    case '$CURRENT_TURN_GOAL': return { title, text: context.execution.turn?.goal || '（尚无可执行的大纲轮次，本轮目标待大纲创建或继续后确定）' };
    case '$USER_INTENT': return { title, text: context.originInstruction || '（用户未提供初始要求）' };
    case '$HOOKS_LEDGER': return { title, text: renderAgentHooksLedger_ACU(context.moduleSnapshot) };
    case '$INFO_GAP': return { title, text: renderAgentInfoGap_ACU(context.moduleSnapshot) };
    case '$ACTIVE_CONSTRAINTS': return { title, text: renderAgentConstraints_ACU(context.moduleSnapshot) };
    case '$TABLE_GLOBAL': return { title, text: renderAgentTableByAliases_ACU('global', context.tableData) };
    case '$TABLE_CHARACTERS': return { title, text: renderAgentTableByAliases_ACU('characters', context.tableData) };
    case '$TABLE_CHRONICLES': return { title, text: renderAgentTableByAliases_ACU('chronicles', context.tableData) };
    default: return { title, text: `占位符 ${normalized || '(空)'} 不是可读资料接口，本次没有为你提供任何内容。` };
  }
}

/**
 * 把一批读集 token 渲染成一整块注入材料。
 * @param tokens 读集标识符列表
 * @param context 解析上下文
 * @returns 分节材料文本；读集为空时如实标注
 */
export function renderAgentReadMaterials_ACU(tokens: readonly string[], context: AgentResolveContext_ACU): string {
  const unique = [...new Set(tokens.map(token => String(token ?? '').trim()).filter(Boolean))];
  if (!unique.length) return '本次没有为你注入任何资料。你只能基于任务描述作答，缺少的信息必须标注「信息不足」。';
  return unique
    .map(token => { const resolved = resolveAgentReadToken_ACU(token, context); return `### ${resolved.title}（${token}）\n${resolved.text}`; })
    .join('\n\n');
}

/**
 * 校验并映射写集 token。
 * @param tokens 写集标识符列表，形如 $HOOKS_LEDGER
 * @param allowedWrites 该子代理被授权的模块名
 * @returns 模块名列表
 */
export function resolveAgentWriteTokens_ACU(tokens: readonly string[], allowedWrites: readonly AgentWritableModule_ACU[]): AgentWritableModule_ACU[] {
  const mapping: Record<string, AgentWritableModule_ACU> = { $HOOKS_LEDGER: 'hooks', $INFO_GAP: 'infoGap', $ACTIVE_CONSTRAINTS: 'constraints' };
  const result: AgentWritableModule_ACU[] = [];
  for (const raw of tokens) {
    const token = String(raw ?? '').trim();
    if (!token) continue;
    const module = mapping[token] ?? (isAgentWritableModule_ACU(token) ? token : null);
    if (!module) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', `写集里的 ${token} 不是可写资料模块`, false, { token }));
    }
    if (!allowedWrites.includes(module)) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', `该子代理无权写入 ${token}`, false, { token, allowedWrites: [...allowedWrites] }));
    }
    if (!result.includes(module)) result.push(module);
  }
  return result;
}

/**
 * service/continuation/agent/agent-placeholder-resolver.ts — 读写集占位符解析
 *
 * 读集 token 只是资料接口标识符，不是提示词 token：解析结果统一汇成一块材料文本，
 * 通过单个 `$AGENT_READ_MATERIALS` 注入子代理提示词。这样动态表名（$TABLE:xxx）
 * 不需要扩展提示词渲染器的固定 token 表。
 */

import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import {
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
  type AgentModuleSnapshot_ACU,
} from './agent-model';
import {
  renderAgentConstraintsByIds_ACU,
  renderAgentHooksByIds_ACU,
  renderAgentInfoGapByIds_ACU,
} from './agent-module-store';
import { renderAgentTableByAliases_ACU, renderAgentTableByName_ACU, type AgentTableRowRange_ACU } from './agent-tables';
import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentChronicleRange_ACU,
  renderAgentWorldbookEntries_ACU,
  type AgentWorldbookSnapshot_ACU,
} from './agent-worldbook-read';

export const AGENT_TABLE_TOKEN_PREFIX_ACU = '$TABLE:';
export const AGENT_STORY_RANGE_TOKEN_PREFIX_ACU = '$STORY_RANGE:';
export const AGENT_WORLDBOOK_TOKEN_PREFIX_ACU = '$WORLDBOOK:';
export const AGENT_CHRONICLES_TOKEN_PREFIX_ACU = '$CHRONICLES:';

/** 每条虚拟/模块/表占位符对应的人类可读标题，进入材料块的分节标题。 */
const READ_TOKEN_TITLES_ACU: Record<string, string> = {
  $STORY_TEXT: '已经发生的小说正文（只含 AI 楼层）',
  $STORY_CATALOG: '正文楼层目录',
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
  /**
   * Agent 可读/可搜正文窗口：只有最近这么多 AI 楼层可以 read/search，
   * 更早的正文只能经纪要（$CHRONICLES）回溯。缺省用 AGENT_STORY_WINDOW_DEFAULT_ACU。
   */
  storyWindowFloors?: number;
  /** 正文目录尾部注入全文的楼数；缺省用 AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU。 */
  storyTailFloors?: number;
  tableData?: unknown;
  /** 运行起点预取的世界书快照；缺省为不可用空快照（如测试环境）。 */
  worldbook?: AgentWorldbookSnapshot_ACU;
}

function messageRole_ACU(message: any): string {
  return message && message.is_user ? '用户' : 'AI';
}

function messageText_ACU(message: any): string {
  return String(message?.mes ?? '').trim();
}

interface AgentStoryFloor_ACU {
  index: number;
  text: string;
}

function listAgentStoryFloors_ACU(context: AgentResolveContext_ACU): AgentStoryFloor_ACU[] {
  const chat = Array.isArray(context.chat) ? context.chat : [];
  return chat
    .map((message, index) => ({ index, text: messageText_ACU(message) }))
    .filter(item => chat[item.index] && !chat[item.index].is_user && item.text);
}

function agentStoryWindowSize_ACU(context: AgentResolveContext_ACU): number {
  return Math.max(0, context.storyWindowFloors ?? AGENT_STORY_WINDOW_DEFAULT_ACU);
}

/** Agent 可读/可搜的正文窗口：最近 storyWindowFloors 个 AI 楼层。同时供搜索工具划定 story 域。 */
export function listAgentStoryWindowFloors_ACU(context: AgentResolveContext_ACU): AgentStoryFloor_ACU[] {
  const window = agentStoryWindowSize_ACU(context);
  return window > 0 ? listAgentStoryFloors_ACU(context).slice(-window) : [];
}

function renderStoryFloors_ACU(floors: readonly AgentStoryFloor_ACU[]): string {
  return floors.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n');
}

function storyOpening_ACU(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 40)}…`;
}

/**
 * 渲染正文楼层目录：窗口内每楼一行（楼层号 + 约字数 + 开头摘要 + 读取地址），
 * 尾部若干楼直接给全文。窗口之前的剧情已压缩为纪要，指引走纪要目录。
 * @param context 解析上下文
 * @returns 目录文本，进入主 Agent 骨架的 $STORY_CATALOG
 */
export function renderAgentStoryCatalog_ACU(context: AgentResolveContext_ACU): string {
  const allFloors = listAgentStoryFloors_ACU(context);
  if (!allFloors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const windowFloors = listAgentStoryWindowFloors_ACU(context);
  if (!windowFloors.length) return '正文可读窗口设置为 0 楼：所有正文都只能经纪要目录（$CHRONICLES）回溯。';
  const tailCount = Math.max(0, context.storyTailFloors ?? AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU);
  const tailFloors = tailCount > 0 ? windowFloors.slice(-tailCount) : [];
  const catalogFloors = windowFloors.slice(0, windowFloors.length - tailFloors.length);
  const hiddenCount = allFloors.length - windowFloors.length;

  const sections: string[] = [];
  const headNote = hiddenCount > 0
    ? `更早的 ${hiddenCount} 个 AI 楼层不在可读窗口内，其剧情已压缩为纪要，请经世界书目录的纪要概要段（$CHRONICLES 地址）回溯。`
    : '当前全部 AI 楼层都在可读窗口内。';
  if (catalogFloors.length) {
    const lines = catalogFloors.map(floor =>
      `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜开头：${storyOpening_ACU(floor.text)}｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`);
    sections.push(`${headNote}\n可读窗口内的楼层目录（区间读取写 $STORY_RANGE:起始楼-结束楼）：\n${lines.join('\n')}`);
  } else {
    sections.push(headNote);
  }
  sections.push(tailFloors.length
    ? `最近 ${tailFloors.length} 楼全文：\n${renderStoryFloors_ACU(tailFloors)}`
    : '（未注入任何楼层全文，需要正文时用 $STORY_RANGE 读取。）');
  return sections.join('\n\n');
}

/**
 * 按楼层区间读取窗口内的 AI 正文全文，支撑 `$STORY_RANGE:a-b`。
 * @param context 解析上下文
 * @param startRaw 起始楼层号
 * @param endRaw 结束楼层号
 * @returns 区间内逐楼全文；区间非法/落在窗口外时回灌可修正的错误文本
 */
export function renderAgentStoryRange_ACU(context: AgentResolveContext_ACU, startRaw: string, endRaw: string): string {
  const start = Number.parseInt(startRaw, 10);
  const end = Number.parseInt(endRaw, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return `楼层区间「${startRaw}-${endRaw}」不合法：写法为 $STORY_RANGE:起始楼-结束楼（两端都是楼层号，起始不大于结束）。可用楼层见正文目录。`;
  }
  const windowFloors = listAgentStoryWindowFloors_ACU(context);
  if (!windowFloors.length) return '正文可读窗口当前为空，无法读取正文；早期剧情请经纪要目录（$CHRONICLES 地址）回溯。';
  const hit = windowFloors.filter(floor => floor.index >= start && floor.index <= end);
  if (!hit.length) {
    const first = windowFloors[0].index;
    const last = windowFloors[windowFloors.length - 1].index;
    return `区间 ${start}-${end} 内没有可读的 AI 楼层。可读窗口目前覆盖楼层 ${first}-${last}（只含 AI 楼）；更早的剧情已压缩为纪要，请改用世界书目录里的 $CHRONICLES 地址回溯。`;
  }
  return renderStoryFloors_ACU(hit);
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
  // 轮次/节点都带 [ID] 前缀：edit_outline 协议按 nodeId/turnId 定位，模型必须能从渲染里拿到编辑目标。
  const turns = execution.node.turns
    .map((turn, index) => `${index + 1}. [${turn.id}] ${turn.goal}${turn.id === execution.turn!.id ? '  ← 本轮' : ''}`)
    .join('\n');
  return [
    `阶段 ${execution.stage.stageNumber}：${execution.revision.outline.title}`,
    `阶段目标：${execution.revision.outline.goal}`,
    `当前节点：[${execution.node.id}] ${execution.node.title}`,
    `节点目标：${execution.node.goal}`,
    `阶段内轮次进度：第 ${execution.turnNumber} / ${execution.revision.outline.totalTurns} 轮`,
    '本节点逐轮目标：',
    turns,
    '注意：大纲是计划，不是已经发生的事实。',
  ].join('\n');
}

/**
 * 渲染大纲游标的一行状态，进入主 Agent 骨架的 $OUTLINE_STATE。
 * 完整大纲窗口靠 read $OUTLINE_WINDOW 调阅，骨架只保留「现在在哪」。
 * @param context 解析上下文
 * @returns 一行状态文本
 */
export function renderAgentOutlineState_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) return '大纲状态：尚无阶段大纲（须先派工 outline-architect 创建，之后才能 finalize）。';
  if (execution.stage.status === 'completed') {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段已全部完成，下一阶段大纲未创建（须派工 outline-architect 继续）。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待确认或游标无效）。`;
  }
  return `大纲状态：第 ${execution.stage.stageNumber} 阶段「${execution.revision.outline.title}」，第 ${execution.turnNumber}/${execution.revision.outline.totalTurns} 轮，当前节点 [${execution.node.id}]，本轮轮次 [${execution.turn.id}]。完整大纲窗口用 read $OUTLINE_WINDOW 调阅。`;
}

const ROW_RANGE_PATTERN_ACU = /^(\d+)-(\d+)$/;

function parseRowRange_ACU(raw: string): AgentTableRowRange_ACU | null {
  const matched = ROW_RANGE_PATTERN_ACU.exec(raw.trim());
  if (!matched) return null;
  return { start: Number.parseInt(matched[1], 10), end: Number.parseInt(matched[2], 10) };
}

function splitIdSuffix_ACU(token: string, prefix: string): string[] | null {
  if (token === prefix) return [];
  if (!token.startsWith(`${prefix}:`)) return null;
  return token.slice(prefix.length + 1).split(/[,，]/).map(id => id.trim()).filter(Boolean);
}

function resolveTableToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const body = token.slice(AGENT_TABLE_TOKEN_PREFIX_ACU.length).trim();
  // 末段若形如 a-b 视为行区间，其余部分是表名——表名本身可能含冒号之外的任意字符。
  const lastColon = body.lastIndexOf(':');
  const rangeCandidate = lastColon >= 0 ? parseRowRange_ACU(body.slice(lastColon + 1)) : null;
  const name = rangeCandidate ? body.slice(0, lastColon).trim() : body;
  const title = rangeCandidate ? `表格「${name}」第 ${rangeCandidate.start}-${rangeCandidate.end} 行` : `表格「${name}」`;
  return { title, text: renderAgentTableByName_ACU(name, context.tableData, rangeCandidate ?? undefined) };
}

function resolveWorldbookToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const body = token.slice(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU.length);
  const lastColon = body.lastIndexOf(':');
  if (lastColon <= 0) {
    return { title: '世界书条目', text: '世界书读取地址不完整：写法为 $WORLDBOOK:书名:uid（逗号分隔多个 uid），地址请从世界书目录复制。' };
  }
  const bookName = body.slice(0, lastColon).trim();
  const uids = body.slice(lastColon + 1).split(/[,，]/).map(uid => uid.trim()).filter(Boolean);
  return { title: `世界书「${bookName}」条目 ${uids.join('、')}`, text: renderAgentWorldbookEntries_ACU(worldbook, bookName, uids) };
}

function resolveChroniclesToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const body = token.slice(AGENT_CHRONICLES_TOKEN_PREFIX_ACU.length).trim();
  const matched = /^(AM\d+)-(AM\d+)$/i.exec(body);
  if (!matched) {
    return { title: '纪要', text: `纪要地址「${token}」不合法：写法为 $CHRONICLES:AM起始码-AM结束码（如 $CHRONICLES:AM12-AM18），地址请从纪要目录复制。` };
  }
  return { title: `纪要 ${matched[1].toUpperCase()}-${matched[2].toUpperCase()}`, text: renderAgentChronicleRange_ACU(worldbook, matched[1], matched[2]) };
}

/**
 * 解析一个读集 token 的内容。
 *
 * 支持的地址体系（与各资料目录里给出的读取地址一一对应）：
 * - `$STORY_RANGE:a-b` 窗口内正文楼层区间；`$STORY_CATALOG` 楼层目录
 * - `$TABLE:表名` / `$TABLE:表名:a-b` 整表或行区间
 * - `$HOOKS_LEDGER[:ID,ID]` / `$INFO_GAP[:ID,ID]` / `$ACTIVE_CONSTRAINTS[:ID,ID]` 模块全量或按 ID 精读
 * - `$WORLDBOOK:书名:uid[,uid]` 已启用世界书条目全文；`$CHRONICLES:AMa-AMb` 纪要区间
 * - 旧固定 token（$STORY_TEXT / $OUTLINE_WINDOW 等）保留兼容
 * @param token 读集标识符
 * @param context 解析上下文
 * @returns { title, text } 分节标题与正文；未知 token 的 text 会明确说明不可读
 */
export function resolveAgentReadToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const normalized = String(token ?? '').trim();
  if (normalized.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU)) return resolveTableToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU)) return resolveWorldbookToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_CHRONICLES_TOKEN_PREFIX_ACU)) return resolveChroniclesToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU)) {
    const body = normalized.slice(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU.length).trim();
    const matched = /^(\d+)-(\d+)$/.exec(body);
    return {
      title: matched ? `正文楼层 ${matched[1]}-${matched[2]}` : '正文楼层区间',
      text: matched
        ? renderAgentStoryRange_ACU(context, matched[1], matched[2])
        : `楼层区间「${normalized}」不合法：写法为 $STORY_RANGE:起始楼-结束楼。可用楼层见正文目录。`,
    };
  }

  const hookIds = splitIdSuffix_ACU(normalized, '$HOOKS_LEDGER');
  if (hookIds !== null) {
    return { title: hookIds.length ? `伏笔账本条目 ${hookIds.join('、')}` : '伏笔账本（全部活跃条目）', text: renderAgentHooksByIds_ACU(context.moduleSnapshot, hookIds.length ? hookIds : undefined) };
  }
  const infoGapIds = splitIdSuffix_ACU(normalized, '$INFO_GAP');
  if (infoGapIds !== null) {
    return { title: infoGapIds.length ? `信息差条目 ${infoGapIds.join('、')}` : '认知与信息差时间线（全部活跃条目）', text: renderAgentInfoGapByIds_ACU(context.moduleSnapshot, infoGapIds.length ? infoGapIds : undefined) };
  }
  const constraintIds = splitIdSuffix_ACU(normalized, '$ACTIVE_CONSTRAINTS');
  if (constraintIds !== null) {
    return { title: constraintIds.length ? `长期约束条目 ${constraintIds.join('、')}` : '长期约束（全部条目）', text: renderAgentConstraintsByIds_ACU(context.moduleSnapshot, constraintIds.length ? constraintIds : undefined) };
  }

  const title = READ_TOKEN_TITLES_ACU[normalized] ?? normalized;
  switch (normalized) {
    case '$STORY_TEXT': return { title, text: renderAgentStoryText_ACU(context) };
    case '$STORY_CATALOG': return { title, text: renderAgentStoryCatalog_ACU(context) };
    case '$HISTORY_UNSETTLED': return { title, text: renderAgentUnsettledHistory_ACU(context) };
    case '$HISTORY_RECENT': return { title, text: renderAgentRecentHistory_ACU(context) };
    case '$OUTLINE_WINDOW': return { title, text: renderAgentOutlineWindow_ACU(context) };
    case '$CURRENT_TURN_GOAL': return { title, text: context.execution.turn?.goal || '（尚无可执行的大纲轮次，本轮目标待大纲创建或继续后确定）' };
    case '$USER_INTENT': return { title, text: context.originInstruction || '（用户未提供初始要求）' };
    case '$TABLE_GLOBAL': return { title, text: renderAgentTableByAliases_ACU('global', context.tableData) };
    case '$TABLE_CHARACTERS': return { title, text: renderAgentTableByAliases_ACU('characters', context.tableData) };
    case '$TABLE_CHRONICLES': return { title, text: renderAgentTableByAliases_ACU('chronicles', context.tableData) };
    default: return { title, text: `占位符 ${normalized || '(空)'} 不是可读资料接口，本次没有为你提供任何内容。请从各资料目录里复制读取地址。` };
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

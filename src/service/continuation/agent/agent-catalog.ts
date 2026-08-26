/**
 * service/continuation/agent/agent-catalog.ts — 子代理能力目录与资料模块目录
 *
 * 主 Agent 只看到摘要：代理能做什么、何时该用、能读什么、能写什么、有什么上限。
 * 子代理的完整系统提示词不暴露给主 Agent，避免主 Agent 被无关细节淹没。
 */

import type { AgentSubagentKind_ACU, AgentSubagentName_ACU, AgentWritableModule_ACU } from './agent-model';

export interface AgentSubagentDefinition_ACU {
  name: AgentSubagentName_ACU;
  kind: AgentSubagentKind_ACU;
  description: string;
  triggers: string[];
  allowedReads: string[];
  allowedWrites: AgentWritableModule_ACU[];
  promptKey: 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer';
}

export interface AgentModuleDefinition_ACU {
  token: string;
  description: string;
  triggers: string[];
  writableBy: AgentSubagentName_ACU[];
}

export const AGENT_SUBAGENT_DEFINITIONS_ACU: readonly AgentSubagentDefinition_ACU[] = [
  {
    name: 'hook-cognition-maintainer',
    kind: 'maintain',
    description: '结算已经发生的正文：维护伏笔账本与认知信息差时间线，只登记真实历史里已实际发生的变化',
    triggers: ['存在尚未结算的真实历史', '新正文出现异常线索、秘密、反常细节', '已有伏笔被再次触碰', '某个角色的知晓状态发生变化'],
    // 角色表是「谁此刻知道什么」的直接依据，信息差结算离不开它，因此纳入可读范围。
    allowedReads: ['$HISTORY_UNSETTLED', '$HOOKS_LEDGER', '$INFO_GAP', '$TABLE_CHRONICLES', '$TABLE_CHARACTERS', '$OUTLINE_WINDOW'],
    allowedWrites: ['hooks', 'infoGap'],
    promptKey: 'maintainer',
  },
  {
    name: 'mainline-planner',
    kind: 'plan',
    description: '策划本轮主线推进：给出冲突阶梯、主角代理权与实质价值变动的自然语言建议，不写正文、不改资料',
    triggers: ['每轮都需要主线推进建议', '轮次目标涉及主线冲突升级或价值转移'],
    allowedReads: ['$OUTLINE_WINDOW', '$CURRENT_TURN_GOAL', '$TABLE_GLOBAL', '$TABLE_CHARACTERS', '$HOOKS_LEDGER', '$HISTORY_RECENT'],
    allowedWrites: [],
    promptKey: 'mainlinePlanner',
  },
  {
    name: 'beat-planner',
    kind: 'plan',
    description: '策划本轮伏笔操作与情绪节拍：给出埋设、强化、误导、回收的具体手法与情绪微弧建议，不写正文、不改资料',
    triggers: ['本轮计划操作伏笔', '本轮需要信息差的设用揭新循环', '情绪节拍需要承接上轮残留'],
    allowedReads: ['$OUTLINE_WINDOW', '$HOOKS_LEDGER', '$INFO_GAP', '$TABLE_CHRONICLES', '$HISTORY_RECENT'],
    allowedWrites: [],
    promptKey: 'beatPlanner',
  },
  {
    name: 'continuity-reviewer',
    kind: 'review',
    description: '审查策划结果的连续性与约束合规：输出 pass / revise / block 判词，只读不写',
    triggers: ['策划结果之间存在冲突', '本轮触碰长期约束红线', '大阶段转折或伏笔密集轮次'],
    allowedReads: ['$ACTIVE_CONSTRAINTS', '$TABLE_GLOBAL', '$TABLE_CHARACTERS', '$INFO_GAP', '$HOOKS_LEDGER', '$HISTORY_RECENT'],
    allowedWrites: [],
    promptKey: 'reviewer',
  },
];

export const AGENT_MODULE_DEFINITIONS_ACU: readonly AgentModuleDefinition_ACU[] = [
  {
    token: '$HOOKS_LEDGER',
    description: '伏笔账本：已进入真实正文的伏笔及其生命周期状态（埋设/强化/误导/部分回收/回收/放弃）、埋设楼层与重要度',
    triggers: ['正文触碰异常线索', '本轮计划强化、误导或回收伏笔', '判断某条悬念是否已经欠账太久'],
    writableBy: ['hook-cognition-maintainer'],
  },
  {
    token: '$INFO_GAP',
    description: '认知与信息差时间线：客观事实、读者已知、各角色知晓状态与揭示进度',
    triggers: ['设计局部信息揭露', '判断某个角色此刻是否该知道某件事', '避免提前揭穿幕后'],
    writableBy: ['hook-cognition-maintainer'],
  },
  {
    token: '$ACTIVE_CONSTRAINTS',
    description: '长期约束：契约红线、禁止提前释放的底牌、已知连贯性风险。子代理只能提议，由主 Agent 裁决后登记',
    triggers: ['本轮动作可能越过既定红线', '需要确认哪些底牌本轮不能翻'],
    writableBy: [],
  },
];

/**
 * 渲染子代理能力目录。
 * @returns 主 Agent 可见的摘要文本，不含子代理内部提示词
 */
export function renderAgentSubagentCatalog_ACU(): string {
  const blocks = AGENT_SUBAGENT_DEFINITIONS_ACU.map(definition => [
    `- name: ${definition.name}`,
    `  类型: ${definition.kind === 'maintain' ? '结算维护' : definition.kind === 'plan' ? '策划' : '审查'}`,
    `  职责: ${definition.description}`,
    `  适用时机: ${definition.triggers.join('；')}`,
    `  可读: ${definition.allowedReads.join('、')}`,
    `  可写: ${definition.allowedWrites.length ? definition.allowedWrites.join('、') : '无（只返回建议）'}`,
  ].join('\n'));
  return blocks.join('\n');
}

/**
 * 渲染资料模块目录。
 * @returns 主 Agent 可见的模块摘要文本，只说模块是什么、何时用、谁能写
 */
export function renderAgentModuleCatalog_ACU(): string {
  const blocks = AGENT_MODULE_DEFINITIONS_ACU.map(definition => [
    `- 占位符: ${definition.token}`,
    `  内容: ${definition.description}`,
    `  适用时机: ${definition.triggers.join('；')}`,
    `  可写代理: ${definition.writableBy.length ? definition.writableBy.join('、') : '仅主 Agent 裁决后登记'}`,
  ].join('\n'));
  return blocks.join('\n');
}

/**
 * 按名称查子代理定义。
 * @param name 代理名
 * @returns 命中的定义；未知代理返回 null
 */
export function findAgentSubagentDefinition_ACU(name: string): AgentSubagentDefinition_ACU | null {
  return AGENT_SUBAGENT_DEFINITIONS_ACU.find(definition => definition.name === name) ?? null;
}

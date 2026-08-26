/**
 * service/continuation/agent/agent-tables.ts — 表格系统的只读投影
 *
 * 表名由用户模板决定，不能硬编码物理标识。三张保底表按别名列表匹配，
 * 别名取值与工程既有惯例一致（如纪要表在多处按 name === '纪要表' 取表）。
 * 命中零张或多张都如实标注，绝不猜测目标表。
 */

import { currentJsonTableData_ACU } from '../../runtime/state-manager';

export const AGENT_TABLE_ALIASES_ACU = {
  global: ['全局数据表', '全局表', '总体大纲'],
  characters: ['角色表', '重要人物表', '人物表'],
  chronicles: ['纪要表', '总结表'],
} as const;

export type AgentGuaranteedTable_ACU = keyof typeof AGENT_TABLE_ALIASES_ACU;

const TABLE_LABELS_ACU: Record<AgentGuaranteedTable_ACU, string> = {
  global: '全局数据表',
  characters: '角色表',
  chronicles: '纪要表',
};

interface AgentSheetView_ACU {
  name: string;
  header: string[];
  rows: string[][];
}

function readTableData_ACU(tableData?: unknown): Record<string, any> {
  const source = tableData ?? currentJsonTableData_ACU;
  return source && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, any> : {};
}

function toSheetView_ACU(sheet: any): AgentSheetView_ACU | null {
  if (!sheet || typeof sheet !== 'object') return null;
  const name = String(sheet.name ?? '').trim();
  const content = Array.isArray(sheet.content) ? sheet.content : [];
  if (!name || !Array.isArray(content[0])) return null;
  const header = content[0].map((cell: unknown) => String(cell ?? '').trim());
  const rows = content.slice(1)
    .filter((row: unknown) => Array.isArray(row))
    .map((row: any[]) => row.map(cell => String(cell ?? '').trim()));
  return { name, header, rows };
}

function listSheetViews_ACU(tableData?: unknown): AgentSheetView_ACU[] {
  return Object.entries(readTableData_ACU(tableData))
    .filter(([key]) => key !== 'mate')
    .flatMap(([, sheet]) => { const view = toSheetView_ACU(sheet); return view ? [view] : []; });
}

/**
 * 按别名列表查找 sheet。
 * @param aliases 候选表名
 * @param tableData 表格数据对象，缺省取运行时快照
 * @returns 命中的 sheet 视图列表，可能为空或多条
 */
export function findAgentSheetsByAliases_ACU(aliases: readonly string[], tableData?: unknown): AgentSheetView_ACU[] {
  return listSheetViews_ACU(tableData).filter(view => aliases.includes(view.name));
}

/**
 * 把一张表渲染成紧凑文本。
 * @param view sheet 视图
 * @returns 形如「表名（共 N 行）\n列: a | b\n1. x | y」的文本
 */
export function renderAgentSheet_ACU(view: AgentSheetView_ACU): string {
  const lines = [`表名：${view.name}（共 ${view.rows.length} 行）`, `列：${view.header.join(' | ')}`];
  if (!view.rows.length) lines.push('（该表暂无数据行）');
  else view.rows.forEach((row, index) => lines.push(`${index + 1}. ${row.join(' | ')}`));
  return lines.join('\n');
}

/**
 * 渲染一张保底表。缺失或同名多张都如实标注。
 * @param table 保底表标识
 * @param tableData 表格数据对象，缺省取运行时快照
 * @returns 自然语言文本
 */
export function renderAgentTableByAliases_ACU(table: AgentGuaranteedTable_ACU, tableData?: unknown): string {
  const matched = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU[table], tableData);
  if (!matched.length) {
    return `当前聊天不存在${TABLE_LABELS_ACU[table]}（已按候选表名 ${AGENT_TABLE_ALIASES_ACU[table].join('、')} 查找）。请勿据此推断内容，需要该类信息时改用表格目录里实际存在的表。`;
  }
  if (matched.length === 1) return renderAgentSheet_ACU(matched[0]);
  const header = `命中 ${matched.length} 张同名或同类表，全部列出，请自行判断使用哪一张：`;
  return [header, ...matched.map(renderAgentSheet_ACU)].join('\n\n');
}

/**
 * 按精确表名渲染一张表，支撑 `$TABLE:<表名>` 形式的读集。
 * @param name 表名
 * @param tableData 表格数据对象，缺省取运行时快照
 * @returns 自然语言文本；不存在时如实标注
 */
export function renderAgentTableByName_ACU(name: string, tableData?: unknown): string {
  const target = String(name ?? '').trim();
  if (!target) return '读集里的表名为空，无法读取。';
  const matched = listSheetViews_ACU(tableData).filter(view => view.name === target);
  if (!matched.length) return `当前聊天不存在名为「${target}」的表。`;
  if (matched.length === 1) return renderAgentSheet_ACU(matched[0]);
  return [`命中 ${matched.length} 张名为「${target}」的表，全部列出：`, ...matched.map(renderAgentSheet_ACU)].join('\n\n');
}

/**
 * 渲染表格目录。目录是权威来源：主 Agent 据此知道当前聊天到底有哪些表可读。
 * @param tableData 表格数据对象，缺省取运行时快照
 * @returns 每行一张表的目录文本
 */
export function renderAgentTableCatalog_ACU(tableData?: unknown): string {
  const views = listSheetViews_ACU(tableData);
  if (!views.length) return '当前聊天没有任何可读表格。';
  const lines = views.map(view => `- ${view.name}（${view.rows.length} 行）列：${view.header.join(' | ')}｜读集写法：$TABLE:${view.name}`);
  return ['以下是当前聊天实际存在的全部表格；只有这里列出的表才能读取：', ...lines].join('\n');
}

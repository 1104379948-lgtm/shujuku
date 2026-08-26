/**
 * service/continuation/agent/agent-session-log.ts — Agent 运行会话日志
 *
 * 纯内存、无框架依赖的旁路事件通道：主循环在关键节点发事件，UI 订阅后
 * 以 coding 会话样式实时展示。它绝不参与业务决策——订阅者抛错被就地吞掉，
 * 任何日志问题都不允许影响续写循环本身。
 */

export type AgentSessionEventKind_ACU =
  | 'run_started'
  | 'main_action'
  | 'protocol_retry'
  | 'delegation'
  | 'outline_op'
  | 'finalize'
  | 'block'
  | 'run_failed'
  | 'run_completed';

export interface AgentSessionEntry_ACU {
  id: number;
  at: number;
  kind: AgentSessionEventKind_ACU;
  title: string;
  detail: string;
  agentName: string;
  ok: boolean;
}

export interface AgentSessionEventInput_ACU {
  kind: AgentSessionEventKind_ACU;
  title: string;
  detail?: string;
  agentName?: string;
  ok?: boolean;
}

/** 会话条目上限。超出后丢最旧的，避免长循环把 UI 内存撑爆。 */
const SESSION_ENTRY_LIMIT_ACU = 300;

/** 单条 detail 的字符上限。会话流展示要点，不承载完整提示词或正文。 */
const SESSION_DETAIL_LIMIT_ACU = 2000;

let entries_ACU: AgentSessionEntry_ACU[] = [];
let nextId_ACU = 1;
let running_ACU = false;
const listeners_ACU = new Set<() => void>();

function notify_ACU(): void {
  for (const listener of listeners_ACU) {
    try { listener(); } catch { /* 订阅者异常不允许影响续写循环。 */ }
  }
}

function truncateDetail_ACU(text: string): string {
  if (text.length <= SESSION_DETAIL_LIMIT_ACU) return text;
  return `${text.slice(0, SESSION_DETAIL_LIMIT_ACU)}\n（内容过长，已截断）`;
}

/**
 * 开始一次新的运行。清空上一次会话并写入起始条目。
 * @param label 本次运行的标题，如「第 2 阶段 · 第 3 轮」
 * @param detail 起始说明
 */
export function beginAgentSessionRun_ACU(label: string, detail = ''): void {
  entries_ACU = [];
  running_ACU = true;
  logAgentSession_ACU({ kind: 'run_started', title: label, detail });
}

/**
 * 记录一条会话事件。
 * @param input 事件内容；ok 缺省为 true
 */
export function logAgentSession_ACU(input: AgentSessionEventInput_ACU): void {
  entries_ACU.push({
    id: nextId_ACU++,
    at: Date.now(),
    kind: input.kind,
    title: input.title,
    detail: truncateDetail_ACU(String(input.detail ?? '')),
    agentName: String(input.agentName ?? ''),
    ok: input.ok !== false,
  });
  if (entries_ACU.length > SESSION_ENTRY_LIMIT_ACU) entries_ACU = entries_ACU.slice(-SESSION_ENTRY_LIMIT_ACU);
  if (input.kind === 'run_completed' || input.kind === 'run_failed' || input.kind === 'block') running_ACU = false;
  notify_ACU();
}

/**
 * 读取当前会话条目。
 * @returns 条目数组的浅拷贝，调用方不可回写
 */
export function readAgentSessionLog_ACU(): AgentSessionEntry_ACU[] {
  return [...entries_ACU];
}

/**
 * 当前是否有运行中的 Agent 循环。
 * @returns 运行标记
 */
export function isAgentSessionRunning_ACU(): boolean {
  return running_ACU;
}

/**
 * 订阅会话变化。
 * @param listener 变化回调，回调内自行调用 readAgentSessionLog_ACU 取最新条目
 * @returns 退订函数
 */
export function subscribeAgentSessionLog_ACU(listener: () => void): () => void {
  listeners_ACU.add(listener);
  return () => { listeners_ACU.delete(listener); };
}

export function resetAgentSessionLogForTests_ACU(): void {
  entries_ACU = [];
  nextId_ACU = 1;
  running_ACU = false;
  listeners_ACU.clear();
}

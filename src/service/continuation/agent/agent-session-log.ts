/**
 * service/continuation/agent/agent-session-log.ts — Agent 运行会话日志
 *
 * 纯内存、无框架依赖的旁路事件通道：主循环在关键节点发事件，UI 订阅后
 * 以 coding 会话样式实时展示。它绝不参与业务决策——订阅者抛错被就地吞掉，
 * 任何日志问题都不允许影响续写循环本身。
 */

export type AgentSessionEventKind_ACU =
  | 'run_started'
  | 'run_resumed'
  | 'thought'
  | 'main_action'
  | 'protocol_retry'
  | 'delegation'
  | 'outline_op'
  | 'finalize'
  | 'block'
  | 'run_failed'
  | 'run_completed';

/** 条目执行状态：running 表示动作已发出尚未有结果，UI 据此显示进行中动画。 */
export type AgentSessionEntryStatus_ACU = 'running' | 'done' | 'failed';

export interface AgentSessionEntry_ACU {
  id: number;
  at: number;
  kind: AgentSessionEventKind_ACU;
  title: string;
  detail: string;
  agentName: string;
  ok: boolean;
  status: AgentSessionEntryStatus_ACU;
}

export interface AgentSessionEventInput_ACU {
  kind: AgentSessionEventKind_ACU;
  title: string;
  detail?: string;
  agentName?: string;
  ok?: boolean;
  status?: AgentSessionEntryStatus_ACU;
}

export interface AgentSessionEntryPatch_ACU {
  title?: string;
  detail?: string;
  ok?: boolean;
  status?: AgentSessionEntryStatus_ACU;
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
 * 开始一次新的运行。
 * @param label 本次运行的标题，如「第 2 阶段 · 第 3 轮」
 * @param detail 起始说明
 * @param resume 为 true 时保留既有会话记录并写入「恢复运行」条目——
 *               从中断点恢复时用户必须能看到之前已完成的过程；缺省清空重来
 */
export function beginAgentSessionRun_ACU(label: string, detail = '', resume = false): void {
  if (!resume) entries_ACU = [];
  running_ACU = true;
  logAgentSession_ACU({ kind: resume ? 'run_resumed' : 'run_started', title: label, detail });
}

/**
 * 记录一条会话事件。
 * @param input 事件内容；ok 缺省为 true，status 缺省按 ok 推导（false→failed，true→done）
 * @returns 条目 id，可用于 updateAgentSession_ACU 原地更新（如 running→done）
 */
export function logAgentSession_ACU(input: AgentSessionEventInput_ACU): number {
  const id = nextId_ACU++;
  const ok = input.ok !== false;
  entries_ACU.push({
    id,
    at: Date.now(),
    kind: input.kind,
    title: input.title,
    detail: truncateDetail_ACU(String(input.detail ?? '')),
    agentName: String(input.agentName ?? ''),
    ok,
    status: input.status ?? (ok ? 'done' : 'failed'),
  });
  if (entries_ACU.length > SESSION_ENTRY_LIMIT_ACU) entries_ACU = entries_ACU.slice(-SESSION_ENTRY_LIMIT_ACU);
  if (input.kind === 'run_completed' || input.kind === 'run_failed' || input.kind === 'block') running_ACU = false;
  notify_ACU();
  return id;
}

/**
 * 原地更新一条已有会话条目（典型用途：派工从 running 更新为成功/失败）。
 * @param id logAgentSession_ACU 返回的条目 id
 * @param patch 要更新的字段；条目已被上限截断淘汰时静默忽略
 */
export function updateAgentSession_ACU(id: number, patch: AgentSessionEntryPatch_ACU): void {
  const entry = entries_ACU.find(item => item.id === id);
  if (!entry) return;
  if (patch.title !== undefined) entry.title = patch.title;
  if (patch.detail !== undefined) entry.detail = truncateDetail_ACU(String(patch.detail));
  if (patch.ok !== undefined) entry.ok = patch.ok;
  if (patch.status !== undefined) entry.status = patch.status;
  else if (patch.ok !== undefined) entry.status = patch.ok ? 'done' : 'failed';
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

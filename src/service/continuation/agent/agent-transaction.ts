/**
 * service/continuation/agent/agent-transaction.ts — 资料模块写集事务
 *
 * 所有写入都是全量校验后一次性生效的事务：任一条目不合规就拒绝整份 delta，
 * 绝不做部分落盘。核心防线是「漏写不等于删除」——删除必须显式 retire 并给出理由。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  isAgentWritableModule_ACU,
  type AgentConstraintEntry_ACU,
  type AgentHookDeltaItem_ACU,
  type AgentHookEntry_ACU,
  type AgentInfoGapDeltaItem_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentModuleDelta_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';

function reject_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', message, false, details));
}

function collectTouchedModules_ACU(delta: AgentModuleDelta_ACU): AgentWritableModule_ACU[] {
  const touched: AgentWritableModule_ACU[] = [];
  if (delta.hooks.length) touched.push('hooks');
  if (delta.infoGap.length) touched.push('infoGap');
  return touched;
}

function assertWritePermission_ACU(delta: AgentModuleDelta_ACU, allowedWrites: readonly string[]): void {
  for (const module of collectTouchedModules_ACU(delta)) {
    if (!allowedWrites.includes(module)) {
      reject_ACU(`子代理试图写入未授权模块：${module}`, { module, allowedWrites: [...allowedWrites] });
    }
  }
  for (const key of Object.keys(delta.expectedRevisions)) {
    if (!isAgentWritableModule_ACU(key)) reject_ACU(`expectedRevisions 含非法模块名：${key}`, { key });
  }
}

function assertExpectedRevisions_ACU(delta: AgentModuleDelta_ACU, snapshot: AgentModuleSnapshot_ACU): void {
  for (const module of collectTouchedModules_ACU(delta)) {
    const expected = delta.expectedRevisions[module];
    // 未声明不拒绝：并发基准由运行时按渲染时刻捕获后补齐，不依赖子代理自报。
    if (expected === undefined) continue;
    if (expected !== snapshot.revisions[module]) {
      reject_ACU(`${module} 的 revision 已变化，写入被拒绝`, { module, expected, actual: snapshot.revisions[module] });
    }
  }
}

/**
 * 用「子代理读到资料的那一刻」的修订号补齐未声明的模块。
 * @param delta 子代理返回的写集
 * @param readRevisions 渲染读集材料时捕获的快照修订号
 * @returns 新的 delta；子代理已显式声明的模块保持原值，仍按显式断言校验
 */
export function mergeAgentDeltaRevisions_ACU(delta: AgentModuleDelta_ACU, readRevisions: AgentModuleRevisions_ACU): AgentModuleDelta_ACU {
  const merged: AgentModuleDelta_ACU['expectedRevisions'] = { ...delta.expectedRevisions };
  for (const module of collectTouchedModules_ACU(delta)) {
    if (merged[module] === undefined) merged[module] = readRevisions[module];
  }
  return { ...delta, expectedRevisions: merged };
}

function applyHookDelta_ACU(existing: AgentHookEntry_ACU[], items: AgentHookDeltaItem_ACU[], settledIndex: number): AgentHookEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('伏笔条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的伏笔不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 伏笔 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim(), updatedIndex: settledIndex });
      continue;
    }
    if (!item.summary.trim()) reject_ACU(`伏笔 ${item.id} 的 summary 不能为空`, { id: item.id });
    const previous = byId.get(item.id);
    byId.set(item.id, {
      id: item.id,
      summary: item.summary.trim(),
      status: item.status,
      importance: item.importance,
      plantedIndex: previous ? previous.plantedIndex : item.plantedIndex,
      updatedIndex: settledIndex,
      plannedPayoff: item.plannedPayoff,
      retired: false,
      retiredReason: '',
    });
  }
  return [...byId.values()];
}

function applyInfoGapDelta_ACU(existing: AgentInfoGapEntry_ACU[], items: AgentInfoGapDeltaItem_ACU[], settledIndex: number): AgentInfoGapEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('信息差条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的信息差条目不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 信息差条目 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim() });
      continue;
    }
    if (!item.topic.trim()) reject_ACU(`信息差条目 ${item.id} 的 topic 不能为空`, { id: item.id });
    // 未揭示的事件不允许携带揭示楼层，否则等于把计划写成了已发生事实。
    if (item.revealStatus === 'unrevealed' && item.revealIndex !== null) {
      reject_ACU(`信息差条目 ${item.id} 标记为未揭示，揭示楼层必须为空`, { id: item.id, revealIndex: item.revealIndex });
    }
    if (item.revealStatus !== 'unrevealed' && item.revealIndex === null) {
      reject_ACU(`信息差条目 ${item.id} 已揭示，必须给出揭示楼层`, { id: item.id });
    }
    byId.set(item.id, {
      id: item.id,
      topic: item.topic.trim(),
      objectiveFact: item.objectiveFact,
      readerKnown: item.readerKnown,
      characterKnowledge: item.characterKnowledge,
      revealStatus: item.revealStatus,
      revealIndex: item.revealIndex,
      retired: false,
      retiredReason: '',
    });
  }
  void settledIndex;
  return [...byId.values()];
}

/**
 * 把一份子代理写集事务应用到快照上。
 * @param snapshot 当前快照
 * @param delta 子代理返回的写集
 * @param allowedWrites 该子代理被授权的模块名列表
 * @param settledIndex 本次结算的水位楼层，用于记录条目变动楼层
 * @returns 应用后的新快照，被写入模块的 revision 各自 +1
 */
export function applyAgentModuleDelta_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  delta: AgentModuleDelta_ACU,
  allowedWrites: readonly string[],
  settledIndex: number,
): AgentModuleSnapshot_ACU {
  assertWritePermission_ACU(delta, allowedWrites);
  assertExpectedRevisions_ACU(delta, snapshot);
  const touched = collectTouchedModules_ACU(delta);
  if (!touched.length) return snapshot;
  const hooks = delta.hooks.length ? applyHookDelta_ACU(snapshot.hooks, delta.hooks, settledIndex) : snapshot.hooks;
  const infoGap = delta.infoGap.length ? applyInfoGapDelta_ACU(snapshot.infoGap, delta.infoGap, settledIndex) : snapshot.infoGap;
  return {
    ...snapshot,
    hooks,
    infoGap,
    revisions: {
      hooks: snapshot.revisions.hooks + (delta.hooks.length ? 1 : 0),
      infoGap: snapshot.revisions.infoGap + (delta.infoGap.length ? 1 : 0),
      constraints: snapshot.revisions.constraints,
    },
  };
}

/**
 * 登记主 Agent 裁决后的长期约束。约束是全量列表语义，因此必须显式覆盖既有条目。
 * @param snapshot 当前快照
 * @param current 本次生效的全部约束文本
 * @param retired 本次废除的约束文本
 * @param settledIndex 登记时的水位楼层
 * @returns 应用后的新快照，constraints 的 revision +1
 */
export function applyAgentConstraintRegistration_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  current: readonly string[],
  retired: readonly string[],
  settledIndex: number,
): AgentModuleSnapshot_ACU {
  const currentTexts = current.map(text => text.trim()).filter(Boolean);
  const retiredTexts = new Set(retired.map(text => text.trim()).filter(Boolean));
  const covered = new Set([...currentTexts, ...retiredTexts]);
  // 漏写既有活跃约束不等于删除它；缺任何一条都判整份登记无效。
  const missing = snapshot.constraints.filter(item => !covered.has(item.text)).map(item => item.text);
  if (missing.length) {
    reject_ACU('长期约束登记漏写了既有活跃条目；漏写不等于删除，删除必须显式列入 retired', { missing });
  }
  const existingByText = new Map(snapshot.constraints.map(item => [item.text, item]));
  const constraints: AgentConstraintEntry_ACU[] = currentTexts.map((text, order) => {
    const previous = existingByText.get(text);
    if (previous) return previous;
    return { id: `C${String(snapshot.revisions.constraints + 1).padStart(2, '0')}-${order + 1}`, text, reason: '主 Agent 本轮裁决登记', createdIndex: settledIndex };
  });
  return { ...snapshot, constraints, revisions: { ...snapshot.revisions, constraints: snapshot.revisions.constraints + 1 } };
}

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
  type AgentHookPatch_ACU,
  type AgentInfoGapDeltaItem_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentInfoGapPatch_ACU,
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
  if (delta.hooks.length || delta.hookPatches.length) touched.push('hooks');
  if (delta.infoGap.length || delta.infoGapPatches.length) touched.push('infoGap');
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

function applyHookPatches_ACU(entries: AgentHookEntry_ACU[], patches: AgentHookPatch_ACU[], settledIndex: number): AgentHookEntry_ACU[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const patch of patches) {
    const current = byId.get(patch.id);
    if (!current) reject_ACU(`patch 的伏笔不存在：${patch.id}`, { id: patch.id });
    if (current.retired) reject_ACU(`伏笔 ${patch.id} 已退役，不可 patch；需要恢复请用 upsert 重新登记`, { id: patch.id });
    byId.set(patch.id, {
      ...current,
      summary: patch.summary ?? current.summary,
      status: patch.status ?? current.status,
      importance: patch.importance ?? current.importance,
      plannedPayoff: patch.plannedPayoff ?? current.plannedPayoff,
      updatedIndex: settledIndex,
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

function applyInfoGapPatches_ACU(entries: AgentInfoGapEntry_ACU[], patches: AgentInfoGapPatch_ACU[]): AgentInfoGapEntry_ACU[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const patch of patches) {
    const current = byId.get(patch.id);
    if (!current) reject_ACU(`patch 的信息差条目不存在：${patch.id}`, { id: patch.id });
    if (current.retired) reject_ACU(`信息差条目 ${patch.id} 已退役，不可 patch`, { id: patch.id });
    const merged: AgentInfoGapEntry_ACU = {
      ...current,
      topic: patch.topic ?? current.topic,
      objectiveFact: patch.objectiveFact ?? current.objectiveFact,
      readerKnown: patch.readerKnown ?? current.readerKnown,
      characterKnowledge: patch.characterKnowledge ?? current.characterKnowledge,
      revealStatus: patch.revealStatus ?? current.revealStatus,
      revealIndex: 'revealIndex' in patch ? patch.revealIndex! : current.revealIndex,
    };
    // 合并结果必须满足与 upsert 相同的一致性规则：把计划写成事实的典型症状在 patch 路径同样要拦。
    if (merged.revealStatus === 'unrevealed' && merged.revealIndex !== null) {
      reject_ACU(`信息差条目 ${patch.id} patch 后标记为未揭示，揭示楼层必须同时清空（revealIndex 传 null）`, { id: patch.id, revealIndex: merged.revealIndex });
    }
    if (merged.revealStatus !== 'unrevealed' && merged.revealIndex === null) {
      reject_ACU(`信息差条目 ${patch.id} patch 后已揭示，必须给出揭示楼层`, { id: patch.id });
    }
    byId.set(patch.id, merged);
  }
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
  const hooksTouched = delta.hooks.length > 0 || delta.hookPatches.length > 0;
  const infoGapTouched = delta.infoGap.length > 0 || delta.infoGapPatches.length > 0;
  let hooks = delta.hooks.length ? applyHookDelta_ACU(snapshot.hooks, delta.hooks, settledIndex) : snapshot.hooks;
  if (delta.hookPatches.length) hooks = applyHookPatches_ACU(hooks, delta.hookPatches, settledIndex);
  let infoGap = delta.infoGap.length ? applyInfoGapDelta_ACU(snapshot.infoGap, delta.infoGap, settledIndex) : snapshot.infoGap;
  if (delta.infoGapPatches.length) infoGap = applyInfoGapPatches_ACU(infoGap, delta.infoGapPatches);
  return {
    ...snapshot,
    hooks,
    infoGap,
    revisions: {
      hooks: snapshot.revisions.hooks + (hooksTouched ? 1 : 0),
      infoGap: snapshot.revisions.infoGap + (infoGapTouched ? 1 : 0),
      constraints: snapshot.revisions.constraints,
    },
  };
}

/** 渲染当前活跃约束清单，用于拒绝回显，让主 Agent 看到可引用的 id 与原文后自我修正。 */
function renderActiveConstraintList_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  if (!snapshot.constraints.length) return '（当前没有任何活跃约束）';
  return snapshot.constraints.map(item => `${item.id}：${item.text}`).join('；');
}

/**
 * 登记主 Agent 裁决后的长期约束。增量语义：add 只写新增文本，retire 只写要废除的
 * 条目（按 id 或原文精确匹配）。漏写既有条目不等于删除；重复登记已有文本幂等跳过。
 * @param snapshot 当前快照
 * @param add 新增的约束文本
 * @param retire 废除的约束（id 或原文）
 * @param settledIndex 登记时的水位楼层
 * @returns 应用后的新快照；有实际变更时 constraints 的 revision +1，否则原样返回
 */
export function applyAgentConstraintRegistration_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  add: readonly string[],
  retire: readonly string[],
  settledIndex: number,
): AgentModuleSnapshot_ACU {
  const retireKeys = [...new Set(retire.map(text => text.trim()).filter(Boolean))];
  const retiredIds = new Set<string>();
  for (const key of retireKeys) {
    const matched = snapshot.constraints.find(item => item.id === key || item.text === key);
    if (!matched) {
      reject_ACU(
        `retire 的约束不存在：「${key}」。retire 必须精确引用活跃条目的 id 或原文。当前活跃约束：${renderActiveConstraintList_ACU(snapshot)}`,
        { retireKey: key, active: snapshot.constraints.map(item => ({ id: item.id, text: item.text })) },
      );
    }
    retiredIds.add(matched.id);
  }
  const remaining = snapshot.constraints.filter(item => !retiredIds.has(item.id));
  const existingTexts = new Set(remaining.map(item => item.text));
  const addTexts: string[] = [];
  for (const raw of add) {
    const text = raw.trim();
    // 重复登记既有文本（含旧全量形态重抄整份清单）幂等跳过，不再构成拒绝理由。
    if (!text || existingTexts.has(text)) continue;
    existingTexts.add(text);
    addTexts.push(text);
  }
  if (!retiredIds.size && !addTexts.length) return snapshot;
  const nextRevision = snapshot.revisions.constraints + 1;
  const added: AgentConstraintEntry_ACU[] = addTexts.map((text, order) => ({
    id: `C${String(nextRevision).padStart(2, '0')}-${order + 1}`,
    text,
    reason: '主 Agent 本轮裁决登记',
    createdIndex: settledIndex,
  }));
  return { ...snapshot, constraints: [...remaining, ...added], revisions: { ...snapshot.revisions, constraints: nextRevision } };
}

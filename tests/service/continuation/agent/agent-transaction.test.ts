import { describe, expect, it } from 'vitest';

import { applyAgentConstraintRegistration_ACU, applyAgentModuleDelta_ACU, mergeAgentDeltaRevisions_ACU } from '../../../../src/service/continuation/agent/agent-transaction';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';

function baseSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 5,
    revisions: { hooks: 2, infoGap: 3, constraints: 1 },
    hooks: [{ id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'high', plantedIndex: 2, updatedIndex: 2, plannedPayoff: '第三阶段回收', retired: false, retiredReason: '' }],
    infoGap: [{ id: 'E1', topic: '守门人身份', objectiveFact: '内应', readerKnown: '行为反常', characterKnowledge: [], revealStatus: 'unrevealed', revealIndex: null, retired: false, retiredReason: '' }],
    constraints: [{ id: 'C01-1', text: '不得提前揭穿幕后', reason: '既有裁决', createdIndex: 3 }],
  };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], constraintProposals: [], ...patch };
}

function hookItem_ACU(patch: Record<string, unknown> = {}) {
  return { action: 'upsert' as const, id: 'H1', summary: '断裂的封印被再次触碰', status: 'reinforced' as const, importance: 'high' as const, plantedIndex: 9, plannedPayoff: '第三阶段回收', reason: '', ...patch };
}

function infoGapItem_ACU(patch: Record<string, unknown> = {}) {
  return { action: 'upsert' as const, id: 'E1', topic: '守门人身份', objectiveFact: '内应', readerKnown: '行为反常', characterKnowledge: [], revealStatus: 'unrevealed' as const, revealIndex: null, reason: '', ...patch };
}

describe('Agent 写集事务', () => {
  it('越权写入被拒绝', () => {
    const input = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), input, ['infoGap'], 6)).toThrowError(/未授权模块/);
  });

  it('子代理声明的版本号不匹配时拒绝整份写入', () => {
    const stale = delta_ACU({ expectedRevisions: { hooks: 1 }, hooks: [hookItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), stale, ['hooks'], 6)).toThrowError(/revision 已变化/);
  });

  it('未声明版本号时不拒绝，并发基准由运行时按读取时刻补齐', () => {
    const missing = delta_ACU({ hooks: [hookItem_ACU()] });
    expect(applyAgentModuleDelta_ACU(baseSnapshot_ACU(), missing, ['hooks'], 6).revisions.hooks).toBe(3);

    const merged = mergeAgentDeltaRevisions_ACU(missing, { hooks: 1, infoGap: 3, constraints: 1 });
    expect(merged.expectedRevisions).toEqual({ hooks: 1 });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), merged, ['hooks'], 6)).toThrowError(/revision 已变化/);
  });

  it('补齐不会覆盖子代理已显式声明的版本号，也不给未触碰模块补值', () => {
    const declared = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] });
    const merged = mergeAgentDeltaRevisions_ACU(declared, { hooks: 9, infoGap: 9, constraints: 9 });
    expect(merged.expectedRevisions).toEqual({ hooks: 2 });
    expect(applyAgentModuleDelta_ACU(baseSnapshot_ACU(), merged, ['hooks'], 6).revisions.hooks).toBe(3);
  });

  it('upsert 保留原有埋设楼层并只给被写模块升版本', () => {
    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] }), ['hooks'], 6);

    expect(applied.hooks[0].plantedIndex).toBe(2);
    expect(applied.hooks[0].status).toBe('reinforced');
    expect(applied.hooks[0].updatedIndex).toBe(6);
    expect(applied.revisions).toEqual({ hooks: 3, infoGap: 3, constraints: 1 });
  });

  it('retire 必须命中既有条目并给出理由', () => {
    const unknown = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', id: 'H9', reason: '完成回收' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), unknown, ['hooks'], 6)).toThrowError(/retire 的伏笔不存在/);

    const noReason = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', reason: '' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), noReason, ['hooks'], 6)).toThrowError(/必须给出理由/);

    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', reason: '完成回收' })] }), ['hooks'], 6);
    expect(applied.hooks[0]).toMatchObject({ retired: true, retiredReason: '完成回收' });
  });

  it('信息差的揭示状态与揭示楼层必须自洽', () => {
    const fakeReveal = delta_ACU({ expectedRevisions: { infoGap: 3 }, infoGap: [infoGapItem_ACU({ revealIndex: 6 })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), fakeReveal, ['infoGap'], 6)).toThrowError(/揭示楼层必须为空/);

    const missingIndex = delta_ACU({ expectedRevisions: { infoGap: 3 }, infoGap: [infoGapItem_ACU({ revealStatus: 'partial' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), missingIndex, ['infoGap'], 6)).toThrowError(/必须给出揭示楼层/);
  });

  it('patch 只改给定字段并保留其余字段，版本号照常递增', () => {
    const applied = applyAgentModuleDelta_ACU(
      baseSnapshot_ACU(),
      delta_ACU({ hookPatches: [{ id: 'H1', summary: '封印裂缝开始渗出黑雾' }] }),
      ['hooks'],
      7,
    );
    expect(applied.hooks[0]).toMatchObject({
      summary: '封印裂缝开始渗出黑雾',
      status: 'planted',
      importance: 'high',
      plannedPayoff: '第三阶段回收',
      updatedIndex: 7,
    });
    expect(applied.revisions.hooks).toBe(3);
  });

  it('patch 不存在或已退役的条目整份拒绝', () => {
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ hookPatches: [{ id: 'H9', summary: '改' }] }), ['hooks'], 7))
      .toThrowError(/patch 的伏笔不存在/);

    const withRetired = baseSnapshot_ACU();
    withRetired.hooks[0] = { ...withRetired.hooks[0], retired: true, retiredReason: '已回收' };
    expect(() => applyAgentModuleDelta_ACU(withRetired, delta_ACU({ hookPatches: [{ id: 'H1', summary: '改' }] }), ['hooks'], 7))
      .toThrowError(/已退役，不可 patch/);
  });

  it('信息差 patch 的合并结果必须满足揭示状态一致性', () => {
    const revealed = baseSnapshot_ACU();
    revealed.infoGap[0] = { ...revealed.infoGap[0], revealStatus: 'partial', revealIndex: 4 };
    expect(() => applyAgentModuleDelta_ACU(revealed, delta_ACU({ infoGapPatches: [{ id: 'E1', revealStatus: 'unrevealed' }] }), ['infoGap'], 7))
      .toThrowError(/揭示楼层必须同时清空/);

    const fixed = applyAgentModuleDelta_ACU(revealed, delta_ACU({ infoGapPatches: [{ id: 'E1', revealStatus: 'unrevealed', revealIndex: null }] }), ['infoGap'], 7);
    expect(fixed.infoGap[0]).toMatchObject({ revealStatus: 'unrevealed', revealIndex: null, topic: '守门人身份' });
  });

  it('空 delta 原样返回同一份快照，不产生无意义的版本递增', () => {
    const snapshot = baseSnapshot_ACU();
    expect(applyAgentModuleDelta_ACU(snapshot, delta_ACU(), ['hooks', 'infoGap'], 6)).toBe(snapshot);
  });
});

describe('Agent 长期约束登记（增量语义）', () => {
  it('add 只追加新增条目，漏写既有条目不等于删除', () => {
    const snapshot = baseSnapshot_ACU();
    const applied = applyAgentConstraintRegistration_ACU(snapshot, ['新增红线'], [], 6);

    expect(applied.constraints).toHaveLength(2);
    expect(applied.constraints[0]).toBe(snapshot.constraints[0]);
    expect(applied.constraints[1]).toMatchObject({ text: '新增红线', createdIndex: 6 });
    expect(applied.revisions.constraints).toBe(2);
  });

  it('重复登记既有文本幂等跳过（含旧全量形态重抄整份清单），无变更时原样返回', () => {
    const snapshot = baseSnapshot_ACU();
    expect(applyAgentConstraintRegistration_ACU(snapshot, ['不得提前揭穿幕后'], [], 6)).toBe(snapshot);
    expect(applyAgentConstraintRegistration_ACU(snapshot, [], [], 6)).toBe(snapshot);

    const mixed = applyAgentConstraintRegistration_ACU(snapshot, ['不得提前揭穿幕后', '主角不得使用禁咒', '主角不得使用禁咒'], [], 6);
    expect(mixed.constraints).toHaveLength(2);
    expect(mixed.constraints[1]).toMatchObject({ text: '主角不得使用禁咒', createdIndex: 6 });
    expect(mixed.revisions.constraints).toBe(2);
  });

  it('retire 按 id 或原文精确匹配移除，未命中即拒绝并回显活跃清单', () => {
    const snapshot = baseSnapshot_ACU();
    const removedByText = applyAgentConstraintRegistration_ACU(snapshot, [], ['不得提前揭穿幕后'], 6);
    expect(removedByText.constraints).toHaveLength(0);
    expect(removedByText.revisions.constraints).toBe(2);

    const removedById = applyAgentConstraintRegistration_ACU(snapshot, [], ['C01-1'], 6);
    expect(removedById.constraints).toHaveLength(0);

    expect(() => applyAgentConstraintRegistration_ACU(snapshot, [], ['不存在的约束'], 6))
      .toThrowError(/retire 的约束不存在.*C01-1：不得提前揭穿幕后/);
  });
});

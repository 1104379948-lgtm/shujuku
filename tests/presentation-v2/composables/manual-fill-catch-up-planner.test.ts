import { describe, expect, it } from 'vitest';
import {
  planManualFillCatchUp,
  type CatchUpSheetState,
} from '../../../src/presentation-v2/composables/manual-fill-catch-up-planner';

function sheet(overrides: Partial<CatchUpSheetState> = {}): CatchUpSheetState {
  return {
    sheetKey: 'sheet_0',
    hasAnyData: true,
    hasTrackedUpdate: true,
    lastTrackedUpdateAiFloor: 0,
    ...overrides,
  };
}

function plan(sheets: CatchUpSheetState[], aiFloorCount = 5, skipUpdateFloors = 0) {
  return planManualFillCatchUp({
    aiMessageIndices: Array.from({ length: aiFloorCount }, (_, index) => index * 2),
    skipUpdateFloors,
    sheets,
  });
}

describe('planManualFillCatchUp', () => {
  it('空数据表从第一层开始并覆盖全部有效 AI 层', () => {
    expect(plan([sheet({ hasAnyData: false })])).toEqual([{
      targetKeys: ['sheet_0'], contextDepth: 5, startAiFloor: 1, endAiFloor: 5,
    }]);
  });

  it('空数据表忽略残留追踪进度', () => {
    expect(plan([sheet({ hasAnyData: false, lastTrackedUpdateAiFloor: 4 })])[0]?.contextDepth).toBe(5);
  });

  it('有数据但无可信追踪进度时从第一层开始', () => {
    expect(plan([sheet({ hasTrackedUpdate: false, lastTrackedUpdateAiFloor: 4 })])[0]?.startAiFloor).toBe(1);
  });

  it('有数据且存在可信进度时从断点后继续', () => {
    expect(plan([sheet({ lastTrackedUpdateAiFloor: 3 })], 8)).toEqual([{
      targetKeys: ['sheet_0'], contextDepth: 5, startAiFloor: 4, endAiFloor: 8,
    }]);
  });

  it('相同起点的表合并且保持输入顺序', () => {
    expect(plan([
      sheet({ sheetKey: 'sheet_b', lastTrackedUpdateAiFloor: 2 }),
      sheet({ sheetKey: 'sheet_a', lastTrackedUpdateAiFloor: 2 }),
    ])).toEqual([{
      targetKeys: ['sheet_b', 'sheet_a'], contextDepth: 3, startAiFloor: 3, endAiFloor: 5,
    }]);
  });

  it('不同起点按开始楼层升序稳定排序', () => {
    const result = plan([
      sheet({ sheetKey: 'late', lastTrackedUpdateAiFloor: 4 }),
      sheet({ sheetKey: 'early', lastTrackedUpdateAiFloor: 1 }),
      sheet({ sheetKey: 'middle', lastTrackedUpdateAiFloor: 3 }),
    ]);
    expect(result.map(group => group.targetKeys)).toEqual([['early'], ['middle'], ['late']]);
  });

  it('skipUpdateFloors 从有效尾部截断范围', () => {
    expect(plan([sheet({ lastTrackedUpdateAiFloor: 2 })], 8, 3)).toEqual([{
      targetKeys: ['sheet_0'], contextDepth: 3, startAiFloor: 3, endAiFloor: 5,
    }]);
  });

  it('无 AI 层、全部已追平或全部被跳过时返回空组', () => {
    expect(plan([sheet()], 0)).toEqual([]);
    expect(plan([sheet({ lastTrackedUpdateAiFloor: 5 })])).toEqual([]);
    expect(plan([sheet({ hasAnyData: false })], 5, 99)).toEqual([]);
  });

  it('重复表只保留第一次，且首次状态决定范围', () => {
    expect(plan([
      sheet({ sheetKey: 'same', lastTrackedUpdateAiFloor: 1 }),
      sheet({ sheetKey: 'same', hasAnyData: false, lastTrackedUpdateAiFloor: 0 }),
    ])).toEqual([{
      targetKeys: ['same'], contextDepth: 4, startAiFloor: 2, endAiFloor: 5,
    }]);
  });

  it.each([
    [[0, 0]],
    [[1, 0]],
    [[-1]],
    [[0, 1.5]],
    [[Number.NaN]],
  ])('拒绝非法 AI 消息索引 %j', aiMessageIndices => {
    expect(() => planManualFillCatchUp({ aiMessageIndices, skipUpdateFloors: 0, sheets: [] }))
      .toThrow('aiMessageIndices 必须是严格递增的非负整数数组');
  });

  it('拒绝空白表键', () => {
    expect(() => plan([sheet({ sheetKey: '  ' })])).toThrow('sheetKey 不能为空');
  });

  it('将越界、负数、小数和非有限追踪进度归一到有效范围', () => {
    expect(plan([
      sheet({ sheetKey: 'negative', lastTrackedUpdateAiFloor: -2 }),
      sheet({ sheetKey: 'fraction', lastTrackedUpdateAiFloor: 2.9 }),
      sheet({ sheetKey: 'overflow', lastTrackedUpdateAiFloor: 99 }),
      sheet({ sheetKey: 'nan', lastTrackedUpdateAiFloor: Number.NaN }),
    ])).toEqual([
      { targetKeys: ['negative', 'nan'], contextDepth: 5, startAiFloor: 1, endAiFloor: 5 },
      { targetKeys: ['fraction'], contextDepth: 3, startAiFloor: 3, endAiFloor: 5 },
    ]);
  });
});

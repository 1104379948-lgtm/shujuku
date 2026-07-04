import { describe, expect, it } from 'vitest';
import { buildManualRefillBaseFromChain_ACU, manualRefillChainMatchesRequest_ACU } from '../../../src/service/table/manual-refill-chain';
import type { ManualRefillChainV2_ACU } from '../../../src/service/table/storage-frame-v2-types';

function makeChain(): ManualRefillChainV2_ACU {
  return {
    kind: 'manual_refill_chain',
    version: 1,
    status: 'complete',
    selectedSheetKeys: ['sheet_0'],
    contextMessageIndices: [1, 3, 5],
    originalStartMessageIndex: 1,
    targetMessageIndex: 5,
    batchSize: 1,
    baseCheckpoint: {
      mate: { type: 'acu' },
      sheet_0: { name: 'A', content: [['row_id', '值']] },
      sheet_1: { name: 'B', content: [['row_id', '值'], ['1', '最新B']] },
    } as any,
    chunks: [{
      chunkIndex: 0,
      groupKeys: ['0|1,3,5|1'],
      buckets: [
        {
          bucketIndex: 0,
          saveTargetIndex: 1,
          batchNumber: 1,
          updateMode: 'manual_independent',
          jobGroupKeys: ['0|1,3,5|1'],
          messageIndices: [1],
          sheetKeys: ['sheet_0'],
          operations: [{
            kind: 'sheet_replace',
            sheetKey: 'sheet_0',
            sheet: { name: 'A', content: [['row_id', '值'], ['1', '一批']] } as any,
            reason: 'system',
          }],
          filledSheetKeys: ['sheet_0'],
          changedSheetKeys: ['sheet_0'],
          groupKeys: ['sheet_0'],
        },
        {
          bucketIndex: 1,
          saveTargetIndex: 3,
          batchNumber: 2,
          updateMode: 'manual_independent',
          jobGroupKeys: ['0|1,3,5|1'],
          messageIndices: [3],
          sheetKeys: ['sheet_0'],
          operations: [{
            kind: 'sheet_replace',
            sheetKey: 'sheet_0',
            sheet: { name: 'A', content: [['row_id', '值'], ['1', '一批'], ['2', '二批']] } as any,
            reason: 'system',
          }],
          filledSheetKeys: ['sheet_0'],
          changedSheetKeys: ['sheet_0'],
          groupKeys: ['sheet_0'],
        },
      ],
    }],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('manualRefillChainMatchesRequest_ACU', () => {
  it('要求 selectedSheetKeys 完全一致', () => {
    const result = manualRefillChainMatchesRequest_ACU(makeChain(), ['sheet_0', 'sheet_1'], [3, 5], 5);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('selected_sheets_mismatch');
  });

  it('目标楼层不一致时拒绝', () => {
    const result = manualRefillChainMatchesRequest_ACU(makeChain(), ['sheet_0'], [3, 5], 7);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('target_mismatch');
  });

  it('请求范围早于 chain 覆盖范围时拒绝', () => {
    const result = manualRefillChainMatchesRequest_ACU(makeChain(), ['sheet_0'], [0, 1, 3, 5], 5);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('range_not_covered');
  });
});

describe('buildManualRefillBaseFromChain_ACU', () => {
  it('从 baseCheckpoint 加前置 bucket operations 恢复起点前基底，并保留未选表最新状态', async () => {
    const result = await buildManualRefillBaseFromChain_ACU({
      chain: makeChain(),
      requestedStartMessageIndex: 3,
      latestState: {
        sheet_0: { name: 'A', content: [['row_id', '值'], ['1', '最新A']] },
        sheet_1: { name: 'B', content: [['row_id', '值'], ['1', '更新后的B']] },
      } as any,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.effectiveStartMessageIndex).toBe(3);
      expect(result.data.sheet_0.content).toEqual([['row_id', '值'], ['1', '一批']]);
      expect(result.data.sheet_1.content).toEqual([['row_id', '值'], ['1', '更新后的B']]);
    }
  });

  it('起点落在 bucket 内时回退到 bucket 起点', async () => {
    const chain = makeChain();
    chain.chunks[0].buckets[1].messageIndices = [3, 4];
    const result = await buildManualRefillBaseFromChain_ACU({
      chain,
      requestedStartMessageIndex: 4,
      latestState: chain.baseCheckpoint as any,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.effectiveStartMessageIndex).toBe(3);
  });

  it('operation replay 失败时返回结构化失败', async () => {
    const chain = makeChain();
    chain.chunks[0].buckets[0].operations = [{ kind: 'sql_batch', statements: ['insert into missing_table values (1)'] }];
    const result = await buildManualRefillBaseFromChain_ACU({
      chain,
      requestedStartMessageIndex: 3,
      latestState: chain.baseCheckpoint as any,
    });

    expect(result.success).toBe(false);
    if (result.success === false) expect(result.failure.code).toBe('operation_replay_failed');
  });

  it('可以正向回放 sql_batch operation 恢复基底', async () => {
    const chain = makeChain();
    chain.baseCheckpoint = {
      sheet_0: {
        name: 'A',
        sourceData: { ddl: 'CREATE TABLE A (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value']],
      },
    } as any;
    chain.chunks[0].buckets[0].operations = [{
      kind: 'sql_batch',
      statements: ["INSERT INTO A (row_id, value) VALUES (1, '一批')"],
    }];
    const result = await buildManualRefillBaseFromChain_ACU({
      chain,
      requestedStartMessageIndex: 3,
      latestState: chain.baseCheckpoint as any,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sheet_0.content).toEqual([['row_id', 'value'], ['1', '一批']]);
    }
  });
});

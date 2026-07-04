import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { replayTableOperationsV2_ACU } from './storage-frame-v2-replay';
import type { ManualRefillChainBucketV2_ACU, ManualRefillChainFailure_ACU, ManualRefillChainV2_ACU } from './storage-frame-v2-types';

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizeKeys_ACU(keys: string[]): string[] {
  return [...new Set((keys || []).filter(key => typeof key === 'string'))].sort();
}

function keysEqual_ACU(a: string[], b: string[]): boolean {
  const aa = normalizeKeys_ACU(a);
  const bb = normalizeKeys_ACU(b);
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function failure_ACU(code: ManualRefillChainFailure_ACU['code'], message: string, detail?: Record<string, unknown>): ManualRefillChainFailure_ACU {
  return { code, message, ...(detail ? { detail } : {}) };
}

function flattenBuckets_ACU(chain: ManualRefillChainV2_ACU): Array<ManualRefillChainBucketV2_ACU & { chunkIndex: number }> {
  return (chain.chunks || [])
    .flatMap(chunk => (chunk.buckets || []).map(bucket => ({ ...bucket, chunkIndex: chunk.chunkIndex })))
    .sort((a, b) => a.chunkIndex - b.chunkIndex || a.bucketIndex - b.bucketIndex || a.saveTargetIndex - b.saveTargetIndex || a.batchNumber - b.batchNumber);
}

function bucketMinMessageIndex_ACU(bucket: ManualRefillChainBucketV2_ACU): number {
  const values = (bucket.messageIndices || []).filter(index => Number.isFinite(Number(index))).map(Number);
  return values.length > 0 ? Math.min(...values) : bucket.saveTargetIndex;
}

function bucketMaxMessageIndex_ACU(bucket: ManualRefillChainBucketV2_ACU): number {
  const values = (bucket.messageIndices || []).filter(index => Number.isFinite(Number(index))).map(Number);
  return values.length > 0 ? Math.max(...values) : bucket.saveTargetIndex;
}

export function manualRefillChainMatchesRequest_ACU(
  chain: ManualRefillChainV2_ACU,
  selectedSheetKeys: string[],
  contextMessageIndices: number[],
  targetMessageIndex: number,
): { ok: true } | { ok: false; failure: ManualRefillChainFailure_ACU } {
  if (!chain || chain.kind !== 'manual_refill_chain') {
    return { ok: false, failure: failure_ACU('missing_chain', '未找到可用的手动重填操作链。') };
  }
  if (chain.status !== 'complete') {
    return { ok: false, failure: failure_ACU('range_not_covered', '手动重填操作链尚未完成，不能用于新的局部重填恢复。') };
  }
  if (!keysEqual_ACU(chain.selectedSheetKeys || [], selectedSheetKeys || [])) {
    return { ok: false, failure: failure_ACU('selected_sheets_mismatch', '当前选择的表与上次手动重填操作链不一致，无法安全恢复。') };
  }
  if (chain.targetMessageIndex !== targetMessageIndex) {
    return { ok: false, failure: failure_ACU('target_mismatch', '当前重填目标楼层与手动重填操作链不一致，无法恢复。') };
  }
  const requestedStart = contextMessageIndices[0];
  if (!Number.isFinite(Number(requestedStart)) || requestedStart < chain.originalStartMessageIndex) {
    return { ok: false, failure: failure_ACU('range_not_covered', '当前重填范围早于手动重填操作链覆盖范围，无法恢复。') };
  }
  if (contextMessageIndices[contextMessageIndices.length - 1] !== chain.targetMessageIndex) {
    return { ok: false, failure: failure_ACU('range_not_covered', '当前重填范围未延伸到手动重填操作链目标楼层，无法恢复。') };
  }
  return { ok: true };
}

export async function buildManualRefillBaseFromChain_ACU(input: {
  chain: ManualRefillChainV2_ACU;
  requestedStartMessageIndex: number;
  latestState: TableDataObject_ACU;
}): Promise<{
  success: true;
  data: TableDataObject_ACU;
  effectiveStartMessageIndex: number;
} | {
  success: false;
  failure: ManualRefillChainFailure_ACU;
}> {
  const { chain, requestedStartMessageIndex, latestState } = input;
  try {
    const buckets = flattenBuckets_ACU(chain);
    if (buckets.length === 0) {
      return { success: false, failure: failure_ACU('range_not_covered', '手动重填操作链没有可回放批次。') };
    }

    const requestedStart = Number(requestedStartMessageIndex);
    if (!Number.isFinite(requestedStart) || requestedStart < chain.originalStartMessageIndex || requestedStart > chain.targetMessageIndex) {
      return { success: false, failure: failure_ACU('range_not_covered', '请求的重填起点不在手动重填操作链覆盖范围内。') };
    }

    const containingBucket = buckets.find(bucket => bucketMinMessageIndex_ACU(bucket) <= requestedStart && bucketMaxMessageIndex_ACU(bucket) >= requestedStart);
    const effectiveStartMessageIndex = containingBucket ? bucketMinMessageIndex_ACU(containingBucket) : requestedStart;
    const replayBuckets = buckets.filter(bucket => bucketMaxMessageIndex_ACU(bucket) < effectiveStartMessageIndex);
    const workingData = deepClone_ACU(chain.baseCheckpoint || {}) as TableDataObject_ACU;

    for (const bucket of replayBuckets) {
      try {
        await replayTableOperationsV2_ACU(workingData, bucket.operations || []);
      } catch (error: any) {
        return {
          success: false,
          failure: failure_ACU('operation_replay_failed', '无法从上次手动重填操作链恢复指定楼层前状态。', {
            bucketIndex: bucket.bucketIndex,
            message: error?.message || String(error),
          }),
        };
      }
    }

    const selectedSet = new Set(chain.selectedSheetKeys || []);
    for (const [key, value] of Object.entries(latestState || {})) {
      if (key === 'mate' || (key.startsWith('sheet_') && !selectedSet.has(key))) {
        (workingData as any)[key] = deepClone_ACU(value);
      }
    }

    return { success: true, data: workingData, effectiveStartMessageIndex };
  } catch (error: any) {
    return {
      success: false,
      failure: failure_ACU('bucket_replay_failed', '手动重填操作链回放失败。', { message: error?.message || String(error) }),
    };
  }
}

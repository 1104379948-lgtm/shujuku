import type { GroupedRuntimeUpdateGroup_ACU } from './update-orchestrator';
import type { ManualRefillSessionMarkerV2_ACU } from './storage-frame-v2-types';

export function filterCompletedManualRefillGroups_ACU(
  groups: Record<string, { indices: number[]; batchSize: number }>,
  completedSaveTargetIndices: number[],
): void {
  const completed = new Set(completedSaveTargetIndices);
  for (const group of Object.values(groups)) {
    const batchSize = Math.max(1, Number(group.batchSize) || 1);
    const remainingIndices: number[] = [];
    for (let i = 0; i < group.indices.length; i += batchSize) {
      const batch = group.indices.slice(i, i + batchSize);
      const target = batch[batch.length - 1];
      if (!completed.has(target)) remainingIndices.push(...batch);
    }
    group.indices = remainingIndices;
  }
}

export function collectManualRefillSaveTargetsForGroups_ACU(groups: GroupedRuntimeUpdateGroup_ACU[]): number[] {
  const targets = new Set<number>();
  for (const group of groups) {
    const batchSize = Math.max(1, Number(group.batchSize) || 1);
    for (let i = 0; i < group.indices.length; i += batchSize) {
      const batch = group.indices.slice(i, i + batchSize);
      const target = batch[batch.length - 1];
      if (Number.isInteger(target)) targets.add(target);
    }
  }
  return [...targets].sort((a, b) => a - b);
}

export function markManualRefillBatchesCompleted_ACU(
  marker: ManualRefillSessionMarkerV2_ACU,
  saveTargetIndices: number[],
): ManualRefillSessionMarkerV2_ACU {
  return {
    ...marker,
    status: 'cleaned',
    completedSaveTargetIndices: [...new Set([...(marker.completedSaveTargetIndices || []), ...saveTargetIndices])].sort((a, b) => a - b),
    updatedAt: Date.now(),
  };
}

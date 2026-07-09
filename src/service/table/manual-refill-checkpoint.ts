import { rebuildManualRefillCheckpointsReady_ACU, type ManualRefillLogRewriteSession_ACU } from './manual-refill-log-rewrite';
import type { ManualRefillSessionMarkerV2_ACU } from './storage-frame-v2-types';

export async function rebuildReadyDirtyCheckpoints_ACU(
  logSession: ManualRefillLogRewriteSession_ACU,
  marker: ManualRefillSessionMarkerV2_ACU,
): Promise<{ success: boolean; marker: ManualRefillSessionMarkerV2_ACU; rebuilt: number[]; error?: string }> {
  const result = await rebuildManualRefillCheckpointsReady_ACU(
    logSession,
    marker.completedSaveTargetIndices || [],
    marker.plannedSaveTargetIndices || [],
  );
  if (!result.success) return { success: false, marker, rebuilt: result.rebuilt, error: result.error };
  return {
    success: true,
    rebuilt: result.rebuilt,
    marker: {
      ...marker,
      dirtyCheckpointIndices: [...new Set([...(marker.dirtyCheckpointIndices || []), ...logSession.dirtyCheckpoints.map(item => item.messageIndex)])].sort((a, b) => a - b),
      rebuiltCheckpointIndices: [...new Set([...(marker.rebuiltCheckpointIndices || []), ...result.rebuilt])].sort((a, b) => a - b),
      updatedAt: Date.now(),
    },
  };
}

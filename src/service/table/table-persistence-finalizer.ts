import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import { initIsolatedTagSlot_ACU, isLegacyMatchForIsolation_ACU } from '../../data/repositories/chat-message-data-repo';
import { saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { RollupCheckpointBeforePurgeResult_ACU, TableCheckpointV2_ACU, TablePersistenceLayerV2_ACU } from './table-delta-types';
import { getTablePersistenceDeltasV2_ACU } from '../../shared/models/table-persistence-v2-utils';
import { readTablePersistenceLayerV2_ACU, writeTablePersistenceLayerV2_ACU } from './table-delta-repository';
import { reconstructTablesFromChatDeltas_ACU } from './table-delta-reconstruct';
import { ensureChatOpenCheckpoint_ACU } from './table-checkpoint-bootstrap';
import { normalizeTableDataRowIdentity_ACU } from './table-row-identity';
import { logWarn_ACU } from '../../shared/utils';

function cloneJson_ACU<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function hasAnySheet_ACU(data: TableDataObject_ACU | null | undefined): data is TableDataObject_ACU {
  return !!data && Object.keys(data).some(key => key.startsWith('sheet_'));
}

function hasAnySheetKey_ACU(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).some(key => key.startsWith('sheet_'));
}

function hasMeaningfulTagDataAfterTablePurge_ACU(tagData: any): boolean {
  if (!tagData || typeof tagData !== 'object') return false;
  if (hasAnySheetKey_ACU(tagData.independentData)) return true;
  if (tagData.tablePersistenceV2?.checkpoint || getTablePersistenceDeltasV2_ACU(tagData.tablePersistenceV2).length > 0) return true;
  if (Array.isArray(tagData.modifiedKeys) && tagData.modifiedKeys.length > 0) return true;
  if (Array.isArray(tagData.updateGroupKeys) && tagData.updateGroupKeys.length > 0) return true;
  if (Array.isArray(tagData.attemptedUpdateKeys) && tagData.attemptedUpdateKeys.length > 0) return true;
  if (tagData.vectorMemoryState !== undefined) return true;
  if (tagData.summaryVectorIndexState !== undefined) return true;
  if (tagData.summaryVectorIndexManifest !== undefined) return true;
  if (tagData._acu_base_state !== undefined) return true;
  return false;
}

function createRetentionCheckpoint_ACU(
  data: TableDataObject_ACU,
  isolationKey: string,
  boundaryMessageIndex: number,
): TableCheckpointV2_ACU {
  return {
    kind: 'checkpoint',
    version: 2,
    checkpointId: `retention-rollup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    source: 'retention-rollup',
    isolationKey,
    messageIndexHint: boundaryMessageIndex,
    data: cloneJson_ACU(data),
  };
}

function deleteCurrentIsolationTableFields_ACU(msg: any, isolationKey: string): boolean {
  const isolatedData = msg?.TavernDB_ACU_IsolatedData;
  if (!isolatedData || typeof isolatedData !== 'object' || Array.isArray(isolatedData)) return false;
  if (!Object.prototype.hasOwnProperty.call(isolatedData, isolationKey)) return false;

  const nextContainer = cloneJson_ACU(isolatedData);
  const tagData = nextContainer[isolationKey];
  if (!tagData || typeof tagData !== 'object') return false;

  let changed = false;
  if (tagData.tablePersistenceV2 !== undefined) {
    delete tagData.tablePersistenceV2;
    changed = true;
  }
  if (tagData.independentData !== undefined && hasAnySheetKey_ACU(tagData.independentData)) {
    delete tagData.independentData;
    changed = true;
  }
  if (tagData.modifiedKeys !== undefined) {
    delete tagData.modifiedKeys;
    changed = true;
  }
  if (tagData.updateGroupKeys !== undefined) {
    delete tagData.updateGroupKeys;
    changed = true;
  }
  if (tagData.attemptedUpdateKeys !== undefined) {
    delete tagData.attemptedUpdateKeys;
    changed = true;
  }

  if (!changed) return false;

  if (hasMeaningfulTagDataAfterTablePurge_ACU(tagData)) {
    nextContainer[isolationKey] = tagData;
  } else {
    delete nextContainer[isolationKey];
  }

  if (Object.keys(nextContainer).length === 0) {
    delete msg.TavernDB_ACU_IsolatedData;
  } else {
    msg.TavernDB_ACU_IsolatedData = nextContainer;
  }
  return true;
}

function deleteRootLegacyTableFields_ACU(msg: any, isolationConfig: IsolationConfig_ACU): boolean {
  if (!isLegacyMatchForIsolation_ACU(msg, isolationConfig)) return false;
  let changed = false;
  const keysToDelete = [
    'TavernDB_ACU_Data',
    'TavernDB_ACU_SummaryData',
    'TavernDB_ACU_IndependentData',
    'TavernDB_ACU_ModifiedKeys',
    'TavernDB_ACU_UpdateGroupKeys',
    'TavernDB_ACU_AttemptedUpdateKeys',
    'TavernDB_ACU_Identity',
  ];

  for (const key of keysToDelete) {
    if (Object.prototype.hasOwnProperty.call(msg, key)) {
      delete msg[key];
      changed = true;
    }
  }
  return changed;
}

function purgeTableLayerFromMessage_ACU(
  msg: any,
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU,
): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const isolatedChanged = deleteCurrentIsolationTableFields_ACU(msg, isolationKey);
  const rootChanged = deleteRootLegacyTableFields_ACU(msg, isolationConfig);
  return isolatedChanged || rootChanged;
}

function collectDefaultDataMessageIndices_ACU(
  chat: any[],
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU,
): number[] {
  const indices: number[] = [];
  for (let index = 0; index < chat.length; index++) {
    const msg = chat[index];
    if (!msg || msg.is_user) continue;
    const layer = readTablePersistenceLayerV2_ACU(msg, isolationKey);
    const hasV2 = !!(layer?.checkpoint || getTablePersistenceDeltasV2_ACU(layer).length > 0);
    const hasIsolatedLegacy = hasAnySheetKey_ACU(msg?.TavernDB_ACU_IsolatedData?.[isolationKey]?.independentData);
    const hasRootLegacy = isLegacyMatchForIsolation_ACU(msg, isolationConfig)
      && (hasAnySheetKey_ACU(msg?.TavernDB_ACU_IndependentData)
        || hasAnySheetKey_ACU(msg?.TavernDB_ACU_Data)
        || hasAnySheetKey_ACU(msg?.TavernDB_ACU_SummaryData));
    if (hasV2 || hasIsolatedLegacy || hasRootLegacy) indices.push(index);
  }
  return indices;
}

function normalizeRetainCount_ACU(retainRecentLayers: number | null | undefined): number {
  if (!Number.isFinite(retainRecentLayers)) return 0;
  return Math.max(0, Math.trunc(Number(retainRecentLayers)));
}

export interface FinalizeTablePersistenceAfterUpdateOptions_ACU {
  chat: any[];
  isolationKey: string;
  isolationConfig: IsolationConfig_ACU;
  retainRecentLayers?: number | null;
  dataMessageIndices?: number[];
  templateSheetKeys?: string[];
  save?: boolean;
}

export interface FinalizeTablePersistenceAfterUpdateResult_ACU extends RollupCheckpointBeforePurgeResult_ACU {
  reconstructedData: TableDataObject_ACU | null;
  bootstrapChanged: boolean;
  reconstructChanged: boolean;
}

export async function finalizeTablePersistenceAfterUpdate_ACU(
  options: FinalizeTablePersistenceAfterUpdateOptions_ACU,
): Promise<FinalizeTablePersistenceAfterUpdateResult_ACU> {
  const chat = options.chat;
  if (!Array.isArray(chat) || chat.length === 0) {
    return {
      changed: false,
      purgedMessageIndices: [],
      reconstructedData: null,
      bootstrapChanged: false,
      reconstructChanged: false,
    };
  }

  let changed = false;
  const bootstrapResult = await ensureChatOpenCheckpoint_ACU({
    chat,
    isolationKey: options.isolationKey,
    isolationConfig: options.isolationConfig,
    templateSheetKeys: options.templateSheetKeys,
    retainRecentLayers: options.retainRecentLayers ?? undefined,
    save: false,
  });
  if (bootstrapResult.changed) changed = true;

  const reconstructResult = reconstructTablesFromChatDeltas_ACU(chat, {
    isolationKey: options.isolationKey,
    isolationConfig: options.isolationConfig,
    templateSheetKeys: options.templateSheetKeys,
  }, {
    allowLegacyMigration: false,
    saveChatAfterMigration: false,
    retainRecentLayers: options.retainRecentLayers ?? undefined,
  });
  if (reconstructResult.changed) changed = true;

  const reconstructedData = normalizeTableDataRowIdentity_ACU(reconstructResult.data, {
    sourceLabel: 'finalizeTablePersistenceAfterUpdate.reconstruct',
  });

  const retainCount = normalizeRetainCount_ACU(options.retainRecentLayers);
  const dataMessageIndices = Array.isArray(options.dataMessageIndices)
    ? options.dataMessageIndices.filter(index => Number.isInteger(index) && index >= 0 && index < chat.length && !chat[index]?.is_user)
    : collectDefaultDataMessageIndices_ACU(chat, options.isolationKey, options.isolationConfig);

  let boundaryMessageIndex: number | undefined;
  let checkpointId: string | undefined;
  let purgedMessageIndices: number[] = [];

  if (retainCount > 0 && dataMessageIndices.length > retainCount) {
    const sortedIndices = Array.from(new Set(dataMessageIndices)).sort((a, b) => a - b);
    const cutoffIndex = sortedIndices.length - retainCount;
    purgedMessageIndices = sortedIndices.slice(0, cutoffIndex);
    boundaryMessageIndex = sortedIndices[cutoffIndex];
    const boundaryMessage = chat[boundaryMessageIndex];

    if (!boundaryMessage || boundaryMessage.is_user) {
      logWarn_ACU('[TablePersistenceFinalizer] Boundary message is not writable, skip checkpoint rollup.', boundaryMessageIndex);
    } else {
      const boundaryReconstruct = reconstructTablesFromChatDeltas_ACU(chat, {
        isolationKey: options.isolationKey,
        isolationConfig: options.isolationConfig,
        templateSheetKeys: options.templateSheetKeys,
      }, {
        targetMessageIndexExclusive: boundaryMessageIndex,
        allowLegacyMigration: false,
        saveChatAfterMigration: false,
        retainRecentLayers: retainCount,
      });
      if (boundaryReconstruct.changed) changed = true;

      const boundaryData = normalizeTableDataRowIdentity_ACU(boundaryReconstruct.data, {
        sourceLabel: 'finalizeTablePersistenceAfterUpdate.boundary',
      });
      let wroteBoundaryCheckpoint = false;
      if (hasAnySheet_ACU(boundaryData)) {
        const existingLayer = readTablePersistenceLayerV2_ACU(boundaryMessage, options.isolationKey);
        const checkpoint = createRetentionCheckpoint_ACU(boundaryData, options.isolationKey, boundaryMessageIndex);
        const nextLayer: TablePersistenceLayerV2_ACU = {
          version: 2,
          checkpoint,
        };
        const existingDeltas = getTablePersistenceDeltasV2_ACU(existingLayer);
        if (existingDeltas.length > 0) {
          nextLayer.deltas = existingDeltas.map(delta => cloneJson_ACU(delta));
          nextLayer.delta = cloneJson_ACU(existingDeltas[existingDeltas.length - 1]);
        }
        initIsolatedTagSlot_ACU(boundaryMessage, options.isolationKey);
        writeTablePersistenceLayerV2_ACU(boundaryMessage, options.isolationKey, nextLayer);
        checkpointId = checkpoint.checkpointId;
        changed = true;
        wroteBoundaryCheckpoint = true;
      }
      if (wroteBoundaryCheckpoint) {
        for (const messageIndex of purgedMessageIndices) {
          const msg = chat[messageIndex];
          if (purgeTableLayerFromMessage_ACU(msg, options.isolationKey, options.isolationConfig)) {
            changed = true;
          }
        }
      } else {
        purgedMessageIndices = [];
      }
    }
  }

  if (changed && options.save !== false) {
    await saveChatToHost_ACU();
  }

  return {
    changed,
    boundaryMessageIndex,
    checkpointId,
    purgedMessageIndices,
    reconstructedData,
    bootstrapChanged: bootstrapResult.changed,
    reconstructChanged: reconstructResult.changed,
  };
}

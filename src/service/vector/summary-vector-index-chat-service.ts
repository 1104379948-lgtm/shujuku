import { cloneIsolatedData_ACU, readIsolatedTagData_ACU, writeIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import {
    clearSummaryVectorFlushTasksByScope_ACU,
    deleteSummaryVectorHotCacheByScope_ACU,
} from '../../data/storage/vector-index-hot-cache';
import {
    buildLegacyVectorIndexSingleSnapshotFilePath_ACU,
    buildVectorIndexSingleSnapshotFilePath_ACU,
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
    loadVectorIndexRegistry_ACU,
    readVectorIndexJsonFile_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import { getCurrentCharacterCardName_ACU } from '../../shared/template-preset-utils';
import { isSummaryOrOutlineTable_ACU, logWarn_ACU } from '../../shared/utils';
import { getChatArray_ACU, saveChatToHost_ACU, saveChatToHostStrict_ACU } from '../chat/chat-service';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
    assignSummaryVectorIndexStateToTagData_ACU,
    getAggregatedSummaryVectorIndexSnapshot_ACU,
} from './summary-vector-index-state-service';
import {
    cleanupUnreachableSummaryVectorIndexFiles_ACU,
    validateSingleFileSnapshotIdentity_ACU,
    type VectorIndexSingleSnapshotBlob_ACU,
} from './summary-vector-index-storage-service';

function getCurrentSummaryVectorIndexSourceTableKey_ACU(): string {
    const tables = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? currentJsonTableData_ACU
        : null;
    if (!tables) return 'summary';
    return Object.keys(tables).find((key) => {
        const table = tables[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    }) || 'summary';
}

/**
 * 当聊天 tag data 缺少索引指针时，从唯一可证明属于当前 canonical scope 的外部快照恢复。
 *
 * 这是聊天/向量持久化逻辑，不属于任何 UI。V2 只接受 registry 中已 durable-published 的
 * 快照；legacy 格式没有可靠的修订序，只接受唯一可信候选，避免用文件名顺序猜测数据新旧。
 */
function getUniqueSummaryVectorIndexSourceTableKeyForRecovery_ACU(): string {
    const tables = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? currentJsonTableData_ACU
        : null;
    if (!tables) return '';

    const candidates = Object.keys(tables).filter((key) => {
        const table = tables[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    });
    return candidates.length === 1 ? candidates[0] : '';
}

export async function tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU(): Promise<boolean> {
    const chatKey = String(currentChatFileIdentifier_ACU || '').trim();
    const isolationKey = String(getCurrentIsolationKey_ACU() || '').trim();
    const sourceTableKey = getUniqueSummaryVectorIndexSourceTableKeyForRecovery_ACU();
    if (!chatKey || !isolationKey || !sourceTableKey) return false;

    const chatName = getCurrentCharacterCardName_ACU();
    const registeredFiles = await loadVectorIndexRegistry_ACU()
        .then((registry) => Array.isArray(registry.files) ? registry.files : [])
        .catch((error) => {
            logWarn_ACU('[交火模式纪要索引] 自动恢复读取 V2 registry 失败，将继续尝试 legacy 路径:', error);
            return [] as any[];
        });

    const restoreCandidate = async (
        blob: VectorIndexSingleSnapshotBlob_ACU,
        manifest: any,
    ): Promise<boolean> => {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) return false;
        const targetIndex = chat.map((message: any, index: number) => message && !message.is_user ? index : -1)
            .filter((index: number) => index >= 0)
            .pop() ?? -1;
        if (targetIndex < 0) return false;

        const message = chat[targetIndex];
        if (readIsolatedTagData_ACU(message, isolationKey)?.summaryVectorIndexState?.manifest?.indexId) return false;
        const previousIsolatedData = {
            exists: Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_IsolatedData'),
            value: message.TavernDB_ACU_IsolatedData,
        };
        const nextIsolatedData = cloneIsolatedData_ACU(message);
        const tagData = nextIsolatedData[isolationKey] || { independentData: {}, modifiedKeys: {}, updateGroupKeys: {} } as any;
        const rows = Array.isArray(blob.rows) ? blob.rows : [];
        const chunks = Array.isArray(blob.chunks) ? blob.chunks : [];
        assignSummaryVectorIndexStateToTagData_ACU(tagData, {
            manifest,
            rows,
            chunks,
            rowCount: rows.filter((row: any) => row.status !== 'removed').length,
            chunkCount: chunks.length,
            snapshotMessageId: String(manifest.snapshotMessageId || message.mesId || ''),
            sourceTableKey: String(manifest.sourceTableKey || sourceTableKey),
            sourceTableName: String(manifest.sourceTableName || sourceTableKey),
            indexedAt: String(manifest.indexedAt || new Date().toISOString()),
            skippedRowCount: 0,
        } as any);
        try {
            message.TavernDB_ACU_IsolatedData = nextIsolatedData;
            writeIsolatedTagData_ACU(message, isolationKey, tagData);
            await saveChatToHostStrict_ACU();
            return true;
        } catch (error) {
            if (previousIsolatedData.exists) message.TavernDB_ACU_IsolatedData = previousIsolatedData.value;
            else delete message.TavernDB_ACU_IsolatedData;
            logWarn_ACU('[交火模式纪要索引] 自动恢复持久化失败，已回滚写前 state:', error);
            return false;
        }
    };

    const v2PathPrefix = `TavernDB_ACU_vector_v2_${buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ chatKey, isolationKey, sourceTableKey })}_`;
    const v2Candidates: Array<{ path: string; blob: VectorIndexSingleSnapshotBlob_ACU; manifest: any; revision: number }> = [];
    for (const file of registeredFiles) {
        const path = String(file?.path || '').trim();
        if (!path.startsWith(v2PathPrefix) || file?.publicationState !== 'published') continue;
        try {
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
            const blob = loaded.data;
            const manifest = blob?.manifest;
            if (!loaded.ok || !blob || blob.schema !== 'single_file_snapshot' || !manifest?.indexId || manifest.status !== 'ready') continue;
            if (String(manifest.chatKey || '') !== chatKey || String(manifest.isolationKey || '') !== isolationKey || String(manifest.sourceTableKey || '') !== sourceTableKey) continue;
            validateSingleFileSnapshotIdentity_ACU(manifest, blob, path);
            const revision = Number(manifest.storageIdentity?.revision ?? manifest.snapshot?.revision);
            if (Number.isInteger(revision) && revision >= 1) v2Candidates.push({ path, blob, manifest, revision });
        } catch { /* 单个 registry 对象不可信时继续审阅同 scope 的其他 published 候选。 */ }
    }
    if (v2Candidates.length > 0) {
        const newestRevision = Math.max(...v2Candidates.map((candidate) => candidate.revision));
        const newestCandidates = v2Candidates.filter((candidate) => candidate.revision === newestRevision);
        if (newestCandidates.length !== 1) {
            logWarn_ACU('[交火模式纪要索引] 自动恢复拒绝同 scope 同 revision 的多个 published V2 候选:', {
                scope: v2PathPrefix, revision: newestRevision, paths: newestCandidates.map((candidate) => candidate.path),
            });
            return false;
        }
        return restoreCandidate(newestCandidates[0].blob, newestCandidates[0].manifest);
    }

    const legacyPaths = new Set([
        buildVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey, chatName }),
        buildVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey }),
        buildLegacyVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey }),
    ]);
    const legacyCandidates: Array<{ path: string; blob: VectorIndexSingleSnapshotBlob_ACU; manifest: any }> = [];
    for (const path of legacyPaths) {
        try {
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
            const blob = loaded.data;
            const manifest = blob?.manifest;
            if (!loaded.ok || !blob || blob.schema !== 'single_file_snapshot' || !manifest?.indexId || manifest.status !== 'ready') continue;
            if (String(manifest.chatKey || '') !== chatKey || String(manifest.isolationKey || '') !== isolationKey || String(manifest.sourceTableKey || '') !== sourceTableKey) continue;
            validateSingleFileSnapshotIdentity_ACU(manifest, blob, path);
            legacyCandidates.push({ path, blob, manifest });
        } catch { /* 当前候选不可信，继续同 scope 的下一个候选。 */ }
    }
    if (legacyCandidates.length !== 1) {
        if (legacyCandidates.length > 1) {
            logWarn_ACU('[交火模式纪要索引] 自动恢复拒绝多个可信 legacy 快照候选:', {
                paths: legacyCandidates.map((candidate) => candidate.path),
            });
        }
        return false;
    }
    return restoreCandidate(legacyCandidates[0].blob, legacyCandidates[0].manifest);
}

export async function clearSummaryVectorIndexLayerFromChat_ACU(params: {
    messageIndex: number;
    isolationKey: string;
    indexId: string;
}): Promise<boolean> {
    const chat = getChatArray_ACU();
    const message = Array.isArray(chat) ? chat[params.messageIndex] : null;
    if (!message || message.is_user) return false;

    const nextIsolatedData = cloneIsolatedData_ACU(message);
    const tagData = nextIsolatedData[params.isolationKey];
    if (!tagData || typeof tagData !== 'object') return false;
    const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
    if (!manifest || String(manifest.indexId || '') !== String(params.indexId || '')) return false;

    const previousIsolatedData = {
        exists: Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_IsolatedData'),
        value: message.TavernDB_ACU_IsolatedData,
    };
    assignSummaryVectorIndexStateToTagData_ACU(tagData, null);
    try {
        message.TavernDB_ACU_IsolatedData = nextIsolatedData;
        writeIsolatedTagData_ACU(message, params.isolationKey, tagData);
        await saveChatToHostStrict_ACU();
        return true;
    } catch (error) {
        if (previousIsolatedData.exists) message.TavernDB_ACU_IsolatedData = previousIsolatedData.value;
        else delete message.TavernDB_ACU_IsolatedData;
        throw error;
    }
}

export async function deleteCurrentSummaryVectorIndexFromChat_ACU(): Promise<boolean> {
    const snapshot = getAggregatedSummaryVectorIndexSnapshot_ACU();
    const chat = getChatArray_ACU();
    const scopeHints = new Map<string, { chatKey?: string; isolationKey: string; sourceTableKey: string }>();
    let changed = false;

    if (snapshot?.layers?.length) {
        for (const layer of snapshot.layers) {
            const message = chat[layer.messageIndex];
            if (!message || message.is_user) continue;
            const tagData = readIsolatedTagData_ACU(message, layer.isolationKey);
            if (!tagData) continue;
            const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
            if (manifest) {
                const hint = {
                    chatKey: manifest.chatKey || currentChatFileIdentifier_ACU,
                    isolationKey: manifest.isolationKey || layer.isolationKey,
                    sourceTableKey: manifest.sourceTableKey || getCurrentSummaryVectorIndexSourceTableKey_ACU(),
                };
                scopeHints.set(`${hint.chatKey || ''}\n${hint.isolationKey}\n${hint.sourceTableKey}`, hint);
            }
            assignSummaryVectorIndexStateToTagData_ACU(tagData, null);
            writeIsolatedTagData_ACU(message, layer.isolationKey, tagData);
            changed = true;
        }
    }

    if (changed) {
        await saveChatToHost_ACU();
    }

    const scopeHintList = Array.from(scopeHints.values());
    for (const hint of scopeHintList) {
        await deleteSummaryVectorHotCacheByScope_ACU(hint);
        await clearSummaryVectorFlushTasksByScope_ACU(hint);
    }
    const gcResult = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: scopeHintList });
    return changed || gcResult.deletedPaths.length > 0 || gcResult.failedDeletes.length > 0;
}

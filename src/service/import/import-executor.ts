/**
 * service/import/import-executor.ts — 外部导入核心业务逻辑
 * 从 presentation/triggers/import-process.ts 的 processImportedTxtAsUpdates_ACU 中提取
 * 
 * 只负责「初始化/恢复导入数据库」和「最终注入+清理」，不涉及 UI（toast/按钮状态）。
 */

import { STORAGE_KEY_IMPORTED_ENTRIES_ACU, STORAGE_KEY_IMPORTED_STATUS_ACU, STORAGE_KEY_IMPORTED_STATUS_FULL_ACU, STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU, STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU } from '../../shared/data-constants';
import { importTempGet_ACU, importTempRemove_ACU, importTempSet_ACU } from '../../shared/idb-import-temp';
import { currentJsonTableData_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { loadImportedJsonDataFromLorebook_ACU, saveImportedJsonDataToLorebook_ACU, deleteImportedJsonDataFromLorebook_ACU, getLorebookEntries_ACU, deleteLorebookEntries_ACU } from '../worldbook/worldbook-service';
import { updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { getSortedSheetKeys_ACU } from '../template/chat-scope';
import { getIsolationPrefix_ACU } from '../worldbook/injection-engine';
import { logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { saveSettings_ACU } from '../settings/settings-service';

export interface ImportStatus {
    total: number;
    currentIndex: number;
    selectionSig: string;
}

export interface ImportInitResult {
    success: boolean;
    error?: string;
    allChunks?: any[];
    status?: ImportStatus;
    importTarget?: string;
    selectedSheetKeys?: string[];
    modeSuffix?: string;
}

/**
 * 初始化或恢复导入数据库
 * 
 * @param importTarget - 导入目标世界书名称
 * @param selectedSheetKeys - 选中的表格 key 列表
 * @param allChunks - 所有分块数据
 * @param selectionSig - 选择签名（用于断点续行校验）
 * @returns ImportInitResult
 */
export async function initImportDatabase_ACU(
    importTarget: string,
    selectedSheetKeys: string[] | null,
    allChunks: any[],
    selectionSig: string
): Promise<ImportInitResult> {
    const modeSuffix = '-Selected';
    const statusStorageKey = STORAGE_KEY_IMPORTED_STATUS_ACU;

    let status: ImportStatus = { total: allChunks.length, currentIndex: 0, selectionSig };
    const savedStatusJson = await importTempGet_ACU(statusStorageKey);
    if (savedStatusJson) {
        try {
            const savedStatus = JSON.parse(savedStatusJson);
            if (savedStatus.total === allChunks.length && (typeof savedStatus.selectionSig === 'undefined' || savedStatus.selectionSig === selectionSig)) {
                status = { ...savedStatus, selectionSig };
            }
        } catch(e) { /* use default */ }
    }

    if (status.currentIndex === 0) {
        // 全新导入：重置内存数据库为模板初始状态
        logDebug_ACU(`Starting fresh import (selected tables), resetting in-memory database from template.`);
        try {
            _set_currentJsonTableData_ACU(parseTableTemplateJson_ACU({ stripSeedRows: true }));
        } catch(e) {
            logError_ACU("Failed to parse table template for import.", e);
            return { success: false, error: '无法为导入解析数据库模板。' };
        }
        if (!currentJsonTableData_ACU) {
            return { success: false, error: '无法为导入解析数据库模板。' };
        }
        try {
            await saveImportedJsonDataToLorebook_ACU(importTarget, currentJsonTableData_ACU, modeSuffix);
        } catch (e) {
            logError_ACU('[外部导入] Failed to initialize ImportedJsonData source entry from template.', e);
            return { success: false, error: '无法初始化外部导入的临时数据库条目。' };
        }
    } else {
        // 断点续行：从世界书恢复数据
        let restoredImportData = null;
        try {
            restoredImportData = await loadImportedJsonDataFromLorebook_ACU(importTarget, modeSuffix);
        } catch (e) {
            logError_ACU('[外部导入] Failed to load ImportedJsonData source entry for resume.', e);
        }

        if (restoredImportData && typeof restoredImportData === 'object') {
            _set_currentJsonTableData_ACU(restoredImportData);
            logDebug_ACU(`[外部导入] Resumed import from ImportedJsonData source entry. currentIndex=${status.currentIndex}`);
        } else if (currentJsonTableData_ACU) {
            logWarn_ACU('[外部导入] ImportedJsonData source entry missing during resume, falling back to in-memory data.');
        } else {
            return { success: false, error: '无法继续导入：未找到临时数据库条目，请重新开始导入。' };
        }
    }

    return { success: true, allChunks, status, importTarget, selectedSheetKeys: selectedSheetKeys || undefined, modeSuffix };
}

/**
 * 保存分块处理的中间状态
 */
export async function saveChunkProgress_ACU(
    importTarget: string,
    modeSuffix: string,
    status: ImportStatus,
    chunkIndex: number
): Promise<boolean> {
    try {
        await saveImportedJsonDataToLorebook_ACU(importTarget, currentJsonTableData_ACU, modeSuffix);
    } catch (e) {
        logError_ACU(`[外部导入] Failed to persist ImportedJsonData after chunk ${chunkIndex + 1}.`, e);
        return false;
    }

    status.currentIndex = chunkIndex + 1;
    await importTempSet_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU, JSON.stringify(status));
    return true;
}

/**
 * 最终注入 + 清理：将导入数据注入世界书，清理旧条目和本地缓存
 * 
 * @param importTarget - 导入目标世界书名称
 * @param selectedSheetKeys - 选中的表格 key 列表
 * @param modeSuffix - 模式后缀
 * @param allChunksCount - 总分块数
 */
export async function finalizeImportAndCleanup_ACU(
    importTarget: string,
    selectedSheetKeys: string[] | null,
    modeSuffix: string,
    allChunksCount: number
): Promise<{ success: boolean; error?: string; cleanedCount?: number }> {
    // 1. 从目标世界书重载最终数据
    let finalImportSourceData = currentJsonTableData_ACU;
    try {
        const persistedFinalData = await loadImportedJsonDataFromLorebook_ACU(importTarget, modeSuffix);
        if (persistedFinalData && typeof persistedFinalData === 'object') {
            finalImportSourceData = persistedFinalData;
            _set_currentJsonTableData_ACU(persistedFinalData);
            logDebug_ACU('[外部导入] Reloaded final import data from ImportedJsonData source entry before worldbook creation.');
        }
    } catch (e) {
        logWarn_ACU('[外部导入] Failed to reload ImportedJsonData source entry before final worldbook creation, falling back to in-memory data:', e);
    }

    // 2. 按选中表格筛选最终数据
    let finalDataForInjection = JSON.parse(JSON.stringify(finalImportSourceData));
    if (selectedSheetKeys && Array.isArray(selectedSheetKeys) && selectedSheetKeys.length > 0) {
        const tableKeys = getSortedSheetKeys_ACU(finalDataForInjection);
        tableKeys.forEach(sheetKey => {
            if (!selectedSheetKeys.includes(sheetKey)) delete finalDataForInjection[sheetKey];
        });
    }

    // 3. 注入世界书
    const originalData = currentJsonTableData_ACU;
    _set_currentJsonTableData_ACU(finalDataForInjection);
    await updateReadableLorebookEntry_ACU(true, true, importTarget);
    _set_currentJsonTableData_ACU(originalData);
    logDebug_ACU('[外部导入] Final worldbook entries created from ImportedJsonData source entry.');

    // 4. 删除临时数据源条目
    try {
        const deleted = await deleteImportedJsonDataFromLorebook_ACU(importTarget, modeSuffix);
        if (deleted) {
            logDebug_ACU('[外部导入] Deleted ImportedJsonData source entry to detach from worldbook.');
        }
    } catch (e) {
        logWarn_ACU('[外部导入] Failed to delete ImportedJsonData source entry:', e);
    }

    // 5. 清理旧条目
    let cleanedCount = 0;
    try {
        const IMPORT_PREFIX = '外部导入-';
        const isoPrefix = getIsolationPrefix_ACU();
        const allTargetEntries = await getLorebookEntries_ACU(importTarget);

        const templateEntryNames: string[] = [];
        const templateTableNames: string[] = [];
        if (finalDataForInjection) {
            const sheetKeys = getSortedSheetKeys_ACU(finalDataForInjection);
            sheetKeys.forEach(sheetKey => {
                const sheet = finalDataForInjection[sheetKey];
                if (sheet?.exportConfig?.enabled) {
                    if (sheet?.exportConfig?.entryName) {
                        templateEntryNames.push(sheet.exportConfig.entryName);
                    }
                    if (sheet?.name) {
                        templateTableNames.push(sheet.name);
                    }
                }
            });
        }

        const oldEntryBasePrefixes = [
            'TavernDB-ACU-ReadableDataTable',
            'TavernDB-ACU-WrapperStart',
            'TavernDB-ACU-WrapperEnd',
            'TavernDB-ACU-MemoryStart',
            'TavernDB-ACU-MemoryEnd',
            'TavernDB-ACU-PersonsHeader',
            'TavernDB-ACU-OutlineTable',
            'TavernDB-ACU-CustomExport-',
            'TavernDB-ACU-ImportantPersonsIndex',
            '总结条目',
            '小总结条目',
            '故事大纲',
            '大纲表',
            '重要人物条目',
            '纪要索引',
        ];
        const allOldPrefixes = [
            ...oldEntryBasePrefixes,
            ...templateEntryNames,
            ...templateTableNames
        ];

        const entriesToDelete = allTargetEntries.filter(entry => {
            const comment = entry.comment || '';
            const normalizedComment = comment.replace(/^ACU-\[[^\]]+\]-/, '');
            if (normalizedComment.startsWith(IMPORT_PREFIX)) return false;
            return allOldPrefixes.some(prefix => normalizedComment.startsWith(prefix));
        });

        if (entriesToDelete.length > 0) {
            const uidsToDelete = entriesToDelete.map(e => e.uid);
            await deleteLorebookEntries_ACU(importTarget, uidsToDelete);
            cleanedCount = uidsToDelete.length;
            logDebug_ACU(`[外部导入] Cleaned up ${uidsToDelete.length} old entries (non-import prefixed) from target worldbook.`);
        }
    } catch (e) {
        logWarn_ACU('[外部导入] Failed to clean old entries from target worldbook:', e);
    }

    // 6. 清理本地缓存
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_FULL_ACU);
    logDebug_ACU('[外部导入] Cleared temp storage entries + status after import completion.');

    // 7. 清空导入目标设置
    settings_ACU.importWorldbookTarget = '';
    saveSettings_ACU();

    // 8. 清除内存数据
    _set_currentJsonTableData_ACU(null);
    logDebug_ACU('Cleared in-memory database data after import completion.');

    return { success: true, cleanedCount };
}

/**
 * 清除导入条目的核心逻辑（世界书条目查找/删除 + 本地缓存清理）
 * 纯业务逻辑，不涉及 UI
 * @param targetLorebook - 目标世界书名称
 * @returns { deletedCount: number; localCleared: boolean }
 */
export async function clearImportedEntriesCore_ACU(
    targetLorebook: string
): Promise<{ deletedCount: number; localCleared: boolean }> {
    const allEntries = await getLorebookEntries_ACU(targetLorebook);

    const prefixesToDelete = [
        '外部导入-',
        'TavernDB-ACU-ImportedJsonData',
        'TavernDB-ACU-ImportedTxt-',
    ];

    const uidsToDelete = allEntries
        .filter(entry => entry.comment && prefixesToDelete.some(prefix => entry.comment.startsWith(prefix)))
        .map(entry => entry.uid);

    if (uidsToDelete.length > 0) {
        await deleteLorebookEntries_ACU(targetLorebook, uidsToDelete);
        logDebug_ACU(`Successfully deleted ${uidsToDelete.length} imported txt entries.`);
    }

    // 清除本地存储
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU);
    await importTempRemove_ACU(STORAGE_KEY_IMPORTED_STATUS_FULL_ACU);
    logDebug_ACU('[外部导入] Cleared imported txt entries and status from temp storage (IndexedDB preferred).');

    return { deletedCount: uidsToDelete.length, localCleared: true };
}

/**
 * 按隔离标识删除导入注入条目的核心逻辑
 * 纯业务逻辑，不涉及 UI
 * @param targetLorebook - 目标世界书名称
 * @returns 删除的条目数量
 */
export async function deleteImportedEntriesCore_ACU(
    targetLorebook: string
): Promise<number> {
    const allEntries = await getLorebookEntries_ACU(targetLorebook);

    const IMPORT_PREFIX = '外部导入-';
    const isoPrefix = getIsolationPrefix_ACU();

    const uidsToDelete = allEntries
        .filter(entry => {
            if (!entry.comment) return false;

            if (settings_ACU.dataIsolationEnabled) {
                return entry.comment.startsWith(isoPrefix + IMPORT_PREFIX);
            } else {
                if (entry.comment.startsWith('ACU-[')) return false;
                return entry.comment.startsWith(IMPORT_PREFIX);
            }
        })
        .map(entry => entry.uid);

    if (uidsToDelete.length > 0) {
        await deleteLorebookEntries_ACU(targetLorebook, uidsToDelete);
        logDebug_ACU(`Successfully deleted ${uidsToDelete.length} imported entries from ${targetLorebook} (Isolation: ${settings_ACU.dataIsolationEnabled}).`);
    }

    return uidsToDelete.length;
}

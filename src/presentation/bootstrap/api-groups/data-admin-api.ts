/**
 * presentation/bootstrap/api-groups/data-admin-api.ts
 * 数据管理与导入 API — 模板导入导出 + TXT导入链路 + 合并总结
 */

import { logError_ACU } from '../../../shared/utils';
import { exportCurrentJsonData_ACU, exportTableTemplate_ACU, importTableTemplate_ACU, migrateLegacySummaryVectorIndex_ACU, overrideLatestLayerWithTemplate_ACU, resetAllToDefaults_ACU, resetTableTemplate_ACU } from '../../triggers/data-admin-ui';
import { importCombinedSettings_ACU } from '../../triggers/admin-ui';
import { exportCombinedSettings_ACU, handleManualMergeSummary_ACU } from '../../triggers/update-trigger';
import { clearImportLocalStorage_ACU, clearImportedEntries_ACU, deleteImportedEntries_ACU, handleInjectImportedTxtSelected_ACU } from '../../triggers/import-process';
import { handleTxtImportAndSplit_ACU, handleInjectSplitEntriesFull_ACU, handleInjectSplitEntriesStandard_ACU, handleInjectSplitEntriesSummary_ACU } from '../../components/import-status-ui';
import { openNewVisualizer_ACU } from '../../pages/visualizer';
import type { ApiGroupContext } from './callback-api';
import { importTxtTextAndSplitCore_ACU, injectImportedSelectedCore_ACU, type ImportTxtTextAndSplitOptions_ACU, type InjectImportedSelectedOptions_ACU } from '../../../service/import/import-executor';

export function createDataAdminApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 模板/数据管理
        importTemplate: async function(options: any = {}) { try { return await importTableTemplate_ACU(options); } catch (e) { logError_ACU('importTemplate failed:', e); return false; } },
        exportTemplate: async function(options: any = {}) { try { return await exportTableTemplate_ACU(options); } catch (e) { logError_ACU('exportTemplate failed:', e); return false; } },
        resetTemplate: async function(options: any = {}) { try { return await resetTableTemplate_ACU(options); } catch (e) { logError_ACU('resetTemplate failed:', e); return false; } },
        resetAllDefaults: async function() { try { return await resetAllToDefaults_ACU(); } catch (e) { logError_ACU('resetAllDefaults failed:', e); return false; } },
        exportJsonData: async function() { try { return await exportCurrentJsonData_ACU(); } catch (e) { logError_ACU('exportJsonData failed:', e); return false; } },
        importCombinedSettings: async function() { try { return await importCombinedSettings_ACU(); } catch (e) { logError_ACU('importCombinedSettings failed:', e); return false; } },
        exportCombinedSettings: async function() { try { return await exportCombinedSettings_ACU(); } catch (e) { logError_ACU('exportCombinedSettings failed:', e); return false; } },
        overrideWithTemplate: async function() { try { return await overrideLatestLayerWithTemplate_ACU(); } catch (e) { logError_ACU('overrideWithTemplate failed:', e); return false; } },
        migrateLegacyVectorIndex: async function() { try { return await migrateLegacySummaryVectorIndex_ACU(); } catch (e) { logError_ACU('migrateLegacyVectorIndex failed:', e); return false; } },
        openVisualizer: async function() { try { return await openNewVisualizer_ACU(); } catch (e) { logError_ACU('openVisualizer failed:', e); return false; } },

        // 导入TXT链路
        importTxtAndSplit: async function() { try { return await handleTxtImportAndSplit_ACU(); } catch (e) { logError_ACU('importTxtAndSplit failed:', e); return false; } },
        importTxtTextAndSplit: async function(text: string, options: ImportTxtTextAndSplitOptions_ACU = {}) { try { return await importTxtTextAndSplitCore_ACU(text, options); } catch (e: any) { logError_ACU('importTxtTextAndSplit failed:', e); return { success: false, error: e?.message || '导入 TXT 文本失败。' }; } },
        injectImportedSelected: async function(options?: InjectImportedSelectedOptions_ACU) { try { return options?.targetWorldbook ? await injectImportedSelectedCore_ACU(options) : await handleInjectImportedTxtSelected_ACU(options || {}); } catch (e: any) { logError_ACU('injectImportedSelected failed:', e); return { success: false, error: e?.message || '注入导入文本失败。' }; } },
        injectImportedStandard: async function() { try { return await handleInjectSplitEntriesStandard_ACU(); } catch (e) { logError_ACU('injectImportedStandard failed:', e); return false; } },
        injectImportedSummary: async function() { try { return await handleInjectSplitEntriesSummary_ACU(); } catch (e) { logError_ACU('injectImportedSummary failed:', e); return false; } },
        injectImportedFull: async function() { try { return await handleInjectSplitEntriesFull_ACU(); } catch (e) { logError_ACU('injectImportedFull failed:', e); return false; } },
        deleteImportedEntries: async function() { try { return await deleteImportedEntries_ACU(); } catch (e) { logError_ACU('deleteImportedEntries failed:', e); return false; } },
        clearImportedEntries: async function(clearAll = true) { try { return await clearImportedEntries_ACU(!!clearAll); } catch (e) { logError_ACU('clearImportedEntries failed:', e); return false; } },
        clearImportCache: async function(clearAll = true) { try { return await clearImportLocalStorage_ACU(!!clearAll); } catch (e) { logError_ACU('clearImportCache failed:', e); return false; } },

        // 合并总结
        mergeSummaryNow: async function() { try { return await handleManualMergeSummary_ACU(); } catch (e) { logError_ACU('mergeSummaryNow failed:', e); return false; } },
    };
}

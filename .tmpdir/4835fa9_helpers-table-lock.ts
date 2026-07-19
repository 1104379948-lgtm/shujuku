/**
 * service/runtime/helpers-table-lock.ts — 表格锁定与索引
 * 从 helpers-remaining.ts 拆出
 */
import { settings_ACU, currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from './state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';

export type TableLockDraft_ACU = {
    rows?: Iterable<number> | number[];
    cols?: Iterable<number> | number[];
    cells?: Iterable<string> | string[];
    specialIndexLocked?: boolean;
};

export type CurrentTableLocksSnapshot_ACU = {
    scopeKey: string;
    hasTableLocks: boolean;
    tableLocks: Record<string, any> | null;
    hasSpecialIndexLocks: boolean;
    specialIndexLocks: Record<string, boolean> | null;
};

export type TableLocksBatchCommitResult_ACU = {
    success: boolean;
    changed: boolean;
    snapshot: CurrentTableLocksSnapshot_ACU;
    warning: string;
};

function cloneTableLockValue_ACU<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getSettingsSaveWarning_ACU(result: ReturnType<typeof saveSettings_ACU>): string {
    return result?.warning || result?.error || '';
}

  function getTableLockScopeKey_ACU() {
      const chatKey = (currentChatFileIdentifier_ACU || 'default').trim() || 'default';
      const isolationKey = getCurrentIsolationKey_ACU() || '';
      return `${chatKey}::${isolationKey}`;
  }

  function ensureTableLockStore_ACU() {
      if (!settings_ACU.tableUpdateLocks || typeof settings_ACU.tableUpdateLocks !== 'object') {
          settings_ACU.tableUpdateLocks = {};
      }
      if (!settings_ACU.specialIndexLocks || typeof settings_ACU.specialIndexLocks !== 'object') {
          settings_ACU.specialIndexLocks = {};
      }
  }

  export function getTableLocksForSheet_ACU(sheetKey: string) {
      const scopeKey = getTableLockScopeKey_ACU();
      const bucket = settings_ACU?.tableUpdateLocks?.[scopeKey]?.[sheetKey] || {};
      return {
          rows: new Set(Array.isArray(bucket.rows) ? bucket.rows : []),
          cols: new Set(Array.isArray(bucket.cols) ? bucket.cols : []),
          cells: new Set(Array.isArray(bucket.cells) ? bucket.cells : []),
      };
  }

  export function saveTableLocksForSheet_ACU(sheetKey: string, lockState: any) {
      if (!sheetKey) return;
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      if (!settings_ACU.tableUpdateLocks[scopeKey]) settings_ACU.tableUpdateLocks[scopeKey] = {};
      settings_ACU.tableUpdateLocks[scopeKey][sheetKey] = {
          rows: Array.from(lockState.rows || []),
          cols: Array.from(lockState.cols || []),
          cells: Array.from(lockState.cells || []),
      };
      saveSettings_ACU();
  }

  export function toggleRowLock_ACU(sheetKey: string, rowIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      if (lockState.rows.has(rowIndex)) lockState.rows.delete(rowIndex);
      else lockState.rows.add(rowIndex);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function toggleColLock_ACU(sheetKey: string, colIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      if (lockState.cols.has(colIndex)) lockState.cols.delete(colIndex);
      else lockState.cols.add(colIndex);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function toggleCellLock_ACU(sheetKey: string, rowIndex: number, colIndex: number) {
      const lockState = getTableLocksForSheet_ACU(sheetKey);
      const key = `${rowIndex}:${colIndex}`;
      if (lockState.cells.has(key)) lockState.cells.delete(key);
      else lockState.cells.add(key);
      saveTableLocksForSheet_ACU(sheetKey, lockState);
  }

  export function isSpecialIndexLockEnabled_ACU(sheetKey: string) {
      const scopeKey = getTableLockScopeKey_ACU();
      const bucket = settings_ACU?.specialIndexLocks?.[scopeKey] || {};
      if (typeof bucket[sheetKey] === 'boolean') return bucket[sheetKey];
      return true; // 默认锁定
  }

  export function setSpecialIndexLockEnabled_ACU(sheetKey: string, enabled: boolean) {
      if (!sheetKey) return;
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      if (!settings_ACU.specialIndexLocks[scopeKey]) settings_ACU.specialIndexLocks[scopeKey] = {};
      settings_ACU.specialIndexLocks[scopeKey][sheetKey] = !!enabled;
      saveSettings_ACU();
  }

  export function captureCurrentTableLocksSnapshot_ACU(): CurrentTableLocksSnapshot_ACU {
      ensureTableLockStore_ACU();
      const scopeKey = getTableLockScopeKey_ACU();
      const hasTableLocks = Object.prototype.hasOwnProperty.call(settings_ACU.tableUpdateLocks, scopeKey);
      const hasSpecialIndexLocks = Object.prototype.hasOwnProperty.call(settings_ACU.specialIndexLocks, scopeKey);
      return {
          scopeKey,
          hasTableLocks,
          tableLocks: hasTableLocks ? cloneTableLockValue_ACU(settings_ACU.tableUpdateLocks[scopeKey]) : null,
          hasSpecialIndexLocks,
          specialIndexLocks: hasSpecialIndexLocks ? cloneTableLockValue_ACU(settings_ACU.specialIndexLocks[scopeKey]) : null,
      };
  }

  export function restoreCurrentTableLocksSnapshot_ACU(
      snapshot: CurrentTableLocksSnapshot_ACU,
      { save = true } = {},
  ): { success: boolean; warning: string } {
      ensureTableLockStore_ACU();
      if (snapshot.hasTableLocks) {
          settings_ACU.tableUpdateLocks[snapshot.scopeKey] = cloneTableLockValue_ACU(snapshot.tableLocks || {});
      } else {
          delete settings_ACU.tableUpdateLocks[snapshot.scopeKey];
      }
      if (snapshot.hasSpecialIndexLocks) {
          settings_ACU.specialIndexLocks[snapshot.scopeKey] = cloneTableLockValue_ACU(snapshot.specialIndexLocks || {});
      } else {
          delete settings_ACU.specialIndexLocks[snapshot.scopeKey];
      }
      if (!save) return { success: true, warning: '' };
      const saveResult = saveSettings_ACU();
      return {
          success: !!saveResult?.saved,
          warning: getSettingsSaveWarning_ACU(saveResult),
      };
  }

  export function commitTableLockDraftsBatch_ACU(options: {
      drafts?: Record<string, TableLockDraft_ACU>;
      deletedSheetKeys?: string[];
  }): TableLocksBatchCommitResult_ACU {
      const snapshot = captureCurrentTableLocksSnapshot_ACU();
      const drafts = options?.drafts && typeof options.drafts === 'object' ? options.drafts : {};
      const deletedSheetKeys = [...new Set((options?.deletedSheetKeys || [])
          .map(key => String(key || '').trim())
          .filter(Boolean))];
      let changed = false;

      deletedSheetKeys.forEach(sheetKey => {
          const result = deleteTableLocksForSheet_ACU(sheetKey, { save: false });
          changed = result.changed || changed;
      });

      Object.entries(drafts).forEach(([sheetKey, draft]) => {
          const normalizedSheetKey = String(sheetKey || '').trim();
          if (!normalizedSheetKey || deletedSheetKeys.includes(normalizedSheetKey)) return;
          ensureTableLockStore_ACU();
          const scopeKey = getTableLockScopeKey_ACU();
          if (!settings_ACU.tableUpdateLocks[scopeKey]) settings_ACU.tableUpdateLocks[scopeKey] = {};
          if (!settings_ACU.specialIndexLocks[scopeKey]) settings_ACU.specialIndexLocks[scopeKey] = {};
          const nextTableLocks = {
              rows: Array.from(draft?.rows || []),
              cols: Array.from(draft?.cols || []),
              cells: Array.from(draft?.cells || []),
          };
          const nextSpecialIndexLock = draft?.specialIndexLocked !== false;
          const currentTableLocks = settings_ACU.tableUpdateLocks[scopeKey][normalizedSheetKey];
          const currentSpecialIndexLock = settings_ACU.specialIndexLocks[scopeKey][normalizedSheetKey];
          if (JSON.stringify(currentTableLocks) !== JSON.stringify(nextTableLocks)) {
              settings_ACU.tableUpdateLocks[scopeKey][normalizedSheetKey] = nextTableLocks;
              changed = true;
          }
          if (currentSpecialIndexLock !== nextSpecialIndexLock) {
              settings_ACU.specialIndexLocks[scopeKey][normalizedSheetKey] = nextSpecialIndexLock;
              changed = true;
          }
      });

      if (!changed) {
          return { success: true, changed: false, snapshot, warning: '' };
      }

      const saveResult = saveSettings_ACU();
      if (saveResult?.saved) {
          return {
              success: true,
              changed: true,
              snapshot,
              warning: getSettingsSaveWarning_ACU(saveResult),
          };
      }

      restoreCurrentTableLocksSnapshot_ACU(snapshot, { save: false });
      return {
          success: false,
          changed: true,
          snapshot,
          warning: getSettingsSaveWarning_ACU(saveResult) || '表格锁设置保存失败。',
      };
  }

  export function deleteTableLocksForSheet_ACU(sheetKey: string, { save = true } = {}) {
      const normalizedSheetKey = String(sheetKey || '').trim();
      const scopeKey = getTableLockScopeKey_ACU();
      const result = {
          scopeKey,
          sheetKey: normalizedSheetKey,
          removedTableLocks: false,
          removedSpecialIndexLock: false,
          changed: false,
          saved: !save,
          warning: '',
      };
      if (!normalizedSheetKey) return result;

      const tableBucket = settings_ACU?.tableUpdateLocks?.[scopeKey];
      if (tableBucket && typeof tableBucket === 'object' && Object.prototype.hasOwnProperty.call(tableBucket, normalizedSheetKey)) {
          delete tableBucket[normalizedSheetKey];
          if (Object.keys(tableBucket).length === 0) delete settings_ACU.tableUpdateLocks[scopeKey];
          result.removedTableLocks = true;
          result.changed = true;
      }

      const specialBucket = settings_ACU?.specialIndexLocks?.[scopeKey];
      if (specialBucket && typeof specialBucket === 'object' && Object.prototype.hasOwnProperty.call(specialBucket, normalizedSheetKey)) {
          delete specialBucket[normalizedSheetKey];
          if (Object.keys(specialBucket).length === 0) delete settings_ACU.specialIndexLocks[scopeKey];
          result.removedSpecialIndexLock = true;
          result.changed = true;
      }

      if (save && result.changed) {
          const saveResult = saveSettings_ACU();
          result.saved = !!saveResult?.saved;
          result.warning = saveResult?.warning || saveResult?.error || '';
      }
      return result;
  }

  export function clearCurrentTableLocks_ACU({ save = true } = {}) {
      const scopeKey = getTableLockScopeKey_ACU();
      const result = {
          scopeKey,
          removedTableLocks: false,
          removedSpecialIndexLocks: false,
          changed: false,
      };

      if (settings_ACU.tableUpdateLocks && typeof settings_ACU.tableUpdateLocks === 'object' && !Array.isArray(settings_ACU.tableUpdateLocks)) {
          if (Object.prototype.hasOwnProperty.call(settings_ACU.tableUpdateLocks, scopeKey)) {
              delete settings_ACU.tableUpdateLocks[scopeKey];
              result.removedTableLocks = true;
              result.changed = true;
          }
      } else if (settings_ACU.tableUpdateLocks !== undefined) {
          settings_ACU.tableUpdateLocks = {};
          result.changed = true;
      }

      if (settings_ACU.specialIndexLocks && typeof settings_ACU.specialIndexLocks === 'object' && !Array.isArray(settings_ACU.specialIndexLocks)) {
          if (Object.prototype.hasOwnProperty.call(settings_ACU.specialIndexLocks, scopeKey)) {
              delete settings_ACU.specialIndexLocks[scopeKey];
              result.removedSpecialIndexLocks = true;
              result.changed = true;
          }
      } else if (settings_ACU.specialIndexLocks !== undefined) {
          settings_ACU.specialIndexLocks = {};
          result.changed = true;
      }

      if (save && result.changed) {
          saveSettings_ACU();
      }

      return result;
  }

  export function getSummaryIndexColumnIndex_ACU(table: any) {
      try {
          if (!table || !Array.isArray(table.content) || !Array.isArray(table.content[0])) return -1;
          const headers = table.content[0].slice(1);
          if (!headers.length) return -1;
          let idx = headers.findIndex(h => {
              if (typeof h !== 'string') return false;
              return /编码|索引/.test(h);
          });
          if (idx === -1) idx = headers.length - 1;
          return idx;
      } catch (e) {
          return -1;
      }
  }

  export function formatSummaryIndexCode_ACU(num: any) {
      const n = Math.max(1, parseInt(num, 10) || 1);
      return `AM${String(n).padStart(4, '0')}`;
  }

  export function applySummaryIndexSequenceToTable_ACU(table: any, colIndex: number) {
      if (!table || !Array.isArray(table.content) || colIndex < 0) return;
      for (let i = 1; i < table.content.length; i++) {
          const row = table.content[i];
          if (!Array.isArray(row)) continue;
          row[colIndex + 1] = formatSummaryIndexCode_ACU(i);
      }
  }

  export function applySpecialIndexSequenceToSummaryTables_ACU(dataObj: Record<string, any>) {
      if (!dataObj || typeof dataObj !== 'object') return;
      Object.keys(dataObj).forEach(sheetKey => {
          if (!sheetKey.startsWith('sheet_')) return;
          const table = dataObj[sheetKey];
          if (!table || !isSummaryOrOutlineTable_ACU(table.name)) return;
          if (!isSpecialIndexLockEnabled_ACU(sheetKey)) return;
          const colIndex = getSummaryIndexColumnIndex_ACU(table);
          if (colIndex < 0) return;
          applySummaryIndexSequenceToTable_ACU(table, colIndex);
      });
  }

import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import {
  getChatScopedConfigContainer_ACU,
  normalizeChatScopedConfigContainer_ACU,
  setChatScopedConfigContainer_ACU,
} from '../../data/storage/chat-history';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
  FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
  type FlightModeState_ACU,
} from '../../shared/models/flight-mode-model';
import type { Sheet_ACU } from '../../shared/models/table-data';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { deleteTableLocksForSheet_ACU, setSpecialIndexLockEnabled_ACU } from '../runtime/helpers-table-lock';
import { applyChatTemplateSnapshotWithReconciliation_ACU } from '../template/template-preset-service';
import {
  getCurrentChatTemplateScopeState_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU,
} from '../template/chat-scope/chat-scope-template';
import { buildFlightModeBigSummarySheet_ACU } from './big-summary-sheet-def';
import {
  canEnableFlightMode_ACU,
  getCurrentFlightModeState_ACU,
  normalizeFlightModeState_ACU,
} from './flight-mode-state';

export type FlightModeTransitionResult_ACU = {
  ok: boolean;
  reason?: 'already_enabled' | 'already_disabled' | 'chronicle_not_found' | 'too_many_visible_chronicle_rows' | 'template_unavailable' | 'big_summary_sheet_key_conflict' | 'restore_archive_missing' | 'template_scope_changed' | 'commit_failed' | 'big_summary_sheet_key_unresolved';
  visibleChronicleRowCount?: number;
  /** 提交层的原始拒绝原因，直接透传给 UI，不改写不省略。 */
  error?: string;
  blockers?: string[];
};

export interface DisableFlightModeOptions_ACU {
  /** 用户已明确确认：停用将按 archive 恢复模板，并覆盖启用后对该会话模板的修改。 */
  confirmTemplateScopeChange?: boolean;
}

function cloneValue_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findSheetByName_ACU(data: Record<string, any> | null | undefined, name: string): { key: string; sheet: Sheet_ACU } | null {
  if (!data || typeof data !== 'object') return null;
  for (const [key, sheet] of Object.entries(data)) {
    if (!key.startsWith('sheet_')) continue;
    if ((sheet as any)?.name === name) return { key, sheet: sheet as Sheet_ACU };
  }
  return null;
}

function getEffectiveTemplateScope_ACU() {
  return getCurrentChatTemplateScopeState_ACU({ isolationKey: getCurrentIsolationKey_ACU() })
    || getGlobalTemplateSnapshotForCurrentProfile_ACU();
}

function parseEffectiveTemplate_ACU(): Record<string, any> | null {
  const scope = getEffectiveTemplateScope_ACU();
  if (!scope?.templateStr) return null;
  try {
    const parsed = JSON.parse(scope.templateStr);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function getCurrentEffectiveTemplateText_ACU(): string | null {
  return getEffectiveTemplateScope_ACU()?.templateStr || null;
}

/**
 * flightMode 与模板 scope 是同一个 scoped container 的兄弟键，而模板提交在内部
 * peek 一份 container 作为回滚快照。因此状态只能在提交成功后单独写入：反序会让
 * 提交失败的回滚还原模板、却保留 flightMode 状态，产生开关与模板不一致的脏态。
 */
async function persistFlightModeState_ACU(next: FlightModeState_ACU): Promise<void> {
  const chat = getChatArray_ACU();
  const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const states = container.flightModeByIsolationKey;
  container.flightModeByIsolationKey = {
    ...(states && typeof states === 'object' && !Array.isArray(states) ? states : {}),
    [isolationKey]: normalizeFlightModeState_ACU(next),
  };
  setChatScopedConfigContainer_ACU(chat, container);
  await saveChatToHost_ACU();
}

export async function enableFlightMode_ACU(): Promise<FlightModeTransitionResult_ACU> {
  const currentState = getCurrentFlightModeState_ACU();
  if (currentState.enabled) return { ok: true, reason: 'already_enabled' };

  const check = canEnableFlightMode_ACU(currentJsonTableData_ACU);
  if (!check.canEnable) return { ok: false, reason: check.reason, visibleChronicleRowCount: check.visibleChronicleRowCount };

  const template = parseEffectiveTemplate_ACU();
  if (!template) return { ok: false, reason: 'template_unavailable' };

  const chronicleEntry = findSheetByName_ACU(template, '纪要表');
  if (!chronicleEntry) return { ok: false, reason: 'chronicle_not_found', visibleChronicleRowCount: check.visibleChronicleRowCount };
  if (findSheetByName_ACU(template, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU)) {
    return { ok: false, reason: 'big_summary_sheet_key_conflict', visibleChronicleRowCount: check.visibleChronicleRowCount };
  }

  // 目标模板：改写纪要表导出配置 + 追加大总结表。key 只是占位，协调层会按显示名重派生。
  const nextTemplate = cloneValue_ACU(template);
  const nextChronicle = findSheetByName_ACU(nextTemplate, '纪要表')!.sheet;
  const originalExportConfig = cloneValue_ACU(nextChronicle.exportConfig);
  nextChronicle.exportConfig = {
    ...nextChronicle.exportConfig,
    entryType: 'constant',
    extraIndexEnabled: false,
  };
  nextTemplate[FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU] = buildFlightModeBigSummarySheet_ACU(nextChronicle, nextTemplate);

  const scopeBeforeEnable = getCurrentChatTemplateScopeState_ACU({ isolationKey: getCurrentIsolationKey_ACU() });
  const committed: any = await applyChatTemplateSnapshotWithReconciliation_ACU(nextTemplate, {
    source: 'flight_mode_enable',
    presetName: getEffectiveTemplateScope_ACU()?.presetName || '',
  });
  if (!committed?.saved) {
    return {
      ok: false,
      reason: 'commit_failed',
      visibleChronicleRowCount: check.visibleChronicleRowCount,
      ...(committed?.error ? { error: committed.error } : {}),
      ...(committed?.blockers?.length ? { blockers: committed.blockers } : {}),
    };
  }

  // 协调层按显示名派生真实 key（大总结 → sheet_da_zong_jie），提交后必须重新解析。
  const resolved = findSheetByName_ACU(currentJsonTableData_ACU, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU);
  if (!resolved) return { ok: false, reason: 'big_summary_sheet_key_unresolved', visibleChronicleRowCount: check.visibleChronicleRowCount };

  await persistFlightModeState_ACU({
    enabled: true,
    enabledAt: Date.now(),
    hiddenRowIds: [],
    bigSummarySheetKey: resolved.key,
    archive: {
      chronicleExportConfig: originalExportConfig,
      templateScope: scopeBeforeEnable === null ? undefined : cloneValue_ACU(scopeBeforeEnable),
      templateScopeWasAbsent: scopeBeforeEnable === null,
      // 必须记录正式提交后的作用域文本，而不是 nextTemplate：协调层会重派 key 并规范化结构。
      enabledTemplateStr: getCurrentEffectiveTemplateText_ACU() || undefined,
    },
  });
  setSpecialIndexLockEnabled_ACU(resolved.key, false);
  return { ok: true, visibleChronicleRowCount: check.visibleChronicleRowCount };
}

export async function disableFlightMode_ACU(options: DisableFlightModeOptions_ACU = {}): Promise<FlightModeTransitionResult_ACU> {
  const currentState = getCurrentFlightModeState_ACU();
  if (!currentState.enabled) return { ok: true, reason: 'already_disabled' };

  const archive = currentState.archive;
  const archivedScope = archive?.templateScope as { templateStr?: string; presetName?: string } | undefined;
  const restoreTemplate = (() => {
    if (!archivedScope?.templateStr) return null;
    try {
      const parsed = JSON.parse(archivedScope.templateStr);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  })();
  if (!restoreTemplate) return { ok: false, reason: 'restore_archive_missing' };

  const enabledTemplateStr = String(archive?.enabledTemplateStr || '');
  const currentTemplateStr = getCurrentEffectiveTemplateText_ACU();
  if (enabledTemplateStr && currentTemplateStr && enabledTemplateStr !== currentTemplateStr && !options.confirmTemplateScopeChange) {
    return { ok: false, reason: 'template_scope_changed' };
  }

  const bigSummaryKey = currentState.bigSummarySheetKey;
  // 大总结内容只是被隐藏纪要行的摘要。停用会把那些纪要行全部恢复可见，摘要随即失去意义，
  // 因此这里显式硬删而非隐藏保留；hardDeleteMissingSheets 必须与破坏性确认成对出现。
  const committed: any = await applyChatTemplateSnapshotWithReconciliation_ACU(restoreTemplate, {
    source: 'flight_mode_disable',
    presetName: archivedScope?.presetName || '',
    hardDeleteMissingSheets: true,
    destructiveChangeConfirmed: true,
  });
  if (!committed?.saved) {
    return {
      ok: false,
      reason: 'commit_failed',
      ...(committed?.error ? { error: committed.error } : {}),
      ...(committed?.blockers?.length ? { blockers: committed.blockers } : {}),
    };
  }

  await persistFlightModeState_ACU({
    enabled: false,
    enabledAt: 0,
    hiddenRowIds: [],
    bigSummarySheetKey: bigSummaryKey,
  });
  deleteTableLocksForSheet_ACU(bigSummaryKey);
  return { ok: true };
}

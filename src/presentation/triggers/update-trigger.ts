import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU } from '../../shared/defaults-json.js';
import { abortAllActiveRequests_ACU, getCharCardPromptFromUI_ACU, isAutoUpdatingCard_ACU, wasStoppedByUser_ACU, _set_isAutoUpdatingCard_ACU, _set_wasStoppedByUser_ACU } from '../components/plot-editors';
import { showToastr_ACU } from '../theme/toast';
import { ACU_TOAST_CATEGORY_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { stopGeneration_ACU } from '../../service/chat/chat-service';
import { jQuery_API_ACU } from '../dom-utils';
import { toastr_API_ACU } from '../../shared/host-api';
import { settings_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../state/ui-refs';
import { sanitizeChatSheetsObject_ACU } from '../../service/template/chat-scope';
import { topLevelWindow_ACU } from '../../shared/env';
import { isSqliteMode } from '../../service/table/storage-mode';
import { renderStopButton_ACU } from '../../shared/html-helpers';
import { ensureSheetOrderNumbers_ACU, logError_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { prepareMergeSummary_ACU, executeManualMergeSummary_ACU } from '../../service/summary/merge-executor';
/**
 * presentation/triggers/update-trigger.ts — 手动更新触发 UI
 * 从 features/ui/01_update_trigger.js 迁移而来
 * presentation 层只负责 UI 交互，业务逻辑委托给 service 层。
 */

  // [重构] 手动合并纪要功能处理函数 (Medusa 模式)
  // presentation 层只负责：confirm 弹窗、进度 toast、停止按钮绑定、按钮状态
  // 业务逻辑（校验、执行批次、写入结果、保存、更新世界书）全部委托给 service 层
  export async function handleManualMergeSummary_ACU() {
      // 调用 service 层前置准备（刷新数据 + 校验参数）
      const preparation = await prepareMergeSummary_ACU(isSqliteMode() ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU);
      if (!preparation.valid) {
          const errorMsg = preparation.error!;
          const isInfo = errorMsg.includes('未找到') || errorMsg.includes('没有') || errorMsg.includes('指定范围') || errorMsg.includes('请稍候');
          showToastr_ACU(isInfo ? 'info' : 'error', errorMsg, { acuToastCategory: ACU_TOAST_CATEGORY_ACU.MERGE_TABLE });
          return;
      }

      const { confirmInfo, validation } = preparation;
      const $btn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-start-merge-summary`);

      // UI：confirm 弹窗
      if (!confirm(`即将开始合并纪要。\n\n源数据范围: 第${confirmInfo!.startIndex + 1}条 到 第${confirmInfo!.actualEndIndex}条 (${confirmInfo!.selectedRange} 条数据)\n处理数据: ${confirmInfo!.allSummaryRowsCount} 条纪要\n目标: 精简为 ${confirmInfo!.targetCount} 条\n\n注意：此操作将使用AI重写指定范围内的纪要数据，其他数据不受影响。操作不可逆！\n建议先导出JSON备份。`)) {
          return;
      }

      // UI：按钮状态
      $btn.prop('disabled', true).text('正在合并 (0%)...');

      // UI：进度 toast + 停止按钮
      const stopButtonHtml = renderStopButton_ACU('acu-merge-stop-btn', '终止');
      let progressToast = showToastr_ACU('info', `<div>正在合并纪要...${stopButtonHtml}</div>`, {
          timeOut: 0, extendedTimeOut: 0, tapToDismiss: false,
          acuToastCategory: ACU_TOAST_CATEGORY_ACU.MERGE_TABLE,
          onShown: function() {
              bindMergeStopButton($btn);
          }
      });

      try {
          // 调用 service 层执行合并，传入进度回调（只接收纯数据）
          const result = await executeManualMergeSummary_ACU(
              validation!,
              // 进度回调：presentation 层根据纯数据更新 UI
              (batchIndex, totalBatches, attempt, maxRetries) => {
                  const progressText = `正在处理批次 ${batchIndex + 1}/${totalBatches} (尝试 ${attempt}/${maxRetries})...`;
                  $btn.text(progressText);
                  if (progressToast) {
                      const toastMessage = `<div>正在合并纪要... (批次 ${batchIndex + 1}/${totalBatches})${stopButtonHtml}</div>`;
                      progressToast.find('.toast-message').html(toastMessage);
                      bindMergeStopButton($btn);
                  }
              },
              // 中止检查回调
              () => wasStoppedByUser_ACU
          );

          // UI：根据返回值显示结果
          if (result.success) {
              try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(); } catch (_) {}
              if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
              showToastr_ACU('success', '所有批次处理完毕，数据库已更新！', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.MERGE_TABLE });
          } else {
              showToastr_ACU('error', '合并过程出错: ' + (result.error || '未知错误'), { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
          }
      } finally {
          $btn.prop('disabled', false).text('开始合并总结');
          if (progressToast && toastr_API_ACU) toastr_API_ACU.clear(progressToast);
      }
  }

  /** UI 辅助：绑定合并停止按钮事件 */
  function bindMergeStopButton($btn: any) {
      jQuery_API_ACU('#acu-merge-stop-btn').off('click.acu_stop').on('click.acu_stop', function(e: any) {
          e.stopPropagation();
          e.preventDefault();
          _set_wasStoppedByUser_ACU(true);
          abortAllActiveRequests_ACU();
          stopGeneration_ACU();
          jQuery_API_ACU(this).closest('.toast').remove();
          showToastr_ACU('warning', '合并操作已由用户终止。');
          _set_isAutoUpdatingCard_ACU(false);
          $btn.prop('disabled', false).text('开始合并纪要');
      });
  }

  export function exportCombinedSettings_ACU() {    const promptSegments = getCharCardPromptFromUI_ACU();
    if (!promptSegments || promptSegments.length === 0) {
      showToastr_ACU('warning', '没有可导出的提示词。');
      return;
    }

    try {
        // [修复] 合并导出应导出“当前模板”（localStorage/内存中的模板），并兼容旧模板缺少顺序编号的情况
        const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
        if (!templateObj || typeof templateObj !== 'object') {
            throw new Error('无法解析当前模板。');
        }
        const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
        ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });
        // [瘦身] 合并导出时也不带冗余字段
        const templateData = sanitizeChatSheetsObject_ACU(templateObj, { ensureMate: true });
        const combinedData = {
            prompt: promptSegments,
            template: templateData,
            mergeSummaryPrompt: settings_ACU.mergeSummaryPrompt || (isSqliteMode() ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU), // [新增] 导出合并提示词（根据存储模式选择默认版本）
            mergeTargetCount: settings_ACU.mergeTargetCount || 1, // [新增] 导出合并目标条数
            mergeBatchSize: settings_ACU.mergeBatchSize || 5, // [新增] 导出合并批次大小
            mergeStartIndex: settings_ACU.mergeStartIndex || 1, // [新增] 导出合并起始条数
            mergeEndIndex: settings_ACU.mergeEndIndex || null, // [新增] 导出合并终止条数
            autoMergeEnabled: settings_ACU.autoMergeEnabled || false, // [新增] 导出自动合并总结设置
            autoMergeThreshold: settings_ACU.autoMergeThreshold || 20, // [新增] 导出自动合并总结楼层数
            autoMergeReserve: settings_ACU.autoMergeReserve || 0, // [新增] 导出保留固定楼层数
            deleteStartFloor: settings_ACU.deleteStartFloor || null, // [新增] 导出删除起始楼层
            deleteEndFloor: settings_ACU.deleteEndFloor || null // [新增] 导出删除终止楼层
        };
        const jsonString = JSON.stringify(combinedData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'TavernDB_Combined_Settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToastr_ACU('success', '合并配置已成功导出！');
    } catch (error) {
        logError_ACU('导出合并配置失败:', error);
        showToastr_ACU('error', '导出合并配置失败，请检查控制台获取详情。');
    }
  }
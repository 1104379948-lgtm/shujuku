/**
 * service/ai/prompt-builder/table-edit-parser.ts
 * AI 响应表格编辑解析 — <tableEdit> 块提取 + 指令解析 + 编辑应用
 * 从 prompt-builder.ts 拆出（L502-L1519）
 * JSON 清洗管线已提取到 json-sanitizer.ts
 */
import { currentJsonTableData_ACU, settings_ACU } from '../../runtime/state-manager';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { applySummaryIndexSequenceToTable_ACU, formatSummaryIndexCode_ACU, getSummaryIndexColumnIndex_ACU, getTableLocksForSheet_ACU, isSpecialIndexLockEnabled_ACU } from '../../runtime/helpers-remaining';
import { sanitizeJsonPipeline_ACU, coerceLooseRowObject_ACU } from './json-sanitizer';
import { isSqliteMode } from '../../table/storage-mode';
import { extractStrictJsonTableFillResponse_ACU } from './strict-json-table-fill';
import { stripJsonCommentsPreservingStrings_ACU } from '../../../shared/json-helpers';
import { allocateStableRowIdForSheet_ACU, ensureStableNextRowId_ACU } from '../../../shared/stable-row-id-allocator';
import { extractDslCommands_ACU, getSnapshotSheetKeysForDsl_ACU, isDslRowDataObject_ACU, parseDslNonNegativeInteger_ACU, resolveDslTableTarget_ACU, validateDslColumnTargets_ACU } from '../../../shared/table-dsl-contract';

  function normalizeAiResponseForTableEditParsing_ACU(text: string) {
    if (typeof text !== 'string') return '';
    let cleaned = text.trim();
    cleaned = cleaned.replace(/'\s*\+\s*'/g, '');
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) cleaned = cleaned.slice(1, -1);
    cleaned = cleaned.replace(/\\n/g, '\n');
    cleaned = cleaned.replace(/\\\\"/g, '\\"');
    cleaned = cleaned.replace(/：/g, ':');
    return cleaned;
  }

  export function extractTableEditInner_ACU(text: string, options: any = {}) {
    const { allowNoTableEditTags = true, useLastPairOnly = (settings_ACU?.tableEditLastPairOnly !== false) } = options;
    const cleaned = normalizeAiResponseForTableEditParsing_ACU(text);
    if (!cleaned) return null;

    if (useLastPairOnly) {
      const fullRe = /<tableEdit>([\s\S]*?)<\/tableEdit>/ig;
      let lastMatch = null;
      let m;
      while ((m = fullRe.exec(cleaned)) !== null) {
        lastMatch = m;
      }
      if (lastMatch && typeof lastMatch[1] === 'string') {
        return { inner: lastMatch[1], cleaned, mode: 'full_last' };
      }
    } else {
      const fullMatch = cleaned.match(/<tableEdit>([\s\S]*?)<\/tableEdit>/i);
      if (fullMatch && typeof fullMatch[1] === 'string') {
        return { inner: fullMatch[1], cleaned, mode: 'full' };
      }
    }

    const lowerCleaned = cleaned.toLowerCase();
    const openTag = '<tableedit>';
    const closeTag = '</tableedit>';
    const hasOpen = lowerCleaned.includes(openTag);
    const hasClose = lowerCleaned.includes(closeTag);
    const hasAnyTag = hasOpen || hasClose;

    const commentRe = /<!--([\s\S]*?)-->/g;
    const commentBlocks = [];
    let m;
    while ((m = commentRe.exec(cleaned)) !== null) {
      commentBlocks.push({
        start: m.index,
        end: commentRe.lastIndex,
        raw: m[0],
        content: m[1] || ''
      });
    }

    const hasCommands = (s: string) => /(insertRow|updateRow|deleteRow)\s*\(/.test(s);
    const candidates = commentBlocks.filter(b => hasCommands(b.content));
    if (!candidates.length) return null;

    let chosen = null;
    if (hasOpen && !hasClose) {
      const openIdx = useLastPairOnly ? lowerCleaned.lastIndexOf(openTag) : cleaned.search(/<tableEdit>/i);
      chosen = candidates.find(b => b.start > openIdx) || (useLastPairOnly ? candidates[candidates.length - 1] : candidates[0]);
    } else if (!hasOpen && hasClose) {
      const closeIdx = useLastPairOnly ? lowerCleaned.lastIndexOf(closeTag) : cleaned.search(/<\/tableEdit>/i);
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].end < closeIdx) { chosen = candidates[i]; break; }
      }
      chosen = chosen || candidates[candidates.length - 1];
    } else if (hasAnyTag) {
      const lastOpenIdx = lowerCleaned.lastIndexOf(openTag);
      const lastCloseIdx = lowerCleaned.lastIndexOf(closeTag);
      const tagIdx = useLastPairOnly
        ? (lastCloseIdx !== -1 ? lastCloseIdx : lastOpenIdx)
        : (hasOpen ? cleaned.search(/<tableEdit>/i) : cleaned.search(/<\/tableEdit>/i));
      let bestDist = Infinity;
      candidates.forEach(b => {
        const dist = Math.min(Math.abs(b.start - tagIdx), Math.abs(b.end - tagIdx));
        if (dist < bestDist) { bestDist = dist; chosen = b; }
      });
    } else if (allowNoTableEditTags) {
      chosen = useLastPairOnly ? candidates[candidates.length - 1] : candidates[0];
    }

    if (!chosen) return null;
    return { inner: chosen.raw, cleaned, mode: 'comment_fallback', hasOpen, hasClose };
  }

  export function parseAndApplyTableEditsToData_ACU(aiResponse: string, tableData: any, updateMode = 'standard', isImportMode = false) {
    if (!tableData) {
        logError_ACU('Cannot apply edits, tableData is not loaded.');
        return false;
    }

    let responseForParsing = aiResponse;
    if (settings_ACU?.strictJsonTableFillEnabled === true) {
        const strictExtraction = extractStrictJsonTableFillResponse_ACU(aiResponse, {
            sqlite: isSqliteMode(),
            tableData,
        });
        if (!strictExtraction.ok) {
            const error = strictExtraction.retryHint || strictExtraction.error || '严格 JSON 填表响应格式无效';
            logWarn_ACU(error);
            return { success: false, modifiedKeys: [] as string[], appliedEdits: 0, error };
        }
        responseForParsing = strictExtraction.normalizedResponse || aiResponse;
    }
    const originalTableData = tableData;
    tableData = JSON.parse(JSON.stringify(originalTableData));

    const extracted = extractTableEditInner_ACU(responseForParsing, { allowNoTableEditTags: true });
    if (!extracted || !extracted.inner) {
        logWarn_ACU('No recognizable table edit block found (missing <tableEdit> boundary and/or incomplete <!-- --> wrapper).');
        return true;
    }

    const editsString = extracted.inner.replace(/<!--|-->/g, '').trim();
    if (!editsString) {
        logDebug_ACU('Empty <tableEdit> block. No edits to apply.');
        return true;
    }

    // SQLite SQL 写入必须由 table-update-commit 公共提交模型执行；解析器不得直接改运行时 DB。
    if (isSqliteMode() && isSqlContent(editsString)) {
        const message = 'SQLite SQL tableEdit must be applied through table update commit model.';
        logError_ACU(`[SQL Mode] ${message}`);
        throw new Error(message);
    }

    let finalCommandLines: string[];
    try {
        finalCommandLines = extractDslCommands_ACU(editsString);
    } catch (error: any) {
        const message = error?.message || String(error);
        return { success: false, modifiedKeys: [] as string[], appliedEdits: 0, error: message };
    }

    const sheetKeysForIndexing = getSnapshotSheetKeysForDsl_ACU(tableData);
    let appliedEdits = 0;
    const commandErrors: string[] = [];
    const editCountsBySheetKey: Record<string, number> = {};

    const resolveTableTarget_ACU = (target: unknown): { table: any; sheetKey: string; tableIndex: number } | { error: string } => {
        const resolved = resolveDslTableTarget_ACU(tableData, target, sheetKeysForIndexing);
        if (resolved.ok === false) return { error: resolved.message };
        return { table: resolved.sheet, sheetKey: resolved.sheetKey, tableIndex: resolved.tableIndex };
    };

    const resolveCommandTable_ACU = (command: string, target: unknown) => {
        const resolved = resolveTableTarget_ACU(target);
        if ('error' in resolved) {
            commandErrors.push(`${command}: ${resolved.error}`);
            logWarn_ACU(`[表格编辑] ${command}: ${resolved.error}`);
            return null;
        }
        return resolved;
    };

    // 指令解析函数
    const parseTableEditCommandLine_ACU = (rawLine: string) => {
        try {
            let commandLineWithoutComment = stripJsonCommentsPreservingStrings_ACU(rawLine).trim();
            if (!commandLineWithoutComment) return null;
            const match = commandLineWithoutComment.match(/^(insertRow|deleteRow|updateRow)\s*\((.*)\);?$/);
            if (!match) return null;
            const command = match[1];
            const argsString = match[2];
            let args;
            const firstBracket = argsString.indexOf('{');
            if (firstBracket === -1) {
                args = JSON.parse(`[${argsString}]`);
            } else {
                const paramsPart = argsString.substring(0, firstBracket).trim();
                let jsonPart = argsString.substring(firstBracket);
                const initialArgs = JSON.parse(`[${paramsPart.replace(/,$/, '')}]`);
                try {
                    const jsonData = JSON.parse(jsonPart);
                    args = [...initialArgs, jsonData];
                } catch (jsonError) {
                    logError_ACU(`Primary JSON parse failed for: "${jsonPart}". Attempting sanitization pipeline...`, jsonError);

                    const originalLooseObjectResult = coerceLooseRowObject_ACU(jsonPart);
                    if (originalLooseObjectResult.success) {
                        args = [...initialArgs, originalLooseObjectResult.result];
                        logWarn_ACU(`[JSON Sanitization] Recovered malformed row object from original payload via loose parsing. Keys: ${originalLooseObjectResult.recoveredKeys.join(', ')}`);
                    } else {
                        const sanitizeResult = sanitizeJsonPipeline_ACU(jsonPart);
                        if (!sanitizeResult.success) {
                            logError_ACU(`JSON sanitization pipeline failed for: "${jsonPart}"`, new Error(sanitizeResult.error || 'Unknown sanitization error'));
                            throw jsonError;
                        }

                        try {
                            const jsonData = JSON.parse(sanitizeResult.result);
                            args = [...initialArgs, jsonData];
                            if (sanitizeResult.layersApplied.length > 0) {
                                logWarn_ACU(`[JSON Sanitization] Applied layers: ${sanitizeResult.layersApplied.join(', ')}`);
                            }
                        } catch (sanitizedJsonError) {
                            const looseObjectResult = coerceLooseRowObject_ACU(sanitizeResult.result);
                            if (looseObjectResult.success) {
                                args = [...initialArgs, looseObjectResult.result];
                                logWarn_ACU(`[JSON Sanitization] Recovered malformed row object from sanitized payload via loose parsing. Keys: ${looseObjectResult.recoveredKeys.join(', ')}`);
                            } else {
                                const sanitizedPreview = sanitizeResult.result.length > 400
                                    ? `${sanitizeResult.result.slice(0, 400)}...`
                                    : sanitizeResult.result;
                                logError_ACU(`Sanitized JSON parse failed after layers [${sanitizeResult.layersApplied.join(', ') || 'none'}]: "${sanitizedPreview}"`, sanitizedJsonError);
                                logError_ACU(`[JSON Sanitization] Loose row object recovery failed. Original: ${originalLooseObjectResult.error || 'Unknown'}; Sanitized: ${looseObjectResult.error || 'Unknown'}`);
                                throw sanitizedJsonError;
                            }
                        }
                    }
                }
            }
            return { command, args, line: commandLineWithoutComment };
        } catch (e) {
            logError_ACU(`Failed to parse command line: "${rawLine}"`, e);
            return null;
        }
    };

    // 总结表/总体大纲同步新增检查
    let summaryInsertCount = 0;
    let outlineInsertCount = 0;
    const standardizedFillEnabled = settings_ACU?.standardizedTableFillEnabled !== false;
    if (standardizedFillEnabled) {
        finalCommandLines.forEach(line => {
            try {
                const parsed = parseTableEditCommandLine_ACU(line);
                if (!parsed || parsed.command !== 'insertRow') return;
                const resolved = resolveTableTarget_ACU(parsed.args?.[0]);
                if ('error' in resolved) return;
                const { table } = resolved;
                if (!isSummaryOrOutlineTable_ACU(table.name)) return;
                if (table.name === '总结表') summaryInsertCount++;
                if (table.name === '总体大纲') outlineInsertCount++;
            } catch (e) {}
        });
    }
    const allowSummaryOutlineInsert = !standardizedFillEnabled ||
        (summaryInsertCount === 1 && outlineInsertCount === 1) ||
        (summaryInsertCount === 0 && outlineInsertCount === 0);
    if (standardizedFillEnabled && !allowSummaryOutlineInsert && (summaryInsertCount > 0 || outlineInsertCount > 0)) {
        logWarn_ACU(`[屏蔽] 总结表/总体大纲新增不同步：总结=${summaryInsertCount}, 大纲=${outlineInsertCount}，本轮两表均不写入。`);
    }

    // 仅物化当前 canonical snapshot 自带的 seedRows，不读取 guide/template。
    const materializeSeedRowsIfNeeded_ACU = (table: any) => {
        try {
            if (!table || typeof table !== 'object') return;
            if (!Array.isArray(table.content) || table.content.length !== 1) return;
            const sr = (Array.isArray(table.seedRows) && table.seedRows.length > 0) ? table.seedRows : null;
            if (!Array.isArray(sr) || sr.length === 0) return;
            const headerRow = JSON.parse(JSON.stringify(table.content[0]));
            const seed = JSON.parse(JSON.stringify(sr));
            table.content = [headerRow, ...seed];
        } catch (e) { logWarn_ACU('[表格编辑] restoreSeedRows 失败:', e); }
    };

    // 逐条应用编辑指令
    finalCommandLines.forEach(line => {
        const parsed = parseTableEditCommandLine_ACU(line);
        if (!parsed) {
            const error = 'malformed_command: 指令格式无效或参数 JSON 无法解析';
            commandErrors.push(error);
            logWarn_ACU(`[表格编辑] ${error}`);
            return;
        }
        const { command, args } = parsed;

        try {
            switch (command) {
                case 'insertRow': {
                    const [tableTarget, data] = args;
                    const resolved = resolveCommandTable_ACU(command, tableTarget);
                    if (!resolved) {
                        break;
                    }
                    const { table, sheetKey, tableIndex } = resolved;
                    materializeSeedRowsIfNeeded_ACU(table);
                    const isSummaryTable = isSummaryOrOutlineTable_ACU(table.name);
                    const isUnifiedMode = (updateMode === 'full' || updateMode === 'manual_unified' || updateMode === 'auto_unified');
                    const isStandardMode = (updateMode === 'standard' || updateMode === 'auto_standard' || updateMode === 'manual_standard');
                    const isSummaryMode = (updateMode === 'summary' || updateMode === 'auto_summary' || updateMode === 'auto_summary_silent' || updateMode === 'manual_summary');
                    const isManualMode = (updateMode && updateMode.startsWith('manual'));

                    if (isUnifiedMode) {
                        // 允许所有操作
                    } else if (isStandardMode && isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 标准表更新模式(手动)：忽略总结表/总体大纲的insertRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    } else if (isSummaryMode && !isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 总结表更新模式(手动)：忽略标准表的insertRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    }
                    if (isSummaryTable && !allowSummaryOutlineInsert) {
                        logDebug_ACU(`[屏蔽] 总结表/总体大纲新增不同步：忽略 insertRow (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                        break;
                    }
                    if (!isDslRowDataObject_ACU(data)) {
                        commandErrors.push(`invalid_row_data: insertRow 的数据必须是非空对象，当前值为 ${JSON.stringify(data)}`);
                        break;
                    }
                    {
                        const headers = table.content[0].slice(1);
                        const columnError = validateDslColumnTargets_ACU(data, headers.length);
                        if (columnError) {
                            commandErrors.push(columnError);
                            break;
                        }
                        const newRow: any[] = [allocateStableRowIdForSheet_ACU(table)];
                        const specialIndexCol = (isSummaryTable && sheetKey && isSpecialIndexLockEnabled_ACU(sheetKey))
                            ? getSummaryIndexColumnIndex_ACU(table)
                            : -1;
                        headers.forEach((_: any, colIndex: number) => {
                            let nextVal = data[colIndex] ?? data[String(colIndex)] ?? "";
                            if (colIndex === specialIndexCol) {
                                nextVal = formatSummaryIndexCode_ACU(table.content.length);
                            }
                            newRow.push(nextVal);
                        });
                        table.content.push(newRow);
                        if (isSummaryTable && specialIndexCol >= 0) {
                            applySummaryIndexSequenceToTable_ACU(table, specialIndexCol);
                        }
                        logDebug_ACU(`Applied insertRow to table ${tableIndex} (${table.name}) with data:`, data);
                        appliedEdits++;
                        editCountsBySheetKey[sheetKey] = (editCountsBySheetKey[sheetKey] || 0) + 1;
                    }
                    break;
                }
                case 'deleteRow': {
                    const [tableTarget, rowIndex] = args;
                    const resolved = resolveCommandTable_ACU(command, tableTarget);
                    if (!resolved) {
                        break;
                    }
                    const { table, sheetKey, tableIndex } = resolved;
                    const normalizedRowIndex = parseDslNonNegativeInteger_ACU(rowIndex);
                    if (normalizedRowIndex === null) {
                        commandErrors.push(`invalid_row_target: deleteRow 的行号必须是非负整数，当前值为 ${JSON.stringify(rowIndex)}`);
                        break;
                    }
                    materializeSeedRowsIfNeeded_ACU(table);
                    const isSummaryTable = isSummaryOrOutlineTable_ACU(table.name);

                    if (isSummaryTable) {
                        logDebug_ACU(`[屏蔽] 总结表/总体大纲忽略 deleteRow 操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                        break;
                    }

                    const isUnifiedMode = (updateMode === 'full' || updateMode === 'manual_unified' || updateMode === 'auto_unified');
                    const isStandardMode = (updateMode === 'standard' || updateMode === 'auto_standard' || updateMode === 'manual_standard');
                    const isSummaryMode = (updateMode === 'summary' || updateMode === 'auto_summary' || updateMode === 'auto_summary_silent' || updateMode === 'manual_summary');
                    const isManualMode = (updateMode && updateMode.startsWith('manual'));

                    if (isUnifiedMode) {
                        // 允许所有操作
                    } else if (isStandardMode && isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 标准表更新模式(手动)：忽略总结表/总体大纲的deleteRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    } else if (isSummaryMode && !isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 总结表更新模式(手动)：忽略标准表的deleteRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    }
                    if (table.content.length > normalizedRowIndex + 1) {
                        const targetRow = table.content[normalizedRowIndex + 1];
                        if (!Array.isArray(targetRow)) {
                            commandErrors.push(`invalid_table_structure: deleteRow 的目标行 ${normalizedRowIndex} 不是有效数组`);
                            break;
                        }
                        ensureStableNextRowId_ACU(table);
                        table.content.splice(normalizedRowIndex + 1, 1);
                        logDebug_ACU(`Applied deleteRow to table ${tableIndex} (${table.name}) at index ${normalizedRowIndex}`);
                        appliedEdits++;
                        editCountsBySheetKey[sheetKey] = (editCountsBySheetKey[sheetKey] || 0) + 1;
                    } else {
                        commandErrors.push(`invalid_row_target: deleteRow 的行号 ${JSON.stringify(rowIndex)} 在表 ${JSON.stringify(table.name)} 中不存在`);
                    }
                    break;
                }
                case 'updateRow': {
                    const [tableTarget, rowIndex, data] = args;
                    const resolved = resolveCommandTable_ACU(command, tableTarget);
                    if (!resolved) {
                        break;
                    }
                    const { table, sheetKey, tableIndex } = resolved;
                    const normalizedRowIndex = parseDslNonNegativeInteger_ACU(rowIndex);
                    if (normalizedRowIndex === null) {
                        commandErrors.push(`invalid_row_target: updateRow 的行号必须是非负整数，当前值为 ${JSON.stringify(rowIndex)}`);
                        break;
                    }
                    if (!isDslRowDataObject_ACU(data)) {
                        commandErrors.push(`invalid_row_data: updateRow 的数据必须是非空对象，当前值为 ${JSON.stringify(data)}`);
                        break;
                    }

                    materializeSeedRowsIfNeeded_ACU(table);
                    const isSummaryTable = isSummaryOrOutlineTable_ACU(table.name);

                    if (isSummaryTable) {
                        logDebug_ACU(`[屏蔽] 总结表/总体大纲忽略 updateRow 操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                        break;
                    }

                    const isUnifiedMode = (updateMode === 'full' || updateMode === 'manual_unified' || updateMode === 'auto_unified');
                    const isStandardMode = (updateMode === 'standard' || updateMode === 'auto_standard' || updateMode === 'manual_standard');
                    const isSummaryMode = (updateMode === 'summary' || updateMode === 'auto_summary' || updateMode === 'auto_summary_silent' || updateMode === 'manual_summary');
                    const isManualMode = (updateMode && updateMode.startsWith('manual'));

                    if (isUnifiedMode) {
                        // 允许所有操作
                    } else if (isStandardMode && isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 标准表更新模式(手动)：忽略总结表/总体大纲的updateRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    } else if (isSummaryMode && !isSummaryTable) {
                        if (isManualMode) {
                            logDebug_ACU(`[屏蔽] 总结表更新模式(手动)：忽略标准表的updateRow操作 (tableIndex: ${tableIndex}, tableName: ${table.name})`);
                            break;
                        }
                    }
                    if (table.content.length > normalizedRowIndex + 1) {
                        const targetRow = table.content[normalizedRowIndex + 1];
                        if (!Array.isArray(targetRow)) {
                            commandErrors.push(`invalid_table_structure: updateRow 的目标行 ${normalizedRowIndex} 不是有效数组`);
                            break;
                        }
                        const writableColumnCount = Math.min(table.content[0].length, targetRow.length) - 1;
                        const columnError = validateDslColumnTargets_ACU(data, Math.max(0, writableColumnCount));
                        if (columnError) {
                            commandErrors.push(columnError);
                            break;
                        }

                        ensureStableNextRowId_ACU(table);
                        const lockState = sheetKey ? getTableLocksForSheet_ACU(sheetKey) : { rows: new Set(), cols: new Set(), cells: new Set() };
                        if (lockState.rows.has(normalizedRowIndex)) {
                            logDebug_ACU(`[锁定] 行锁定阻止 updateRow (tableIndex: ${tableIndex}, rowIndex: ${normalizedRowIndex})`);
                            break;
                        }
                        Object.keys(data).forEach(colIndexStr => {
                            const colIndex = Number(colIndexStr);
                            if (lockState.cols.has(colIndex)) return;
                            if (lockState.cells.has(`${normalizedRowIndex}:${colIndex}`)) return;
                            targetRow[colIndex + 1] = data[colIndexStr];
                        });
                        if (isSummaryTable && sheetKey && isSpecialIndexLockEnabled_ACU(sheetKey)) {
                            const specialIndexCol = getSummaryIndexColumnIndex_ACU(table);
                            if (specialIndexCol >= 0) applySummaryIndexSequenceToTable_ACU(table, specialIndexCol);
                        }
                        logDebug_ACU(`Applied updateRow to table ${tableIndex} (${table.name}) at index ${normalizedRowIndex} with data:`, data);
                        appliedEdits++;
                        editCountsBySheetKey[sheetKey] = (editCountsBySheetKey[sheetKey] || 0) + 1;
                    } else {
                        commandErrors.push(`invalid_row_target: updateRow 的行号 ${JSON.stringify(rowIndex)} 在表 ${JSON.stringify(table.name)} 中不存在`);
                    }
                    break;
                }
            }
        } catch (e) {
            logError_ACU(`Failed to parse or apply command: "${line}"`, e);
            commandErrors.push(`command_exception: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    if (commandErrors.length > 0) {
        return { success: false, modifiedKeys: [], appliedEdits: 0, error: commandErrors.join('；') };
    }

    // 将统计信息写入表格对象
    Object.keys(editCountsBySheetKey).forEach(sheetKey => {
        if (!tableData[sheetKey]._lastUpdateStats) {
            tableData[sheetKey]._lastUpdateStats = {};
        }
        tableData[sheetKey]._lastUpdateStats.changes = editCountsBySheetKey[sheetKey];
    });
    
    // 收集所有被修改的表格 key
    const modifiedSheetKeys: string[] = [];
    Object.keys(editCountsBySheetKey).forEach(sheetKey => {
        if (editCountsBySheetKey[sheetKey] > 0) {
            modifiedSheetKeys.push(sheetKey);
        }
    });
    
    Object.keys(originalTableData).forEach(key => delete originalTableData[key]);
    Object.assign(originalTableData, tableData);

    return { success: true, modifiedKeys: modifiedSheetKeys, appliedEdits };
  }

  export function parseAndApplyTableEdits_ACU(aiResponse: string, updateMode = 'standard', isImportMode = false) {
    if (!currentJsonTableData_ACU) {
        logError_ACU('Cannot apply edits, currentJsonTableData_ACU is not loaded.');
        return false;
    }
    return parseAndApplyTableEditsToData_ACU(aiResponse, currentJsonTableData_ACU, updateMode, isImportMode);
  }

  /**
   * 检测 <tableEdit> 内容是否为 SQL 语句
   * 跳过空行和注释行后，检查第一条非空行是否以 SQL 关键字开头
   */
  export function isSqlContent(content: string): boolean {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 跳过 SQL 注释
      if (trimmed.startsWith('--')) continue;
      // 跳过 HTML 注释残留
      if (trimmed.startsWith('<!--') || trimmed.startsWith('-->')) continue;
      // 检查是否以 SQL 关键字开头
      const sqlKeywords = /^(INSERT|UPDATE|DELETE|ALTER|BEGIN|CREATE|DROP|REPLACE)\b/i;
      return sqlKeywords.test(trimmed);
    }
    return false;
  }

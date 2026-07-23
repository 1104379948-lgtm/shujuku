/**
 * data/sqlite/sync-bridge.ts — SQLite ↔ ChatMessage 双向同步桥
 *
 * 加载方向：ChatMessage → mergeAll → JSON → SQLite
 * 保存方向：SQLite → JSON → saveIndependentTable → ChatMessage
 *
 * 关键设计：复用现有的 mergeAllIndependentTables_ACU 和
 *          saveIndependentTableToChatHistory_ACU，不重新实现持久化逻辑
 */

import { SqliteEngine } from './sqlite-engine';
import { buildRuntimeFallbackDDL_ACU, createSheetInsertPlan, generateInserts, resultToContent, parseDDLTableName, parseDDLColumnNames, buildColumnNameMap, resolveEffectiveDDL } from './schema-mapper';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../shared/models/table-data';
import { hashUserInput_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { formatCanonicalRowIssues_ACU, normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';

/** 同步桥的元数据表名（内部使用，对用户和 AI 不可见） */
const META_TABLE_NAME = '_acu_sheet_meta';

/** 元数据表的建表 DDL */
const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE_NAME} (
  sheet_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER DEFAULT 0,
  source_data_json TEXT,
  update_config_json TEXT,
  export_config_json TEXT
);`;

export interface RuntimeDdlFallbackDiagnostic_ACU {
  sheetKey: string;
  reason: 'fallback_missing' | 'fallback_invalid';
  failureSummary?: string;
  originalDdlDigest: string;
  effectiveTableName: string;
  phase: 'initial_load' | 'runtime_ddl_retry';
}

export interface RuntimeEffectiveSchema_ACU {
  effectiveDDL: string;
  columnMap: ReturnType<typeof resolveEffectiveDDL>['columnMap'];
  source: ReturnType<typeof resolveEffectiveDDL>['source'];
  diagnostics: readonly string[];
  originalDdlDigest: string;
}

export class SyncBridge {
  private readonly runtimeFallbackDiagnostics = new Map<string, RuntimeDdlFallbackDiagnostic_ACU>();
  private readonly runtimeEffectiveSchemas = new Map<string, RuntimeEffectiveSchema_ACU>();

  constructor(private engine: SqliteEngine) {}

  getRuntimeFallbackDiagnostics_ACU(): readonly RuntimeDdlFallbackDiagnostic_ACU[] {
    return Array.from(this.runtimeFallbackDiagnostics.values());
  }

  /**
   * 从 TableDataObject 加载到 SQLite
   * 1. 创建元数据表
   * 2. 遍历每张 sheet：建表 + 灌数据 + 写元数据
   *
   * @param data 完整的表格数据对象（通常来自 mergeAllIndependentTables_ACU 的结果）
   */
  loadFromTableData(data: TableDataObject_ACU, options: { strict?: boolean; allowRuntimeDdlFallback?: boolean } = {}): void {
    if (!data || typeof data !== 'object') return;
    if (!this.engine.isReady) {
      throw new Error('SyncBridge: SqliteEngine 未初始化');
    }

    // 创建元数据表
    const normalization = normalizeCanonicalTableRows_ACU(data);
    if (normalization.errors.length > 0) {
      const message = `[SyncBridge] snapshot 行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}`;
      if (options.strict) throw new Error(message);
      logWarn_ACU(message);
    }
    this.engine.run(META_TABLE_DDL);

    // 遍历所有 sheet
    const sheetKeys = Object.keys(data).filter(k => k.startsWith('sheet_'));
    logDebug_ACU(`[SyncBridge] 开始加载 ${sheetKeys.length} 张表到 SQLite`);
    for (const key of sheetKeys) {
      const sheet = data[key] as Sheet_ACU;
      if (!sheet || !Array.isArray(sheet.content)) continue;

      try {
        this._loadSheet(key, sheet, options.allowRuntimeDdlFallback === true);
      } catch (e: any) {
        const errorMessage = e?.message || String(e);
        const reason = /^第 \d+ 条语句失败:/.test(errorMessage) ? 'SQLite 写入失败' : errorMessage;
        const message = `[SyncBridge] 加载表 ${key} (${sheet.name}) 失败: ${reason}`;
        logError_ACU(message);
        if (options.strict) {
          throw new Error(message);
        }
      }
    }
  }

  /**
   * 从 SQLite 导出为 TableDataObject
   * SELECT * FROM 每张用户表 → 还原为 content 二维数组
   * 元数据从 _acu_sheet_meta 表读取
   *
   * @param originalMate 原始的 mate 对象（SQLite 不存储 mate，需要外部传入）
   * @returns 完整的 TableDataObject
   */
  exportToTableData(originalMate: Mate_ACU): TableDataObject_ACU {
    if (!this.engine.isReady) {
      throw new Error('SyncBridge: SqliteEngine 未初始化');
    }

    const result: TableDataObject_ACU = { mate: originalMate };

    // 读取元数据
    const metaMap = this._loadAllMeta();

    // 遍历所有用户表
    const tableNames = this.engine.getTableNames();
    logDebug_ACU(`[SyncBridge] 开始导出 ${tableNames.length} 张表从 SQLite`);
    for (const tableName of tableNames) {
      // 查找对应的元数据
      const meta = this._findMetaByTableName(metaMap, tableName);
      if (!meta) continue;

      try {
        const sheet = this._exportSheet(tableName, meta);
        result[meta.sheetKey] = sheet;
      } catch (e: any) {
        logError_ACU(`[SyncBridge] 导出表 ${tableName} 失败:`, e?.message || e);
      }
    }

    const normalization = normalizeCanonicalTableRows_ACU(result);
    if (normalization.errors.length > 0) {
      logWarn_ACU(`[SyncBridge] 导出结果存在无法自动合并的行标识问题：${formatCanonicalRowIssues_ACU(normalization.errors)}`);
    }
    return result;
  }

  /**
   * 仅同步 SQLite → JSON（不写聊天消息）
   * 用于 AI 编辑后立即更新内存视图，但延迟持久化
   *
   * @param originalData 原始的 TableDataObject（提供 mate 和未变更的 sheet 信息）
   * @returns 更新后的 TableDataObject
   */
  syncToJson(originalData: TableDataObject_ACU): TableDataObject_ACU {
    return this.exportToTableData(originalData.mate as Mate_ACU);
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /** 加载单张 sheet 到 SQLite */
  private _loadSheet(sheetKey: string, sheet: Sheet_ACU, allowRuntimeDdlFallback: boolean): void {
    const resolvedDDL = resolveEffectiveDDL(sheet, sheet.uid || sheetKey);
    if (resolvedDDL.source === 'fallback_invalid' && !allowRuntimeDdlFallback) {
      throw new Error(resolvedDDL.diagnostics[0]);
    }

    const metaSql = `INSERT OR REPLACE INTO ${META_TABLE_NAME} (sheet_key, uid, name, order_no, source_data_json, update_config_json, export_config_json) VALUES (?, ?, ?, ?, ?, ?, ?);`;
    const executeResolvedDDL = (candidate: typeof resolvedDDL) => {
      const tableName = parseDDLTableName(candidate.effectiveDDL);
      if (!tableName) throw new Error(`无法从 DDL 中解析表名: ${candidate.effectiveDDL.substring(0, 100)}`);

      // 映射或行数据错误必须在执行 DDL 前失败，绝不能被 runtime schema fallback 掩盖。
      const plan = createSheetInsertPlan(sheet, candidate.columnMap);
      const inserts = generateInserts(sheet, tableName, plan);
      this.engine.runBatch(
        [candidate.effectiveDDL, ...inserts, metaSql],
        [
          undefined,
          ...new Array<undefined>(inserts.length).fill(undefined),
          [
            sheetKey,
            sheet.uid || sheetKey,
            sheet.name || sheetKey,
            sheet.orderNo ?? 0,
            JSON.stringify(sheet.sourceData || {}),
            JSON.stringify(sheet.updateConfig || {}),
            JSON.stringify(sheet.exportConfig || {}),
          ],
        ],
      );
    };

    if (resolvedDDL.source !== 'explicit') {
      this._recordRuntimeFallbackDiagnostic(sheetKey, resolvedDDL, 'initial_load');
    }

    try {
      executeResolvedDDL(resolvedDDL);
      this._recordRuntimeEffectiveSchema(sheetKey, resolvedDDL);
    } catch (error: any) {
      // runBatch 已保证失败事务回滚。仅首条 CREATE TABLE 执行失败才允许一次 runtime fallback；
      // INSERT/约束/映射错误必须原样 fail closed，防止用全 TEXT 表偷偷吞掉数据完整性问题。
      if (resolvedDDL.source !== 'explicit' || !allowRuntimeDdlFallback || !/^第 1 条语句失败:/.test(error?.message || '')) throw error;
      const fallback = buildRuntimeFallbackDDL_ACU(sheet, sheet.uid || sheetKey, 'fallback_invalid', '显式 DDL 无法在 runtime SQLite 执行，已使用 fallback schema。');
      this._recordRuntimeFallbackDiagnostic(sheetKey, fallback, 'runtime_ddl_retry', error?.message || String(error));
      executeResolvedDDL(fallback);
      this._recordRuntimeEffectiveSchema(sheetKey, fallback);
    }
  }

  private _recordRuntimeEffectiveSchema(sheetKey: string, resolvedDDL: ReturnType<typeof resolveEffectiveDDL>): void {
    this.runtimeEffectiveSchemas.set(sheetKey, {
      effectiveDDL: resolvedDDL.effectiveDDL,
      columnMap: resolvedDDL.columnMap,
      source: resolvedDDL.source,
      diagnostics: resolvedDDL.diagnostics,
      originalDdlDigest: hashUserInput_ACU(resolvedDDL.originalDDL),
    });
  }

  private _recordRuntimeFallbackDiagnostic(
    sheetKey: string,
    resolvedDDL: ReturnType<typeof resolveEffectiveDDL>,
    phase: RuntimeDdlFallbackDiagnostic_ACU['phase'],
    failureSummary?: string,
  ): void {
    if (this.runtimeFallbackDiagnostics.has(sheetKey)) return;
    const effectiveTableName = parseDDLTableName(resolvedDDL.effectiveDDL) || 'unknown_table';
    const diagnostic: RuntimeDdlFallbackDiagnostic_ACU = {
      sheetKey,
      reason: resolvedDDL.source === 'fallback_missing' ? 'fallback_missing' : 'fallback_invalid',
      originalDdlDigest: hashUserInput_ACU(resolvedDDL.originalDDL),
      effectiveTableName,
      phase,
      failureSummary: failureSummary?.slice(0, 240),
    };
    this.runtimeFallbackDiagnostics.set(sheetKey, diagnostic);
    logWarn_ACU(`[SyncBridge][runtime-ddl-fallback] ${JSON.stringify(diagnostic)} ${resolvedDDL.diagnostics[0]}`);
  }

  /** 从 SQLite 导出单张表为 Sheet_ACU */
  private _exportSheet(tableName: string, meta: SheetMeta): Sheet_ACU {
    // 查询所有数据
    const queryResult = this.engine.query(`SELECT * FROM ${tableName};`);

    // 导出必须以实际创建到 runtime SQLite 的 schema 为准；meta.sourceData.ddl
    // 可能是保留给用户修复的非法原文，不能再拿它反向解释已 fallback 的物理列。
    const ddl = this.engine.getTableDDL(tableName) || '';
    const { sqlToChinese } = buildColumnNameMap(ddl);

    // 转换为 content。
    // sql.js 对空表 SELECT * 可能返回空结果集且不带 columns；此时必须从 DDL 恢复列名，
    // 否则空表会被导出成只有 ['row_id'] 的坏表头，污染后续 checkpoint/可视化编辑器。
    const columns = queryResult.columns.length > 0 ? queryResult.columns : parseDDLColumnNames(ddl);
    const content = resultToContent(columns, queryResult.values, sqlToChinese);

    const sheet: Sheet_ACU & { _acu_runtimeEffectiveSchema?: RuntimeEffectiveSchema_ACU } = {
      uid: meta.uid,
      name: meta.name,
      sourceData: meta.sourceData,
      content,
      updateConfig: meta.updateConfig,
      exportConfig: meta.exportConfig,
      orderNo: meta.orderNo,
    };
    const runtimeSchema = this.runtimeEffectiveSchemas.get(meta.sheetKey);
    if (runtimeSchema) {
      Object.defineProperty(sheet, '_acu_runtimeEffectiveSchema', {
        value: runtimeSchema,
        enumerable: false,
      });
    }
    return sheet;
  }

  /** 读取所有元数据 */
  private _loadAllMeta(): Map<string, SheetMeta> {
    const map = new Map<string, SheetMeta>();
    try {
      const result = this.engine.query(`SELECT * FROM ${META_TABLE_NAME};`);
      for (const row of result.values) {
        const sheetKey = String(row[0]);
        map.set(sheetKey, {
          sheetKey,
          uid: String(row[1]),
          name: String(row[2]),
          orderNo: Number(row[3]) || 0,
          sourceData: safeJsonParse(row[4]),
          updateConfig: safeJsonParse(row[5]),
          exportConfig: safeJsonParse(row[6]),
        });
      }
    } catch (_) {
      // 元数据表不存在时返回空 map
    }
    return map;
  }

  /** 通过 SQL 表名查找对应的元数据 */
  private _findMetaByTableName(metaMap: Map<string, SheetMeta>, tableName: string): SheetMeta | null {
    // 遍历元数据，找到 DDL 中表名匹配的那条
    for (const [, meta] of metaMap) {
      const ddl = meta.sourceData?.ddl;
      if (ddl) {
        const ddlTableName = parseDDLTableName(ddl);
        if (ddlTableName === tableName) return meta;
      }
    }
    // fallback：用 uid 匹配
    for (const [, meta] of metaMap) {
      if (meta.uid === tableName) return meta;
    }
    return null;
  }
}

/** 元数据结构 */
interface SheetMeta {
  sheetKey: string;
  uid: string;
  name: string;
  orderNo: number;
  sourceData: any;
  updateConfig: any;
  exportConfig: any;
}

/** 安全的 JSON 解析 */
function safeJsonParse(val: SqlJsValueType): any {
  if (val === null || val === undefined) return {};
  try {
    return JSON.parse(String(val));
  } catch (_) {
    return {};
  }
}

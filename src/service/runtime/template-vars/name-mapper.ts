/**
 * service/runtime/template-vars/name-mapper.ts
 * 中英文名称双向映射器
 *
 * 从 DDL 注释中自动构建中英文双向映射。
 * 用户在 ORM / SQL / <if> 中可以使用中文名、英文名、甚至混用，
 * 引擎自动翻译为英文名后执行。
 *
 * 翻译在应用层完成，SQLite 引擎本身只认英文名。
 */

import {
  parseDDLChineseName,
  parseDDLColumnComments,
} from '../../../shared/ddl-utils';
import { logDebug_ACU, logWarn_ACU } from '../../../shared/utils';
import { resolveEffectiveDDL, type EffectiveDDLResult_ACU } from '../../../data/sqlite/schema-mapper';
import type { Sheet_ACU } from '../../../shared/models/table-data';

/** 全局 NameMapper 单例 */
let _globalNameMapper: NameMapper | null = null;
/** 当前 mapper 对应的有效 DDL 集合签名；null 表示尚未绑定到任何 runtime schema。 */
let _globalNameMapperSchemaSignature: string | null = null;

function buildDDLMapSignature_ACU(ddlMap: Map<string, string>): string {
  return [...ddlMap.entries()]
    .map(([tableName, ddl]) => [String(tableName || '').trim(), String(ddl || '').trim()] as const)
    .filter(([tableName, ddl]) => !!tableName && !!ddl)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tableName, ddl]) => `${tableName}\u0000${ddl}`)
    .join('\u0001');
}

/**
 * 获取全局 NameMapper 实例
 * 如果尚未构建，返回一个空的 NameMapper（所有名称直接透传）
 */
export function getNameMapper(): NameMapper {
  if (!_globalNameMapper) {
    _globalNameMapper = new NameMapper();
  }
  return _globalNameMapper;
}

/**
 * 从所有表的 DDL 构建全局 NameMapper
 * 在 SQLite 加载完成后调用
 *
 * @param ddlMap runtime 物理表名 → 有效 DDL 的映射
 */
export function buildGlobalNameMapper(ddlMap: Map<string, string>): void {
  _globalNameMapperSchemaSignature = buildDDLMapSignature_ACU(ddlMap);
  _globalNameMapper = NameMapper.fromDDLs(ddlMap);
  logDebug_ACU(`[NameMapper] 全局映射器已构建: ${_globalNameMapper.tableCount} 张表`);
}

/**
 * 仅当 mapper 尚未绑定当前有效 schema 时重建。
 * 不能用 tableCount 判断就绪：不同模板可能拥有相同数量的表但列映射已经变化。
 */
export function ensureGlobalNameMapperForDDLs_ACU(ddlMap: Map<string, string>): NameMapper {
  const nextSignature = buildDDLMapSignature_ACU(ddlMap);
  if (!_globalNameMapper || _globalNameMapperSchemaSignature !== nextSignature) {
    buildGlobalNameMapper(ddlMap);
  }
  return _globalNameMapper!;
}

/**
 * 解析运行时有效 DDL（包括缺失或无效 DDL 的 fallback）。
 * presentation 必须经 service 层使用该解析，不能直接依赖 data/sqlite。
 */
export function resolveRuntimeEffectiveDDL_ACU(
  sheet: Sheet_ACU,
  fallbackTableName?: string,
  runtimeTableName?: string,
): EffectiveDDLResult_ACU {
  return resolveEffectiveDDL(sheet, fallbackTableName, runtimeTableName);
}

/** 当前全局 mapper 是否精确对应给定的有效 DDL 集合。 */
export function isGlobalNameMapperCurrentForDDLs_ACU(ddlMap: Map<string, string>): boolean {
  return _globalNameMapper !== null
    && _globalNameMapperSchemaSignature === buildDDLMapSignature_ACU(ddlMap);
}

/** 供诊断使用；不暴露 DDL 内容，避免日志泄漏模板。 */
export function getGlobalNameMapperStatus_ACU(): { ready: boolean; tableCount: number } {
  return {
    ready: _globalNameMapper !== null,
    tableCount: _globalNameMapper?.tableCount ?? 0,
  };
}

/**
 * 销毁全局 NameMapper
 */
export function disposeGlobalNameMapper(): void {
  _globalNameMapper = null;
  _globalNameMapperSchemaSignature = null;
}

/**
 * 中英文名称双向映射器
 */
export class NameMapper {
  // 表名映射：中文 → 英文
  private tableNameMap: Map<string, string> = new Map();
  // 列名映射：表英文名.中文列名 → 英文列名
  private columnNameMap: Map<string, string> = new Map();
  // 反向映射：英文 → 中文
  private reverseTableMap: Map<string, string> = new Map();
  private reverseColumnMap: Map<string, string> = new Map();

  /** 映射的表数量 */
  get tableCount(): number {
    return this.reverseTableMap.size;
  }

  /**
   * 从多张表的 DDL 构建映射器
   *
   * Map key 是由完整 TableDataObject 分配的 runtime 物理表名；不能从
   * 用户可编辑的 DDL 文本重新推导，否则显示名与 DDL 名不一致时会向 SQLite
   * 发出不存在的表名。
   */
  static fromDDLs(ddlMap: Map<string, string>): NameMapper {
    const mapper = new NameMapper();

    for (const [physicalTableName, ddl] of ddlMap) {
      const englishTableName = String(physicalTableName || '').trim();
      if (!englishTableName || !ddl) continue;

      // 解析中文表名（DDL 第一行注释）
      const chineseTableName = parseDDLChineseName(ddl);
      if (chineseTableName) {
        mapper.tableNameMap.set(chineseTableName, englishTableName);
        mapper.reverseTableMap.set(englishTableName, chineseTableName);
      } else {
        // 没有中文注释，也记录英文名（用于 reverseTableMap）
        mapper.reverseTableMap.set(englishTableName, englishTableName);
      }

      // 解析列名注释
      const columnComments = parseDDLColumnComments(ddl);
      for (const [colName, comment] of columnComments) {
        if (comment && colName !== 'row_id') {
          const key = `${englishTableName}.${comment}`;
          mapper.columnNameMap.set(key, colName);
          mapper.reverseColumnMap.set(`${englishTableName}.${colName}`, comment);
        }
      }
    }

    return mapper;
  }

  /**
   * 解析表名（中文→英文，英文直接返回）
   */
  resolveTableName(name: string): string {
    if (!name) return name;
    const trimmed = name.trim();
    // 先查中文映射
    const english = this.tableNameMap.get(trimmed);
    if (english) return english;
    // 检查是否本身就是英文表名
    if (this.reverseTableMap.has(trimmed)) return trimmed;
    // 未找到映射，原样返回
    return trimmed;
  }

  /**
   * 解析列名（中文→英文，英文直接返回）
   * @param tableName 英文表名（已解析过的）
   * @param columnName 列名（可能是中文或英文）
   */
  resolveColumnName(tableName: string, columnName: string): string {
    if (!columnName) return columnName;
    const trimmed = columnName.trim();
    // 先查中文映射
    const key = `${tableName}.${trimmed}`;
    const english = this.columnNameMap.get(key);
    if (english) return english;
    // 检查是否本身就是英文列名
    if (this.reverseColumnMap.has(`${tableName}.${trimmed}`)) return trimmed;
    // 未找到映射，原样返回（可能是英文名或未知名）
    return trimmed;
  }

  /** 指定表中是否存在已确认的中文展示列名或英文物理列名。 */
  hasColumnName(tableName: string, columnName: string): boolean {
    if (!tableName || !columnName) return false;
    const trimmed = columnName.trim();
    return this.columnNameMap.has(`${tableName}.${trimmed}`)
      || this.reverseColumnMap.has(`${tableName}.${trimmed}`)
      || trimmed === 'row_id';
  }

  /**
   * 反向：英文表名→中文（用于展示给用户）
   */
  getChineseTableName(englishName: string): string {
    return this.reverseTableMap.get(englishName) || englishName;
  }

  /**
   * 反向：英文列名→中文（用于展示给用户）
   */
  getChineseColumnName(tableName: string, englishName: string): string {
    return this.reverseColumnMap.get(`${tableName}.${englishName}`) || englishName;
  }

  /**
   * 将原生 SQL 中的中文名替换为英文名（跳过字符串值）
   *
   * 安全替换策略：
   * 1. 先把单引号字符串提取出来，用占位符替代
   * 2. 在安全的 SQL 上做中文→英文替换（长名称优先，避免子串误匹配）
   * 3. 把字符串值放回去
   */
  translateSql(sql: string): string {
    if (!sql) return sql;

    // 1. 提取单引号字符串，用占位符替代
    const strings: string[] = [];
    let safeSql = sql.replace(/'[^']*'/g, (match) => {
      strings.push(match);
      return `__STR_${strings.length - 1}__`;
    });

    // 2. 替换中文表名（长名称优先）
    const sortedTableNames = [...this.tableNameMap.entries()]
      .sort((a, b) => b[0].length - a[0].length);
    for (const [cn, en] of sortedTableNames) {
      safeSql = safeSql.split(cn).join(en);
    }

    // 3. 替换中文列名（长名称优先）
    const sortedColumnNames = [...this.columnNameMap.entries()]
      .map(([key, en]) => {
        const dotIndex = key.indexOf('.');
        const cn = key.substring(dotIndex + 1);
        return { cn, en };
      })
      .sort((a, b) => b.cn.length - a.cn.length);
    for (const { cn, en } of sortedColumnNames) {
      safeSql = safeSql.split(cn).join(en);
    }

    // 4. 把字符串值放回去
    safeSql = safeSql.replace(/__STR_(\d+)__/g, (_, i) => strings[Number(i)]);

    return safeSql;
  }

  /**
   * 获取所有英文表名
   */
  getAllTableNames(): string[] {
    return [...this.reverseTableMap.keys()];
  }
}

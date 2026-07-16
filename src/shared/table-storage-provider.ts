/**
 * shared/table-storage-provider.ts — 统一的表格存储提供者接口
 *
 * 定义 ITableStorageProvider 接口，原生模式和 SQLite 模式各自实现。
 * 上层代码通过策略选择器获取 Provider，不直接依赖具体实现。
 */

import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

/** 存储模式 */
export type StorageMode = 'native' | 'sqlite';

/** SQL 查询结果（SELECT） */
export interface SqlQueryResult {
  /** 列名数组 */
  columns: string[];
  /** 结果行（每行是一个值数组） */
  values: (string | number | Uint8Array | null)[][];
  /** 结果行数 */
  rowCount: number;
}

/** SQL 查询执行选项 */
export interface SqlQueryExecutionOptions_ACU {
  suppressErrorLog?: boolean;
}

/** SQL 变更结果（INSERT/UPDATE/DELETE） */
export interface SqlMutationResult {
  /** 受影响的行数 */
  changes: number;
  /** 错误信息列表（如果有） */
  errors: string[];
}

/** AI 编辑应用结果 */
export interface ApplyEditsResult {
  /** 是否成功 */
  success: boolean;
  /** 受影响的 sheetKey 列表 */
  modifiedKeys: string[];
  /** 成功应用的编辑数量 */
  appliedEdits: number;
  /** 实际业务 SQL 的总变更行数；provider 可在 SQLite 批处理时提供。 */
  changes?: number;
  /** 与调用方 prepared statements 同索引的变更行数。 */
  statementChanges?: number[];
  /** 错误信息（失败时） */
  error?: string;
}

export interface SqlSheetMetadataUpdate_ACU {
  sheetKey: string;
  sheet: Sheet_ACU;
}

export interface SqlReseedPlan_ACU {
  statements: string[];
  paramsList: (string | number | null)[][];
  metadataUpdates: SqlSheetMetadataUpdate_ACU[];
}

export interface TableRuntimeHydrationOptions_ACU {
  /** canonical snapshot 的来源；Provider 不得根据数据行数量自行改写该语义。 */
  source: 'merged' | 'initialized';
}

export interface ApplyEditsBatchWithSheetMetadataOptions_ACU {
  /** 受控 prepared batch 必须关闭，避免 provider 添加未持久化的业务 SQL。 */
  includeImplicitReseed?: boolean;
}

/**
 * 统一的表格存储提供者接口
 *
 * 原生模式（NativeTableServiceAdapter）和 SQLite 模式（SqlTableService）
 * 各自实现此接口。上层代码通过 getStorageProvider() 获取当前 Provider，
 * 不需要知道底层是 JSON 操作还是 SQL 操作。
 */
export interface ITableStorageProvider {
  /** 模式标识 */
  readonly mode: StorageMode;

  /**
   * 从聊天消息加载表格数据到运行时
   * - native：调用 loadOrCreateJsonTableFromChatHistory_ACU
   * - sqlite：mergeAll → loadFromTableData → 建表灌数据
   */
  loadFromChat(): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }>;

  /**
   * 从调用方已捕获的 canonical snapshot 初始化运行时。
   *
   * Provider 只能精确 hydrate 输入数据，不得自行读取模板、guide、公共 JSON
   * 或公共 NameMapper。null 明确表示没有可 hydrate 的 snapshot。
   */
  loadFromData?(data: TableDataObject_ACU | null, options?: TableRuntimeHydrationOptions_ACU): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }>;

  /**
   * 标记该 provider 的后续 hydrate 属于未发布候选；候选不得写入全局运行时视图。
   */
  beginRuntimeCandidate_ACU?(): void;

  /**
   * 发布已验证候选的完整运行时状态（provider、JSON 视图与名称映射）。
   */
  activateRuntimeStatePublication_ACU?(): void;

  /**
   * 将 SQLite 实例已构建的候选名称映射发布到当前运行时。
   * 只能由存储策略在候选实例 hydrate 成功后调用。
   */
  activateNameMapperPublication_ACU?(): void;

  /**
   * 撤销该实例已发布的名称映射；实现必须保证不会撤销其他实例的映射。
   */
  deactivateNameMapperPublication_ACU?(): void;

  /** 当前运行时是否已经可用。native 恒为 true；sqlite 需引擎已初始化。 */
  isReady(): boolean;

  /**
   * 保存当前运行时数据到聊天消息
   * - native：调用 saveIndependentTableToChatHistory_ACU
   * - sqlite：exportToTableData → 更新 JSON 视图 → saveIndependentTable
   */
  saveToChat(
    targetSheetKeys?: string[] | null,
    updateGroupKeys?: string[] | null,
    trackingSheetKeys?: string[] | null,
    options?: { source?: string; requestId?: string; batchId?: string; operations?: unknown[]; transactionContext?: unknown },
  ): Promise<{ saved: boolean; messageIndex?: number; error?: string }>;

  /**
   * 获取当前运行时的完整表格数据（JSON 格式）
   * 两种模式都返回 TableDataObject_ACU，保证上层代码零改动
   */
  getCurrentData(): TableDataObject_ACU | null;

  /**
   * 严格导出当前 runtime canonical data。SQLite 导出失败必须抛错，
   * 不得回退到 currentJsonTableData_ACU 等缓存快照。
   */
  exportCanonicalData?(): TableDataObject_ACU;

  /**
   * 在公共提交模型内替换完整运行时数据。
   * 注意：只负责运行时更新，不负责持久化聊天记录。
   */
  replaceAllData?(data: TableDataObject_ACU): Promise<ApplyEditsResult> | ApplyEditsResult;

  /**
   * 应用 AI 返回的编辑指令
   * - native：解析 DSL（insertRow/updateRow/deleteRow）
   * - sqlite：执行 SQL 语句（事务包裹，失败回滚）
   *
   * @param edits AI 返回的编辑内容（DSL 或 SQL）
   * @param updateMode 更新模式（standard/summary/unified）
   * @returns 应用结果
   */
  applyEdits(edits: string, updateMode?: string): ApplyEditsResult;

  /**
   * 批量应用多段 AI SQL/编辑内容。
   * sqlite 模式必须把所有 SQL 放进同一个运行时事务；native 可不实现。
   */
  applyEditsBatch?(editsList: string[], updateMode?: string, paramsList?: (string | number | null)[][]): ApplyEditsResult;

  /**
   * 基于调用方已导出的 canonical data，只读准备当前 SQLite 空表所需的
   * seedRows reseed SQL 与 metadata。
   * 调用方若持久化 SQL operation，必须使用此计划作为同一 prepared batch 的一部分。
   */
  prepareReseedPlanForEmptyTables?(
    canonicalData: TableDataObject_ACU,
    targetSheetKeys?: string[],
  ): SqlReseedPlan_ACU;

  /** 在一个 SQLite 事务内提交调用方已准备的 SQL 与 Sheet metadata。 */
  applyEditsBatchWithSheetMetadata?(
    editsList: string[],
    paramsList: (string | number | null)[][],
    metadataUpdates: SqlSheetMetadataUpdate_ACU[],
    updateMode?: string,
    options?: ApplyEditsBatchWithSheetMetadataOptions_ACU,
  ): ApplyEditsResult;

  /** 创建运行时快照，用于提交失败或重试前回滚。sqlite 返回二进制 DB 快照；native 可不实现。 */
  createRuntimeSnapshot?(): unknown;

  /** 恢复 createRuntimeSnapshot 创建的运行时快照。 */
  restoreRuntimeSnapshot?(snapshot: unknown): Promise<void>;

  /**
   * 精确清空运行时表格状态，不读取聊天记录也不创建模板数据。
   * 失败补偿依赖此方法恢复“旧运行时为空”的状态，因此所有 provider 必须实现。
   */
  clearRuntimeData(): void;

  /**
   * 执行 SQL 查询（仅 sqlite 模式支持）
   * native 模式调用时抛出 Error
   */
  executeQuery(
    sql: string,
    params?: (string | number | null)[],
    options?: SqlQueryExecutionOptions_ACU,
  ): SqlQueryResult;

  /**
   * 执行 SQL 变更语句（仅 sqlite 模式支持）
   * native 模式调用时抛出 Error
   */
  executeMutation(sql: string, params?: (string | number | null)[]): SqlMutationResult;

  /**
   * 销毁/清理资源
   * - native：无操作
   * - sqlite：关闭数据库实例
   */
  dispose(): void;
}

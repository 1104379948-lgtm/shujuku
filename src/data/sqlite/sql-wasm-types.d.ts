/**
 * data/sqlite/sql-wasm-types.d.ts
 * sql.js 引擎模块声明（wasm / asm / 构建占位符）。
 * sql.js 包不携带类型定义，这里声明默认导出为初始化函数；
 * locateFile 用于定位 .wasm 文件（多形态解析见 sql-wasm-locator.ts）。
 */
declare module 'sql.js/dist/sql-wasm.js' {
  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

declare module 'sql.js/dist/sql-asm-memory-growth.js' {
  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

/** 构建占位符：rollup 按 ACU_SQLITE_ENGINE 替换为 wasm/asm 模块。 */
declare module '__ACU_SQLITE_ENGINE_IMPORT__' {
  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

#!/usr/bin/env node
/**
 * scripts/sql-wasm-assets.mjs
 * SQLite 引擎选择与 sql-wasm.wasm 复制/校验的共享逻辑。
 * 供 rollup.config.js 与 rollup.plus-assistantembedded.config.js 复用，
 * 确保三种构建目标对 wasm 资产的处理一致（复制 + SHA-256 校验）。
 */
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

/**
 * SQLite 引擎选择：wasm（默认，产物 ~660KB）| asm（回滚，纯 JS 无 wasm）。
 *
 * 必须 trim 并显式校验：Windows cmd 的 `set VAR=asm && cmd` 会把尾随空格并入值，
 * 得到 'asm '。历史实现用 `=== 'asm'` 选引擎、`!== 'wasm'` 决定是否复制 wasm，
 * 这类脏值会同时判错两边，静默产出「wasm 引擎 + 未分发 wasm」的坏产物
 * （运行时报 both async and sync fetching of the wasm failed）。
 * 因此这里 fail loud：未知值直接中断构建，绝不静默回落到默认引擎。
 */
const RAW_ACU_SQLITE_ENGINE = process.env.ACU_SQLITE_ENGINE;
const NORMALIZED_ACU_SQLITE_ENGINE = String(RAW_ACU_SQLITE_ENGINE ?? '').trim().toLowerCase();
const SUPPORTED_ACU_SQLITE_ENGINES = new Set(['wasm', 'asm']);

if (NORMALIZED_ACU_SQLITE_ENGINE && !SUPPORTED_ACU_SQLITE_ENGINES.has(NORMALIZED_ACU_SQLITE_ENGINE)) {
  throw new Error(
    `[sql-wasm-assets] ACU_SQLITE_ENGINE 取值非法: ${JSON.stringify(RAW_ACU_SQLITE_ENGINE)}。`
    + ` 仅支持 wasm | asm（大小写与首尾空白已规范化）。`,
  );
}

export const ACU_SQLITE_ENGINE = NORMALIZED_ACU_SQLITE_ENGINE || 'wasm';

console.log(`[sql-wasm-assets] 引擎选择: ${ACU_SQLITE_ENGINE}（原始值 ${JSON.stringify(RAW_ACU_SQLITE_ENGINE ?? null)}）`);

/**
 * sqlite-engine 中占位 import 说明符 __ACU_SQLITE_ENGINE_IMPORT__ 的替换目标。
 */
export const SQL_WASM_IMPORT_ID =
  ACU_SQLITE_ENGINE === 'asm'
    ? 'sql.js/dist/sql-asm-memory-growth.js'
    : 'sql.js/dist/sql-wasm.js';

const WASM_SOURCE = join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 复制 sql.js wasm 到目标目录并校验 SHA-256。
 * asm 模式下跳过；源缺失或复制后 hash 不一致时抛错（构建失败）。
 */
export function copySqlWasmTo(targetDir) {
  if (ACU_SQLITE_ENGINE !== 'wasm') {
    console.log('[copy-sql-wasm] 引擎为 asm，跳过 wasm 复制');
    return;
  }
  if (!existsSync(WASM_SOURCE)) {
    throw new Error(`sql.js wasm 源缺失: ${WASM_SOURCE}`);
  }
  mkdirSync(targetDir, { recursive: true });
  const sourceBuffer = readFileSync(WASM_SOURCE);
  const sourceHash = sha256Of(sourceBuffer);
  const targetFile = join(targetDir, 'sql-wasm.wasm');
  copyFileSync(WASM_SOURCE, targetFile);
  const copiedHash = sha256Of(readFileSync(targetFile));
  if (copiedHash !== sourceHash) {
    throw new Error(`sql.js wasm 复制后 hash 不一致: ${copiedHash} != ${sourceHash}`);
  }
  console.log(
    `[copy-sql-wasm] ${WASM_SOURCE} -> ${targetFile} (${sourceBuffer.length} bytes, sha256 ${copiedHash})`,
  );
}

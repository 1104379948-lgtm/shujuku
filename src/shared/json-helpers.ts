/**
 * shared/json-helpers.ts — JSON 安全解析/序列化工具
 *
 * 零副作用、零全局依赖。
 * safeJsonParse/safeJsonStringify 从 src/core/02_storage_and_profile.js 迁移而来。
 *
 * 注意：02_api_call.js 中的 JSON 清洗管线（normalizeQuotesLayer 等 ~15 个函数）
 * 目前嵌套在 parseAndApplyTableEdits_ACU 闭包内，暂不迁移，等阶段 5 整体重构时拆出。
 */

/**
 * 安全 JSON 解析（失败时返回 fallback 而不抛异常）
 */
export function safeJsonParse_ACU(str: string, fallback: any = null): any {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

/**
 * 安全 JSON 序列化（失败时返回 fallback 而不抛异常）
 */
export function safeJsonStringify_ACU(obj: any, fallback: string = '{}'): string {
  try { return JSON.stringify(obj); } catch (e) { return fallback; }
}

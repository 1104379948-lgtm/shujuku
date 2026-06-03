/**
 * shared/table-storage-metadata.ts — 统一存储格式元数据契约
 * 
 * 管理存储模式（checkpoint/delta/legacy）与存储版本号的规范化。
 */

import type { IsolationTagData_ACU, TableStorageMode_ACU } from '../data/models/chat-message-data';

/** 当前系统支持的表格存储最高版本 */
export const TABLE_STORAGE_VERSION_ACU = 1;

/**
 * 判断指定的 TagData 是否为当前系统支持的版本
 * - 缺失 version 视为旧版（legacy），受支持
 * - version <= TABLE_STORAGE_VERSION_ACU 视为受支持
 * - version > TABLE_STORAGE_VERSION_ACU 视为未来版本，不支持
 */
export function isSupportedTableStorageVersion_ACU(tagData: IsolationTagData_ACU | null | undefined): boolean {
    if (!tagData) return true;
    if (tagData._acu_storage_version == null) return true;
    return tagData._acu_storage_version <= TABLE_STORAGE_VERSION_ACU;
}

/**
 * 规范化并获取 TagData 的安全存储模式与版本信息
 * 如果是未来版本，返回 supported = false，调用方应据此决定是否降级或跳过
 * 
 * @param tagData 目标 tagData
 * @param fallbackMode 缺失模式时的降级策略
 */
export function normalizeTableTagStorageMetadata_ACU(
    tagData: IsolationTagData_ACU | null | undefined,
    fallbackMode: TableStorageMode_ACU = 'checkpoint'
): { mode: TableStorageMode_ACU; version: number; supported: boolean } {
    if (!tagData) {
        return { mode: fallbackMode, version: TABLE_STORAGE_VERSION_ACU, supported: true };
    }

    const version = tagData._acu_storage_version != null ? tagData._acu_storage_version : TABLE_STORAGE_VERSION_ACU;
    const mode = tagData._acu_storage_mode || fallbackMode;
    const supported = version <= TABLE_STORAGE_VERSION_ACU;

    return {
        mode,
        version,
        supported
    };
}

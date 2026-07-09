/**
 * data/gateways/character-gateway.ts — 角色数据读取网关
 *
 * 封装 TavernHelper_API_ACU 的角色数据相关方法。
 * service 层通过本模块访问角色数据，不再直接调用宿主 API。
 *
 * 所有方法内置存在性检查，宿主 API 不可用时返回安全默认值。
 */

import { TavernHelper_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';

/**
 * 获取当前角色的完整数据
 * @param target 目标标识，通常为 'current'
 * @returns 角色数据对象，不可用时返回 null
 */
export function getCurrentCharData_ACU(target: string = 'current'): any | null {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCharData !== 'function') {
        return null;
    }
    return TavernHelper_API_ACU.getCharData(target);
}

/**
 * 获取当前角色绑定的所有世界书列表
 * @param options 查询选项，默认 { type: 'all' }
 * @returns 世界书名称数组，不可用时返回 []
 */
export async function getCharLorebooks_ACU(options: { type?: 'all' | 'primary' | 'additional' } = { type: 'all' }): Promise<any> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCharLorebooks !== 'function') {
        logWarn_ACU('[CharacterGateway] getCharLorebooks 不可用，返回空数组');
        return [];
    }
    return await TavernHelper_API_ACU.getCharLorebooks(options);
}

/**
 * 获取聊天消息（通过 TavernHelper API）
 * @param range 消息范围
 * @param options 查询选项
 * @returns 消息数组，不可用时返回 []
 */
export async function getChatMessages_ACU(range?: any, options?: any): Promise<any[]> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getChatMessages !== 'function') {
        logWarn_ACU('[CharacterGateway] getChatMessages 不可用，返回空数组');
        return [];
    }
    return await TavernHelper_API_ACU.getChatMessages(range, options);
}

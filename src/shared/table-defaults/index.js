/**
 * table-defaults/index.js — 默认表模板组装入口
 *
 * 将 8 张表 + mate 元数据组装为消费端期望的双重编码 JSON 字符串。
 * 格式：`"{ ... }"` —— 外层引号包裹的 JSON 字符串。
 *
 * 消费端（parseTableTemplateJson_ACU）会先 JSON.parse 去掉外层引号得到内层 JSON 字符串，
 * 再 JSON.parse 得到最终对象。这里的组装逻辑精确复现这个格式。
 */
import { globalStateSheet } from './global-state.js';
import { protagonistInfoSheet } from './protagonist-info.js';
import { importantCharsSheet } from './important-chars.js';
import { protagonistSkillsSheet } from './protagonist-skills.js';
import { inventorySheet } from './inventory.js';
import { questsEventsSheet } from './quests-events.js';
import { chronicleSheet } from './chronicle.js';
import { optionsSheet } from './options.js';
import { mateConfig } from './mate.js';

/**
 * 构建默认表模板对象（普通 JS 对象，未序列化）
 */
export function buildDefaultTableTemplateObject_ACU() {
  return {
    [globalStateSheet.uid]: globalStateSheet,
    [protagonistInfoSheet.uid]: protagonistInfoSheet,
    [importantCharsSheet.uid]: importantCharsSheet,
    [protagonistSkillsSheet.uid]: protagonistSkillsSheet,
    [inventorySheet.uid]: inventorySheet,
    [questsEventsSheet.uid]: questsEventsSheet,
    [chronicleSheet.uid]: chronicleSheet,
    [optionsSheet.uid]: optionsSheet,
    mate: mateConfig
  };
}

/**
 * 构建默认表模板的双重编码 JSON 字符串
 *
 * 返回格式：`"{ ... }"` —— 与原 DEFAULT_TABLE_TEMPLATE_ACU 完全一致的格式。
 * 消费端 parseTableTemplateJson_ACU 期望首尾有双引号。
 */
export function buildDefaultTableTemplateString_ACU() {
  const obj = buildDefaultTableTemplateObject_ACU();
  // JSON.stringify 生成内层 JSON，再用 JSON.stringify 包一层引号
  const innerJson = JSON.stringify(obj, null, 2);
  return JSON.stringify(innerJson);
}

// 导出所有单表定义，方便外部按需引用
export {
  globalStateSheet,
  protagonistInfoSheet,
  importantCharsSheet,
  protagonistSkillsSheet,
  inventorySheet,
  questsEventsSheet,
  chronicleSheet,
  optionsSheet,
  mateConfig
};

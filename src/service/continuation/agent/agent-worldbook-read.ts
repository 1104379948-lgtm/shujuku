/**
 * service/continuation/agent/agent-worldbook-read.ts — Agent 的世界书只读接入
 *
 * 运行起点一次性预取启用条目做运行内快照，之后目录 / 精读 / 纪要区间 / 搜索都基于
 * 同一份快照（世界书读取是异步宿主调用，预取后地址在一次运行内不漂移）。
 *
 * 暴露范围：已启用集合内除纪要（总结条目）之外的条目全部可读可搜（含插件生成的
 * 重要人物条目等）；纪要只经概要目录按 AM 区间调阅；未启用条目不进目录、不进搜索、不可读。
 */

import { getIsolationPrefix_ACU } from '../../worldbook/injection-engine-state';
import { getLorebookEntriesByNames_ACU } from '../../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../../settings/settings-readers';
import { isEntryBlocked_ACU, logWarn_ACU } from '../../../shared/utils';
import {
  compareAmCodes_ACU,
  extractAmCodes_ACU,
  isSummaryEntryComment_ACU,
  normalizeAmCode_ACU,
  normalizeGeneratedComment_ACU,
  resolveRelevantBookNames_ACU,
} from '../worldbook-context';

/** 一条已启用的普通世界书条目（纪要之外）。 */
export interface AgentWorldbookEntryView_ACU {
  bookName: string;
  uid: string;
  title: string;
  keys: string[];
  constant: boolean;
  content: string;
}

/** 一条纪要（总结条目）的概要视图。 */
export interface AgentChronicleDigestView_ACU {
  /** 已按 AM 码排序。 */
  codes: string[];
  content: string;
}

/** 一次 Agent 运行内的世界书快照。 */
export interface AgentWorldbookSnapshot_ACU {
  entries: AgentWorldbookEntryView_ACU[];
  chronicles: AgentChronicleDigestView_ACU[];
  /** 读取宿主失败时为 false；目录会如实标注，不当成「没有条目」。 */
  available: boolean;
}

export function buildEmptyAgentWorldbookSnapshot_ACU(available = true): AgentWorldbookSnapshot_ACU {
  return { entries: [], chronicles: [], available };
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readEntryKeys_ACU(entry: Record<string, unknown>): string[] {
  const raw = Array.isArray(entry.keys) ? entry.keys : typeof entry.keys === 'string' ? entry.keys.split(/[,，]/) : [];
  return raw.map(key => String(key ?? '').trim()).filter(Boolean);
}

/** 与 pipeline 的 isSelected 语义一致：插件侧勾选表缺书/缺列表都视为全选。 */
function isEntrySelected_ACU(bookName: string, uid: string, enabledEntriesMap: unknown): boolean {
  if (!isRecord_ACU(enabledEntriesMap) || !Object.keys(enabledEntriesMap).length) return true;
  const list = enabledEntriesMap[bookName];
  if (typeof list === 'undefined' || !Array.isArray(list)) return true;
  return list.some(item => String(item) === uid);
}

/**
 * 预取当前已启用的世界书条目为运行内快照。
 *
 * 启用判定与提示词注入管线一致：条目自身 enabled 为真、且通过插件侧 enabledEntries
 * 勾选表、且不属于屏蔽名单（规则/思维链等功能性条目）。纪要条目单独归入 chronicles。
 * 内部插件条目（TavernDB-ACU- 前缀）是存储载体而非叙事资料，不暴露。
 * @returns 快照；宿主读取失败时返回 available=false 的空快照
 */
export async function loadAgentWorldbookSnapshot_ACU(): Promise<AgentWorldbookSnapshot_ACU> {
  try {
    const bookNames = await resolveRelevantBookNames_ACU();
    if (!bookNames.length) return buildEmptyAgentWorldbookSnapshot_ACU();
    const entriesByBook = await getLorebookEntriesByNames_ACU(bookNames);
    const isolationPrefix = getIsolationPrefix_ACU();
    const enabledEntriesMap = getCurrentWorldbookConfig_ACU()?.enabledEntries;

    const entries: AgentWorldbookEntryView_ACU[] = [];
    const chronicles: AgentChronicleDigestView_ACU[] = [];
    for (const bookName of bookNames) {
      for (const raw of entriesByBook[bookName] ?? []) {
        if (!isRecord_ACU(raw)) continue;
        if (raw.enabled !== true) continue;
        const uid = String(raw.uid ?? '').trim();
        const title = normalizeGeneratedComment_ACU(raw, isolationPrefix);
        const content = String(raw.content ?? '').trim();
        if (isSummaryEntryComment_ACU(title)) {
          const codes = [...extractAmCodes_ACU(raw)].sort(compareAmCodes_ACU);
          if (codes.length && content) chronicles.push({ codes, content });
          continue;
        }
        if (!uid || !content) continue;
        if (!isEntrySelected_ACU(bookName, uid, enabledEntriesMap)) continue;
        if (isEntryBlocked_ACU(raw)) continue;
        if (title.startsWith('TavernDB-ACU-')) continue;
        entries.push({ bookName, uid, title: title || `条目 ${uid}`, keys: readEntryKeys_ACU(raw), constant: raw.type === 'constant', content });
      }
    }
    chronicles.sort((left, right) => compareAmCodes_ACU(left.codes[0], right.codes[0]));
    return { entries, chronicles, available: true };
  } catch (error) {
    logWarn_ACU('[Continuation][Agent] 世界书快照预取失败，本轮目录与搜索将不含世界书。', { error: error instanceof Error ? error.message : String(error) });
    return buildEmptyAgentWorldbookSnapshot_ACU(false);
  }
}

function chronicleAddress_ACU(digest: AgentChronicleDigestView_ACU): string {
  const first = digest.codes[0];
  const last = digest.codes[digest.codes.length - 1];
  return `$CHRONICLES:${first}-${last}`;
}

/**
 * 渲染世界书目录：普通条目一行一条带精读地址；纪要单列概要段带 AM 区间地址。
 * @param snapshot 运行内快照
 * @returns 目录文本，进入主 Agent 骨架的 $WORLDBOOK_CATALOG
 */
export function renderAgentWorldbookCatalog_ACU(snapshot: AgentWorldbookSnapshot_ACU): string {
  if (!snapshot.available) return '本轮世界书读取失败，目录不可用；请勿臆测世界书内容，可照常使用其他资料域。';
  const sections: string[] = [];
  if (snapshot.entries.length) {
    const lines = snapshot.entries.map(entry => {
      const trigger = entry.constant ? '常开' : '关键词触发';
      const keys = entry.keys.length ? entry.keys.join('、') : '（无关键词）';
      return `- ${entry.title}｜关键词：${keys}｜${trigger}｜约 ${entry.content.length} 字 → 读取地址 $WORLDBOOK:${entry.bookName}:${entry.uid}`;
    });
    sections.push(`## 已启用的世界书条目（共 ${snapshot.entries.length} 条，只有这里列出的可读）\n${lines.join('\n')}`);
  } else {
    sections.push('## 已启用的世界书条目\n当前没有已启用的普通世界书条目。');
  }
  if (snapshot.chronicles.length) {
    const lines = snapshot.chronicles.map(digest => `- ${digest.codes[0]}-${digest.codes[digest.codes.length - 1]}（约 ${digest.content.length} 字）→ 读取地址 ${chronicleAddress_ACU(digest)}`);
    sections.push(`## 纪要目录（早期剧情的压缩记录，共 ${snapshot.chronicles.length} 段；正文窗口之前的剧情只能经此回溯）\n${lines.join('\n')}`);
  } else {
    sections.push('## 纪要目录\n当前没有纪要段；早期剧情尚未被压缩，或本聊天还没有跑过总结。');
  }
  return sections.join('\n\n');
}

/**
 * 按书名 + uid 列表精读世界书条目全文，支撑 `$WORLDBOOK:书名:uid1,uid2`。
 * @param snapshot 运行内快照
 * @param bookName 世界书名
 * @param uids 条目 uid 列表
 * @returns 条目全文；未知书名/uid 或条目未启用时回灌可修正的错误文本
 */
export function renderAgentWorldbookEntries_ACU(snapshot: AgentWorldbookSnapshot_ACU, bookName: string, uids: readonly string[]): string {
  if (!snapshot.available) return '本轮世界书读取失败，无法精读条目。';
  const book = String(bookName ?? '').trim();
  const wanted = uids.map(uid => String(uid ?? '').trim()).filter(Boolean);
  if (!book || !wanted.length) return '世界书读取地址不完整：需要 $WORLDBOOK:书名:uid（逗号分隔多个 uid）。地址请从世界书目录复制。';
  const inBook = snapshot.entries.filter(entry => entry.bookName === book);
  if (!inBook.length) return `已启用条目中不存在世界书「${book}」。可用地址见世界书目录；未启用的条目不可读。`;
  const found = inBook.filter(entry => wanted.includes(entry.uid));
  const missing = wanted.filter(uid => !inBook.some(entry => entry.uid === uid));
  const parts: string[] = found.map(entry => `### ${entry.title}（${entry.bookName}#${entry.uid}）\n${entry.content}`);
  if (missing.length) parts.push(`以下 uid 不存在于「${book}」的已启用条目中：${missing.join('、')}。地址请从世界书目录复制。`);
  return parts.join('\n\n');
}

/**
 * 按 AM 码区间读取纪要内容，支撑 `$CHRONICLES:AMa-AMb`。
 * @param snapshot 运行内快照
 * @param firstRaw 区间起始 AM 码
 * @param lastRaw 区间结束 AM 码
 * @returns 命中的纪要段全文（带 AM 码抬头）；区间非法或无命中时回灌可修正的错误文本
 */
export function renderAgentChronicleRange_ACU(snapshot: AgentWorldbookSnapshot_ACU, firstRaw: string, lastRaw: string): string {
  if (!snapshot.available) return '本轮世界书读取失败，无法读取纪要。';
  const first = normalizeAmCode_ACU(firstRaw);
  const last = normalizeAmCode_ACU(lastRaw);
  if (!first || !last || compareAmCodes_ACU(first, last) > 0) {
    return `纪要区间「${firstRaw}-${lastRaw}」不合法：两端都必须是 AM 码（如 AM12）且起始不大于结束。可用区间见纪要目录。`;
  }
  const hit = snapshot.chronicles.filter(digest =>
    digest.codes.some(code => compareAmCodes_ACU(code, first) >= 0 && compareAmCodes_ACU(code, last) <= 0));
  if (!hit.length) return `区间 ${first}-${last} 没有命中任何纪要段。可用区间见纪要目录。`;
  return hit.map(digest => `### 纪要 ${digest.codes.join(', ')}\n${digest.content}`).join('\n\n');
}

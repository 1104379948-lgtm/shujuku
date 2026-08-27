import { getCurrentCharacterWorldbookBinding_ACU } from '../../data/gateways/character-gateway';
import { getIsolationPrefix_ACU, getInjectionTargetLorebook_ACU } from '../worldbook/injection-engine-state';
import { buildCombinedWorldbookContentByStrategy_ACU, getLorebookEntriesByNames_ACU } from '../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { logWarn_ACU } from '../../shared/utils';

export interface ContinuationChronicleRange_ACU {
  first: string;
  last: string;
}

export interface ContinuationChronicleSnapshot_ACU {
  count: number;
  range: ContinuationChronicleRange_ACU | null;
}

interface ContinuationSummaryRow_ACU {
  codes: string[];
  content: string;
  order: number;
}

export interface ContinuationWorldbookAdapterDependencies_ACU {
  resolveRelevantBookNames: () => Promise<string[]>;
  resolveInjectionTarget: () => Promise<string | null>;
  getIsolationPrefix: () => string;
  buildRelevantWorldbookContent: (options: Record<string, unknown>) => Promise<string>;
  readLorebookEntries: (bookNames: string[]) => Promise<Record<string, unknown[]>>;
  logReadFailure: (phase: 'background' | 'history') => void;
}

const AM_CODE_PATTERN_ACU = /^AM\d+$/i;

/** 归一化 AM 码（纪要地址码）；非法返回 null。同时供 Agent 世界书读取工具使用。 */
export function normalizeAmCode_ACU(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  return AM_CODE_PATTERN_ACU.test(code) ? code : null;
}

/** 从世界书条目的 keys 中提取全部 AM 码。 */
export function extractAmCodes_ACU(entry: Record<string, unknown>): string[] {
  const keyValues = Array.isArray(entry.keys)
    ? entry.keys
    : typeof entry.keys === 'string'
      ? entry.keys.split(/[,，]/)
      : [];
  return [...new Set(keyValues
    .map(normalizeAmCode_ACU)
    .filter((code): code is string => code !== null))];
}

/** 去掉隔离前缀后的条目显示名。 */
export function normalizeGeneratedComment_ACU(entry: Record<string, unknown>, isolationPrefix: string): string {
  const raw = String(entry.comment ?? entry.name ?? '').trim();
  return isolationPrefix && raw.startsWith(isolationPrefix) ? raw.slice(isolationPrefix.length) : raw;
}

/** 是否为纪要（总结）条目的显示名。 */
export function isSummaryEntryComment_ACU(comment: string): boolean {
  return /^(?:总结条目|小总结条目)\d+$/.test(comment);
}

function isGeneratedEntryComment_ACU(comment: string): boolean {
  return comment.startsWith('TavernDB-ACU-')
    || comment.startsWith('总结条目')
    || comment.startsWith('小总结条目')
    || comment.startsWith('重要人物条目');
}

/** 按数值语义比较两个 AM 码。 */
export function compareAmCodes_ACU(left: string, right: string): number {
  const leftDigits = left.slice(2).replace(/^0+/, '') || '0';
  const rightDigits = right.slice(2).replace(/^0+/, '') || '0';
  return leftDigits.length - rightDigits.length || leftDigits.localeCompare(rightDigits);
}

function isWithinRange_ACU(code: string, range: ContinuationChronicleRange_ACU): boolean {
  return compareAmCodes_ACU(code, range.first) >= 0 && compareAmCodes_ACU(code, range.last) <= 0;
}

function normalizeRange_ACU(range: ContinuationChronicleRange_ACU | null | undefined): ContinuationChronicleRange_ACU | null {
  const first = normalizeAmCode_ACU(range?.first);
  const last = normalizeAmCode_ACU(range?.last);
  if (!first || !last || compareAmCodes_ACU(first, last) > 0) return null;
  return { first, last };
}

function sortSummaryRows_ACU(rows: ContinuationSummaryRow_ACU[]): ContinuationSummaryRow_ACU[] {
  return [...rows].sort((left, right) => compareAmCodes_ACU(left.codes[0], right.codes[0]) || left.order - right.order);
}

/** 解析当前生效的世界书名单（手动选择或角色绑定）。同时供 Agent 世界书读取工具使用。 */
export async function resolveRelevantBookNames_ACU(): Promise<string[]> {
  const config = getCurrentWorldbookConfig_ACU();
  if (config?.source === 'manual') {
    const manualSelection: unknown[] = Array.isArray(config.manualSelection)
      ? config.manualSelection
      : [];
    return [...new Set(manualSelection
      .map((name: unknown) => String(name ?? '').trim())
      .filter(Boolean))];
  }
  return (await getCurrentCharacterWorldbookBinding_ACU()).orderedNames;
}

// 依赖表里的函数一律延迟绑定：直接引用会在模块求值时就解析 pipeline 的导出，
// 让「谁先被 import」决定本模块能否加载。改成调用时解析后，加载顺序不再影响可用性。
const defaultDependencies_ACU: ContinuationWorldbookAdapterDependencies_ACU = {
  resolveRelevantBookNames: resolveRelevantBookNames_ACU,
  resolveInjectionTarget: () => getInjectionTargetLorebook_ACU(),
  getIsolationPrefix: () => getIsolationPrefix_ACU(),
  buildRelevantWorldbookContent: options => buildCombinedWorldbookContentByStrategy_ACU(options),
  readLorebookEntries: bookNames => getLorebookEntriesByNames_ACU(bookNames),
  logReadFailure: phase => logWarn_ACU('[Continuation] 世界书只读失败。', { phase, error: { category: 'read_failed' } }),
};

/**
 * Continuation 的只读世界书 seam。它只读取当前注入目标世界书，绝不调度剧情任务或写入宿主状态。
 */
export class ContinuationWorldbookContext_ACU {
  constructor(private readonly dependencies: ContinuationWorldbookAdapterDependencies_ACU = defaultDependencies_ACU) {}

  async readRelevantBackground(scanText: string): Promise<string> {
    try {
      const bookNames = await this.dependencies.resolveRelevantBookNames();
      if (!bookNames.length) return '';
      const isolationPrefix = this.dependencies.getIsolationPrefix();
      return await this.dependencies.buildRelevantWorldbookContent({
        logPrefix: '[Continuation]',
        bookNames,
        baseScanText: typeof scanText === 'string' ? scanText : '',
        excludeEntry: (entry: Record<string, unknown>) => isGeneratedEntryComment_ACU(normalizeGeneratedComment_ACU(entry, isolationPrefix)),
        formatEntry: (entry: Record<string, unknown>) => String(entry.content ?? '').trim(),
      });
    } catch {
      this.dependencies.logReadFailure('background');
      return '';
    }
  }

  async readLastStageChronicles(range: ContinuationChronicleRange_ACU | null | undefined): Promise<string> {
    const normalizedRange = normalizeRange_ACU(range);
    if (!normalizedRange) return '';
    const rows = await this.readSummaryRows();
    return sortSummaryRows_ACU(rows.filter(row => row.codes.some(code => isWithinRange_ACU(code, normalizedRange))))
      .map(row => row.content)
      .join('\n\n');
  }

  async readEarlierStageSummaries(ranges: Array<ContinuationChronicleRange_ACU | null | undefined>): Promise<string> {
    const normalizedRanges = ranges.map(normalizeRange_ACU).filter((range): range is ContinuationChronicleRange_ACU => range !== null);
    if (!normalizedRanges.length) return '';
    const rows = await this.readSummaryRows();
    return sortSummaryRows_ACU(rows.filter(row => row.codes.some(code => normalizedRanges.some(range => isWithinRange_ACU(code, range)))))
      .map(row => `${row.codes.join(', ')}\n${row.content}`)
      .join('\n\n');
  }

  async readChronicleSnapshot(): Promise<ContinuationChronicleSnapshot_ACU> {
    const codes = [...new Set((await this.readSummaryRows()).flatMap(row => row.codes))].sort(compareAmCodes_ACU);
    return { count: codes.length, range: codes.length ? { first: codes[0], last: codes[codes.length - 1] } : null };
  }

  private async readSummaryRows(): Promise<ContinuationSummaryRow_ACU[]> {
    try {
      const target = await this.dependencies.resolveInjectionTarget();
      if (!target) return [];
      const entries = this.dependencies.readLorebookEntries([target]);
      const isolationPrefix = this.dependencies.getIsolationPrefix();
      const rows = (await entries)[target] ?? [];
      return rows.flatMap((raw, order) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const entry = raw as Record<string, unknown>;
        if (!isSummaryEntryComment_ACU(normalizeGeneratedComment_ACU(entry, isolationPrefix))) return [];
        const codes = extractAmCodes_ACU(entry);
        const content = String(entry.content ?? '').trim();
        return codes.length && content ? [{ codes, content, order }] : [];
      });
    } catch {
      this.dependencies.logReadFailure('history');
      return [];
    }
  }
}

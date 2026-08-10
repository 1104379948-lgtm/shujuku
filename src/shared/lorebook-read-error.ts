export type LorebookReadErrorCategory_ACU = 'aborted' | 'lorebook_not_found' | 'unknown';

function getLorebookReadErrorMessage_ACU(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

export function classifyLorebookReadError_ACU(error: unknown): LorebookReadErrorCategory_ACU {
  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const message = getLorebookReadErrorMessage_ACU(error);
  if (candidate?.name === 'AbortError' || message === 'TaskAbortedByUser') return 'aborted';

  const isExplicitlyMissingEnglishBook = /\b(?:worldbook|lorebook)\b(?:\s+['\"`][^'\"`\r\n]+['\"`])?\s+(?:not found|does not exist|(?:is\s+)?missing)\b/i.test(message)
    || /\b(?:could not find|cannot find|can't find)\s+(?:the\s+)?(?:worldbook|lorebook)\b/i.test(message);
  const isExplicitlyMissingChineseBook = /世界书(?!\s*条目)\s*(?:[“\"'`][^”\"'`\r\n]+[”\"'`])?\s*(?:未能找到|无法找到|找不到|不存在)/.test(message)
    || /(?:未能找到|无法找到|找不到)\s*世界书(?!\s*条目)/.test(message);

  return isExplicitlyMissingEnglishBook || isExplicitlyMissingChineseBook
    ? 'lorebook_not_found'
    : 'unknown';
}

export function isLorebookReadAbortedError_ACU(error: unknown): boolean {
  return classifyLorebookReadError_ACU(error) === 'aborted';
}

export function isLorebookReadNotFoundError_ACU(error: unknown): boolean {
  return classifyLorebookReadError_ACU(error) === 'lorebook_not_found';
}

/**
 * 纯 duck-typing 的 StrictLorebookReadError 识别。
 * 不 import pipeline，避免 plot-runtime-scope → pipeline → runtime 的循环依赖。
 * 仅检查有限白名单字段，不读取 message/stack。
 */
export function isStrictLorebookReadError_ACU(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    source?: unknown;
    validationPolicy?: unknown;
    runId?: unknown;
    failedBooks?: unknown;
    invalidBookNames?: unknown;
    staleBookNames?: unknown;
  };
  return candidate.name === 'StrictLorebookReadError_ACU'
    && typeof candidate.status === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.validationPolicy === 'string'
    && typeof candidate.runId === 'string'
    && Array.isArray(candidate.failedBooks)
    && Array.isArray(candidate.invalidBookNames)
    && Array.isArray(candidate.staleBookNames);
}

/**
 * 安全摘要：只输出白名单结构化字段，绝不复制 message/stack。
 * 供 plot runtime 顶层与日志使用；pipeline 内可委托本实现避免双份漂移。
 */
export function summarizeStrictLorebookReadError_ACU(error: unknown) {
  if (!isStrictLorebookReadError_ACU(error)) return null;
  const candidate = error as {
    status?: unknown;
    source?: unknown;
    validationPolicy?: unknown;
    runId?: unknown;
    failedBooks?: Array<{ bookName?: unknown; errorCategory?: unknown }>;
    invalidBookNames?: unknown;
    staleBookNames?: unknown;
  };
  const failedBooks = (Array.isArray(candidate.failedBooks) ? candidate.failedBooks : [])
    .filter(failure => failure && typeof failure.bookName === 'string' && typeof failure.errorCategory === 'string')
    .map(failure => ({ bookName: failure.bookName as string, errorCategory: failure.errorCategory as string }));
  return {
    category: 'strict_lorebook_read',
    status: String(candidate.status ?? ''),
    source: String(candidate.source ?? ''),
    validationPolicy: String(candidate.validationPolicy ?? ''),
    runId: String(candidate.runId ?? ''),
    failedCount: failedBooks.length,
    failedBookNames: failedBooks.map(failure => failure.bookName),
    errorCategories: failedBooks.map(failure => failure.errorCategory),
    invalidCount: Array.isArray(candidate.invalidBookNames) ? candidate.invalidBookNames.length : 0,
    staleCount: Array.isArray(candidate.staleBookNames) ? candidate.staleBookNames.length : 0,
  };
}

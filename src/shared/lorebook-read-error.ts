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

import type { Sheet_ACU } from './models/table-data';

function canonicalRowId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const rowId = String(value).trim();
  return rowId ? rowId : null;
}

export function createStableRowIdReservation_ACU(rows: unknown[] | null | undefined): Set<string> {
  const reserved = new Set<string>();
  for (const row of rows || []) {
    if (!Array.isArray(row)) continue;
    const rowId = canonicalRowId_ACU(row[0]);
    if (rowId) reserved.add(rowId);
  }
  return reserved;
}

function positiveSafeIntegerRowId_ACU(value: unknown): number | null {
  const canonical = canonicalRowId_ACU(value);
  if (!canonical || !/^\d+$/.test(canonical)) return null;
  const numeric = Number(canonical);
  return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : null;
}

function storedNextRowId_ACU(sheet: Sheet_ACU): number | null {
  const value = sheet?.sourceData?.nextRowId;
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

/**
 * Resolves the next permanent row ID without mutating the sheet. A persisted
 * high-water mark may advance, but can never be lowered by current row gaps.
 */
export function resolveStableNextRowId_ACU(sheet: Sheet_ACU): number {
  let nextFromRows = 1;
  const rows = Array.isArray(sheet?.content) ? sheet.content.slice(1) : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const numeric = positiveSafeIntegerRowId_ACU(row[0]);
    if (numeric !== null && numeric >= nextFromRows) nextFromRows = numeric + 1;
  }
  return Math.max(nextFromRows, storedNextRowId_ACU(sheet) ?? 1);
}

/**
 * Persists the resolved lower bound before a mutation sequence can delete the
 * current maximum ID. Calling it repeatedly is idempotent and never decreases
 * an existing high-water mark.
 */
export function ensureStableNextRowId_ACU(sheet: Sheet_ACU): number {
  const nextRowId = resolveStableNextRowId_ACU(sheet);
  if (!sheet.sourceData || typeof sheet.sourceData !== 'object') sheet.sourceData = {} as Sheet_ACU['sourceData'];
  sheet.sourceData.nextRowId = nextRowId;
  return nextRowId;
}

/**
 * Reserves a consecutive range on the transaction working copy. Persisting the
 * mutated sheet and rows in one commit makes row allocation rollback-safe.
 */
export function reserveStableRowIdsForSheet_ACU(sheet: Sheet_ACU, count = 1): string[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('row_id reservation count must be a non-negative safe integer');
  const start = ensureStableNextRowId_ACU(sheet);
  const next = start + count;
  if (!Number.isSafeInteger(next)) throw new Error('row_id high-water mark exceeds the safe integer range');
  sheet.sourceData.nextRowId = next;
  return Array.from({ length: count }, (_, index) => String(start + index));
}

/**
 * Materializes template/guide seed rows as new permanent business rows on a
 * transaction working copy. Seed row IDs are descriptive template data, not
 * reusable runtime identities, so every materialized row receives a fresh ID.
 */
export function materializeStableSeedRowsForSheet_ACU(
  sheet: Sheet_ACU,
  seedRows: unknown[] | null | undefined,
): Sheet_ACU['content'] {
  const rows = Array.isArray(seedRows)
    ? seedRows.map(row => Array.isArray(row) ? [...row] : [])
    : [];
  const rowIds = reserveStableRowIdsForSheet_ACU(sheet, rows.length);
  return rows.map((row, index) => {
    if (row.length === 0) return [rowIds[index]];
    row[0] = rowIds[index];
    return row as Sheet_ACU['content'][number];
  });
}

export function allocateStableRowIdForSheet_ACU(sheet: Sheet_ACU): string {
  return reserveStableRowIdsForSheet_ACU(sheet, 1)[0];
}

/**
 * Replaces template-owned source metadata while preserving the runtime row-ID
 * high-water mark. The incoming metadata may advance the mark, but may never
 * remove or lower a value already implied by the persisted sheet.
 */
export function replaceSheetSourceDataPreservingNextRowId_ACU(
  sheet: Sheet_ACU,
  incomingSourceData: unknown,
  highWaterSourceSheet: Sheet_ACU = sheet,
): void {
  const previousNextRowId = resolveStableNextRowId_ACU(highWaterSourceSheet);
  const replacement = incomingSourceData && typeof incomingSourceData === 'object'
    ? JSON.parse(JSON.stringify(incomingSourceData))
    : {};
  sheet.sourceData = replacement as Sheet_ACU['sourceData'];
  const replacementNextRowId = resolveStableNextRowId_ACU(sheet);
  sheet.sourceData.nextRowId = Math.max(previousNextRowId, replacementNextRowId);
}

/**
 * Allocates the smallest unused positive integer ID and reserves it immediately.
 * Legacy row-array helper. New production writes must use the Sheet-level
 * high-water allocator above so deleted IDs are never reused.
 */
export function allocateStableRowId_ACU(reserved: Set<string>): string {
  let candidate = 1;
  while (reserved.has(String(candidate))) candidate += 1;
  const rowId = String(candidate);
  reserved.add(rowId);
  return rowId;
}

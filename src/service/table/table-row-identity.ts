import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { logWarn_ACU } from '../../shared/utils';

export interface NormalizeTableRowIdentityOptions_ACU {
  sourceLabel?: string;
}

export interface TableRowEntry_ACU {
  rowId: string;
  rowIndex: number;
  row: (string | null)[];
}

export function cloneTableRow_ACU(row: (string | null)[]): (string | null)[] {
  return Array.isArray(row) ? row.map(cell => cell ?? null) : [];
}

export function normalizeRowId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function getRowIdFromRow_ACU(row: unknown): string | null {
  if (!Array.isArray(row)) return null;
  return normalizeRowId_ACU(row[0]);
}

export function getSheetHeader_ACU(sheet: Sheet_ACU | null | undefined): (string | null)[] | null {
  if (!sheet || !Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) return null;
  return cloneTableRow_ACU(sheet.content[0]);
}

export function createFallbackRowIdFromIndex_ACU(rowIndex: number): string {
  return String(Math.max(1, rowIndex));
}

export function normalizeRowForIdentity_ACU(row: (string | null)[], rowId: string): (string | null)[] {
  const normalizedRow = cloneTableRow_ACU(row);
  normalizedRow[0] = rowId;
  return normalizedRow;
}

function normalizeHeaderForIdentity_ACU(header: unknown): (string | null)[] {
  if (!Array.isArray(header)) return ['row_id'];
  const normalizedHeader = cloneTableRow_ACU(header as (string | null)[]);
  normalizedHeader[0] = 'row_id';
  return normalizedHeader;
}

export function normalizeSheetRowIdentity_ACU(
  sheet: Sheet_ACU | null | undefined,
  sheetKey = '',
  options: NormalizeTableRowIdentityOptions_ACU = {},
): Sheet_ACU | null | undefined {
  if (!sheet || typeof sheet !== 'object') return sheet;
  if (!Array.isArray((sheet as any).content)) {
    return JSON.parse(JSON.stringify(sheet)) as Sheet_ACU;
  }

  const sourceLabel = options.sourceLabel || 'TableRowIdentity';
  const content = (sheet as any).content as unknown[];
  const normalizedContent: unknown[] = [];
  normalizedContent[0] = normalizeHeaderForIdentity_ACU(content[0]);

  for (let rowIndex = 1; rowIndex < content.length; rowIndex += 1) {
    const row = content[rowIndex];
    if (!Array.isArray(row)) {
      logWarn_ACU(`[${sourceLabel}] Preserve non-array row while normalizing row_id at ${sheetKey || sheet.uid || 'unknown'}#${rowIndex}`);
      normalizedContent[rowIndex] = row;
      continue;
    }

    const explicitRowId = getRowIdFromRow_ACU(row);
    normalizedContent[rowIndex] = explicitRowId
      ? cloneTableRow_ACU(row as (string | null)[])
      : normalizeRowForIdentity_ACU(row as (string | null)[], createFallbackRowIdFromIndex_ACU(rowIndex));
  }

  return {
    ...(JSON.parse(JSON.stringify(sheet)) as Sheet_ACU),
    content: normalizedContent as (string | null)[][],
  };
}

export function normalizeTableDataRowIdentity_ACU(
  data: TableDataObject_ACU | null | undefined,
  options: NormalizeTableRowIdentityOptions_ACU = {},
): TableDataObject_ACU | null {
  if (!data || typeof data !== 'object') return null;

  const cloned = JSON.parse(JSON.stringify(data)) as TableDataObject_ACU;
  for (const key of Object.keys(cloned)) {
    if (!key.startsWith('sheet_')) continue;
    const sheet = cloned[key] as Sheet_ACU;
    const normalizedSheet = normalizeSheetRowIdentity_ACU(sheet, key, options);
    if (normalizedSheet) {
      cloned[key] = normalizedSheet;
    }
  }
  return cloned;
}

export function getDataRowsWithIdentity_ACU(sheet: Sheet_ACU | null | undefined, sheetKey = ''): TableRowEntry_ACU[] {
  if (!sheet || !Array.isArray(sheet.content) || sheet.content.length <= 1) return [];

  const rows: TableRowEntry_ACU[] = [];
  for (let rowIndex = 1; rowIndex < sheet.content.length; rowIndex += 1) {
    const row = sheet.content[rowIndex];
    if (!Array.isArray(row)) {
      logWarn_ACU(`[TableDelta] Skip non-array row at ${sheetKey || sheet?.uid || 'unknown'}#${rowIndex}`);
      continue;
    }

    const explicitRowId = getRowIdFromRow_ACU(row);
    const rowId = explicitRowId || createFallbackRowIdFromIndex_ACU(rowIndex);
    const normalizedRow = explicitRowId ? cloneTableRow_ACU(row) : normalizeRowForIdentity_ACU(row, rowId);

    rows.push({
      rowId,
      rowIndex,
      row: normalizedRow,
    });
  }

  return rows;
}

export function buildRowIdentityMap_ACU(sheet: Sheet_ACU | null | undefined, sheetKey = ''): Map<string, TableRowEntry_ACU> {
  const map = new Map<string, TableRowEntry_ACU>();
  for (const entry of getDataRowsWithIdentity_ACU(sheet, sheetKey)) {
    map.set(entry.rowId, entry);
  }
  return map;
}

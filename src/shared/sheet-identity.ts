import { pinyin } from 'pinyin-pro';
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

export const SHEET_KEY_ALGORITHM_VERSION_ACU = 1;
export const MAX_SHEET_SLUG_LENGTH_ACU = 48;
export const PHYSICAL_TABLE_NAME_ALGORITHM_VERSION_ACU = 1;
const MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU = 48;
const SQLITE_RESERVED_TABLE_PREFIXES_ACU = ['sqlite_', '_acu_'];

export interface SheetNameDiagnostic_ACU {
  code: 'empty_name' | 'duplicate_canonical_name' | 'duplicate_sheet_key';
  index: number;
  originalName: string;
  canonicalName: string;
  candidateKey: string | null;
  conflictsWithIndex?: number;
}

export interface ExistingSheetIdentity_ACU {
  canonicalName: string;
  sheetKey: string;
}

export interface StableSheetKeyAllocationOptions_ACU {
  /** Persisted identities are immutable: allocation may not rewrite their keys. */
  existing?: readonly ExistingSheetIdentity_ACU[];
}

export interface StableSheetKeyAllocation_ACU {
  keys: Array<string | null>;
  diagnostics: SheetNameDiagnostic_ACU[];
}

/** Comparison-only normalization. Never write this value back to the display name. */
export function canonicalizeDisplayName_ACU(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/** Converts a display value to an ASCII slug using the locked pinyin-pro dictionary. */
export function toAsciiSlug_ACU(value: unknown, maxLength = MAX_SHEET_SLUG_LENGTH_ACU): string {
  const canonical = canonicalizeDisplayName_ACU(value);
  if (!canonical) return '';
  const romanized = pinyin(canonical, {
    toneType: 'none',
    traditional: true,
    v: true,
    separator: '_',
    nonZh: 'consecutive',
  });
  return romanized.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, Math.max(1, maxLength))
    .replace(/_+$/g, '');
}

/** Returns an unreserved candidate only; callers must allocate before persisting it. */
export function buildStableSheetKeyCandidate_ACU(displayName: unknown): string | null {
  const slug = toAsciiSlug_ACU(displayName);
  return slug ? `sheet_${slug}` : null;
}

/**
 * Runtime SQLite names are derived from the display name, not from a legacy
 * CREATE TABLE identifier embedded in user-authored DDL. Allocation must use
 * the complete sheet set so slug collisions stay deterministic.
 */
export function resolvePhysicalTableNames_ACU(data: TableDataObject_ACU | Record<string, unknown>): Map<string, string> {
  const entries = Object.keys(data || {})
    .filter(sheetKey => sheetKey.startsWith('sheet_'))
    .sort()
    .map(sheetKey => ({ sheetKey, sheet: (data as Record<string, Sheet_ACU>)[sheetKey] }));
  const baseByKey = new Map(entries.map(({ sheetKey, sheet }) => [sheetKey, physicalTableNameBase_ACU(sheet, sheetKey)]));
  const groups = new Map<string, string[]>();
  for (const [sheetKey, base] of baseByKey) {
    const group = groups.get(base.toLowerCase()) || [];
    group.push(sheetKey);
    groups.set(base.toLowerCase(), group);
  }
  const result = new Map<string, string>();
  for (const { sheetKey } of entries) {
    const base = baseByKey.get(sheetKey)!;
    const group = groups.get(base.toLowerCase())!;
    result.set(sheetKey, group.length === 1 ? base : `${truncatePhysicalTableNameForHash_ACU(base)}_${stableHash_ACU(sheetKey)}`);
  }
  return result;
}

export function getPhysicalTableNameForSheet_ACU(data: TableDataObject_ACU | Record<string, unknown>, sheetKey: string): string {
  const resolved = resolvePhysicalTableNames_ACU(data).get(sheetKey);
  if (!resolved) throw new Error(`无法为 Sheet 分配 SQLite runtime 表名：${sheetKey}`);
  return resolved;
}

/** Use resolvePhysicalTableNames_ACU whenever collision arbitration is possible. */
export function resolvePhysicalTableName_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  return physicalTableNameBase_ACU(sheet, sheetKey);
}

function physicalTableNameBase_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  const displaySlug = toAsciiSlug_ACU(sheet?.name).replace(/_/g, '');
  const keySlug = toAsciiSlug_ACU(String(sheetKey || '').replace(/^sheet_/, '')).replace(/_/g, '');
  let candidate = (displaySlug || keySlug || 'sheet').slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU);
  if (/^[0-9]/.test(candidate) || SQLITE_RESERVED_TABLE_PREFIXES_ACU.some(prefix => candidate.toLowerCase().startsWith(prefix))) {
    candidate = `table_${candidate}`;
  }
  return candidate.slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU) || 'table_sheet';
}

function truncatePhysicalTableNameForHash_ACU(value: string): string {
  return value.slice(0, Math.max(1, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU - 11)).replace(/_+$/g, '') || 'table';
}

/**
 * Allocates identities for a new batch while preserving supplied persisted identities verbatim.
 * Colliding slugs receive a canonical-name hash, so new-key selection is input-order independent.
 */
export function allocateStableSheetKeys_ACU(
  displayNames: readonly unknown[],
  options: StableSheetKeyAllocationOptions_ACU = {},
): StableSheetKeyAllocation_ACU {
  const canonicalNames = displayNames.map(canonicalizeDisplayName_ACU);
  const slugs = displayNames.map(name => toAsciiSlug_ACU(name));
  const diagnostics: SheetNameDiagnostic_ACU[] = [];
  const firstCanonicalIndex = new Map<string, number>();
  const slugGroups = new Map<string, number[]>();
  const existingByCanonicalName = new Map<string, string>();
  const reservedKeys = new Set<string>();
  for (const existing of options.existing || []) {
    const canonicalName = canonicalizeDisplayName_ACU(existing.canonicalName);
    const sheetKey = String(existing.sheetKey || '');
    if (canonicalName && sheetKey) existingByCanonicalName.set(canonicalName, sheetKey);
    if (sheetKey) reservedKeys.add(sheetKey.toLowerCase());
  }

  canonicalNames.forEach((canonicalName, index) => {
    const originalName = String(displayNames[index] ?? '');
    if (!canonicalName || !slugs[index]) {
      diagnostics.push({ code: 'empty_name', index, originalName, canonicalName, candidateKey: null });
      return;
    }
    const firstIndex = firstCanonicalIndex.get(canonicalName);
    if (firstIndex === undefined) firstCanonicalIndex.set(canonicalName, index);
    else diagnostics.push({ code: 'duplicate_canonical_name', index, originalName, canonicalName, candidateKey: null, conflictsWithIndex: firstIndex });
    const group = slugGroups.get(slugs[index]) || [];
    group.push(index);
    slugGroups.set(slugs[index], group);
  });

  const keys: Array<string | null> = slugs.map((slug, index) => {
    if (!slug || !canonicalNames[index]) return null;
    const existingKey = existingByCanonicalName.get(canonicalNames[index]);
    if (existingKey) return existingKey;
    const group = slugGroups.get(slug) || [];
    const bareKey = `sheet_${slug}`;
    if (group.length === 1 && !reservedKeys.has(bareKey.toLowerCase())) return bareKey;
    return `sheet_${truncateForHash_ACU(slug)}_${stableHash_ACU(canonicalNames[index])}`;
  });
  const firstKeyIndex = new Map<string, number>();
  keys.forEach((key, index) => {
    if (!key) return;
    const firstIndex = firstKeyIndex.get(key);
    if (firstIndex === undefined) {
      firstKeyIndex.set(key, index);
    } else {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key, conflictsWithIndex: firstIndex });
    }
    if (!existingByCanonicalName.has(canonicalNames[index]) && reservedKeys.has(key.toLowerCase())) {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key });
    }
  });
  return { keys, diagnostics };
}

function truncateForHash_ACU(slug: string): string {
  return slug.slice(0, Math.max(1, MAX_SHEET_SLUG_LENGTH_ACU - 11)).replace(/_+$/g, '') || 'sheet';
}

function stableHash_ACU(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(0, 10);
}

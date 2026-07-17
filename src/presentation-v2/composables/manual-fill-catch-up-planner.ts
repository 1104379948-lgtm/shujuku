export interface CatchUpSheetState {
  sheetKey: string;
  hasAnyData: boolean;
  hasTrackedUpdate: boolean;
  lastTrackedUpdateAiFloor: number;
}

export interface CatchUpPlanInput {
  aiMessageIndices: number[];
  skipUpdateFloors: number;
  sheets: CatchUpSheetState[];
}

export interface CatchUpGroup {
  targetKeys: string[];
  contextDepth: number;
  startAiFloor: number;
  endAiFloor: number;
}

function validateAiMessageIndices(indices: number[]): void {
  let previous = -1;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index <= previous) {
      throw new Error('aiMessageIndices 必须是严格递增的非负整数数组');
    }
    previous = index;
  }
}

function normalizeSkipUpdateFloors(value: unknown, aiFloorCount: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.floor(numeric), aiFloorCount);
}

function clampTrackedFloor(value: unknown, effectiveTailFloor: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(Math.max(Math.floor(numeric), 0), effectiveTailFloor);
}

export function planManualFillCatchUp(input: CatchUpPlanInput): CatchUpGroup[] {
  validateAiMessageIndices(input.aiMessageIndices);

  const normalizedSkip = normalizeSkipUpdateFloors(input.skipUpdateFloors, input.aiMessageIndices.length);
  const effectiveTailFloor = input.aiMessageIndices.length - normalizedSkip;
  const seenSheetKeys = new Set<string>();
  const groupsByCursor = new Map<number, CatchUpGroup>();

  for (const sheet of input.sheets) {
    const sheetKey = sheet.sheetKey.trim();
    if (!sheetKey) throw new Error('sheetKey 不能为空');
    if (seenSheetKeys.has(sheetKey)) continue;
    seenSheetKeys.add(sheetKey);

    const cursor = !sheet.hasAnyData || !sheet.hasTrackedUpdate
      ? 0
      : clampTrackedFloor(sheet.lastTrackedUpdateAiFloor, effectiveTailFloor);
    if (cursor >= effectiveTailFloor) continue;

    const existing = groupsByCursor.get(cursor);
    if (existing) {
      existing.targetKeys.push(sheetKey);
      continue;
    }

    groupsByCursor.set(cursor, {
      targetKeys: [sheetKey],
      contextDepth: effectiveTailFloor - cursor,
      startAiFloor: cursor + 1,
      endAiFloor: effectiveTailFloor,
    });
  }

  return [...groupsByCursor.values()].sort((left, right) => left.startAiFloor - right.startAiFloor);
}

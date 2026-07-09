import { getCurrentCharacterFallback_ACU } from '../../data/gateways/host-state-gateway';
import { topLevelWindow_ACU } from '../../shared/env';

interface PlotTaskRuntimeResult_ACU {
  rawResponse: string;
  extractedTags: Record<string, string[] | string> | null;
}

const plotTaskRuntimeResults_ACU = new Map<string, PlotTaskRuntimeResult_ACU>();
const currentUserInputs_ACU = new Map<string, string>();
const promptDrafts_ACU = new Map<string, string>();
let currentMainReplyAiResponse_ACU: string | null = null;
let currentMainReplyRequestId_ACU: string | null = null;

export function setScriptPlotTaskRuntimeResult_ACU(taskId: string, result: PlotTaskRuntimeResult_ACU): void {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) return;
  plotTaskRuntimeResults_ACU.set(normalizedTaskId, {
    rawResponse: String(result.rawResponse || ''),
    extractedTags: result.extractedTags && typeof result.extractedTags === 'object' ? result.extractedTags : null,
  });
}

export function clearScriptPlotTaskRuntimeResults_ACU(): void {
  plotTaskRuntimeResults_ACU.clear();
}

export function setScriptCurrentMainReplyAiResponse_ACU(response: string | null): void {
  currentMainReplyAiResponse_ACU = typeof response === 'string' && response.trim() ? response : null;
}

export function setScriptCurrentMainReplyRequestId_ACU(requestId: string | null): void {
  const normalized = String(requestId || '').trim();
  currentMainReplyRequestId_ACU = normalized || null;
}

export function getScriptCurrentMainReplyRequestId_ACU(): string | null {
  return currentMainReplyRequestId_ACU;
}

export function setScriptCurrentUserInput_ACU(kind: 'original' | 'effective' | 'plot_effective', value: string | null): void {
  const normalizedKind = String(kind || '').trim();
  if (!normalizedKind) return;
  const text = typeof value === 'string' ? value : '';
  if (text) currentUserInputs_ACU.set(normalizedKind, text);
  else currentUserInputs_ACU.delete(normalizedKind);
}

export function setScriptPromptDraft_ACU(kind: string, value: string | null, taskId?: string): void {
  const normalizedKind = String(kind || '').trim();
  if (!normalizedKind) return;
  const key = `${normalizedKind}:${String(taskId || '').trim()}`;
  const text = typeof value === 'string' ? value : '';
  if (text) promptDrafts_ACU.set(key, text);
  else promptDrafts_ACU.delete(key);
}

export function clearScriptTavernRuntimeState_ACU(): void {
  currentUserInputs_ACU.clear();
  promptDrafts_ACU.clear();
  currentMainReplyAiResponse_ACU = null;
  currentMainReplyRequestId_ACU = null;
  plotTaskRuntimeResults_ACU.clear();
}

function getScriptPlotTaskRuntimeResult_ACU(taskId: string): PlotTaskRuntimeResult_ACU | null {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) return null;
  return plotTaskRuntimeResults_ACU.get(normalizedTaskId) || null;
}

function getOfficialTavernContext_ACU(): any {
  try {
    const st = (topLevelWindow_ACU as any)?.SillyTavern;
    const context = typeof st?.getContext === 'function' ? st.getContext() : null;
    return context && typeof context === 'object' ? context : {};
  } catch (_) {
    return {};
  }
}

export function getCurrentScriptScope_ACU() {
  const character = getCurrentCharacterFallback_ACU();
  const w = topLevelWindow_ACU as any;
  const stContext = w?.SillyTavern?.getContext?.();
  const characterId = String(
    character?.avatar
    || stContext?.characterId
    || '',
  );
  return {
    chatId: String(stContext?.chatId || stContext?.chatMetadata?.file_name || ''),
    characterId,
    characterName: String(character?.name || stContext?.name2 || ''),
  };
}

export function createScriptTavernFacade_ACU() {
  return getOfficialTavernContext_ACU();
}

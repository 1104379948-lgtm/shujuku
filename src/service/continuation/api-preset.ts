import { resolveApiConfigByPreset_ACU, type ApiPresetApiConfig_ACU, type ApiPresetApiMode_ACU } from '../settings/api-preset-service';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationSettings_ACU,
} from './model';

export interface ContinuationResolvedApiPreset_ACU {
  presetName: string;
  source: 'current' | 'fixed';
  reason: 'fixed_preset' | 'current_configuration';
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
  tavernProfile: string;
}

type ApiPresetResolution_ACU = Omit<ContinuationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'> & { resolved: boolean };
export interface ContinuationApiPresetDependencies_ACU {
  resolvePreset: (presetName: string) => ApiPresetResolution_ACU;
}

const defaultDependencies_ACU: ContinuationApiPresetDependencies_ACU = {
  resolvePreset: resolveApiConfigByPreset_ACU,
};

function failPreset_ACU(phase: ContinuationErrorPhase_ACU, reason: 'empty' | 'missing'): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(
    'CONTINUATION_API_PRESET_MISSING',
    phase,
    reason === 'empty' ? '固定智能续写 API 预设不能为空' : '智能续写 API 预设不存在或已失效',
    false,
    { reason },
  ));
}

export function resolveContinuationApiPreset_ACU(settings: Pick<ContinuationSettings_ACU, 'apiPresetMode' | 'fixedApiPresetName'>, phase: ContinuationErrorPhase_ACU, dependencies: ContinuationApiPresetDependencies_ACU = defaultDependencies_ACU): ContinuationResolvedApiPreset_ACU {
  if (settings.apiPresetMode === 'fixed') {
    const presetName = settings.fixedApiPresetName.trim();
    if (!presetName) failPreset_ACU(phase, 'empty');
    const resolved = dependencies.resolvePreset(presetName);
    if (!resolved.resolved) failPreset_ACU(phase, 'missing');
    return { presetName, source: 'fixed', reason: 'fixed_preset', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile };
  }
  if (settings.apiPresetMode !== 'current') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_MISSING', phase, '智能续写 API 预设模式非法', false));
  }
  const resolved = dependencies.resolvePreset('');
  return { presetName: '', source: 'current', reason: 'current_configuration', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile };
}

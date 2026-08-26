import { callContinuationInternalAi_ACU } from './internal-ai-call';
import { normalizeContinuationInternalAiRetryLimit_ACU } from './defaults';
import { resolveContinuationApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from './api-preset';
import { validateReplannedStageOutline_ACU, resolveContinuationTurnRange_ACU, validateStageOutline_ACU } from './outline-schema';
import { buildStageOutlineFromTags_ACU, parseOutlineTags_ACU, spliceOutlineWithCompletedPrefix_ACU } from './outline-tags';
import { renderContinuationPrompt_ACU, type ContinuationPromptPlaceholder_ACU } from './prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationReplanConstraints_ACU,
  type ContinuationRevisionReason_ACU,
  type ContinuationSettings_ACU,
  type StageOutline_ACU,
  type StageRevision_ACU,
} from './model';

export interface ContinuationOutlinePlanningRequest_ACU {
  settings: ContinuationSettings_ACU;
  reason: ContinuationRevisionReason_ACU;
  createInternalRequestIdentity: (attempt: number) => ContinuationInternalAiRequestIdentity_ACU & { source: 'outline' };
  isInternalRequestCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  /** node/turn 的 ID 分配器。模型不再输出 id，结构标识全部由运行时生成。 */
  allocateId: (prefix: string) => string;
  replanInstruction?: string;
  replanConstraints?: ContinuationReplanConstraints_ACU;
  resolvers?: Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string | null | undefined> | null | undefined>>;
}

export interface ContinuationOutlinePlanningResult_ACU {
  outline: StageOutline_ACU;
  attempts: number;
  apiPreset: Pick<ContinuationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'>;
  requiresReview: boolean;
}

export interface ContinuationOutlinePlannerDependencies_ACU {
  resolveApiPreset: typeof resolveContinuationApiPreset_ACU;
  callInternalAi: (messages: Array<{ role: string; content: string }>, preset: ContinuationResolvedApiPreset_ACU, identity: ContinuationInternalAiRequestIdentity_ACU) => Promise<string | null>;
}

const defaultDependencies_ACU: ContinuationOutlinePlannerDependencies_ACU = {
  resolveApiPreset: resolveContinuationApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
};

function toPlannerError_ACU(error: unknown): ContinuationError_ACU {
  if (error instanceof ContinuationValidationError_ACU) return error.error;
  return createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'outline_call', '阶段大纲内部 AI 调用失败', true);
}

function compactValidationError_ACU(error: ContinuationError_ACU): string {
  // 附上 message：标签口径下剩余的校验错误（轮数超范围、goal 为空）只有带原因模型才能自愈。
  return `${error.code}@${error.phase}: ${error.message}`;
}

function isRetryableOutlineError_ACU(error: ContinuationError_ACU): boolean {
  if (error.code === 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' || error.code === 'CONTINUATION_OUTLINE_JSON_INVALID') return true;
  if (error.phase === 'outline_validate') return true;
  return error.code === 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED'
    || error.code === 'CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH';
}


export class ContinuationOutlinePlanner_ACU {
  constructor(private readonly dependencies: ContinuationOutlinePlannerDependencies_ACU = defaultDependencies_ACU) {}

  async plan(request: ContinuationOutlinePlanningRequest_ACU, apiDependencies?: ContinuationApiPresetDependencies_ACU): Promise<ContinuationOutlinePlanningResult_ACU> {
    const range = resolveContinuationTurnRange_ACU(request.settings.stageSize, request.settings.customTurnMin ?? undefined, request.settings.customTurnMax ?? undefined);
    const preset = this.dependencies.resolveApiPreset(request.settings, request.reason === 'manual_replan' ? 'replan' : 'outline_call', apiDependencies);
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(request.settings.internalAiRetryLimit);
    let lastError: ContinuationError_ACU | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const identity = request.createInternalRequestIdentity(attempt);
        const isCurrent = request.isInternalRequestCurrent;
        if (!isCurrent(identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '阶段大纲内部请求已失效', false));
        }
        const resolvers = { ...request.resolvers };
        if (attempt > 0 && lastError) resolvers.$VALIDATION_ERRORS = () => compactValidationError_ACU(lastError!);
        const rendered = await renderContinuationPrompt_ACU(request.settings.outlinePrompt, resolvers, request.reason === 'manual_replan' ? 'replan' : 'outline_prompt');
        const raw = await this.dependencies.callInternalAi(rendered.messages, preset, identity);
        if (!isCurrent(identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '阶段大纲内部结果已失效', false));
        }
        const constraints = request.replanConstraints;
        const parsed = parseOutlineTags_ACU(raw);
        const built = buildStageOutlineFromTags_ACU(parsed, request.allocateId, constraints ? { title: constraints.previousOutline.title, goal: constraints.previousOutline.goal } : undefined);
        // 重规划：模型只规划剩余轮次，已完成前缀由运行时拼回；剩余轮数额度放宽，
        // 只要求拼接后 totalTurns 落在阶段规模范围内（校验按实际拼接结果传额度）。
        const candidate = constraints ? spliceOutlineWithCompletedPrefix_ACU(constraints.previousOutline, constraints.completedTurns, built) : built;
        const outline = constraints
          ? validateReplannedStageOutline_ACU(candidate, range, { ...constraints, expectedRemainingTurns: candidate.totalTurns - constraints.completedTurns })
          : validateStageOutline_ACU(candidate, range);
        return { outline, attempts: attempt + 1, apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason }, requiresReview: request.settings.outlinePreview };
      } catch (error) {
        lastError = toPlannerError_ACU(error);
        if (!isRetryableOutlineError_ACU(lastError)) throw error;
      }
    }

    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_OUTLINE_RETRY_EXHAUSTED',
      lastError?.phase ?? 'outline_call',
      '阶段大纲生成重试次数已耗尽',
      false,
      { attempts: retries + 1, lastErrorCode: lastError?.code ?? 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' },
    ));
  }
}

export function createPlannedStageRevision_ACU(outline: StageOutline_ACU, revision: number, reason: ContinuationRevisionReason_ACU, replanInstruction = '', createdAt = Date.now()): StageRevision_ACU {
  return { revision, createdAt, reason, replanInstruction, frozen: false, outline };
}

/** Revalidates a user-edited preview before it becomes eligible for execution. */
export function acceptPlannedStageRevision_ACU(revision: StageRevision_ACU, settings: ContinuationSettings_ACU, replanConstraints?: ContinuationReplanConstraints_ACU): StageRevision_ACU {
  if (revision.frozen) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_REVISION_FROZEN', 'replan', '已冻结的阶段 revision 不可编辑', false));
  }
  const range = resolveContinuationTurnRange_ACU(settings.stageSize, settings.customTurnMin ?? undefined, settings.customTurnMax ?? undefined);
  const outline = replanConstraints
    ? validateReplannedStageOutline_ACU(revision.outline, range, replanConstraints)
    : validateStageOutline_ACU(revision.outline, range);
  return freezePlannedStageRevision_ACU({ ...revision, outline });
}

export function freezePlannedStageRevision_ACU(revision: StageRevision_ACU): StageRevision_ACU {
  return { ...revision, frozen: true, outline: { ...revision.outline, nodes: revision.outline.nodes.map(node => ({ ...node, turns: node.turns.map(turn => ({ ...turn })) })) } };
}

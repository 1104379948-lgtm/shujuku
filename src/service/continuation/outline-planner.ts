import { callContinuationInternalAi_ACU } from './internal-ai-call';
import { normalizeContinuationInternalAiRetryLimit_ACU } from './defaults';
import { resolveContinuationAgentApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from './api-preset';
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
  resolveApiPreset: typeof resolveContinuationAgentApiPreset_ACU;
  callInternalAi: (messages: Array<{ role: string; content: string }>, preset: ContinuationResolvedApiPreset_ACU, identity: ContinuationInternalAiRequestIdentity_ACU) => Promise<string | null>;
}

const defaultDependencies_ACU: ContinuationOutlinePlannerDependencies_ACU = {
  resolveApiPreset: resolveContinuationAgentApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
};

function toPlannerError_ACU(error: unknown): ContinuationError_ACU {
  if (error instanceof ContinuationValidationError_ACU) return error.error;
  return createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'outline_call', '阶段大纲内部 AI 调用失败', true);
}

function compactValidationError_ACU(error: ContinuationError_ACU): string {
  // 附上 message 与 details：轮数超范围这类错误只有带上具体数字（min/max/actual）模型才能自愈，
  // 光说「超出范围」等于没说。
  const base = `${error.code}@${error.phase}: ${error.message}`;
  if (!error.details || !Object.keys(error.details).length) return base;
  try {
    return `${base}（${JSON.stringify(error.details)}）`;
  } catch {
    return base;
  }
}

/**
 * 渲染 $TURN_RANGE 的权威文案。planner 是唯一同时掌握阶段规模范围与重规划约束的模块，
 * 因此该占位符在这里注入并覆盖外部同名解析器。
 * @param range 阶段总轮数范围
 * @param constraints 重规划约束；提供时模型只规划剩余轮次，需换算剩余轮数允许区间
 * @returns 给大纲 AI 的范围说明；剩余额度不足时如实说明真实约束
 */
export function renderContinuationTurnRange_ACU(range: { min: number; max: number }, constraints?: ContinuationReplanConstraints_ACU): string {
  const total = `本阶段总轮数（全部 <turn> 的数量）必须在 ${range.min} 到 ${range.max} 之间。`;
  if (!constraints || constraints.completedTurns <= 0) return total;
  const completed = constraints.completedTurns;
  const remainingMin = Math.max(1, range.min - completed);
  const remainingMax = range.max - completed;
  if (remainingMax < remainingMin) {
    return `${total}已完成 ${completed} 轮不可改动，剩余轮数额度不足（最多还能规划 ${Math.max(0, remainingMax)} 轮），当前阶段无法在范围内继续扩展。`;
  }
  return `${total}其中已完成 ${completed} 轮不可改动；你只规划剩余轮次，剩余的 <turn> 数量必须在 ${remainingMin} 到 ${remainingMax} 之间（拼接后总轮数才会落在范围内）。`;
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
    const preset = this.dependencies.resolveApiPreset(request.settings, 'outline', request.reason === 'manual_replan' ? 'replan' : 'outline_call', apiDependencies);
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
        // $TURN_RANGE 由 planner 权威注入：只有这里同时知道范围与重规划约束。
        resolvers.$TURN_RANGE = () => renderContinuationTurnRange_ACU(range, request.replanConstraints);
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

import { CONTINUATION_AGENT_API_PRESET_ROLES_ACU, ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationAgentApiPresets_ACU, type ContinuationPromptSegment_ACU, type ContinuationSettings_ACU, type ContinuationStageSize_ACU, type ContinuationTurnRange_ACU } from './model';
import { buildDefaultContinuationAgentPrompts_ACU } from './agent/agent-defaults';

export const CONTINUATION_TURN_RANGES_ACU: Readonly<Record<Exclude<ContinuationStageSize_ACU, 'custom'>, ContinuationTurnRange_ACU>> = {
  short: { min: 3, max: 5 },
  standard: { min: 6, max: 10 },
  long: { min: 11, max: 20 },
};

const DEFAULT_OUTLINE_PROMPT_ACU: readonly ContinuationPromptSegment_ACU[] = [
  {
    role: 'system',
    content: '你是专业的小说阶段规划助手。负责根据故事背景与历史进展，为下一阶段规划剧情大纲。\n输出格式：把大纲内容写入下列标签，标签外可以自由书写你的思路与分析，系统只读取标签内的内容。\n<stage_title>阶段标题</stage_title>\n<stage_goal>阶段整体目标</stage_goal>\n<node>\n<node_title>节点标题</node_title>\n<node_goal>节点目标</node_goal>\n<turn>本轮剧情目标（每轮一个 turn 标签，内容为该轮要发生的具体剧情）</turn>\n</node>\n节点数量不限，每个 <node> 内至少一个 <turn>；全部 <turn> 的总数就是本阶段的轮数，必须落在给定的阶段轮数范围内。\n不要输出 JSON，不要输出 id、编号或轮数统计字段——结构编号全部由系统自动生成。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '收到。我作为小说阶段规划助手，会把阶段标题、阶段目标、各节点与逐轮剧情目标分别写入 <stage_title>、<stage_goal>、<node>、<node_title>、<node_goal>、<turn> 标签中；标签外只写思路分析，不输出 JSON、id 或任何编号统计字段，并保证全部 <turn> 总数落在给定的轮数范围内。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【大纲方法论与强约束】：\n1. 节奏与阶段分摊：严禁在前半卷或当前阶段将主线矛盾“一次性打穿”。早期阶段仅做铺垫或启动，中段必须让风险升级并出现反转/误导，只有高潮阶段才允许收束本卷目标，且必须保留更高层冲突。\n2. 冲突与障碍递进：每个节点的 goal 必须体现障碍的逐步升高。不要让主角应对同一层次的阻碍“换皮重复”；必须包含环境压力、目标置换或连锁反应。\n3. 情绪弧线与读者期待：注意情绪微弧线的建立，主角面对不利转折必须源于外部高压而非自身降智；压抑后必有加倍反击。明确指出本阶段要埋设、推进或收束哪些伏笔（Payoff），兑现读者期待。\n4. 动态信息差与悬念：在节点 goal 中设计局部信息揭露（需体现开局→中段→结尾的动态变化），并在阶段末留下跨阶段悬念（钩子）。\n5. 实体一致性白名单：参与实体只能从上下文已知角色或场景中选取，绝对禁止凭空自创、捏造新人物或核心组织。动作主体必须明确。\n6. 拒绝空泛与AI味：每个节点的目标必须包含具体的动作、实质性价值改变（地位/资源/情报/关系）。场景要求具备“行动、阻碍、悬念”三要素。禁止使用“大战一触即发”、“深化羁绊”等抽象判词，必须用具体事实填充。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '我已深入理解小说大纲的方法论。在规划每个节点（node）和轮次（turn）的目标时，我会：\n1. 严格控制节奏分摊，前半段主做铺垫与中点反转，保留底牌，不强行完结主线；\n2. 落实“行动、阻碍、悬念”三要素，确保冲突递进而非平庸重复；\n3. 设计明显的情绪曲线（压抑后必有释放），并维护清晰的信息差动态变化；\n4. 遵守实体白名单，严格从提供的上下文中调用角色与实体，绝不自创幻觉；\n5. 确保节点内容丰满，每一轮次的目标都具体到“发生了什么危机、做出了什么选择、揭示了什么信息”及“下一阶段悬念”，足以支撑详细正文。\n我会将这些原则落实到各个标签的内容中。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '初始要求：\n$ORIGIN_INSTRUCTION\n\n阶段轮数范围：\n$TURN_RANGE\n\n当前任务阶段历史：\n$STAGE_HISTORY\n\n当前阶段已完成的部分（仅供衔接参考，严禁在标签中重新输出这些内容，只规划其后的剩余轮次）：\n$COMPLETED_STAGE_PART\n\n重规划补充要求：\n$REPLAN_INSTRUCTION\n\n剩余轮数参考（可按剧情需要增减，只需保证全阶段总轮数在范围内）：\n$REMAINING_TURNS\n\n相关世界书背景：\n$1\n\n上一阶段纪要：\n$LAST_STAGE_CHRONICLES\n\n更早阶段概要：\n$EARLIER_STAGE_SUMMARIES\n\n最近剧情：\n$RECENT_STORY\n\n上次校验错误：\n$VALIDATION_ERRORS\n\n请严格基于上述上下文，规划当前阶段的后续剧情大纲，并按规定标签输出。',
    enabled: true,
    deletable: true,
  },
];

export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_ACU = 'spv1.0-continuation-prompt-pseudo-role-v2';
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V7_ACU = 'spv1.5-continuation-prompt-pseudo-role-v7';
/** Agent 续写链路上线版本。旧版本一律强制刷新为 Agent 提示词组。 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V8_ACU = 'spv1.6-continuation-agent-prompt-v8';
/** 大纲标签化版本：大纲提示词改为标签口径并移除 JSON 预填充。旧版本一律强制刷新。 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V9_ACU = 'spv1.7-continuation-outline-tags-v9';

function clonePromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

export function buildDefaultContinuationOutlinePrompt_ACU(): ContinuationPromptSegment_ACU[] {
  return clonePromptSegments_ACU(DEFAULT_OUTLINE_PROMPT_ACU);
}

/** 六个角色默认全部沿用全局渠道配置，保证旧信封无感迁移。 */
export function buildDefaultContinuationAgentApiPresets_ACU(): ContinuationAgentApiPresets_ACU {
  const presets = {} as ContinuationAgentApiPresets_ACU;
  for (const role of CONTINUATION_AGENT_API_PRESET_ROLES_ACU) {
    presets[role] = { mode: 'inherit', presetName: '' };
  }
  return presets;
}

export function buildDefaultContinuationSettings_ACU(): ContinuationSettings_ACU {
  return {
    stageSize: 'standard',
    customTurnMin: null,
    customTurnMax: null,
    outlinePreview: false,
    autoNextStage: true,
    maxAutomaticStages: 6,
    loopTags: '',
    loopDelaySeconds: 5,
    totalDurationMinutes: 0,
    retryDelaySeconds: 3,
    generationRetryLimit: 3,
    internalAiRetryLimit: 3,
    contextTurnCount: 3,
    contextExtractRules: [],
    contextExcludeRules: [],
    apiPresetMode: 'current',
    fixedApiPresetName: '',
    agentApiPresets: buildDefaultContinuationAgentApiPresets_ACU(),
    outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU(),
    agentPrompts: buildDefaultContinuationAgentPrompts_ACU(),
    promptForceDefaultVersion: CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V9_ACU,
  };
}

function normalizeOptionalInteger_ACU(value: unknown, fallback: number, minimum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_NOT_INTEGER', 'load', `${field} 必须是整数`, false, { field, valueType: typeof value }));
  }
  if (value < minimum) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_OUT_OF_RANGE', 'load', `${field} 超出允许范围`, false, { field, minimum, actual: value }));
  }
  return value;
}

/** Missing values receive the supplied default; 0 remains a valid explicit retry limit. */
export function normalizeContinuationInternalAiRetryLimit_ACU(value: unknown, fallback = 3): number {
  return normalizeOptionalInteger_ACU(value, fallback, 0, 'internalAiRetryLimit');
}

/** Missing values receive the supplied default; 0 is rejected because auto-stage limit must be positive. */
export function normalizeContinuationMaxAutomaticStages_ACU(value: unknown, fallback = 6): number {
  return normalizeOptionalInteger_ACU(value, fallback, 1, 'maxAutomaticStages');
}

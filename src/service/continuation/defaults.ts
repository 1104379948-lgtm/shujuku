import { CONTINUATION_AGENT_API_PRESET_ROLES_ACU, ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationAgentApiPresets_ACU, type ContinuationPromptSegment_ACU, type ContinuationSettings_ACU, type ContinuationStageSize_ACU, type ContinuationTurnRange_ACU } from './model';
import { buildDefaultContinuationAgentPrompts_ACU } from './agent/agent-defaults';
import {
  AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU,
  AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
} from './agent/agent-model';

export const CONTINUATION_TURN_RANGES_ACU: Readonly<Record<Exclude<ContinuationStageSize_ACU, 'custom'>, ContinuationTurnRange_ACU>> = {
  short: { min: 3, max: 5 },
  standard: { min: 6, max: 10 },
  long: { min: 11, max: 20 },
};

const DEFAULT_OUTLINE_PROMPT_ACU: readonly ContinuationPromptSegment_ACU[] = [
  {
    role: 'system',
    content: '你是专业的小说阶段规划助手。负责根据故事背景与历史进展，为下一阶段规划剧情大纲。\n输出格式：把大纲内容写入下列标签，标签外可以自由书写你的思路与分析，系统只读取标签内的内容。\n<stage_title>阶段标题</stage_title>\n<stage_goal>阶段整体目标</stage_goal>\n<node>\n<node_title>节点标题</node_title>\n<node_goal>节点目标</node_goal>\n<turn pacing="setup">本轮剧情目标（每轮一个 turn 标签，内容为该轮要发生的具体剧情）</turn>\n</node>\n每个 <turn> 都必须带 pacing 属性，取值只能是 setup / pressure / turn / cooldown 四者之一，含义见节奏配比条款。\n节点数量不限，每个 <node> 内至少一个 <turn>；全部 <turn> 的总数就是本阶段的轮数，必须落在给定的阶段轮数范围内。\n不要输出 JSON，不要输出 id、编号或轮数统计字段——结构编号全部由系统自动生成。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '收到。我作为小说阶段规划助手，会把阶段标题、阶段目标、各节点与逐轮剧情目标分别写入 <stage_title>、<stage_goal>、<node>、<node_title>、<node_goal>、<turn> 标签中，并给每个 <turn> 标注 pacing 属性；标签外只写思路分析，不输出 JSON、id 或任何编号统计字段，并保证全部 <turn> 总数落在给定的轮数范围内。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【阶段容量：先算清楚这个阶段装得下什么】\n$STAGE_WORD_BUDGET\n\n一个阶段只够讲完一件事的起承转合，不是一段旅程。判断标准很简单：把这个阶段的所有轮目标连起来读，如果它像一部电影的梗概，那就是超载；它应该像一场戏的分镜。\n典型超载反例（禁止照此规划）：一个 8 轮阶段里同时安排「路上遇袭 → 抵达城池 → 赴宴周旋 → 深夜密谈 → 潜入调查 → 追踪可疑者 → 落入陷阱 → 被人所救」。这是三个阶段的量：遇袭与抵达是一个阶段，赴宴与密谈是一个阶段，夜查、追踪、陷阱与获救是一个阶段。硬塞进 8 轮的结果是每轮变成流水账提要，正文模型只能用一千字草草带过一整场戏。\n判断超载时宁可少装：阶段目标定小一点、写深一点，比塞满了写浅要好。剩下的内容会有下一个阶段承接，不会丢。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【节奏配比：故事需要呼吸】\n每个 <turn> 标注四档之一：\n- setup 铺垫日常：关系推进、生活场景、准备工作、信息沉淀。没有外部危机，价值体现在人物关系变化、读者对角色的理解加深、或为后续埋线。\n- pressure 冲突推进：危机、对抗、外部高压。主角被逼做出选择并付出代价。\n- turn 转折揭示：反转、信息揭露、伏笔回收。局势的性质在这一轮发生改变。\n- cooldown 余波消化：战后疗伤、复盘、情绪落地、关系在事件之后的重新校准。\n\n硬性配比要求（不满足会被系统打回重排）：\n1. 低压轮（setup + cooldown）在本阶段占比不得低于给定的最低比例。\n2. 连续的 pressure / turn 不得超过 3 轮——第 4 轮必须是 setup 或 cooldown。\n\n为什么必须这样：读者对紧张的感知是相对的。连续八轮全是危机，第八轮的危机读起来和第一轮一样，甚至更钝；中间插一轮安静的日常，后面那轮危机才重新有分量。同理，重大冲突之后不给一轮 cooldown，人物的代价就没有落点，读者感受不到刚才那场戏的重量。低压轮不是浪费篇幅，它是让高压轮生效的前提。\nsetup 与 cooldown 轮同样要写具体：写清谁和谁在什么场景做什么、这一轮之后他们之间有什么变化，不要写「日常互动」「气氛缓和」这种空话。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【大纲方法论与强约束】：\n1. 节奏与阶段分摊：严禁在前半卷或当前阶段将主线矛盾“一次性打穿”。早期阶段仅做铺垫或启动，中段必须让风险升级并出现反转/误导，只有高潮阶段才允许收束本卷目标，且必须保留更高层冲突。\n2. 冲突与障碍递进：整个阶段的 pressure / turn 轮连起来看，障碍必须逐步升高，不要让主角应对同一层次的阻碍“换皮重复”；节点 goal 要体现这条递进线。这条要求作用在冲突线上，不要求每一轮都升级——setup 与 cooldown 轮本来就不承载障碍。\n3. 情绪弧线与伏笔操作显式化：注意情绪微弧线的建立，主角面对不利转折必须源于外部高压而非自身降智；压抑后必有加倍反击。涉及伏笔的轮目标要写明本轮做哪种操作（埋设/强化/误导/回收）及操作对象，不要只写“推进伏笔”这类模糊表述。\n4. 动态信息差与悬念：在节点与轮目标中设计局部信息揭露，写明本轮允许揭示到哪一层（需体现开局→中段→结尾的动态变化），并在阶段末留下跨阶段悬念（钩子）。\n5. 实体一致性白名单：参与实体只能从上下文已知角色或场景中选取，绝对禁止凭空自创、捏造新人物或核心组织。动作主体必须明确。\n6. 拒绝空泛与AI味：每个目标都必须落到具体的动作与具体的变化上，禁止使用“大战一触即发”、“深化羁绊”等抽象判词。pressure 与 turn 轮要具备“行动、阻碍、悬念”三要素，并带来地位、资源、情报或关系上的实质改变；setup 与 cooldown 轮不需要外部阻碍，它们的价值体现在关系变化、信息沉淀与情绪落地——但同样要写清具体是什么变化，不能用空话交差。\n7. 轮承载量硬约束：正文模型每轮只输出约 800-1200 字。每个 <turn> 只承载一个场景片段、至多两个情节节拍，写得下“一次冲突 + 一个变化 + 一个钩子”即为满载；严禁把多个场景、多次转折或跨地点的大事件塞进同一轮——装不下的内容拆成多轮，多到一个阶段装不下就留给下一个阶段。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '我已深入理解小说大纲的方法论。在规划每个节点（node）和轮次（turn）的目标时，我会：\n1. 先按阶段容量算清楚这个阶段装得下多少内容，宁可把阶段目标定小写深，也不把一段旅程压进一个阶段；\n2. 给每个 <turn> 标注 pacing，保证低压轮占比达标、连续高压不超过三轮，让紧张有对照物、让代价有落点；\n3. 严格控制节奏分摊，前半段主做铺垫与中点反转，保留底牌，不强行完结主线；\n4. 在 pressure / turn 轮落实“行动、阻碍、悬念”三要素并让冲突线逐级升高；setup / cooldown 轮写具体的关系变化、信息沉淀与情绪落地，不写空话也不硬造危机；\n5. 设计明显的情绪曲线（压抑后必有释放），涉及伏笔的轮目标写明操作种类与对象，信息揭露写明允许揭到哪一层；\n6. 遵守实体白名单，严格从提供的上下文中调用角色与实体，绝不自创幻觉；\n7. 尊重轮承载量：每轮只装一个场景片段、至多两个节拍，绝不把正文模型 800-1200 字写不完的内容塞进一轮；\n8. 让阶段目标落在故事总纲当前推进中的那一级台阶内，不触碰总纲里标注为禁止提前释放的底牌，并在阶段末留下跨阶段悬念。\n我会将这些原则落实到各个标签的内容中。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '初始要求：\n$ORIGIN_INSTRUCTION\n\n【故事总纲】（本阶段必须落在当前 active 卷的台阶之内；标注为禁止提前释放的底牌，本阶段一律不许翻）：\n$STORY_ARC\n\n阶段轮数范围：\n$TURN_RANGE\n\n当前任务阶段历史：\n$STAGE_HISTORY\n\n当前阶段已完成的部分（仅供衔接参考，严禁在标签中重新输出这些内容，只规划其后的剩余轮次）：\n$COMPLETED_STAGE_PART\n\n重规划补充要求：\n$REPLAN_INSTRUCTION\n\n剩余轮数参考（可按剧情需要增减，只需保证全阶段总轮数在范围内）：\n$REMAINING_TURNS\n\n相关世界书背景：\n$1\n\n上一阶段纪要：\n$LAST_STAGE_CHRONICLES\n\n更早阶段概要：\n$EARLIER_STAGE_SUMMARIES\n\n最近剧情：\n$RECENT_STORY\n\n上次校验错误：\n$VALIDATION_ERRORS\n\n请严格基于上述上下文，规划当前阶段的后续剧情大纲，并按规定标签输出。',
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
/**
 * Agent 会话化版本：正文改由 $STORY_TEXT 独立摘取，$HISTORY_ANCHOR 承载主 Agent 自己的会话，
 * $TOOL_RESULTS 退役。旧提示词描述的上下文排布与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V10_ACU = 'spv1.8-continuation-agent-conversation-v10';
/**
 * Agent 工具化版本：固定资料注入改为目录+状态骨架，主/子代理获得 read/search 工具与 token 门禁，
 * needMore 与读写授权退役。旧提示词描述的协议与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V11_ACU = 'spv1.9-continuation-agent-tools-v11';
/**
 * 精简轮次版本：大纲轮承载量硬约束（单轮 1000-1500 字）、finalize 紧凑字段化骨架、
 * 长期约束改增量登记（add/retire）。旧提示词描述的约束协议与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V12_ACU = 'spv2.0-continuation-lean-turns-v12';
/**
 * 伏笔派工强制化版本：主 Agent 获得 read/search 后出现「主会话直接安排伏笔、跳过派工」的退化，
 * 默认提示词改为结算先行（未结算历史必须先派 hook-cognition-maintainer）与策划派工强制
 * （每轮至少派 mainline-planner、伏笔操作必须来自 beat-planner 建议）。旧提示词缺少这些
 * 约束会让伏笔账本停止更新，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V13_ACU = 'spv2.1-continuation-hook-delegation-v13';
/**
 * 故事总纲与节奏控制版本：新增 $STORY_ARC 总纲模块与 arc-architect 子代理，大纲轮次带 pacing
 * 标签并受配比硬校验，大纲提示词补上阶段容量锚与节奏配比条款。旧提示词既缺新提示词组，
 * 也仍带着「每个节点都必须升级障碍」这类把日常轮结构性排除掉的条款，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V14_ACU = 'spv2.2-continuation-story-arc-pacing-v14';

/** 低压轮（setup + cooldown）最低占比的默认值。 */
export const CONTINUATION_DOWNTIME_TURN_RATIO_DEFAULT_ACU = 0.3;

/** 低压轮占比的可配置上限。超过 0.6 会让冲突线没有足够轮次推进。 */
export const CONTINUATION_DOWNTIME_TURN_RATIO_MAX_ACU = 0.6;

function clonePromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

export function buildDefaultContinuationOutlinePrompt_ACU(): ContinuationPromptSegment_ACU[] {
  return clonePromptSegments_ACU(DEFAULT_OUTLINE_PROMPT_ACU);
}

/** 全部渠道角色默认沿用全局渠道配置，保证旧信封无感迁移。 */
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
    downtimeTurnRatio: CONTINUATION_DOWNTIME_TURN_RATIO_DEFAULT_ACU,
    storyWindowFloors: AGENT_STORY_WINDOW_DEFAULT_ACU,
    agentHistoryTokenBudget: AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU,
    storyTailFloors: AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
    agentReadTokenBudget: AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU,
    agentReadFallbackTokens: AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU,
    contextExtractRules: [],
    contextExcludeRules: [],
    apiPresetMode: 'current',
    fixedApiPresetName: '',
    agentApiPresets: buildDefaultContinuationAgentApiPresets_ACU(),
    outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU(),
    agentPrompts: buildDefaultContinuationAgentPrompts_ACU(),
    promptForceDefaultVersion: CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V14_ACU,
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

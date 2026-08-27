import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContinuationAgentTurnPlanner_ACU, buildAgentRealHistory_ACU, renderAgentBudget_ACU } from '../../../../src/service/continuation/agent/agent-main-loop';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type ContinuationInternalAiRequestIdentity_ACU } from '../../../../src/service/continuation/model';
import { readAgentSessionLog_ACU, resetAgentSessionLogForTests_ACU } from '../../../../src/service/continuation/agent/agent-session-log';
import { readAgentRunState_ACU, resetAgentRunCacheForTests_ACU } from '../../../../src/service/continuation/agent/agent-run-cache';
import type { AgentModuleSnapshot_ACU, AgentOutlineOpResult_ACU, AgentRunBudget_ACU, ContinuationAgentTurnPlanRequest_ACU } from '../../../../src/service/continuation/agent/agent-model';

const preset_ACU = { presetName: 'p1', source: 'settings' as const, reason: 'test' };

beforeEach(() => { resetAgentSessionLogForTests_ACU(); resetAgentRunCacheForTests_ACU(); });

const chat_ACU = () => ([
  { mes: '我要进禁区', is_user: true },
  { mes: '主角推开铁门。', is_user: false },
  { mes: '继续', is_user: true },
  { mes: '守门人挡在门后，右手藏着黑色晶屑。', is_user: false },
]);

const preOutlineContext_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '推进主角进入禁区' } as any,
  stage: null,
  revision: null,
  node: null,
  turn: null,
  turnNumber: null,
  nodeTurnNumber: null,
});

const execution_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '推进主角进入禁区' } as any,
  stage: { stageNumber: 2, status: 'running' } as any,
  revision: { outline: { title: '禁区试探', goal: '进入禁区', totalTurns: 6 } } as any,
  node: { id: 'node-1', title: '试探守门人', goal: '试探而不揭穿', turns: [{ id: 'turn-1', goal: '推门' }, { id: 'turn-2', goal: '试探' }] } as any,
  turn: { id: 'turn-2', goal: '试探' } as any,
  turnNumber: 2,
  nodeTurnNumber: 2,
});

interface Harness_ACU {
  planner: ContinuationAgentTurnPlanner_ACU;
  request: ContinuationAgentTurnPlanRequest_ACU;
  mainCalls: Array<Array<{ role: string; content: string }>>;
  subCalls: Array<Array<{ role: string; content: string }>>;
  written: Array<{ index: number; snapshot: AgentModuleSnapshot_ACU }>;
  outlineCalls: string[];
  presetRoles: string[];
  setContext: (factory: () => any) => void;
}

function harness_ACU(options: {
  mainReplies: string[];
  subReplies?: string[];
  budget?: Partial<AgentRunBudget_ACU>;
  snapshot?: AgentModuleSnapshot_ACU;
  isCurrent?: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  context?: () => any;
  applyOutline?: (instruction: string) => Promise<AgentOutlineOpResult_ACU> | AgentOutlineOpResult_ACU;
  applyOutlineEdits?: (edits: any[]) => Promise<{ summary: string }> | { summary: string };
  withoutApplyOutline?: boolean;
  apiPresetMode?: 'current' | 'fixed';
  agentApiPresets?: Partial<Record<'main' | 'outline' | 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer', { mode: 'inherit' | 'current' | 'fixed'; presetName: string }>>;
}): Harness_ACU {
  const mainReplies = [...options.mainReplies];
  const subReplies = [...(options.subReplies ?? [])];
  const mainCalls: Array<Array<{ role: string; content: string }>> = [];
  const subCalls: Array<Array<{ role: string; content: string }>> = [];
  const written: Array<{ index: number; snapshot: AgentModuleSnapshot_ACU }> = [];
  const outlineCalls: string[] = [];
  const presetRoles: string[] = [];
  const chat = chat_ACU();
  let snapshot = options.snapshot ?? buildEmptyAgentModuleSnapshot_ACU();
  let contextFactory = options.context ?? execution_ACU;

  const subagentRuntime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { subCalls.push(messages); return subReplies.shift() ?? '{"summary":"空","recommendation":"随便推进"}'; },
  });

  const planner = new ContinuationAgentTurnPlanner_ACU({
    resolveApiPreset: ((_settings: unknown, role: string) => { presetRoles.push(role); return preset_ACU; }) as any,
    callInternalAi: async messages => { mainCalls.push(messages); return mainReplies.shift() ?? '{"action":"block","reason":"脚本没有更多回复"}'; },
    subagentRuntime,
    readChat: () => chat,
    readModuleSnapshot: () => snapshot,
    writeModuleSnapshot: async (_chat, index, next) => { written.push({ index, snapshot: next }); snapshot = next; },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxExtraReads: 1, ...options.budget },
  });

  const settings = buildDefaultContinuationSettings_ACU();
  settings.internalAiRetryLimit = 1;
  settings.apiPresetMode = options.apiPresetMode ?? 'fixed';
  settings.fixedApiPresetName = 'p1';
  if (options.agentApiPresets) settings.agentApiPresets = { ...settings.agentApiPresets, ...options.agentApiPresets };

  const request: ContinuationAgentTurnPlanRequest_ACU = {
    settings,
    readContext: () => contextFactory(),
    createInternalRequestIdentity: attempt => ({ taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any,
    isInternalRequestCurrent: options.isCurrent ?? (() => true),
    applyOutline: options.withoutApplyOutline
      ? undefined
      : async instruction => {
          outlineCalls.push(instruction);
          const handler = options.applyOutline ?? (() => ({ op: 'revise' as const, requiresReview: false, stopped: null, summary: '已改写大纲' }));
          return handler(instruction);
        },
    applyOutlineEdits: options.withoutApplyOutline
      ? undefined
      : async edits => {
          const handler = options.applyOutlineEdits ?? (() => ({ summary: `已按工具编辑改写大纲（${edits.length} 处）` }));
          return handler(edits);
        },
  };

  return { planner, request, mainCalls, subCalls, written, outlineCalls, presetRoles, setContext: factory => { contextFactory = factory; } };
}

function lastMessage_ACU(messages: Array<{ role: string; content: string }>): { role: string; content: string } {
  return messages[messages.length - 1];
}

function findIndex_ACU(messages: Array<{ role: string; content: string }>, needle: string): number {
  return messages.findIndex(message => message.content.includes(needle));
}

describe('真实历史投影', () => {
  it('逐楼带上楼层号，用户楼与 AI 楼角色不同，空楼被跳过', () => {
    const history = buildAgentRealHistory_ACU([{ mes: '你好', is_user: true }, { mes: '   ' }, { mes: '回应' }, null]);
    expect(history).toEqual([
      { role: 'user', content: '【楼层 0】\n你好' },
      { role: 'assistant', content: '【楼层 2】\n回应' },
    ]);
  });
});

describe('预算渲染', () => {
  it('最后一轮明确宣告 FINAL_ITERATION 并禁用派工', () => {
    const ledger = { delegationsUsed: 2, perAgent: new Map(), outcomes: [] };
    expect(renderAgentBudget_ACU({ maxIterations: 3, maxDelegations: 6, maxSameAgent: 2, maxConcurrent: 3, maxExtraReads: 1 }, 3, ledger as any, 3)).toContain('FINAL_ITERATION');
    expect(renderAgentBudget_ACU({ maxIterations: 3, maxDelegations: 6, maxSameAgent: 2, maxConcurrent: 3, maxExtraReads: 1 }, 1, ledger as any, 3)).toContain('预算充足');
  });
});

describe('主 Agent 提示词装配', () => {
  it('真实历史插在锚点段位置：伪 role 在前，运行时证据与预填充在后', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"本轮指导"}'] });
    await h.planner.plan(h.request);

    const messages = h.mainCalls[0];
    const historyStart = findIndex_ACU(messages, '【楼层 0】');
    const runtimeIndex = findIndex_ACU(messages, '本轮预算状态');
    expect(historyStart).toBeGreaterThan(0);
    expect(messages[0].role).toBe('system');
    expect(runtimeIndex).toBeGreaterThan(historyStart);
    expect(findIndex_ACU(messages, '【楼层 3】')).toBeLessThan(runtimeIndex);
    expect(lastMessage_ACU(messages).role).toBe('assistant');
    expect(lastMessage_ACU(messages).content.endsWith('"thought": "')).toBe(true);
    expect(messages.some(message => message.content.includes('$HISTORY_ANCHOR'))).toBe(false);
  });

  it('运行时证据带上未结算区间、子代理目录与资料模块目录', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"本轮指导"}'] });
    await h.planner.plan(h.request);

    const runtime = h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content;
    expect(runtime).toContain('未结算楼层区间：0 到 3');
    expect(runtime).toContain('hook-cognition-maintainer');
    expect(runtime).toContain('$HOOKS_LEDGER');
    expect(runtime).toContain('本轮尚未派工');
  });
});

describe('主 Agent 循环收敛', () => {
  it('finalize 直接交付指导并回报尝试次数', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"从守门人的回避写起","summary":"试探"}'] });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('从守门人的回避写起');
    expect(result.attempts).toBe(1);
    expect(result.apiPreset.presetName).toBe('p1');
    expect(h.written).toHaveLength(0);
  });

  it('finalize 携带约束登记时落盘长期约束', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"指导","constraints":{"current":["不得提前揭穿守门人"],"retired":[]}}'] });
    await h.planner.plan(h.request);
    expect(h.written).toHaveLength(1);
    expect(h.written[0].index).toBe(3);
    expect(h.written[0].snapshot.constraints).toEqual([
      { id: 'C01-1', text: '不得提前揭穿守门人', reason: '主 Agent 本轮裁决登记', createdIndex: 3 },
    ]);
    expect(h.written[0].snapshot.revisions.constraints).toBe(1);
  });

  it('finalize 约束登记漏写既有条目时拒绝回灌，主 Agent 修正后同循环内交付', async () => {
    const withConstraint = buildEmptyAgentModuleSnapshot_ACU();
    withConstraint.constraints = [{ id: 'C01-1', text: '既有约束', reason: '早前登记', createdIndex: 1 }];
    withConstraint.revisions.constraints = 1;
    const h = harness_ACU({
      snapshot: withConstraint,
      mainReplies: [
        '{"action":"finalize","instruction":"指导","constraints":{"current":["新约束"],"retired":[]}}',
        '{"action":"finalize","instruction":"修正后交付","constraints":{"current":["既有约束","新约束"],"retired":[]}}',
      ],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('修正后交付');
    // 第一次 finalize 被拒绝：漏写既有活跃条目不落盘，拒绝原因回灌。
    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.constraints.map(item => item.text)).toEqual(['既有约束', '新约束']);
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('漏写');
    expect(feedback).toContain('finalize 未被采纳');
  });

  it('循环失败后再次运行从中断点恢复，已完成的派工结论保留不重做', async () => {
    const identity = (attempt: number) => ({ chatIdentity: 'chat-resume', taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any;
    const first = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]}]}',
        '协议非法输出一',
        '协议非法输出二',
      ],
      subReplies: ['{"summary":"主线要点","recommendation":"先试探"}'],
    });
    first.request.createInternalRequestIdentity = identity;
    await expect(first.planner.plan(first.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID' } });

    const second = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"恢复后交付"}'] });
    second.request.createInternalRequestIdentity = identity;
    const result = await second.planner.plan(second.request);
    expect(result.instruction).toBe('恢复后交付');
    // 派工结论从缓存恢复进证据，不再重跑子代理。
    expect(second.subCalls).toHaveLength(0);
    expect(second.mainCalls[0].map(message => message.content).join('\n')).toContain('主线要点');
    // 会话续写而非清空：能看到恢复分隔条目。
    expect(readAgentSessionLog_ACU().some(entry => entry.kind === 'run_resumed')).toBe(true);
    // 成功交付后缓存清除，下一轮全新开始。
    expect(readAgentRunState_ACU('chat-resume', 'task-1', 'pre-outline#0#turn-2')).toBeNull();
  });

  it('协议非法时按重试上限重试，重试仍失败则以不可重试错误终止', async () => {
    const h = harness_ACU({ mainReplies: ['我不想输出 JSON', '{"action":"write_story"}'] });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID', retryable: false } });
    expect(h.mainCalls).toHaveLength(2);
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '上一次输出被拒绝')].content).toContain('不包含可解析的 JSON');
  });

  it('预算走到尽头仍不肯交付时终止，不做任何兜底', async () => {
    const h = harness_ACU({
      budget: { maxIterations: 2, maxConcurrent: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"策划","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"beat-planner","prompt":"还要派工","reads":["$OUTLINE_WINDOW"]}]}',
      ],
      subReplies: ['{"summary":"要点","recommendation":"先试探"}'],
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID', retryable: false } });
    expect(h.subCalls).toHaveLength(1);
  });

  it('最后一轮 delegate 被协议层拒绝，理由回灌后 finalize', async () => {
    const h = harness_ACU({
      budget: { maxIterations: 1 },
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"策划"}]}', '{"action":"finalize","instruction":"就这样写"}'],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('就这样写');
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('FINAL_ITERATION');
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '上一次输出被拒绝')].content).toContain('预算最后一轮');
  });

  it('block 以专用错误码终止，并带上未解决项', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"block","reason":"角色表缺失","unresolved":["林瑶当前状态未知"]}'] });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_AGENT_BLOCKED', retryable: false, details: { unresolved: ['林瑶当前状态未知'] } },
    });
  });

  it('轮次已失效时立刻停止，不消耗任何 AI 调用', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"指导"}'], isCurrent: () => false });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(h.mainCalls).toHaveLength(0);
  });
});

describe('大纲子代理派工', () => {
  it('无大纲时 finalize 被拒绝；派工 outline-architect 创建成功后同循环内继续并交付', async () => {
    const h = harness_ACU({
      context: preOutlineContext_ACU,
      mainReplies: [
        '{"action":"finalize","instruction":"直接写"}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"围绕禁区试探创建首个阶段"}]}',
        '{"action":"finalize","instruction":"按新大纲第一轮写"}',
      ],
      applyOutline: () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建第 1 阶段大纲「禁区试探」（共 6 轮）' }),
    });
    // create 成功后运行时读到的上下文切换为有大纲状态。
    const original = h.request.applyOutline!;
    h.request.applyOutline = async instruction => { const result = await original(instruction); h.setContext(execution_ACU); return result; };

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按新大纲第一轮写');
    expect(h.outlineCalls).toEqual(['围绕禁区试探创建首个阶段']);
    // 第一次 finalize 因无大纲被协议层拒绝并回灌。
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('不能 finalize');
    // 大纲操作结果回灌给下一次迭代。
    expect(h.mainCalls[2].map(message => message.content).join('\n')).toContain('已创建第 1 阶段大纲');
  });

  it('大纲操作产出待确认的新大纲时以重规划信号中止', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"节奏放慢"}]}'],
      applyOutline: () => ({ op: 'revise', requiresReview: true, stopped: null, summary: '新大纲待确认' }),
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_AGENT_OUTLINE_REPLANNED', retryable: false, message: expect.stringContaining('确认') },
    });
    expect(h.outlineCalls).toEqual(['节奏放慢']);
  });

  it('继续大纲遇到阶段上限时任务已停止，循环立即中止', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"继续下一阶段"}]}'],
      applyOutline: () => ({ op: 'continue', requiresReview: false, stopped: 'stage_limit_reached', summary: '阶段数已达上限，任务已停止，不再创建下一阶段' }),
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_TASK_STATE_INVALID', details: { stopped: 'stage_limit_reached' } },
    });
  });

  it('正文重试轮次不允许改写大纲，拒绝原因回灌后仍可正常交付', async () => {
    const h = harness_ACU({
      withoutApplyOutline: true,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"改大纲"}]}',
        '{"action":"finalize","instruction":"基于现有大纲交付"}',
      ],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('基于现有大纲交付');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('正文重试轮次不允许改写大纲');
  });

  it('edit_outline 工具编辑成功后结果回灌，同循环继续交付', async () => {
    const received: any[] = [];
    const h = harness_ACU({
      mainReplies: [
        '{"action":"edit_outline","thought":"只需微调","edits":[{"op":"set_turn_goal","turnId":"turn-2","goal":"守门人先露破绽"}]}',
        '{"action":"finalize","instruction":"按微调后的目标写"}',
      ],
      applyOutlineEdits: edits => { received.push(...edits); return { summary: '已按工具编辑改写大纲（1 处）' }; },
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按微调后的目标写');
    expect(received).toEqual([{ op: 'set_turn_goal', turnId: 'turn-2', goal: '守门人先露破绽' }]);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('已按工具编辑改写大纲');
  });

  it('edit_outline 校验被拒时拒绝回灌而不中止，重试轮则直接拒绝', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"edit_outline","edits":[{"op":"remove_turn","turnId":"turn-1"}]}',
        '{"action":"finalize","instruction":"保持原大纲交付"}',
      ],
      applyOutlineEdits: () => {
        throw new ContinuationValidationError_ACU({ code: 'CONTINUATION_AGENT_WRITE_REJECTED', phase: 'agent_loop', message: '编辑不能移除当前轮次', retryable: false } as any);
      },
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('保持原大纲交付');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('编辑不能移除当前轮次');

    const retryRun = harness_ACU({
      withoutApplyOutline: true,
      mainReplies: [
        '{"action":"edit_outline","edits":[{"op":"set_turn_goal","turnId":"turn-2","goal":"改"}]}',
        '{"action":"finalize","instruction":"交付"}',
      ],
    });
    await retryRun.planner.plan(retryRun.request);
    expect(retryRun.mainCalls[1].map(message => message.content).join('\n')).toContain('正文重试轮次不允许修改大纲');
  });

  it('大纲操作先于同波次其他派工执行，普通派工照常并发', async () => {
    const order: string[] = [];
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"outline-architect","prompt":"先修大纲"}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
      applyOutline: () => { order.push('outline'); return { op: 'revise', requiresReview: false, stopped: null, summary: '已改写大纲' }; },
    });
    const planner = h.request;
    const originalIsCurrent = planner.isInternalRequestCurrent;
    planner.isInternalRequestCurrent = identity => { if (identity.source === 'agent_subagent') order.push('subagent'); return originalIsCurrent(identity); };

    await h.planner.plan(h.request);
    expect(order[0]).toBe('outline');
    expect(order).toContain('subagent');
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('已改写大纲');
    expect(feedback).toContain('mainline-planner');
  });
});

describe('派工与写集落盘', () => {
  it('维护类子代理的 delta 串行落盘，结果与约束提议回灌给主 Agent', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算最近正文","reads":["$HISTORY_UNSETTLED","$HOOKS_LEDGER"],"writes":["$HOOKS_LEDGER","$INFO_GAP"]}]}',
        '{"action":"finalize","instruction":"最终指导"}',
      ],
      subReplies: [JSON.stringify({
        summary: '结算了黑色晶屑',
        delta: {
          hooks: [{ action: 'upsert', id: 'H1', summary: '守门人手中的黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }],
          infoGap: [{ action: 'upsert', id: 'E1', topic: '守门人身份', revealStatus: 'unrevealed', characterKnowledge: [{ name: '主角', knows: '只看到晶屑' }] }],
          constraintProposals: ['本阶段不得确认守门人身份'],
        },
      })],
    });

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('最终指导');

    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.hooks).toHaveLength(1);
    expect(h.written[0].snapshot.infoGap).toHaveLength(1);
    expect(h.written[0].snapshot.revisions).toMatchObject({ hooks: 1, infoGap: 1 });
    expect(h.written[0].snapshot.settledThroughIndex).toBe(3);

    const feedback = h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '结果 1')].content;
    expect(feedback).toContain('hook-cognition-maintainer｜成功');
    expect(feedback).toContain('伏笔 1 条、信息差 1 条');
    expect(feedback).toContain('约束提议（需你裁决后登记）：本阶段不得确认守门人身份');
  });

  it('第二次迭代读到的资料是落盘后的新快照', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"continuity-reviewer","prompt":"审查","reads":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [
        JSON.stringify({ summary: '埋设', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }] } }),
        '{"verdict":"pass","reason":"没有冲突"}',
      ],
    });
    await h.planner.plan(h.request);

    const reviewerMaterials = h.subCalls[1].map(message => message.content).join('\n');
    expect(reviewerMaterials).toContain('黑色晶屑');
    expect(h.mainCalls[2][findIndex_ACU(h.mainCalls[2], '结果 2')].content).toContain('判词：pass');
  });

  it('同波次两次写同一模块时，后者按读取时刻的修订号被判过期并如实回灌', async () => {
    const h = harness_ACU({
      budget: { maxSameAgent: 2, maxConcurrent: 2 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算前半段","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]},{"agentName":"hook-cognition-maintainer","prompt":"结算后半段","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [
        JSON.stringify({ summary: '前半段', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }] } }),
        JSON.stringify({ summary: '后半段', delta: { hooks: [{ action: 'upsert', id: 'H2', summary: '铁门', status: 'planted', importance: 'mid', plantedIndex: 1 }] } }),
      ],
    });
    await h.planner.plan(h.request);

    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.hooks.map(hook => hook.id)).toEqual(['H1']);
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('hooks 的 revision 已变化');
  });

  it('修订号过期的 delta 整体拒绝，快照不被污染', async () => {
    const stale = buildEmptyAgentModuleSnapshot_ACU();
    stale.revisions.hooks = 5;
    const h = harness_ACU({
      snapshot: stale,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [JSON.stringify({ summary: '基于旧版本', delta: { expectedRevisions: { hooks: 2 }, hooks: [{ action: 'upsert', id: 'H1', summary: '内容' }] } })],
    });
    await h.planner.plan(h.request);
    expect(h.written).toHaveLength(0);
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '结果 1')].content).toContain('未采用');
  });

  it('越权写集让该次派工失败，但不影响同波次其他子代理', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"越权写","reads":["$OUTLINE_WINDOW"],"writes":["$HOOKS_LEDGER"]},{"agentName":"beat-planner","prompt":"正常策划","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"节拍","recommendation":"三拍推进","mustPreserve":["林瑶有伤"]}'],
    });
    await h.planner.plan(h.request);

    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('mainline-planner｜失败');
    expect(feedback).toContain('无权写入 $HOOKS_LEDGER');
    expect(feedback).toContain('beat-planner｜成功');
    expect(feedback).toContain('必须保留：林瑶有伤');
    expect(h.subCalls).toHaveLength(1);
  });

  it('超出并发上限的派工不执行但如实回灌，可在下一次迭代重派', async () => {
    const h = harness_ACU({
      budget: { maxConcurrent: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('同一波次并发上限为 1 个');
  });

  it('跟随当前活动 API 时同波次强制串行，预算文本同步宣告上限为 1', async () => {
    const h = harness_ACU({
      apiPresetMode: 'current',
      budget: { maxConcurrent: 3 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);

    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('同一波次最多 1 个子代理');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('当前跟随活动 API，同一波次只能派工 1 个子代理');
  });

  it('全局跟随当前 API 但子代理角色全部固定渠道时，波次恢复并发且按角色解析渠道', async () => {
    const fixedChannel = { mode: 'fixed' as const, presetName: 'p2' };
    const h = harness_ACU({
      apiPresetMode: 'current',
      budget: { maxConcurrent: 2 },
      agentApiPresets: { maintainer: fixedChannel, mainlinePlanner: fixedChannel, beatPlanner: fixedChannel, reviewer: fixedChannel },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}', '{"summary":"节拍","recommendation":"三拍"}'],
    });
    await h.planner.plan(h.request);

    expect(h.subCalls).toHaveLength(2);
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('同一波次最多 2 个子代理');
    expect(h.presetRoles).toEqual(['main', 'mainlinePlanner', 'beatPlanner']);
  });

  it('同一代理超过次数上限后被拒绝', async () => {
    const h = harness_ACU({
      budget: { maxSameAgent: 1, maxConcurrent: 2 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"第一次","reads":["$OUTLINE_WINDOW"]},{"agentName":"mainline-planner","prompt":"第二次","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('同一代理最多派工 1 次');
  });

  it('目录里不存在的代理名被拒绝，不发起任何子代理调用', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"story-god","prompt":"全都交给你"}]}', '{"action":"finalize","instruction":"指导"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(0);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('目录里没有名为 story-god 的子代理');
  });
});

describe('子代理运行时', () => {
  let runtime: AgentSubagentRuntime_ACU;
  let calls: Array<Array<{ role: string; content: string }>>;
  let replies: string[];

  const input_ACU = (overrides: Partial<Parameters<AgentSubagentRuntime_ACU['run']>[0]> = {}) => ({
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算未处理正文', reads: ['$HISTORY_UNSETTLED'], writes: ['$HOOKS_LEDGER'] },
    settings: buildDefaultContinuationSettings_ACU(),
    resolveContext: {
      chat: chat_ACU(),
      moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 1,
      execution: execution_ACU(),
      originInstruction: '推进主角进入禁区',
      recentTurnCount: 2,
      tableData: { s1: { name: '角色表', content: [['姓名', '状态'], ['林瑶', '右臂有伤']] } },
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxExtraReads: 1 },
    preset: preset_ACU,
    createIdentity: (_name: string, attempt: number) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
    ...overrides,
  }) as Parameters<AgentSubagentRuntime_ACU['run']>[0];

  beforeEach(() => {
    calls = [];
    replies = [];
    runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return replies.shift() ?? '{}'; },
    });
  });

  it('只注入被授权读集解析后的材料与写集说明，不注入主 Agent 历史', async () => {
    replies = [JSON.stringify({ summary: '结算完成', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑' }] } })];
    const result = await runtime.run(input_ACU());

    const text = calls[0].map(message => message.content).join('\n');
    expect(text).toContain('【楼层 2｜用户】');
    expect(text).toContain('$HOOKS_LEDGER 伏笔账本');
    expect(text).toContain('结算未处理正文');
    expect(text).not.toContain('【楼层 0】');
    expect(result.writes).toEqual(['hooks']);
    expect(result.maintainer?.delta.hooks).toHaveLength(1);
  });

  it('needMore 申请在预算内扩充一次读集并重跑', async () => {
    replies = [
      JSON.stringify({ summary: '资料不够', needMore: ['$TABLE_CHARACTERS'], delta: {} }),
      JSON.stringify({ summary: '补齐后结算', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑' }] } }),
    ];
    const result = await runtime.run(input_ACU());
    expect(calls).toHaveLength(2);
    expect(calls[1].map(message => message.content).join('\n')).toContain('林瑶');
    expect(result.expandedReads).toEqual(['$TABLE_CHARACTERS']);
    expect(result.iterations).toBe(2);
  });

  it('无权读取的 needMore 申请被丢弃，不再重跑', async () => {
    replies = [JSON.stringify({ summary: '想看约束', needMore: ['$ACTIVE_CONSTRAINTS'], delta: {} })];
    const result = await runtime.run(input_ACU({ delegation: { agentName: 'beat-planner', prompt: '节拍', reads: ['$OUTLINE_WINDOW'], writes: [] } } as any));
    expect(calls).toHaveLength(1);
    expect(result.expandedReads).toEqual([]);
  });

  it('读集越权直接拒绝整次派工，不发起 AI 调用', async () => {
    await expect(runtime.run(input_ACU({ delegation: { agentName: 'continuity-reviewer', prompt: '审查', reads: ['$HISTORY_UNSETTLED'], writes: [] } } as any)))
      .rejects.toBeInstanceOf(ContinuationValidationError_ACU);
    expect(calls).toHaveLength(0);
  });

  it('表格读集对所有子代理开放，包括动态表名', async () => {
    replies = ['{"verdict":"pass","reason":"无冲突"}'];
    const result = await runtime.run(input_ACU({ delegation: { agentName: 'continuity-reviewer', prompt: '审查', reads: ['$TABLE:角色表'], writes: [] } } as any));
    expect(calls[0].map(message => message.content).join('\n')).toContain('右臂有伤');
    expect(result.reviewer?.verdict).toBe('pass');
  });

  it('连续返回不符合契约时抛出子代理失败，且把拒绝理由喂回下一次尝试', async () => {
    replies = ['不是 JSON', '{"delta":{"hooks":[{"action":"delete","id":"H1"}]}}'];
    const settings = buildDefaultContinuationSettings_ACU();
    settings.internalAiRetryLimit = 1;
    await expect(runtime.run(input_ACU({ settings } as any))).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SUBAGENT_FAILED' } });
    expect(calls).toHaveLength(2);
    expect(calls[1].map(message => message.content).join('\n')).toContain('上一次返回被拒绝');
  });

  it('派工中途轮次失效时立刻停止', async () => {
    const isCurrent = vi.fn().mockReturnValue(false);
    await expect(runtime.run(input_ACU({ isCurrent } as any))).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(calls).toHaveLength(0);
  });
});

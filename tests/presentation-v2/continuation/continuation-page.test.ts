/**
 * ContinuationPage — 仅验证 v2 会话 UI 到 runtime composable 的派发。
 * 宿主发送归属由 useContinuationRuntime 的独立测试覆盖。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick, ref } from 'vue';

const chatTick = ref(0);
const task = ref<any>(null);
const activeStage = ref<any>(null);
const activeRevision = ref<any>(null);
const activeNode = ref<any>(null);
const activeTurn = ref<any>(null);
const settings = ref<any>(null);
const busy = ref(false);
const canContinue = ref(false);
const awaitingHostResult = ref(false);
const originInstruction = ref('');
const statusText = ref('尚未创建任务');
const initialize = vi.fn(async () => undefined);
const refresh = vi.fn();
const continueTask = vi.fn(async () => undefined);
const retryCurrentTurn = vi.fn(async () => undefined);
const stopTask = vi.fn(async () => undefined);
const sendAgentMessage = vi.fn(async () => true);
const saveActiveOutline = vi.fn(async () => true);
const clearData = vi.fn(async () => true);
const acceptOutline = vi.fn(async () => true);
const saveSettings = vi.fn(async () => 'saved' as const);
const restorePromptDefault = vi.fn((draft: any) => draft);

vi.mock('../../../src/presentation-v2/composables/useContinuationRuntime', () => ({
  useContinuationRuntime: () => ({
    activeStage, activeRevision, activeNode, activeTurn, busy, canContinue, continueTask, initialize,
    isAwaitingHostResult: awaitingHostResult, originInstruction, refresh,
    retryCurrentTurn, acceptOutline, sendAgentMessage, saveActiveOutline, clearData, restorePromptDefault,
    saveSettings, settings, statusText, stopTask, task,
  }),
}));
vi.mock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
  useChatChangedTick: () => chatTick,
}));

function setTask(status = 'paused', pending = false): void {
  task.value = {
    taskId: 'task-1', originInstruction: '让主角找到出口', status, stopReason: null,
    activeStageId: 'stage-1', stages: [{
      stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 2,
      completedTurns: 3, chronicleRange: null, revisions: [{
        revision: 2, reason: 'initial', frozen: true,
        outline: { title: '逃离计划', goal: '让主角找到出口', totalTurns: 6, nodes: [] },
      }],
    }], timeline: [],
    pendingHostTurn: pending ? { status: 'awaiting_generation' } : null,
  };
  activeStage.value = task.value.stages[0];
  activeRevision.value = task.value.stages[0].revisions[0];
  canContinue.value = status === 'paused';
  awaitingHostResult.value = pending;
  statusText.value = pending ? '等待宿主正文' : status;
}

async function mountPage() {
  const Page = (await import('../../../src/presentation-v2/pages/ContinuationPage.vue')).default;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const pinia = createPinia();
  const app = createApp(Page);
  app.use(pinia);
  app.mount(el);
  await nextTick();
  return { app, el };
}

function buttonByText(el: Element, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(text));
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 会话输入框：页面里还有大纲/资料编辑框，按会话自己的类名定位。 */
function chatInput(el: Element): HTMLTextAreaElement {
  return el.querySelector<HTMLTextAreaElement>('.acu-v2-continuation-chat__input')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  task.value = null;
  setActivePinia(createPinia());
  activeStage.value = null;
  activeRevision.value = null;
  activeNode.value = null;
  activeTurn.value = null;
  settings.value = null;
  busy.value = false;
  canContinue.value = false;
  awaitingHostResult.value = false;
  originInstruction.value = '';
  statusText.value = '尚未创建任务';
  chatTick.value = 0;
  vi.clearAllMocks();
});

function setSettings(): void {
  settings.value = {
    stageSize: 'standard', customTurnMin: null, customTurnMax: null,
    outlinePreview: false, autoNextStage: true, maxAutomaticStages: 6,
    loopTags: '', loopDelaySeconds: 5, totalDurationMinutes: 0,
    retryDelaySeconds: 3, generationRetryLimit: 3, internalAiRetryLimit: 3,
    contextTurnCount: 3, storyWindowFloors: 20, storyTailFloors: 2, agentHistoryTokenBudget: 120000,
    agentReadTokenBudget: '30%', agentReadFallbackTokens: 6000,
    contextExtractRules: [], contextExcludeRules: [],
    apiPresetMode: 'current', fixedApiPresetName: '',
    agentApiPresets: {
      main: { mode: 'inherit', presetName: '' },
      outline: { mode: 'inherit', presetName: '' },
      maintainer: { mode: 'inherit', presetName: '' },
      mainlinePlanner: { mode: 'inherit', presetName: '' },
      beatPlanner: { mode: 'inherit', presetName: '' },
      reviewer: { mode: 'inherit', presetName: '' },
    },
    outlinePrompt: [{ role: 'system', content: '规划', enabled: true, deletable: true }],
    agentPrompts: {
      main: [{ role: 'system', content: '主控', enabled: true, deletable: true }],
      maintainer: [{ role: 'system', content: '维护', enabled: true, deletable: true }],
      mainlinePlanner: [{ role: 'system', content: '主线', enabled: true, deletable: true }],
      beatPlanner: [{ role: 'system', content: '节拍', enabled: true, deletable: true }],
      reviewer: [{ role: 'system', content: '审查', enabled: true, deletable: true }],
    },
  };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('ContinuationPage', () => {
  it('空态下没有独立的创建入口，第一条消息即交给 runtime 创建任务', async () => {
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('Agent 会话');
    expect(initialize).toHaveBeenCalledOnce();
    // 创建任务不再是一个单独按钮：发送第一句话就是创建。
    expect(buttonByText(el, '创建续写任务')).toBeUndefined();
    expect(el.textContent).not.toContain('循环提示词');

    typeInto(chatInput(el), '让主角找到出口');
    await nextTick();
    buttonByText(el, '发送')!.click();
    await nextTick();
    expect(sendAgentMessage).toHaveBeenCalledWith('让主角找到出口');
    // 发送后输入框清空，避免重复发送同一句。
    expect(chatInput(el).value).toBe('');
    app.unmount();
  });

  it('Ctrl + Enter 直接发送，空白内容不派发', async () => {
    setTask();
    const { app, el } = await mountPage();
    const input = chatInput(el);

    typeInto(input, '   ');
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    typeInto(input, '这一轮先别揭穿守门人');
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(sendAgentMessage).toHaveBeenCalledWith('这一轮先别揭穿守门人');
    app.unmount();
  });

  it('任务存在时渲染状态条、会话流空态与继续/停止派发', async () => {
    setTask();
    const { app, el } = await mountPage();
    expect(el.querySelector('.acu-v2-session-feed')).not.toBeNull();
    expect(el.textContent).toContain('还没有运行记录');
    expect(el.textContent).toContain('第 1 阶段');
    expect(el.textContent).toContain('已完成 3 / 6 轮');
    expect(el.textContent).toContain('大纲 revision 2');

    buttonByText(el, '继续当前轮次')!.click();
    await nextTick();
    expect(continueTask).toHaveBeenCalledOnce();
    // paused 且会话流没有运行标志时不给停止：没有正在跑的循环可停。
    expect(buttonByText(el, '停止生成')).toBeUndefined();
    app.unmount();
  });

  it('任务状态陈旧为 paused 但会话流显示循环在跑时，仍提供停止生成', async () => {
    const sessionLog = await import('../../../src/service/continuation/agent/agent-session-log');
    setTask();
    const { app, el } = await mountPage();
    try {
      expect(buttonByText(el, '停止生成')).toBeUndefined();

      // UI 发起的循环运行期间 envelope 不刷新，task.status 停留在陈旧的 paused；
      // 会话日志的运行标志才是实时信号，停止按钮必须据它显示。
      sessionLog.beginAgentSessionRun_ACU('第 1 阶段 · 第 1/6 轮');
      await nextTick();
      const stop = buttonByText(el, '停止生成');
      expect(stop).not.toBeUndefined();
      stop!.click();
      await nextTick();
      expect(stopTask).toHaveBeenCalledOnce();
    } finally {
      app.unmount();
      sessionLog.resetAgentSessionLogForTests_ACU();
    }
  });

  it('运行中提供停止生成，等待宿主正文时隐藏所有竞争操作并在聊天切换后刷新', async () => {
    setTask('running');
    const running = await mountPage();
    buttonByText(running.el, '停止生成')!.click();
    await nextTick();
    expect(stopTask).toHaveBeenCalledOnce();
    running.app.unmount();

    setTask('running', true);
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('当前轮次正在等待酒馆的正文生成结束');
    expect(buttonByText(el, '停止生成')).toBeUndefined();
    expect(buttonByText(el, '继续当前轮次')).toBeUndefined();
    chatTick.value += 1;
    await nextTick();
    expect(refresh).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('资料面板可编辑保存当前大纲，一键清空需二次确认', async () => {
    setTask();
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('已有资料');
    expect(el.textContent).toContain('逃离计划');

    const outlineTextarea = el.querySelector<HTMLTextAreaElement>('.acu-v2-continuation-materials__editor textarea')!;
    expect(JSON.parse(outlineTextarea.value).title).toBe('逃离计划');
    // 未改动时保存按钮禁用，避免无意义写盘推进 revision。
    expect(buttonByText(el, '保存大纲')!.disabled).toBe(true);

    typeInto(outlineTextarea, JSON.stringify({ ...JSON.parse(outlineTextarea.value), title: '逃离计划 v2' }));
    await nextTick();
    buttonByText(el, '保存大纲')!.click();
    await nextTick();
    expect(saveActiveOutline).toHaveBeenCalledOnce();
    expect(saveActiveOutline.mock.calls[0][0]).toMatchObject({ title: '逃离计划 v2' });

    // JSON 写坏时就地报错，不派发给领域层。
    typeInto(outlineTextarea, '{不是 JSON');
    await nextTick();
    buttonByText(el, '保存大纲')!.click();
    await nextTick();
    expect(saveActiveOutline).toHaveBeenCalledOnce();
    expect(el.textContent).toContain('大纲 JSON 无法解析');

    buttonByText(el, '一键清空')!.click();
    await nextTick();
    expect(clearData).not.toHaveBeenCalled();
    expect(el.textContent).toContain('小说正文楼层不受影响');
    buttonByText(el, '确认清空')!.click();
    await nextTick();
    expect(clearData).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('渲染设置与伪 Role 提示词，设置修改后自动经 runtime 保存', async () => {
    vi.useFakeTimers();
    try {
      setSettings();
      setTask();
      const { app, el } = await mountPage();

      expect(el.textContent).toContain('续写设置');
      expect(el.textContent).toContain('伪 Role 提示词');
      expect(el.textContent).toContain('正文可读窗口楼数');
      expect(el.textContent).toContain('会话自动总结阈值');
      expect(el.textContent).toContain('读取预算');
      expect(el.textContent).toContain('精读兜底额度');
      // 保存按钮已移除：修改任意设置项后由防抖自动保存。
      expect(buttonByText(el, '保存续写设置')).toBeUndefined();

      const stageSizeSelect = el.querySelector<HTMLSelectElement>('select')!;
      stageSizeSelect.value = 'short';
      stageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await nextTick();
      expect(saveSettings).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledOnce();
      expect(saveSettings.mock.calls[0][0]).toMatchObject({ stageSize: 'short', storyWindowFloors: 20, agentHistoryTokenBudget: 120000 });
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Agent 规划占用时保存返回 busy：显示排队提示并自动重试，落盘后提示消失', async () => {
    vi.useFakeTimers();
    try {
      setSettings();
      setTask('running');
      saveSettings.mockResolvedValueOnce('busy' as any);
      const { app, el } = await mountPage();

      const stageSizeSelect = el.querySelector<HTMLSelectElement>('select')!;
      stageSizeSelect.value = 'short';
      stageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await nextTick();
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledOnce();
      expect(el.textContent).toContain('将在本轮空档自动保存');

      // 第二次重试默认返回 'saved'：改动落盘，排队提示清除。
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledTimes(2);
      await nextTick();
      expect(el.textContent).not.toContain('将在本轮空档自动保存');
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

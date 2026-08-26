/**
 * ContinuationPage — 仅验证 v2 任务 UI 到 runtime composable 的派发。
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
const createTask = vi.fn(async () => undefined);
const continueTask = vi.fn(async () => undefined);
const retryCurrentTurn = vi.fn(async () => undefined);
const stopTask = vi.fn(async () => undefined);
const replanRemaining = vi.fn(async () => undefined);
const replanRemainingWithInstruction = vi.fn(async () => undefined);
const acceptOutline = vi.fn(async () => true);
const abandonAndCreate = vi.fn(async () => true);
const saveSettings = vi.fn(async () => true);

vi.mock('../../../src/presentation-v2/composables/useContinuationRuntime', () => ({
 useContinuationRuntime: () => ({
    activeStage, activeRevision, activeNode, activeTurn, busy, canContinue, createTask, continueTask, initialize,
    isAwaitingHostResult: awaitingHostResult, originInstruction, refresh,
    replanRemaining, replanRemainingWithInstruction, retryCurrentTurn, acceptOutline,
    abandonAndCreate, saveSettings, settings, statusText, stopTask, task,
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
    contextTurnCount: 3, contextExtractRules: [], contextExcludeRules: [],
    apiPresetMode: 'current', fixedApiPresetName: '',
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
  it('显示任务创建入口，并将初始要求交给 runtime', async () => {
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('Agent 会话');
    expect(initialize).toHaveBeenCalledOnce();
    expect(el.textContent).toContain('创建续写任务');
    expect(el.textContent).not.toContain('循环提示词');
    const textarea = el.querySelector('textarea')!;
    textarea.value = '让主角找到出口';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    buttonByText(el, '创建续写任务')!.click();
    await nextTick();
    expect(originInstruction.value).toBe('让主角找到出口');
    expect(createTask).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('任务存在时渲染 Agent 会话流与空态提示', async () => {
    setTask();
    const { app, el } = await mountPage();
    expect(el.querySelector('.acu-v2-session-feed')).not.toBeNull();
    expect(el.textContent).toContain('还没有运行记录');
    app.unmount();
  });

  it('展示持久化任务状态并派发继续、重规划和停止操作', async () => {
    setSettings();
    setTask();
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('第 1 阶段');
    expect(el.textContent).toContain('完成轮次');
    expect(el.textContent).toContain('让主角找到出口');
    buttonByText(el, '继续当前轮次')!.click();
    buttonByText(el, '重新规划剩余阶段')!.click();
    buttonByText(el, '停止智能续写')!.click();
    await nextTick();
    expect(continueTask).toHaveBeenCalledOnce();
    expect(replanRemainingWithInstruction).toHaveBeenCalledOnce();
    expect(stopTask).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('渲染大纲、执行回执、设置与伪 Role 提示词，并仅通过 runtime 保存设置', async () => {
    setSettings();
    setTask();
    const { app, el } = await mountPage();

    expect(el.textContent).toContain('阶段大纲与执行回执');
    expect(el.textContent).toContain('逃离计划');
    expect(el.textContent).toContain('续写设置');
    expect(el.textContent).toContain('伪 Role 提示词');
    expect(el.textContent).toContain('总倒计时');
    buttonByText(el, '保存续写设置')!.click();
    await nextTick();
    expect(saveSettings).toHaveBeenCalledOnce();
    app.unmount();
  });


  it('等待宿主结果时隐藏会产生竞争的操作，并在聊天切换后刷新', async () => {
    setTask('running', true);
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('当前轮次正在等待宿主生成结束事件');
    expect(buttonByText(el, '继续当前轮次')).toBeUndefined();
    expect(buttonByText(el, '重新规划剩余阶段')).toBeUndefined();
    expect(buttonByText(el, '停止智能续写')).toBeUndefined();
    chatTick.value += 1;
    await nextTick();
    expect(refresh).toHaveBeenCalledOnce();
    app.unmount();
  });
});

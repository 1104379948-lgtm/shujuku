import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginAgentSessionRun_ACU,
  isAgentSessionRunning_ACU,
  logAgentSession_ACU,
  readAgentSessionLog_ACU,
  resetAgentSessionLogForTests_ACU,
  subscribeAgentSessionLog_ACU,
} from '../../../../src/service/continuation/agent/agent-session-log';

beforeEach(() => { resetAgentSessionLogForTests_ACU(); });

describe('Agent 会话日志', () => {
  it('新一次运行清空上一次会话并置运行标记', () => {
    beginAgentSessionRun_ACU('第 1 阶段 · 第 1/6 轮');
    logAgentSession_ACU({ kind: 'main_action', title: '迭代 1 · 派工 2 项' });
    beginAgentSessionRun_ACU('第 1 阶段 · 第 2/6 轮', '推进');

    const entries = readAgentSessionLog_ACU();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'run_started', title: '第 1 阶段 · 第 2/6 轮', detail: '推进', ok: true });
    expect(isAgentSessionRunning_ACU()).toBe(true);
  });

  it('终态事件（完成/失败/阻断）清除运行标记', () => {
    beginAgentSessionRun_ACU('运行');
    logAgentSession_ACU({ kind: 'run_completed', title: '完成' });
    expect(isAgentSessionRunning_ACU()).toBe(false);

    beginAgentSessionRun_ACU('运行');
    logAgentSession_ACU({ kind: 'run_failed', title: '失败', ok: false });
    expect(isAgentSessionRunning_ACU()).toBe(false);
  });

  it('条目超过上限后丢最旧的，超长 detail 被截断', () => {
    beginAgentSessionRun_ACU('运行');
    for (let index = 0; index < 320; index += 1) {
      logAgentSession_ACU({ kind: 'delegation', title: `条目 ${index}`, agentName: 'mainline-planner' });
    }
    const entries = readAgentSessionLog_ACU();
    expect(entries).toHaveLength(300);
    expect(entries[0].title).toBe('条目 20');

    logAgentSession_ACU({ kind: 'main_action', title: '长内容', detail: '长'.repeat(3000) });
    const last = readAgentSessionLog_ACU().at(-1)!;
    expect(last.detail.length).toBeLessThan(2100);
    expect(last.detail).toContain('已截断');
  });

  it('订阅者收到变化通知，退订后不再通知，订阅者抛错不影响写入', () => {
    const listener = vi.fn();
    const broken = vi.fn(() => { throw new Error('订阅者坏了'); });
    const unsubscribe = subscribeAgentSessionLog_ACU(listener);
    subscribeAgentSessionLog_ACU(broken);

    logAgentSession_ACU({ kind: 'main_action', title: '事件' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readAgentSessionLog_ACU()).toHaveLength(1);

    unsubscribe();
    logAgentSession_ACU({ kind: 'main_action', title: '事件 2' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readAgentSessionLog_ACU()).toHaveLength(2);
  });
});

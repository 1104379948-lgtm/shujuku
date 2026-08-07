/**
 * AssistantPromptDrawer 组件测试
 *
 * 验证抽屉把 AcuPromptSegments 的 update 事件以 (index, patch) 双参数透传给父级。
 * 回归点：VisualizerAssistantPanel 曾只传 $event（单参 index），导致 patch 丢失、
 * 编辑提示词不生效但 dirty 被置位。本测试从模板层抓住这类「事件参数被截断」的缺陷。
 *
 * 不引入 @vue/test-utils；沿用项目 createApp + 真实 DOM 断言范式。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import AssistantPromptDrawer from '../../../src/presentation-v2/components/AssistantPromptDrawer.vue';
import { TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU } from '../../../src/service/template-assistant/service';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountDrawer(props: Record<string, unknown>): {
  el: HTMLElement;
  emitted: Array<{ event: string; args: unknown[] }>;
} {
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const wrapper = defineComponent({
    setup() {
      return () => h(AssistantPromptDrawer as any, {
        ...props,
        onUpdate: (index: number, patch: unknown) => emitted.push({ event: 'update', args: [index, patch] }),
        onClose: () => emitted.push({ event: 'close', args: [] }),
        onLoadPseudoRole: () => emitted.push({ event: 'load-pseudo-role', args: [] }),
      });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return { el, emitted };
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('AssistantPromptDrawer update 事件透传', () => {
  it('textarea 输入时以 (index, patch) 双参数透传 update 事件', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      segments: [{ role: 'SYSTEM', content: '初始规则', deletable: true }],
      dirty: false,
      message: null,
    });
    await nextTick();

    const textarea = el.querySelector('textarea');
    expect(textarea).not.toBeNull();
    textarea!.value = '修改后的规则';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('update');
    expect(emitted[0]?.args).toEqual([0, { content: '修改后的规则' }]);
  });

  it('role 选择变化时以 (index, patch) 双参数透传 update 事件', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      segments: [{ role: 'SYSTEM', content: '规则', deletable: true }],
      dirty: false,
      message: null,
    });
    await nextTick();

    // AcuSelect 是自定义按钮+菜单：先点击 trigger 打开，再点 USER 选项
    const trigger = el.querySelector<HTMLButtonElement>('.acu-select__trigger');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await nextTick();

    const userItem = Array.from(el.querySelectorAll('.acu-select__item'))
      .find((item) => item.textContent?.trim() === 'USER');
    expect(userItem).not.toBeNull();
    (userItem as HTMLElement).click();
    await nextTick();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('update');
    expect(emitted[0]?.args).toEqual([0, { role: 'USER' }]);
  });
});

describe('AssistantPromptDrawer 占位符清单与载入伪 role', () => {
  it('占位符清单渲染条数 === TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU.length，且元数据驱动无硬编码', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      segments: [{ role: 'SYSTEM', content: '规则', deletable: true }],
      dirty: false,
      message: null,
    });
    await nextTick();

    const items = el.querySelectorAll('.acu-assistant-prompt-drawer__placeholder-item code');
    expect(items).toHaveLength(TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU.length);
    const tokens = Array.from(items).map((item) => item.textContent?.trim());
    TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU.forEach((doc) => {
      expect(tokens).toContain(doc.token);
    });
  });

  it('点击「载入伪 role 模板」按钮 emit load-pseudo-role', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      segments: [{ role: 'SYSTEM', content: '规则', deletable: true }],
      dirty: false,
      message: null,
    });
    await nextTick();

    const button = Array.from(el.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('载入伪 role 模板'));
    expect(button).not.toBeNull();
    (button as HTMLButtonElement).click();
    await nextTick();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('load-pseudo-role');
    expect(emitted[0]?.args).toEqual([]);
  });
});

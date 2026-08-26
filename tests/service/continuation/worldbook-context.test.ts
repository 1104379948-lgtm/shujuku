import { describe, expect, it, vi } from 'vitest';
import {
  ContinuationWorldbookContext_ACU,
  type ContinuationWorldbookAdapterDependencies_ACU,
} from '../../../src/service/continuation/worldbook-context';

function createDependencies_ACU(overrides: Partial<ContinuationWorldbookAdapterDependencies_ACU> = {}) {
  return {
    resolveRelevantBookNames: vi.fn().mockResolvedValue(['角色书', '附加书']),
    resolveInjectionTarget: vi.fn().mockResolvedValue('纪要书'),
    getIsolationPrefix: vi.fn().mockReturnValue('ACU-[chat-a]-'),
    buildRelevantWorldbookContent: vi.fn().mockResolvedValue('相关世界书背景'),
    readLorebookEntries: vi.fn().mockResolvedValue({
      '纪要书': [
        { comment: 'ACU-[chat-a]-总结条目8', keys: ['AM0010'], content: '| AM0010 | 完整纪要十 |\n' },
        { comment: 'ACU-[chat-a]-总结条目2', keys: ['AM0011'], content: '| AM0011 | 完整纪要十一 |\n' },
        { comment: 'ACU-[chat-a]-小总结条目1', keys: ['AM0002'], content: '| AM0002 | 更早概要 |\n' },
        { comment: 'ACU-[chat-a]-总结条目3', keys: ['not-an-am'], content: '| AM9999 | 不能凭正文猜编码 |\n' },
        { comment: 'ACU-[other]-总结条目4', keys: ['AM0099'], content: '| AM0099 | 其他隔离域 |\n' },
        { comment: '普通条目', keys: ['AM0003'], content: '| AM0003 | 普通世界书 |\n' },
      ],
    }),
    logReadFailure: vi.fn(),
    ...overrides,
  } satisfies ContinuationWorldbookAdapterDependencies_ACU;
}

describe('ContinuationWorldbookContext_ACU', () => {
  it('uses the configured relevant books and excludes generated entries from $1 selection', async () => {
    const dependencies = createDependencies_ACU();
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('最近剧情')).resolves.toBe('相关世界书背景');

    expect(dependencies.resolveRelevantBookNames).toHaveBeenCalledTimes(1);
    expect(dependencies.buildRelevantWorldbookContent).toHaveBeenCalledWith(expect.objectContaining({
      bookNames: ['角色书', '附加书'],
      baseScanText: '最近剧情',
    }));
    const options = vi.mocked(dependencies.buildRelevantWorldbookContent).mock.calls[0][0] as any;
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-总结条目1' })).toBe(true);
    expect(options.excludeEntry({ comment: '普通设定' })).toBe(false);
    expect(dependencies.resolveInjectionTarget).not.toHaveBeenCalled();
    expect(dependencies.readLorebookEntries).not.toHaveBeenCalled();
  });

  it('reads complete last-stage entries by AM keys rather than comment ordinal or content text', async () => {
    const dependencies = createDependencies_ACU();
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readLastStageChronicles({ first: 'AM0010', last: 'AM0011' }))
      .resolves.toBe('| AM0010 | 完整纪要十 |\n\n| AM0011 | 完整纪要十一 |');
    expect(dependencies.readLorebookEntries).toHaveBeenCalledWith(['纪要书']);
  });

  it('returns earlier summaries with their stable AM keys and captures a snapshot from readable entries', async () => {
    const dependencies = createDependencies_ACU();
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readEarlierStageSummaries([{ first: 'AM0002', last: 'AM0002' }]))
      .resolves.toBe('AM0002\n| AM0002 | 更早概要 |');
    await expect(context.readChronicleSnapshot()).resolves.toEqual({
      count: 3,
      range: { first: 'AM0002', last: 'AM0011' },
    });
  });

  it('returns empty text on missing, invalid, or failed history reads without blocking continuation', async () => {
    const readLorebookEntries = vi.fn().mockRejectedValue(new Error('host unavailable'));
    const dependencies = createDependencies_ACU({ readLorebookEntries });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readLastStageChronicles({ first: 'invalid', last: 'AM0010' })).resolves.toBe('');
    await expect(context.readLastStageChronicles({ first: 'AM0010', last: 'AM0011' })).resolves.toBe('');
    await expect(context.readEarlierStageSummaries([])).resolves.toBe('');
    await expect(context.readChronicleSnapshot()).resolves.toEqual({ count: 0, range: null });
    expect(dependencies.logReadFailure).toHaveBeenCalledWith('history');
  });

  it('returns empty background when configured book resolution fails', async () => {
    const dependencies = createDependencies_ACU({ resolveRelevantBookNames: vi.fn().mockRejectedValue(new Error('binding unavailable')) });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('剧情')).resolves.toBe('');
    expect(dependencies.buildRelevantWorldbookContent).not.toHaveBeenCalled();
    expect(dependencies.logReadFailure).toHaveBeenCalledWith('background');
  });
});

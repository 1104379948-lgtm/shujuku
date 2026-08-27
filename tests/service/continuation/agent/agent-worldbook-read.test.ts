import { describe, expect, it } from 'vitest';

import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentChronicleRange_ACU,
  renderAgentWorldbookCatalog_ACU,
  renderAgentWorldbookEntries_ACU,
  type AgentWorldbookSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

function snapshot_ACU(): AgentWorldbookSnapshot_ACU {
  return {
    available: true,
    entries: [
      { bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑', '禁区'], constant: false, content: '黑色晶屑是禁区核心的碎片。' },
      { bookName: '设定集', uid: '9', title: '守门人', keys: [], constant: true, content: '守门人世代驻守铁门。' },
    ],
    chronicles: [
      { codes: ['AM1', 'AM2'], content: '主角初次听说晶屑传闻。' },
      { codes: ['AM3'], content: '主角抵达禁区外围。' },
    ],
  };
}

describe('世界书目录渲染', () => {
  it('普通条目一行一条带精读地址，纪要单列概要段带 AM 区间地址', () => {
    const catalog = renderAgentWorldbookCatalog_ACU(snapshot_ACU());
    expect(catalog).toContain('晶屑设定｜关键词：晶屑、禁区｜关键词触发');
    expect(catalog).toContain('守门人｜关键词：（无关键词）｜常开');
    expect(catalog).toContain('$WORLDBOOK:设定集:7');
    expect(catalog).toContain('$CHRONICLES:AM1-AM2');
    expect(catalog).toContain('$CHRONICLES:AM3-AM3');
    // 目录只有标题与元信息，不注入条目正文。
    expect(catalog).not.toContain('黑色晶屑是禁区核心的碎片');
  });

  it('读取失败与空快照分别如实标注，不混为一谈', () => {
    expect(renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false))).toContain('目录不可用');
    const empty = renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(true));
    expect(empty).toContain('当前没有已启用的普通世界书条目');
    expect(empty).toContain('当前没有纪要段');
  });
});

describe('世界书条目精读', () => {
  it('按书名 + uid 返回全文，未知 uid 如实列出', () => {
    const text = renderAgentWorldbookEntries_ACU(snapshot_ACU(), '设定集', ['7', '99']);
    expect(text).toContain('黑色晶屑是禁区核心的碎片。');
    expect(text).toContain('以下 uid 不存在于「设定集」的已启用条目中：99');
  });

  it('未知书名、地址不完整与读取失败都回灌可修正的错误文本', () => {
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '不存在的书', ['7'])).toContain('不存在世界书「不存在的书」');
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '', [])).toContain('地址不完整');
    expect(renderAgentWorldbookEntries_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false), '设定集', ['7'])).toContain('读取失败');
  });
});

describe('纪要区间读取', () => {
  it('AM 码区间命中即返回该段全文，区间可跨多段', () => {
    const single = renderAgentChronicleRange_ACU(snapshot_ACU(), 'AM1', 'AM2');
    expect(single).toContain('纪要 AM1, AM2');
    expect(single).toContain('主角初次听说晶屑传闻。');
    expect(single).not.toContain('禁区外围');

    const both = renderAgentChronicleRange_ACU(snapshot_ACU(), 'AM2', 'AM3');
    expect(both).toContain('晶屑传闻');
    expect(both).toContain('禁区外围');
  });

  it('区间非法与无命中都回灌可修正的错误文本', () => {
    expect(renderAgentChronicleRange_ACU(snapshot_ACU(), '瞎写', 'AM2')).toContain('不合法');
    expect(renderAgentChronicleRange_ACU(snapshot_ACU(), 'AM3', 'AM1')).toContain('不合法');
    expect(renderAgentChronicleRange_ACU(snapshot_ACU(), 'AM7', 'AM9')).toContain('没有命中任何纪要段');
  });
});

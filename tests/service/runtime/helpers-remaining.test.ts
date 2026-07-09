/**
 * tests/service/runtime/helpers-remaining.test.ts
 * 辅助函数集入口文件 单元测试（handleChatCompletionReady_ACU）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockCurrentJsonTableData,
  mockLogDebug,
  mockParseRandomTags,
  mockReplaceRandomVariables,
  mockParseCalcTags,
  mockParseMaxTags,
  mockParseMinTags,
  mockReplaceCalcVariables,
  mockReplaceMaxVariables,
  mockReplaceMinVariables,
  mockParseIfBlockRecursive,
  mockReplaceAcuTemplateVariables,
  mockGetLatestAIMessageContent,
  mockGetPlotFromHistory,
  mockGetScriptCurrentMainReplyRequestId,
} = vi.hoisted(() => ({
  mockSettings: { promptTemplateSettings: { enabled: true, maxNestingDepth: 10, debugMode: false } } as any,
  mockCurrentJsonTableData: { sheet_0: { name: '表', content: [['row_id']] } } as any,
  mockLogDebug: vi.fn(),
  mockParseRandomTags: vi.fn((s: string) => s),
  mockReplaceRandomVariables: vi.fn((s: string) => s),
  mockParseCalcTags: vi.fn((s: string) => s),
  mockParseMaxTags: vi.fn((s: string) => s),
  mockParseMinTags: vi.fn((s: string) => s),
  mockReplaceCalcVariables: vi.fn((s: string) => s),
  mockReplaceMaxVariables: vi.fn((s: string) => s),
  mockReplaceMinVariables: vi.fn((s: string) => s),
  mockParseIfBlockRecursive: vi.fn((s: string) => s),
  mockReplaceAcuTemplateVariables: vi.fn(async (s: string) => s),
  mockGetLatestAIMessageContent: vi.fn(() => ''),
  mockGetPlotFromHistory: vi.fn(() => null),
  mockGetScriptCurrentMainReplyRequestId: vi.fn(() => null),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
}));

vi.mock('../../../src/service/runtime/template-vars', () => ({
  parseRandomTags_ACU: mockParseRandomTags,
  replaceRandomVariables_ACU: mockReplaceRandomVariables,
  parseCalcTags_ACU: mockParseCalcTags,
  parseMaxTags_ACU: mockParseMaxTags,
  parseMinTags_ACU: mockParseMinTags,
  replaceCalcVariables_ACU: mockReplaceCalcVariables,
  replaceMaxVariables_ACU: mockReplaceMaxVariables,
  replaceMinVariables_ACU: mockReplaceMinVariables,
  parseIfBlockRecursive_ACU: mockParseIfBlockRecursive,
  parseIfBlocksInContent_ACU: vi.fn(),
  getLatestAIMessageContent_ACU: mockGetLatestAIMessageContent,
  replaceDbSqlVariables: vi.fn((s: string) => s),
}));

vi.mock('../../../src/service/runtime/template-vars/acu-template-vars', () => ({
  replaceAcuTemplateVariables_ACU: mockReplaceAcuTemplateVariables,
}));

vi.mock('../../../src/service/runtime/plot-runtime', () => ({
  formatOutlineTableForPlot_ACU: vi.fn(),
  formatSummaryIndexForPlot_ACU: vi.fn(),
  loadPresetAndCleanCharacterData_ACU: vi.fn(),
  getPlotFromHistory_ACU: mockGetPlotFromHistory,
  runOptimizationLogic_ACU: vi.fn(),
  getWorldbookContentForPlot_ACU: vi.fn(),
}));

vi.mock('../../../src/service/scripts/script-tavern-facade', () => ({
  getScriptCurrentMainReplyRequestId_ACU: mockGetScriptCurrentMainReplyRequestId,
}));

vi.mock('../../../src/service/runtime/helpers-context-tags', () => ({
  getDefaultPlotContextExtractRules_ACU: vi.fn(),
  getDefaultPlotContextExcludeRules_ACU: vi.fn(),
  applyExcludeRulesToText_ACU: vi.fn(),
  applyContextTagFilters_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-table-lock', () => ({
  getTableLocksForSheet_ACU: vi.fn(),
  saveTableLocksForSheet_ACU: vi.fn(),
  toggleRowLock_ACU: vi.fn(),
  toggleColLock_ACU: vi.fn(),
  toggleCellLock_ACU: vi.fn(),
  isSpecialIndexLockEnabled_ACU: vi.fn(),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(),
  formatSummaryIndexCode_ACU: vi.fn(),
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: vi.fn(),
  formatJsonToReadable_ACU: vi.fn(),
  shouldSuppressWorldbookInjection_ACU: vi.fn(),
  maybeLiftWorldbookSuppression_ACU: vi.fn(),
  fillFirstLayerWithTemplateData_ACU: vi.fn(),
  getEffectiveAutoUpdateThreshold_ACU: vi.fn(),
  isNewChatGreetingStage_ACU: vi.fn(),
  isSingleAiNoUserChat_ACU: vi.fn(),
  buildTemplateBaseStateDataForLocalStorage_ACU: vi.fn(),
  seedGreetingLocalDataFromTemplate_ACU: vi.fn(),
  parseReadableToJson_ACU: vi.fn(),
  GREETING_LOCAL_BASE_STATE_MARKER_ACU: '__GREETING_LOCAL_BASE_STATE__',
}));

import { handleChatCompletionReady_ACU } from '../../../src/service/runtime/helpers-remaining';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.promptTemplateSettings = { enabled: true, maxNestingDepth: 10, debugMode: false };
  mockGetScriptCurrentMainReplyRequestId.mockReturnValue(null);
});

describe('handleChatCompletionReady_ACU', () => {
  it('功能未启用时仍处理脚本变量，但关闭其他模板能力', async () => {
    mockSettings.promptTemplateSettings = { enabled: false };
    mockReplaceAcuTemplateVariables.mockResolvedValue('script-processed');
    const data = { messages: [{ content: '{[script "脚本"]}' }] };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledWith('{[script "脚本"]}', expect.objectContaining({
      enableCalc: false,
      enableDbSql: false,
      enableIf: false,
      enableRandom: false,
    }));
    expect(data.messages[0].content).toBe('script-processed');
  });

  it('settings 为 null 时按默认启用处理', async () => {
    mockSettings.promptTemplateSettings = null;
    const data = { messages: [{ content: '{{random}}' }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalled();
  });

  it('data 为 null 时跳过处理', async () => {
    await handleChatCompletionReady_ACU(null);
    expect(mockReplaceAcuTemplateVariables).not.toHaveBeenCalled();
  });

  it('data.messages 不是数组时跳过处理', async () => {
    await handleChatCompletionReady_ACU({ messages: 'not array' });
    expect(mockReplaceAcuTemplateVariables).not.toHaveBeenCalled();
  });

  it('处理字符串类型的 message.content', async () => {
    mockReplaceAcuTemplateVariables.mockResolvedValue('processed');

    const data = { messages: [{ content: '原始内容' }] };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledWith('原始内容', expect.objectContaining({
      enableCalc: true,
      enableDbSql: true,
      enableIf: true,
      enableRandom: true,
      sourceContext: { promptType: 'main_reply', sourceType: 'tavern_prompt_template' },
    }));
    expect(data.messages[0].content).toBe('processed');
  });

  it('正文模板变量替换携带当前 main_reply requestContext', async () => {
    mockGetScriptCurrentMainReplyRequestId.mockReturnValue('main_reply_request_1');
    mockReplaceAcuTemplateVariables.mockResolvedValue('正文输出');

    const data = { messages: [{ content: '正文 {[script_output "replyHint"]}' }] };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledWith('正文 {[script_output "replyHint"]}', expect.objectContaining({
      sourceContext: { requestId: 'main_reply_request_1', promptType: 'main_reply', sourceType: 'tavern_prompt_template' },
      requestContext: {
        requestId: 'main_reply_request_1',
        source: { promptType: 'main_reply', sourceType: 'tavern_prompt_template' },
      },
    }));
    expect(data.messages[0].content).toBe('正文输出');
  });

  it('处理数组类型的 message.content（多模态）', async () => {
    mockReplaceAcuTemplateVariables.mockResolvedValue('processed');

    const data = {
      messages: [{
        content: [
          { type: 'text', text: '原始文本' },
          { type: 'image_url', image_url: 'http://img.png' },
        ],
      }],
    };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledWith('原始文本', expect.any(Object));
    expect(data.messages[0].content[0].text).toBe('processed');
    // image_url 部分不应被处理
    expect(data.messages[0].content[1].image_url).toBe('http://img.png');
  });

  it('content 不是字符串也不是数组时不处理', async () => {
    const data = { messages: [{ content: 123 }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockReplaceAcuTemplateVariables).not.toHaveBeenCalled();
  });

  it('空字符串 content 不调用处理函数', async () => {
    const data = { messages: [{ content: '' }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockReplaceAcuTemplateVariables).not.toHaveBeenCalled();
  });

  it('多条消息都被处理', async () => {
    mockReplaceAcuTemplateVariables.mockImplementation(async (s: string) => s + '_r');

    const data = {
      messages: [
        { content: '消息1' },
        { content: '消息2' },
        { content: '消息3' },
      ],
    };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledTimes(3);
    expect(data.messages[0].content).toBe('消息1_r');
    expect(data.messages[1].content).toBe('消息2_r');
    expect(data.messages[2].content).toBe('消息3_r');
  });

  it('getPlotFromHistory_ACU 被调用获取剧情数据', async () => {
    mockGetPlotFromHistory.mockReturnValue('剧情内容');
    const data = { messages: [{ content: '测试' }] };
    mockReplaceAcuTemplateVariables.mockResolvedValue('changed');

    await handleChatCompletionReady_ACU(data);
    expect(mockGetPlotFromHistory).toHaveBeenCalled();
  });

  it('委托通用变量入口处理内容', async () => {
    const data = { messages: [{ content: '测试内容' }] };
    await handleChatCompletionReady_ACU(data);

    expect(mockReplaceAcuTemplateVariables).toHaveBeenCalledWith('测试内容', expect.objectContaining({
      contextForCalc: { allTablesJson: mockCurrentJsonTableData },
      contextForIf: expect.objectContaining({ allTablesJson: mockCurrentJsonTableData }),
      ifMode: 'recursive',
    }));
  });
});

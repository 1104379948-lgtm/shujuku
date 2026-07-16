/**
 * tests/presentation/table-crud-api.test.ts
 * 表格 CRUD API 单元测试 — SQLite 模式 SQL 生成逻辑
 *
 * 策略：mock 全局状态 + mock provider，测试 SQL 生成的正确性和边界条件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } },
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

vi.mock('../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: { chat: [] },
}));

let mockCurrentJsonTableData: any = null;
let mockSettings: any = { dataIsolationEnabled: false, dataIsolationCode: '' };

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get settings_ACU() { return mockSettings; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentJsonTableData_ACU: vi.fn((data: any) => { mockCurrentJsonTableData = data; }),
}));

let mockIsSqliteMode = false;
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const {
  mockApplyParameterizedSqlMutation,
  mockPersistTablesToChatMessage,
  mockExecuteRuntimeMutation,
  mockApplyEditsBatchWithSheetMetadata,
  mockPrepareReseedPlan,
  mockGetRuntimeData,
  mockCreateRuntimeSnapshot,
  mockRestoreRuntimeSnapshot,
  mockEnsureStorageProviderReady,
  mockReloadStorageProvider,
  mockRunTableWriteTransaction,
} = vi.hoisted(() => ({
  mockApplyParameterizedSqlMutation: vi.fn(),
  mockPersistTablesToChatMessage: vi.fn().mockResolvedValue({ saved: true, messageIndex: 0 }),
  mockExecuteRuntimeMutation: vi.fn(() => ({ changes: 1, errors: [] })),
  mockApplyEditsBatchWithSheetMetadata: vi.fn(() => ({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 })),
  mockPrepareReseedPlan: vi.fn(() => ({ statements: [], paramsList: [], metadataUpdates: [] })),
  mockGetRuntimeData: vi.fn(),
  mockCreateRuntimeSnapshot: vi.fn(() => new Uint8Array([1, 2, 3])),
  mockRestoreRuntimeSnapshot: vi.fn().mockResolvedValue(undefined),
  mockEnsureStorageProviderReady: vi.fn().mockImplementation(async () => ({
    executeMutation: mockExecuteRuntimeMutation,
    applyEditsBatchWithSheetMetadata: mockApplyEditsBatchWithSheetMetadata,
    prepareReseedPlanForEmptyTables: mockPrepareReseedPlan,
    exportCanonicalData: mockGetRuntimeData,
    getCurrentData: mockGetRuntimeData,
    createRuntimeSnapshot: mockCreateRuntimeSnapshot,
    restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
  })),
  mockReloadStorageProvider: vi.fn().mockResolvedValue(undefined),
  mockRunTableWriteTransaction: vi.fn(async (options: any, task: any) => task({
    transactionId: 'tx-crud-test',
    chatKey: 'chat-a',
    isolationKey: '',
    source: options.source,
    baseRevision: null,
    writeSet: options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  }, options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : null)),
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({
    executeMutation: mockExecuteRuntimeMutation,
    applyEditsBatchWithSheetMetadata: mockApplyEditsBatchWithSheetMetadata,
    prepareReseedPlanForEmptyTables: mockPrepareReseedPlan,
    exportCanonicalData: mockGetRuntimeData,
    getCurrentData: mockGetRuntimeData,
    createRuntimeSnapshot: mockCreateRuntimeSnapshot,
    restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
  })),
  ensureStorageProviderReady_ACU: mockEnsureStorageProviderReady,
  reloadStorageProvider: mockReloadStorageProvider,
}));

vi.mock('../../src/service/table/sql-table-service', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/table/sql-table-service')>()),
  applyParameterizedSqlMutationToTableDataSnapshot_ACU: mockApplyParameterizedSqlMutation,
}));

vi.mock('../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn().mockResolvedValue({ success: true, migrated: false }),
  persistTablesToChatMessage_ACU: mockPersistTablesToChatMessage,
  saveIndependentTableToChatHistory_ACU: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: vi.fn(() => 'runtime-rev-head'),
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
}));

vi.mock('../../src/service/table/table-history', () => ({
  getLatestTableAppendMessageIndexFromChat_ACU: vi.fn(() => 0),
  resolveTableHistoryStateFromChat_ACU: vi.fn(() => ({
    latestAiMessageIndex: 0,
    latestDataMessageIndex: -1,
    lastTrackedUpdateMessageIndex: -1,
    latestDataAiFloor: 0,
    lastTrackedUpdateAiFloor: 0,
    hasAnyData: false,
    hasTrackedUpdate: false,
  })),
}));

vi.mock('../../src/presentation/triggers/update-process', () => ({
  saveCurrentDataForTable_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: vi.fn().mockResolvedValue(undefined),
}));

import {
  quoteIdentifier,
  findTargetSheet,
  createTableCrudApi,
} from '../../src/presentation/bootstrap/api-groups/table-crud-api';
import { resolveTableHistoryStateFromChat_ACU } from '../../src/service/table/table-history';
import { SillyTavern_API_ACU } from '../../src/shared/host-api';

// ═══════════════════════════════════════════════════════════════
// quoteIdentifier
// ═══════════════════════════════════════════════════════════════
describe('quoteIdentifier', () => {
  it('普通英文标识符', () => {
    expect(quoteIdentifier('item_name')).toBe('`item_name`');
  });

  it('中文标识符', () => {
    expect(quoteIdentifier('背包物品表')).toBe('`背包物品表`');
  });

  it('包含反引号的标识符（转义）', () => {
    expect(quoteIdentifier('col`name')).toBe('`col``name`');
  });

  it('空字符串', () => {
    expect(quoteIdentifier('')).toBe('``');
  });

  it('包含空格的标识符', () => {
    expect(quoteIdentifier('item name')).toBe('`item name`');
  });

  it('包含特殊字符的标识符', () => {
    expect(quoteIdentifier('col-1')).toBe('`col-1`');
  });

  it('多个反引号', () => {
    expect(quoteIdentifier('a``b')).toBe('`a````b`');
  });
});

// ═══════════════════════════════════════════════════════════════
// findTargetSheet
// ═══════════════════════════════════════════════════════════════
describe('findTargetSheet', () => {
  beforeEach(() => {
    mockCurrentJsonTableData = null;
  });

  it('找到匹配的表', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', content: [['row_id', 'item']] },
      sheet_1: { name: '技能表', content: [['row_id', 'skill']] },
    };
    const result = findTargetSheet('技能表');
    expect(result).not.toBeNull();
    expect(result!.sheetKey).toBe('sheet_1');
    expect(result!.sheet.name).toBe('技能表');
  });

  it('找不到表返回 null', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', content: [] },
    };
    expect(findTargetSheet('不存在的表')).toBeNull();
  });

  it('currentJsonTableData 为 null 返回 null', () => {
    mockCurrentJsonTableData = null;
    expect(findTargetSheet('任意表')).toBeNull();
  });

  it('跳过非 sheet_ 开头的键', () => {
    mockCurrentJsonTableData = {
      mate: { name: '背包物品表' },
      sheet_0: { name: '背包物品表', content: [] },
    };
    const result = findTargetSheet('背包物品表');
    expect(result!.sheetKey).toBe('sheet_0');
  });
});

// ═══════════════════════════════════════════════════════════════
// createTableCrudApi — SQLite 模式 SQL 生成
// ═══════════════════════════════════════════════════════════════
describe('createTableCrudApi — SQLite 模式', () => {
  let api: Record<string, Function>;
  const mockCtx: any = {};
  let mockAtomicRuntimeData: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSqliteMode = true;
    (SillyTavern_API_ACU as any).chat = [{ is_user: false }];
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        content: [
          ['row_id', '物品名', '数量'],
          ['1', '铁剑', '3'],
          ['2', '药水', '5'],
        ],
        sourceData: {},
      },
    };
    mockApplyParameterizedSqlMutation.mockImplementation(async (sql: string, params: any[], tableData: any) => {
      const workingData = JSON.parse(JSON.stringify(tableData));
      const sheet = workingData.sheet_0;
      if (String(sql).startsWith('INSERT')) {
        sheet.content.push(['3', params[0] ?? '', params[1] ?? '']);
      } else if (String(sql).startsWith('DELETE')) {
        sheet.content = sheet.content.filter((row: any[]) => row[0] !== params[0]);
      } else if (String(sql).startsWith('UPDATE')) {
        const row = sheet.content.find((item: any[]) => item[0] === params[params.length - 1]);
        if (row) row[1] = params[0];
      }
      return {
        success: true,
        modifiedKeys: ['sheet_0'],
        appliedEdits: 1,
        changes: 1,
        workingData,
      };
    });
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockExecuteRuntimeMutation.mockReturnValue({ changes: 1, errors: [] });
    mockPrepareReseedPlan.mockReturnValue({ statements: [], paramsList: [], metadataUpdates: [] });
    mockAtomicRuntimeData = null;
    mockApplyEditsBatchWithSheetMetadata.mockImplementation((statements: string[], paramsList: any[][], metadataUpdates: any[]) => {
      const workingData = JSON.parse(JSON.stringify(mockCurrentJsonTableData));
      const params = paramsList[0] || [];
      const mutationResult = mockExecuteRuntimeMutation(statements[0], params);
      if (mutationResult.errors?.length) {
        return { success: false, modifiedKeys: [], appliedEdits: 0, error: mutationResult.errors.join(', ') };
      }
      if (String(statements[0] || '').startsWith('INSERT')) {
        workingData.sheet_0.content.push([
          String(params[0]),
          params.length > 1 ? params[1] : '',
          params.length > 2 ? params[2] : '',
        ]);
      } else if (String(statements[0] || '').startsWith('DELETE')) {
        workingData.sheet_0.content = workingData.sheet_0.content.filter((row: any[], index: number) => index === 0 || row[0] !== params[0]);
      } else if (String(statements[0] || '').startsWith('UPDATE')) {
        const row = workingData.sheet_0.content.find((item: any[], index: number) => index > 0 && item[0] === params[params.length - 1]);
        if (row) row[1] = params[0];
      }
      for (const update of metadataUpdates || []) {
        if (workingData[update.sheetKey]) {
          workingData[update.sheetKey].sourceData = JSON.parse(JSON.stringify(update.sheet.sourceData || {}));
        }
      }
      mockAtomicRuntimeData = workingData;
      return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: statements.length, changes: mutationResult.changes, statementChanges: statements.map(() => mutationResult.changes) };
    });
    mockGetRuntimeData.mockImplementation(() => {
      if (mockAtomicRuntimeData) return JSON.parse(JSON.stringify(mockAtomicRuntimeData));
      const workingData = JSON.parse(JSON.stringify(mockCurrentJsonTableData));
      const sheet = workingData.sheet_0;
      const lastCall = mockExecuteRuntimeMutation.mock.calls.at(-1) || [];
      const sql = String(lastCall[0] || '');
      const params = (lastCall[1] || []) as any[];
      if (sql.startsWith('INSERT')) {
        sheet.content.push(['3', params[0] ?? '', params[1] ?? '']);
      } else if (sql.startsWith('DELETE')) {
        sheet.content = sheet.content.filter((row: any[]) => row[0] !== params[0]);
      } else if (sql.startsWith('UPDATE')) {
        const row = sheet.content.find((item: any[]) => item[0] === params[params.length - 1]);
        if (row) row[1] = params[0];
      }
      return workingData;
    });
    mockCreateRuntimeSnapshot.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockRestoreRuntimeSnapshot.mockResolvedValue(undefined);
    mockEnsureStorageProviderReady.mockResolvedValue({
      executeMutation: mockExecuteRuntimeMutation,
      applyEditsBatchWithSheetMetadata: mockApplyEditsBatchWithSheetMetadata,
      prepareReseedPlanForEmptyTables: mockPrepareReseedPlan,
      exportCanonicalData: mockGetRuntimeData,
      getCurrentData: mockGetRuntimeData,
      createRuntimeSnapshot: mockCreateRuntimeSnapshot,
      restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
    });
    mockReloadStorageProvider.mockResolvedValue(undefined);
    mockRunTableWriteTransaction.mockImplementation(async (options: any, task: any) => task({
      transactionId: 'tx-crud-test',
      chatKey: 'chat-a',
      isolationKey: '',
      source: options.source,
      baseRevision: null,
      writeSet: options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }, options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : mockCurrentJsonTableData));
    api = createTableCrudApi(mockCtx);
  });

  // ─── updateCell ───
  describe('updateCell', () => {
    it('生成正确的 UPDATE SQL（列名为字符串）', async () => {
      await api.updateCell('背包物品表', 1, '数量', '10');
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `数量` = ? WHERE `row_id` = ?",
        ['10', '1'],
      );
    });

    it('SQLite updateCell 在统一事务内执行', async () => {
      await api.updateCell('背包物品表', 1, '数量', '10');
      expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        reason: 'updateCell:sqlite',
        writeSet: [{ kind: 'cell', sheetKey: 'sheet_0', rowId: '1', columnKey: '数量' }],
      }), expect.any(Function));
    });

    it('生成正确的 UPDATE SQL（列名为数字索引）', async () => {
      await api.updateCell('背包物品表', 1, 1, '新铁剑');
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `物品名` = ? WHERE `row_id` = ?",
        ['新铁剑', '1'],
      );
    });

    it('value 为 null 时生成 NULL', async () => {
      await api.updateCell('背包物品表', 1, '数量', null);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `数量` = ? WHERE `row_id` = ?",
        [null, '1'],
      );
    });

    it('value 包含单引号时正确转义', async () => {
      await api.updateCell('背包物品表', 1, '物品名', "铁剑'加强版");
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `物品名` = ? WHERE `row_id` = ?",
        ["铁剑'加强版", '1'],
      );
    });

    it('表不存在返回 false', async () => {
      const result = await api.updateCell('不存在的表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('列不存在返回 false', async () => {
      const result = await api.updateCell('背包物品表', 1, '不存在的列', '10');
      expect(result).toBe(false);
    });

    it('行索引越界返回 false', async () => {
      const result = await api.updateCell('背包物品表', 0, '数量', '10');
      expect(result).toBe(false);
    });

    it('SQL 执行失败返回 false', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['SQL 语法错误'], changes: 0 });
      const result = await api.updateCell('背包物品表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.updateCell('背包物品表', 1, '数量', '10');

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('currentJsonTableData 为 null 返回 false', async () => {
      mockCurrentJsonTableData = null;
      const result = await api.updateCell('背包物品表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('已有历史数据时不把编辑器保存记为最新填表更新', async () => {
      vi.mocked(resolveTableHistoryStateFromChat_ACU).mockReturnValueOnce({
        latestAiMessageIndex: 1,
        latestDataMessageIndex: 0,
        lastTrackedUpdateMessageIndex: 0,
        latestDataAiFloor: 1,
        lastTrackedUpdateAiFloor: 1,
        hasAnyData: true,
        hasTrackedUpdate: true,
      });
      await api.updateCell('背包物品表', 1, '数量', '10');
      const { saveCurrentDataForTable_ACU } = await import('../../src/presentation/triggers/update-process');
      expect(vi.mocked(saveCurrentDataForTable_ACU)).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        targetSheetKeys: ['sheet_0'],
        updateGroupKeys: null,
        trackingSheetKeys: [],
        trackAsUpdate: false,
      }));
    });
  });

  // ─── updateRow ───
  describe('updateRow', () => {
    it('生成正确的 UPDATE SQL（多列）', async () => {
      await api.updateRow('背包物品表', 1, { '物品名': '钢剑', '数量': '7' });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `物品名` = ?, `数量` = ? WHERE `row_id` = ?",
        ['钢剑', '7', '1'],
      );
    });

    it('跳过 isImportMode 内部标记', async () => {
      await api.updateRow('背包物品表', 1, { '物品名': '钢剑', isImportMode: true });
      expect(mockExecuteRuntimeMutation.mock.calls[0][0] as string).not.toContain('isImportMode');
    });

    it('跳过不存在的列名', async () => {
      await api.updateRow('背包物品表', 1, { '不存在的列': '值', '物品名': '钢剑' });
      expect(mockExecuteRuntimeMutation.mock.calls[0][0] as string).not.toContain('不存在的列');
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        "UPDATE `背包物品表` SET `物品名` = ? WHERE `row_id` = ?",
        ['钢剑', '1'],
      );
    });

    it('无有效列时返回 false（无效操作）', async () => {
      const result = await api.updateRow('背包物品表', 1, { '不存在的列': '值' });
      expect(result).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
    });

    it('rowIndex < 1 返回 false', async () => {
      const result = await api.updateRow('背包物品表', 0, { '物品名': '钢剑' });
      expect(result).toBe(false);
    });

    it('rowIndex 越界时拒绝隐式新增无 row_id 行', async () => {
      const result = await api.updateRow('背包物品表', 3, { '物品名': '钢剑' });
      expect(result).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(3);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.updateRow('背包物品表', 1, { '物品名': '钢剑' });

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('row_id 不存在返回 false', async () => {
      mockCurrentJsonTableData.sheet_0.content[1][0] = null;
      const result = await api.updateRow('背包物品表', 1, { '物品名': '钢剑' });
      expect(result).toBe(false);
    });
  });

  // ─── insertRow ───
  describe('insertRow', () => {
    it('使用 Sheet 高水位生成显式 row_id INSERT，并原子提交 metadata', async () => {
      await api.insertRow('背包物品表', { '物品名': '盾牌', '数量': '1' });
      const [statements, paramsList, metadataUpdates, reason, batchOptions] = mockApplyEditsBatchWithSheetMetadata.mock.calls[0];
      expect(statements).toEqual(['INSERT INTO `背包物品表` (`row_id`, `物品名`, `数量`) VALUES (?, ?, ?);']);
      expect(paramsList).toEqual([['3', '盾牌', '1']]);
      expect(metadataUpdates).toHaveLength(1);
      expect(metadataUpdates[0].sheetKey).toBe('sheet_0');
      expect(metadataUpdates[0].sheet.sourceData.nextRowId).toBe(4);
      expect(reason).toBe('insertRow:sqlite');
      expect(batchOptions).toEqual({ includeImplicitReseed: false });
    });

    it('忽略调用方 row_id，始终使用系统高水位', async () => {
      await api.insertRow('背包物品表', { row_id: '99', '物品名': '盾牌' });
      const [statements, paramsList, , reason, batchOptions] = mockApplyEditsBatchWithSheetMetadata.mock.calls[0];
      expect(statements).toEqual(['INSERT INTO `背包物品表` (`row_id`, `物品名`) VALUES (?, ?);']);
      expect(paramsList).toEqual([['3', '盾牌']]);
      expect(reason).toBe('insertRow:sqlite');
      expect(batchOptions).toEqual({ includeImplicitReseed: false });
    });

    it('空 data 仍显式写入系统 row_id', async () => {
      await api.insertRow('背包物品表', {});
      const [statements, paramsList, , reason, batchOptions] = mockApplyEditsBatchWithSheetMetadata.mock.calls[0];
      expect(statements).toEqual(['INSERT INTO `背包物品表` (`row_id`) VALUES (?);']);
      expect(paramsList).toEqual([['3']]);
      expect(reason).toBe('insertRow:sqlite');
      expect(batchOptions).toEqual({ includeImplicitReseed: false });
    });

    it('value 为 null 时将 null 作为参数传递', async () => {
      await api.insertRow('背包物品表', { '物品名': null, '数量': '1' });
      const [statements, paramsList, , reason, batchOptions] = mockApplyEditsBatchWithSheetMetadata.mock.calls[0];
      expect(statements).toEqual(['INSERT INTO `背包物品表` (`row_id`, `物品名`, `数量`) VALUES (?, ?, ?);']);
      expect(paramsList).toEqual([['3', null, '1']]);
      expect(reason).toBe('insertRow:sqlite');
      expect(batchOptions).toEqual({ includeImplicitReseed: false });
    });

    it('value 包含单引号时传递原始值不作转义（由参数化查询处理）', async () => {
      await api.insertRow('背包物品表', { '物品名': "铁剑'加强版" });
      const [statements, paramsList, , reason, batchOptions] = mockApplyEditsBatchWithSheetMetadata.mock.calls[0];
      expect(statements).toEqual(['INSERT INTO `背包物品表` (`row_id`, `物品名`) VALUES (?, ?);']);
      expect(paramsList).toEqual([['3', "铁剑'加强版"]]);
      expect(reason).toBe('insertRow:sqlite');
      expect(batchOptions).toEqual({ includeImplicitReseed: false });
    });

    it('表不存在返回 -1', async () => {
      const result = await api.insertRow('不存在的表', { '物品名': '盾牌' });
      expect(result).toBe(-1);
    });

    it('SQL 执行失败返回 -1', async () => {
      mockApplyEditsBatchWithSheetMetadata.mockImplementationOnce(() => { throw new Error('SQL 错误'); });
      const result = await api.insertRow('背包物品表', { '物品名': '盾牌' });
      expect(result).toBe(-1);
    });

    it('真实运行时 DB 约束失败时不写持久层', async () => {
      mockApplyEditsBatchWithSheetMetadata.mockImplementationOnce(() => { throw new Error('NOT NULL constraint failed: map_elements.element_name'); });

      const result = await api.insertRow('背包物品表', { '物品名': null, '数量': '1' });

      expect(result).toBe(-1);
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
      expect(mockReloadStorageProvider).not.toHaveBeenCalled();
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.insertRow('背包物品表', { '物品名': '盾牌' });

      expect(result).toBe(-1);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockApplyEditsBatchWithSheetMetadata).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('非 SQLite insertRow 使用持久高水位且 operation 同步固化 row_id 与 nextRowId', async () => {
      mockIsSqliteMode = false;
      mockCurrentJsonTableData.sheet_0.content = [
        ['row_id', '物品名', '数量'],
        ['1', '铁剑', '3'],
        ['3', '盾牌', '1'],
      ];
      mockCurrentJsonTableData.sheet_0.sourceData = { nextRowId: 4 };

      const result = await api.insertRow('背包物品表', { '物品名': '药水', '数量': '0' });

      expect(result).toBe(3);
      expect(mockCurrentJsonTableData.sheet_0.content[3]).toEqual(['4', '药水', '0']);
      expect(mockCurrentJsonTableData.sheet_0.sourceData.nextRowId).toBe(5);
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        operations: [
          { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '4', cells: ['4', '药水', '0'] },
          { kind: 'meta_update', sheetKey: 'sheet_0', meta: { sourceData: { nextRowId: 5 } } },
        ],
        tableData: expect.objectContaining({
          sheet_0: expect.objectContaining({
            content: expect.arrayContaining([['4', '药水', '0']]),
            sourceData: expect.objectContaining({ nextRowId: 5 }),
          }),
        }),
      }));
    });

    it('持久化失败时在同一公共提交模型内 reload 运行时', async () => {
      mockPersistTablesToChatMessage.mockResolvedValue({ saved: false, error: 'save failed' });

      const result = await api.insertRow('背包物品表', { '物品名': '盾牌', '数量': '1' });

      expect(result).toBe(-1);
      expect(mockApplyEditsBatchWithSheetMetadata).toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        tableData: expect.any(Object),
        assumeCommitLock: true,
      }));
      expect(mockReloadStorageProvider).toHaveBeenCalled();
    });
  });

  // ─── deleteRow ───
  describe('deleteRow', () => {
    it('生成正确的 DELETE SQL', async () => {
      await api.deleteRow('背包物品表', 1);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'DELETE FROM `背包物品表` WHERE `row_id` = ?',
        ['1'],
      );
    });

    it('rowIndex < 1 返回 false', async () => {
      const result = await api.deleteRow('背包物品表', 0);
      expect(result).toBe(false);
    });

    it('rowIndex 越界返回 false', async () => {
      const result = await api.deleteRow('背包物品表', 99);
      expect(result).toBe(false);
    });

    it('row_id 为 null 返回 false', async () => {
      mockCurrentJsonTableData.sheet_0.content[1][0] = null;
      const result = await api.deleteRow('背包物品表', 1);
      expect(result).toBe(false);
    });

    it('SQL 执行失败返回 false', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['SQL 错误'], changes: 0 });
      const result = await api.deleteRow('背包物品表', 1);
      expect(result).toBe(false);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.deleteRow('背包物品表', 1);

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('表不存在返回 false', async () => {
      const result = await api.deleteRow('不存在的表', 1);
      expect(result).toBe(false);
    });
  });
});

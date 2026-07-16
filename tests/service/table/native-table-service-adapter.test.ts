/**
 * tests/service/table/native-table-service-adapter.test.ts
 * NativeTableServiceAdapter 单元测试
 *
 * 策略：mock 所有委托函数，验证适配器正确转发调用和转换返回值
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

// mock log 函数
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

// mock table-service
const mockLoadOrCreate = vi.fn();
vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: (...args: any[]) => mockLoadOrCreate(...args),
}));

// mock table-edit-parser
const mockParseAndApply = vi.fn();
vi.mock('../../../src/service/ai/prompt-builder/table-edit-parser', () => ({
  parseAndApplyTableEdits_ACU: (...args: any[]) => mockParseAndApply(...args),
}));

// mock state-manager
const nativeStateMocks = vi.hoisted(() => {
  const state: { data: any; owner: object | null } = { data: null, owner: null };
  return {
    state,
    capture: vi.fn(() => ({ data: state.data, owner: state.owner })),
    publish: vi.fn((owner: object, value: any) => {
      state.owner = owner;
      state.data = value;
    }),
    release: vi.fn((owner: object) => {
      if (state.owner !== owner) return false;
      state.owner = null;
      state.data = null;
      return true;
    }),
    restore: vi.fn((snapshot: { data: any; owner: object | null }) => {
      state.data = snapshot.data;
      state.owner = snapshot.owner;
    }),
  };
});
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return nativeStateMocks.state.data; },
  captureCurrentJsonTablePublication_ACU: nativeStateMocks.capture,
  publishCurrentJsonTableDataForOwner_ACU: nativeStateMocks.publish,
  releaseCurrentJsonTableDataForOwner_ACU: nativeStateMocks.release,
  restoreCurrentJsonTablePublication_ACU: nativeStateMocks.restore,
}));

const nativeNameMapperMocks = vi.hoisted(() => {
  const state: { mapper: any; owner: object | null } = { mapper: null, owner: null };
  return {
    state,
    capture: vi.fn(() => ({ mapper: state.mapper, owner: state.owner })),
    publish: vi.fn((owner: object, mapper: any) => {
      state.mapper = mapper;
      state.owner = mapper ? owner : null;
    }),
    restore: vi.fn((snapshot: { mapper: any; owner: object | null }) => {
      state.mapper = snapshot.mapper;
      state.owner = snapshot.owner;
    }),
  };
});
vi.mock('../../../src/service/runtime/template-vars/name-mapper', () => ({
  captureGlobalNameMapperPublication_ACU: nativeNameMapperMocks.capture,
  publishGlobalNameMapperForOwner_ACU: nativeNameMapperMocks.publish,
  restoreGlobalNameMapperPublication_ACU: nativeNameMapperMocks.restore,
}));

import { NativeTableServiceAdapter } from '../../../src/service/table/native-table-service-adapter';

describe('NativeTableServiceAdapter', () => {
  let adapter: NativeTableServiceAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    nativeStateMocks.state.data = null;
    nativeStateMocks.state.owner = null;
    nativeNameMapperMocks.state.mapper = null;
    nativeNameMapperMocks.state.owner = null;
    adapter = new NativeTableServiceAdapter();
  });

  // ═══════════════════════════════════════════════════════════════
  // mode
  // ═══════════════════════════════════════════════════════════════
  describe('mode', () => {
    it('mode 为 "native"', () => {
      expect(adapter.mode).toBe('native');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // loadFromChat
  // ═══════════════════════════════════════════════════════════════
  describe('loadFromChat', () => {
    it('委托给 loadOrCreateJsonTableFromChatHistory_ACU', async () => {
      mockLoadOrCreate.mockResolvedValue({ loaded: true, source: 'merged' });
      const result = await adapter.loadFromChat();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('merged');
      expect(mockLoadOrCreate).toHaveBeenCalledTimes(1);
    });

    it('传递初始化结果', async () => {
      mockLoadOrCreate.mockResolvedValue({ loaded: true, source: 'initialized' });
      const result = await adapter.loadFromChat();
      expect(result.source).toBe('initialized');
    });

    it('传递空结果', async () => {
      mockLoadOrCreate.mockResolvedValue({ loaded: false, source: 'empty', error: '无数据' });
      const result = await adapter.loadFromChat();
      expect(result.loaded).toBe(false);
      expect(result.error).toBe('无数据');
    });
  });

  describe('candidate publication', () => {
    it('候选 loadFromData 只保留私有快照，activation 后才 owner publish', async () => {
      const activeView = { sheet_active: { name: 'active' } };
      const candidateView = { sheet_candidate: { name: 'candidate' } } as any;
      nativeStateMocks.state.data = activeView;
      adapter.beginRuntimeCandidate_ACU();

      await adapter.loadFromData(candidateView);

      expect(adapter.getCurrentData()).toEqual(candidateView);
      expect(nativeStateMocks.state.data).toBe(activeView);
      expect(nativeStateMocks.publish).not.toHaveBeenCalled();
      expect(nativeNameMapperMocks.publish).not.toHaveBeenCalled();

      adapter.activateRuntimeStatePublication_ACU();
      expect(nativeStateMocks.publish).toHaveBeenCalledWith(adapter, candidateView);
      expect(nativeNameMapperMocks.publish).toHaveBeenCalledWith(adapter, null);
      expect(nativeStateMocks.state.data).toEqual(candidateView);
    });

    it('mapper 清理失败时恢复旧 publication，随后 candidate dispose 不破坏旧状态', async () => {
      const oldJsonOwner = {};
      const oldMapperOwner = {};
      const activeView = { sheet_active: { name: 'active' } };
      const activeMapper = { tableCount: 3 };
      nativeStateMocks.state.data = activeView;
      nativeStateMocks.state.owner = oldJsonOwner;
      nativeNameMapperMocks.state.mapper = activeMapper;
      nativeNameMapperMocks.state.owner = oldMapperOwner;
      adapter.beginRuntimeCandidate_ACU();
      await adapter.loadFromData({ sheet_candidate: { name: 'candidate' } } as any);
      nativeNameMapperMocks.publish.mockImplementationOnce(() => {
        throw new Error('mapper cleanup failed');
      });

      expect(() => adapter.activateRuntimeStatePublication_ACU()).toThrow('mapper cleanup failed');
      expect(nativeStateMocks.state.data).toBe(activeView);
      expect(nativeStateMocks.state.owner).toBe(oldJsonOwner);
      expect(nativeNameMapperMocks.state.mapper).toBe(activeMapper);
      expect(nativeNameMapperMocks.state.owner).toBe(oldMapperOwner);

      adapter.dispose();
      expect(nativeStateMocks.state.data).toBe(activeView);
      expect(nativeStateMocks.state.owner).toBe(oldJsonOwner);
      expect(nativeNameMapperMocks.state.mapper).toBe(activeMapper);
      expect(nativeNameMapperMocks.state.owner).toBe(oldMapperOwner);
    });

    it('显式 initialization snapshot 保留来源语义且不修改输入', async () => {
      const initialView = { mate: {}, sheet_0: { content: [['row_id', 'name']] } } as any;
      const original = JSON.parse(JSON.stringify(initialView));
      adapter.beginRuntimeCandidate_ACU();

      const result = await adapter.loadFromData(initialView, { source: 'initialized' });

      expect(result).toEqual({ loaded: true, source: 'initialized' });
      expect(initialView).toEqual(original);
      expect(adapter.getCurrentData()).toEqual(original);
      expect(adapter.getCurrentData()).not.toBe(initialView);
      expect(nativeNameMapperMocks.publish).not.toHaveBeenCalled();
    });

    it('候选 dispose 不清理遗留 mapper，只有 activation 显式清理', async () => {
      adapter.beginRuntimeCandidate_ACU();
      await adapter.loadFromData({ mate: {}, sheet_0: { content: [['row_id']] } } as any);
      adapter.dispose();
      expect(nativeNameMapperMocks.publish).not.toHaveBeenCalled();
    });

    it('旧实例 dispose 不清除其他 owner 的公共 JSON', async () => {
      const otherOwner = {};
      nativeStateMocks.state.owner = otherOwner;
      nativeStateMocks.state.data = { sheet_new: {} };
      adapter.dispose();
      expect(nativeStateMocks.state.data).toEqual({ sheet_new: {} });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // saveToChat
  // ═══════════════════════════════════════════════════════════════
  describe('saveToChat', () => {
    it('拒绝 provider 直接保存，要求走公共提交模型', async () => {
      const result = await adapter.saveToChat(['sheet_0'], ['group_1']);
      expect(result.saved).toBe(false);
      expect(result.error).toContain('table update commit model');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentData
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentData', () => {
    it('返回 currentJsonTableData_ACU', () => {
      nativeStateMocks.state.data = { mate: { type: 'acu' }, sheet_0: { name: '测试' } };
      expect(adapter.getCurrentData()).toEqual(nativeStateMocks.state.data);
    });

    it('数据为 null 时返回 null', () => {
      nativeStateMocks.state.data = null;
      expect(adapter.getCurrentData()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // clearRuntimeData
  // ═══════════════════════════════════════════════════════════════
  describe('clearRuntimeData', () => {
    it('精确清空当前 JSON 运行时数据', () => {
      nativeStateMocks.state.data = { mate: { type: 'acu' }, sheet_0: { name: '测试' } };
      adapter.clearRuntimeData();
      expect(adapter.getCurrentData()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // applyEdits
  // ═══════════════════════════════════════════════════════════════
  describe('applyEdits', () => {
    it('成功时返回 success=true', () => {
      mockParseAndApply.mockReturnValue(true);
      const result = adapter.applyEdits('<tableEdit>...</tableEdit>', 'standard');
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
      expect(mockParseAndApply).toHaveBeenCalledWith('<tableEdit>...</tableEdit>', 'standard');
    });

    it('失败时返回 success=false', () => {
      mockParseAndApply.mockReturnValue(false);
      const result = adapter.applyEdits('invalid', 'standard');
      expect(result.success).toBe(false);
      expect(result.appliedEdits).toBe(0);
    });

    it('返回对象结果时正确处理', () => {
      mockParseAndApply.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
      const result = adapter.applyEdits('edits', 'standard');
      // NativeTableServiceAdapter 将 parseAndApplyTableEdits_ACU 的返回值当 boolean 处理
      expect(result.success).toBe(true);
    });

    it('updateMode 默认为 "standard"', () => {
      mockParseAndApply.mockReturnValue(true);
      adapter.applyEdits('edits');
      expect(mockParseAndApply).toHaveBeenCalledWith('edits', 'standard');
    });

    it('modifiedKeys 始终为空数组（原生模式不追踪）', () => {
      mockParseAndApply.mockReturnValue(true);
      const result = adapter.applyEdits('edits', 'standard');
      expect(result.modifiedKeys).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // executeQuery — 原生模式不支持
  // ═══════════════════════════════════════════════════════════════
  describe('executeQuery', () => {
    it('抛出 Error', () => {
      expect(() => adapter.executeQuery('SELECT 1')).toThrow('SQL 查询仅在 SQLite 模式下可用');
    });

    it('错误信息包含切换提示', () => {
      expect(() => adapter.executeQuery('SELECT 1')).toThrow('切换到 SQLite 模式');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // executeMutation — 原生模式不支持
  // ═══════════════════════════════════════════════════════════════
  describe('executeMutation', () => {
    it('抛出 Error', () => {
      expect(() => adapter.executeMutation('INSERT INTO t VALUES (1)')).toThrow('SQL 变更仅在 SQLite 模式下可用');
    });

    it('错误信息包含切换提示', () => {
      expect(() => adapter.executeMutation('DELETE FROM t')).toThrow('切换到 SQLite 模式');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // dispose
  // ═══════════════════════════════════════════════════════════════
  describe('dispose', () => {
    it('不抛出异常', () => {
      expect(() => adapter.dispose()).not.toThrow();
    });

    it('多次调用不抛出', () => {
      adapter.dispose();
      expect(() => adapter.dispose()).not.toThrow();
    });
  });
});

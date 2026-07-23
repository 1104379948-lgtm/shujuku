import { describe, expect, it } from 'vitest';
import {
  allocateStableSheetKeys_ACU,
  buildStableSheetKeyCandidate_ACU,
  canonicalizeDisplayName_ACU,
  SHEET_KEY_ALGORITHM_VERSION_ACU,
  toAsciiSlug_ACU,
} from '../../src/shared/sheet-identity';

describe('sheet identity', () => {
  it('版本化并规范化显示名，但不要求调用方回写原名', () => {
    expect(SHEET_KEY_ALGORITHM_VERSION_ACU).toBe(1);
    expect(canonicalizeDisplayName_ACU('  ＨＥＲＯ\u3000 Inventory  ')).toBe('hero inventory');
  });

  it('为英文、中文和混合名称生成确定性的稳定 key', () => {
    expect(buildStableSheetKeyCandidate_ACU(' Hero Inventory ')).toBe('sheet_hero_inventory');
    expect(buildStableSheetKeyCandidate_ACU('背包物品表')).toBe('sheet_bei_bao_wu_pin_biao');
    expect(buildStableSheetKeyCandidate_ACU('背包物品表')).toBe('sheet_bei_bao_wu_pin_biao');
    expect(buildStableSheetKeyCandidate_ACU('角色 Inventory')).toBe('sheet_jue_se_inventory');
    expect(toAsciiSlug_ACU('重庆')).toBe('chong_qing');
  });

  it('标点、emoji 与空白不会产生随机兜底 key', () => {
    expect(buildStableSheetKeyCandidate_ACU('任务！清单')).toBe('sheet_ren_wu_qing_dan');
    expect(buildStableSheetKeyCandidate_ACU('  😀  ')).toBeNull();
  });

  it('拒绝 canonical 重名并报告可定位冲突', () => {
    const result = allocateStableSheetKeys_ACU(['Inventory', ' inventory ', '装备']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'duplicate_canonical_name', index: 1, conflictsWithIndex: 0,
    }));
    expect(result.keys[0]).toBe(result.keys[1]);
  });

  it('用 canonical 哈希消除不同名称的 slug 碰撞，且不依赖输入顺序', () => {
    const first = allocateStableSheetKeys_ACU(['a b', 'a-b']);
    const second = allocateStableSheetKeys_ACU(['a-b', 'a b']);
    expect(first.keys[0]).not.toBe(first.keys[1]);
    expect(first.keys[0]).toBe(second.keys[1]);
    expect(first.keys[1]).toBe(second.keys[0]);
  });


  it('保留历史 key，仅对后续撞 key 的新名称消歧', () => {
    const result = allocateStableSheetKeys_ACU(['a-b'], {
      existing: [{ canonicalName: 'a b', sheetKey: 'sheet_a_b' }],
    });
    expect(result.keys).toEqual([expect.stringMatching(/^sheet_a_b_[a-f0-9]{10}$/)]);
    expect(result.diagnostics).toEqual([]);

    const retained = allocateStableSheetKeys_ACU(['a b'], {
      existing: [{ canonicalName: 'a b', sheetKey: 'sheet_legacy_random' }],
    });
    expect(retained.keys).toEqual(['sheet_legacy_random']);
  });

  it('冻结简繁和多音字的算法基线', () => {
    expect(toAsciiSlug_ACU('重庆')).toBe('chong_qing');
    expect(toAsciiSlug_ACU('重慶')).toBe('zhong_qing');
    expect(toAsciiSlug_ACU('绿')).toBe('lv');
    expect(toAsciiSlug_ACU('綠')).toBe('lv');
  });

  it('截断长名称并在重复调用间保持一致', () => {
    const name = `表${'a'.repeat(100)}`;
    const key = buildStableSheetKeyCandidate_ACU(name)!;
    expect(key).toMatch(/^sheet_[a-z0-9_]+$/);
    expect(key.length).toBeLessThanOrEqual(54);
    expect(buildStableSheetKeyCandidate_ACU(name)).toBe(key);
  });
});

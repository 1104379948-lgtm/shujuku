/**
 * tests/shared/lorebook-read-error.test.ts
 * 共享世界书读取错误分类器：统一 gateway / strict pipeline / plot runtime 的宿主错误分类。
 */
import { describe, expect, it } from 'vitest';
import {
  classifyLorebookReadError_ACU,
  isLorebookReadAbortedError_ACU,
  isLorebookReadNotFoundError_ACU,
} from '../../src/shared/lorebook-read-error';

describe('classifyLorebookReadError_ACU', () => {
  describe('lorebook_not_found', () => {
    it.each([
      'Worldbook "ghost" not found',
      'Lorebook does not exist',
      'Could not find the lorebook',
      'Cannot find the worldbook',
      'Can\'t find worldbook',
      'Worldbook is missing',
      'lorebook is missing',
    ])('英文明确书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('lorebook_not_found');
    });

    it.each([
      '世界书“旧书”不存在',
      '未能找到世界书',
      '无法找到世界书',
      '世界书 “X” 无法找到',
      '世界书 "X" 无法找到',
      '找不到世界书 \'Sakura - Neglected Roommate\'',
    ])('中文明确书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('lorebook_not_found');
    });
  });

  describe('aborted', () => {
    it('AbortError name 归类为 aborted', () => {
      const error = Object.assign(new Error('worldbook "X" not found'), { name: 'AbortError' });
      expect(classifyLorebookReadError_ACU(error)).toBe('aborted');
      expect(isLorebookReadAbortedError_ACU(error)).toBe(true);
      expect(isLorebookReadNotFoundError_ACU(error)).toBe(false);
    });

    it('TaskAbortedByUser 消息归类为 aborted', () => {
      expect(classifyLorebookReadError_ACU(new Error('TaskAbortedByUser'))).toBe('aborted');
    });
  });

  describe('unknown', () => {
    it.each([
      'permission denied',
      'network unavailable',
      'Lorebook permission denied',
      'Lorebook credentials missing',
      'Lorebook permission scope missing',
      'Lorebook response missing required field',
      'Lorebook credentials not found',
      'Lorebook permission scope not found',
      'Lorebook response field not found',
      'Missing permission for Lorebook',
      'Lorebook network request failed',
      'Lorebook response malformed',
      '无法找到世界书条目',
      '未能找到世界书条目',
      '找不到世界书条目',
      '世界书条目不存在',
      'Lorebook entry not found',
      'Worldbook entry does not exist',
      '无法找到世界书条目，请检查关键词',
    ])('普通失败或条目级缺失不得归类为书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('unknown');
    });

    it('非 Error 拒绝值归类为 unknown', () => {
      expect(classifyLorebookReadError_ACU({ reason: 'Lorebook unavailable' })).toBe('unknown');
      expect(classifyLorebookReadError_ACU(undefined)).toBe('unknown');
      expect(classifyLorebookReadError_ACU(null)).toBe('unknown');
    });
  });
});

/**
 * tests/shared/json-helpers.test.ts
 * JSON 安全解析/序列化工具 单元测试
 */
import { describe, it, expect } from 'vitest';
import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../src/shared/json-helpers';

describe('safeJsonParse_ACU', () => {
  it('正常 JSON 字符串解析成功', () => {
    expect(safeJsonParse_ACU('{"a":1}')).toEqual({ a: 1 });
  });

  it('数组 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('字符串 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('"hello"')).toBe('hello');
  });

  it('数字 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('42')).toBe(42);
  });

  it('null JSON 解析成功', () => {
    expect(safeJsonParse_ACU('null')).toBeNull();
  });

  it('非法 JSON 返回默认 fallback（null）', () => {
    expect(safeJsonParse_ACU('{invalid}')).toBeNull();
  });

  it('非法 JSON 返回自定义 fallback', () => {
    expect(safeJsonParse_ACU('{invalid}', { default: true })).toEqual({ default: true });
  });

  it('空字符串返回 fallback', () => {
    expect(safeJsonParse_ACU('')).toBeNull();
  });

  it('undefined 字符串返回 fallback', () => {
    expect(safeJsonParse_ACU('undefined')).toBeNull();
  });

  it('嵌套对象解析成功', () => {
    const json = '{"a":{"b":{"c":1}}}';
    expect(safeJsonParse_ACU(json)).toEqual({ a: { b: { c: 1 } } });
  });

  it('含中文的 JSON 解析成功', () => {
    expect(safeJsonParse_ACU('{"名字":"铁剑"}')).toEqual({ 名字: '铁剑' });
  });
});

describe('safeJsonStringify_ACU', () => {
  it('正常对象序列化成功', () => {
    expect(safeJsonStringify_ACU({ a: 1 })).toBe('{"a":1}');
  });

  it('数组序列化成功', () => {
    expect(safeJsonStringify_ACU([1, 2, 3])).toBe('[1,2,3]');
  });

  it('null 序列化成功', () => {
    expect(safeJsonStringify_ACU(null)).toBe('null');
  });

  it('字符串序列化成功', () => {
    expect(safeJsonStringify_ACU('hello')).toBe('"hello"');
  });

  it('循环引用返回默认 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(safeJsonStringify_ACU(obj)).toBe('{}');
  });

  it('循环引用返回自定义 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(safeJsonStringify_ACU(obj, '[]')).toBe('[]');
  });

  it('含中文的对象序列化成功', () => {
    const result = safeJsonStringify_ACU({ 名字: '铁剑' });
    expect(result).toContain('铁剑');
  });
});

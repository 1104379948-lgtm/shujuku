import { describe, expect, it } from 'vitest';
import {
  validateSqliteTemplateDataStrict_ACU,
} from '../../../src/service/table/sqlite-template-validation';

const invalidRuntimeDdlSnapshot = {
  mate: { type: 'acu_table_data', version: 3 },
  sheet_runtime: {
    uid: 'runtime_sheet',
    name: '运行时回退表',
    sourceData: {
      ddl: 'CREATE TABLE broken_runtime ( INVALID SYNTAX;',
    },
    content: [
      ['row_id', '物品'],
      ['1', '铁剑'],
    ],
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
  },
};

describe('validateSqliteTemplateDataStrict_ACU', () => {
  it('默认仍拒绝非法 DDL，避免模板校验意外放宽', async () => {
    await expect(validateSqliteTemplateDataStrict_ACU(invalidRuntimeDdlSnapshot))
      .resolves.toMatchObject({ success: false });
  });

  it('显式允许时与 SQLite 运行时一致，使用 fallback schema 完成 hydrate', async () => {
    await expect(validateSqliteTemplateDataStrict_ACU(
      invalidRuntimeDdlSnapshot,
      { allowRuntimeDdlFallback: true },
    )).resolves.toEqual({ success: true });
  });
});

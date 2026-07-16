import { isSqlReadStatement_ACU, splitTopLevelSqlStatementsForClassification_ACU } from '../../table/sql-statement-classifier';

export interface ReadOnlySqlValidationResult_ACU {
  valid: boolean;
  reason?: string;
}

export function validateReadOnlySql_ACU(sql: unknown): ReadOnlySqlValidationResult_ACU {
  const source = String(sql || '').trim();
  if (!source) return { valid: false, reason: 'empty_sql' };
  if (splitTopLevelSqlStatementsForClassification_ACU(source).length !== 1) {
    return { valid: false, reason: 'multiple_statements' };
  }
  if (isSqlReadStatement_ACU(source)) return { valid: true };
  if (/^PRAGMA\b/i.test(source)) return { valid: false, reason: 'pragma_not_allowed' };
  return { valid: false, reason: 'statement_not_read_only' };
}

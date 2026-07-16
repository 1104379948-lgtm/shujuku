const WRITE_KEYWORD_ACU = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE)\b/i;

const READ_ONLY_PRAGMAS_ACU = new Set([
  'collation_list', 'compile_options', 'database_list', 'foreign_key_check',
  'foreign_key_list', 'function_list', 'index_info', 'index_list', 'index_xinfo',
  'integrity_check', 'module_list', 'pragma_list', 'quick_check', 'table_info',
  'table_list', 'table_xinfo',
]);

function stripSqlCommentsAndStrings_ACU(sql: string): string {
  let output = '';
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === '\n') { lineComment = false; output += ' '; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; output += ' '; }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      output += ' ';
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index += 1; output += ' '; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; output += ' '; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; output += ' '; continue; }
    output += char;
  }
  return output;
}

export function splitTopLevelSqlStatementsForClassification_ACU(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    current += char;
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) {
      if (char === '*' && next === '/') { current += next; index += 1; blockComment = false; }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) { current += next; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') { current += next; index += 1; lineComment = true; continue; }
    if (char === '/' && next === '*') { current += next; index += 1; blockComment = true; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === ';') {
      const statement = current.slice(0, -1).trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }
  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

function isReadOnlyPragma_ACU(statement: string): boolean {
  const match = statement.match(/^PRAGMA\s+(?:(?:[A-Za-z_][\w]*)\.)?([A-Za-z_][\w]*)(?:\s*\(([^)]*)\))?\s*$/i);
  return !!match && READ_ONLY_PRAGMAS_ACU.has(match[1].toLowerCase());
}

export function isSqlReadStatement_ACU(sql: string): boolean {
  const statements = splitTopLevelSqlStatementsForClassification_ACU(sql);
  if (statements.length !== 1) return false;
  const statement = statements[0].trim();
  if (/^PRAGMA\b/i.test(statement)) return isReadOnlyPragma_ACU(statement);
  if (/^SELECT\b/i.test(statement)) return true;
  if (/^EXPLAIN\b/i.test(statement)) {
    const explainedStatement = statement.replace(/^EXPLAIN\s+(?:QUERY\s+PLAN\s+)?/i, '').trim();
    if (/^SELECT\b/i.test(explainedStatement)) return true;
    if (!/^WITH\b/i.test(explainedStatement)) return false;
    return !WRITE_KEYWORD_ACU.test(stripSqlCommentsAndStrings_ACU(explainedStatement));
  }
  if (/^WITH\b/i.test(statement)) {
    return !WRITE_KEYWORD_ACU.test(stripSqlCommentsAndStrings_ACU(statement));
  }
  return false;
}

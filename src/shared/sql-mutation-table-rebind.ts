export type SqlTableAliasMap_ACU = ReadonlyMap<string, string>;

type Quote_ACU = '"' | '`' | '[' | null;
interface Token_ACU { start: number; end: number; value: string; quote: Quote_ACU; depth: number; commaBefore: boolean; }

function wordStart(char: string): boolean { return /^[A-Za-z_]$/.test(char); }
function wordPart(char: string): boolean { return /^[A-Za-z0-9_$]$/.test(char); }
function keyword(token: Token_ACU | undefined, value: string): boolean {
  return !!token && token.quote === null && token.value.toUpperCase() === value;
}

function tokens(sql: string): Token_ACU[] {
  const result: Token_ACU[] = [];
  let index = 0;
  let depth = 0;
  const commaDepths = new Set<number>();
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') { index += 2; while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1; continue; }
    if (char === '/' && next === '*') { const end = sql.indexOf('*/', index + 2); if (end < 0) throw new Error('unterminated comment'); index = end + 2; continue; }
    if (char === "'") { index += 1; while (index < sql.length) { if (sql[index] !== "'") index += 1; else if (sql[index + 1] === "'") index += 2; else { index += 1; break; } } if (sql[index - 1] !== "'") throw new Error('unterminated string'); continue; }
    if (char === ',') { commaDepths.add(depth); index += 1; continue; }
    if (char === '(') { commaDepths.delete(depth); depth += 1; index += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue; }
    if (char === '"' || char === '`' || char === '[') {
      const quote = char as Exclude<Quote_ACU, null>; const close = quote === '[' ? ']' : quote; const start = index; let value = ''; index += 1; let closed = false;
      while (index < sql.length) { if (sql[index] !== close) value += sql[index++]; else if (sql[index + 1] === close) { value += close; index += 2; } else { index += 1; closed = true; break; } }
      if (!closed) throw new Error('unterminated quoted identifier'); result.push({ start, end: index, value, quote, depth, commaBefore: commaDepths.delete(depth) }); continue;
    }
    if (wordStart(char)) { const start = index; index += 1; while (index < sql.length && wordPart(sql[index])) index += 1; result.push({ start, end: index, value: sql.slice(start, index), quote: null, depth, commaBefore: commaDepths.delete(depth) }); continue; }
    index += 1;
  }
  return result;
}

function qualifiedTail(sql: string, values: Token_ACU[], start: number): Token_ACU | undefined {
  let token = values[start];
  if (!token) return undefined;
  let index = start;
  while (values[index + 1] && values[index + 1].depth === token.depth && /^\s*\.\s*$/.test(sql.slice(token.end, values[index + 1].start))) token = values[++index];
  return token;
}

function mutationTarget(sql: string, values: Token_ACU[]): Token_ACU | undefined {
  const first = values[0];
  const actionIndex = keyword(first, 'WITH') ? values.findIndex((token, index) => index > 0 && token.depth === 0 && ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token.value.toUpperCase())) : 0;
  const action = values[actionIndex];
  if (!action) return undefined;
  if (keyword(action, 'INSERT') || keyword(action, 'REPLACE')) {
    let index = actionIndex + 1;
    if (keyword(action, 'INSERT') && keyword(values[index], 'OR')) index += 2;
    return keyword(values[index], 'INTO') ? qualifiedTail(sql, values, index + 1) : undefined;
  }
  if (keyword(action, 'UPDATE')) { let index = actionIndex + 1; if (keyword(values[index], 'OR')) index += 2; return qualifiedTail(sql, values, index); }
  return keyword(action, 'DELETE') && keyword(values[actionIndex + 1], 'FROM') ? qualifiedTail(sql, values, actionIndex + 2) : undefined;
}

interface CteScope_ACU { name: string; depth: number; start: number; end: number; }

function cteScopes(values: Token_ACU[]): CteScope_ACU[] {
  const result: CteScope_ACU[] = [];
  for (let withIndex = 0; withIndex < values.length; withIndex += 1) {
    const withToken = values[withIndex];
    if (!keyword(withToken, 'WITH')) continue;
    const depth = withToken.depth;
    let index = withIndex + 1;
    if (keyword(values[index], 'RECURSIVE')) index += 1;
    const names: string[] = [];
    let valid = false;
    while (values[index]) {
      const name = values[index];
      if (!name || name.depth !== depth) break;
      index += 1;
      if (values[index]?.depth === depth + 1) {
        const columnDepth = values[index].depth;
        while (values[index] && values[index].depth >= columnDepth) index += 1;
      }
      if (!keyword(values[index], 'AS')) break;
      names.push(name.value.toLowerCase());
      index += 1;
      if (!values[index] || values[index].depth !== depth + 1) break;
      const definitionDepth = values[index].depth;
      while (values[index] && values[index].depth >= definitionDepth) index += 1;
      valid = true;
      if (!values[index]?.commaBefore || values[index].depth !== depth) break;
    }
    if (!valid) continue;
    const end = values.findIndex((token, tokenIndex) => tokenIndex > index && token.depth < depth);
    for (const name of names) result.push({ name, depth, start: withIndex, end: end < 0 ? values.length : end });
  }
  return result;
}

function isCteReference(values: Token_ACU[], token: Token_ACU, scopes: CteScope_ACU[]): boolean {
  const index = values.indexOf(token);
  return index >= 0 && scopes.some(scope => (
    scope.name === token.value.toLowerCase()
    && index >= scope.start
    && index < scope.end
    && token.depth >= scope.depth
  ));
}

function references(sql: string, values: Token_ACU[], target: Token_ACU): Token_ACU[] {
  const result = new Map<number, Token_ACU>([[target.start, target]]);
  const scopes = cteScopes(values);
  const terminators = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'RETURNING', 'VALUES', 'SET']);
  const fromDepths = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    const value = token.quote === null ? token.value.toUpperCase() : '';
    if (terminators.has(value)) fromDepths.delete(token.depth);
    if (value === 'FROM') fromDepths.add(token.depth);
    if (value === 'FROM' || value === 'JOIN') {
      const reference = qualifiedTail(sql, values, index + 1);
      if (reference && reference.depth === token.depth && !isCteReference(values, reference, scopes)) result.set(reference.start, reference);
    } else if (token.commaBefore && fromDepths.has(token.depth) && !isCteReference(values, token, scopes)) {
      result.set(token.start, token);
    }
  }
  return [...result.values()];
}

function format(value: string, quote: Quote_ACU): string {
  if (quote === '"') return `"${value.replace(/"/g, '""')}"`;
  if (quote === '`') return `\`${value.replace(/`/g, '``')}\``;
  if (quote === '[') return `[${value.replace(/]/g, ']]')}]`;
  return value;
}

export function decodeSqlIdentifier_ACU(value: unknown): string {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text[0] === '"' && text[text.length - 1] === '"') || (text[0] === '`' && text[text.length - 1] === '`'))) {
    return text.slice(1, -1).split(text[0] + text[0]).join(text[0]);
  }
  if (text.length >= 2 && text[0] === '[' && text[text.length - 1] === ']') return text.slice(1, -1).split(']]').join(']');
  return text;
}

export function rebindSqlMutationTableReferences_ACU(
  statements: string[],
  aliases: SqlTableAliasMap_ACU,
  options: { lenient?: boolean } = {},
): string[] {
  const resolvedAliases = new Map<string, string>();
  for (const [alias, physicalName] of aliases) resolvedAliases.set(decodeSqlIdentifier_ACU(alias).toLowerCase(), physicalName);
  return statements.map(statement => {
    try {
      const values = tokens(statement);
      const target = mutationTarget(statement, values);
      if (!target || !resolvedAliases.has(target.value.toLowerCase())) return statement;
      const replacements = references(statement, values, target)
        .map(token => ({ token, name: resolvedAliases.get(token.value.toLowerCase()) }))
        .filter((item): item is { token: Token_ACU; name: string } => !!item.name);
      let result = statement;
      for (const { token, name } of replacements.sort((left, right) => right.token.start - left.token.start)) {
        result = `${result.slice(0, token.start)}${format(name, token.quote)}${result.slice(token.end)}`;
      }
      return result;
    } catch (error) {
      if (options.lenient) return statement;
      throw error;
    }
  });
}

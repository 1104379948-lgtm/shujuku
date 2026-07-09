import { getScriptOutput_ACU } from './script-output-context';
import { runScriptVariable_ACU, stringifyScriptValue_ACU } from './script-runner';
import { addScriptLog_ACU, persistScriptRuntimeState_ACU } from './script-store';
import { getCurrentScriptScope_ACU } from './script-tavern-facade';
import { resolveScriptRequestIdFromInputs_ACU, type ScriptRequestContext_ACU } from './script-request-context';
import type { ScriptVariableCall_ACU } from './script-types';

function safeGetCurrentScriptScope_ACU(): ReturnType<typeof getCurrentScriptScope_ACU> {
  try {
    return getCurrentScriptScope_ACU();
  } catch (_) {
    return { chatId: '', characterId: '', characterName: '' };
  }
}

function logScriptVariableError_ACU(raw: string, error: unknown): void {
  const message = String((error as any)?.message || error || '脚本变量解析失败');
  addScriptLog_ACU({
    scriptId: '',
    scriptName: 'script_variable',
    level: 'error',
    message: `${raw}: ${message}`,
  });
  try {
    persistScriptRuntimeState_ACU();
  } catch (_) {}
}

function extractErrorPlaceholderFromRaw_ACU(raw: string): string {
  const match = /(?:^|\s)error\s*=\s*(["'])([\s\S]*?)\1/.exec(String(raw || ''));
  return match ? match[2] : '';
}

function splitCommand_ACU(inner: string): { command: string; body: string } {
  const trimmed = String(inner || '').trim();
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  return { command: match?.[1] || '', body: match?.[2] || '' };
}

function findVariableEnd_ACU(text: string, start: number): number {
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = start + 2; i < text.length - 1; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === ']' && text[i + 1] === '}') return i + 2;
  }
  return -1;
}

function parseJsonLoose_ACU(text: string): unknown {
  const trimmed = String(text || '').trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

type ParsedToken_ACU =
  | { type: 'quoted'; value: string }
  | { type: 'word'; value: string }
  | { type: 'json'; value: string };

function skipSpaces_ACU(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function readQuoted_ACU(text: string, index: number): { value: string; end: number } {
  const quote = text[index];
  let value = '';
  let escape = false;
  for (let i = index + 1; i < text.length; i++) {
    const ch = text[i];
    if (escape) { value += ch; escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === quote) return { value, end: i + 1 };
    value += ch;
  }
  throw new Error('字符串参数未闭合');
}

function readJsonValue_ACU(text: string, index: number): { value: string; end: number } {
  const open = text[index];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = index; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { value: text.slice(index, i + 1), end: i + 1 };
    }
  }
  throw new Error('JSON 参数未闭合');
}

function readWord_ACU(text: string, index: number): { value: string; end: number } {
  let end = index;
  while (end < text.length && !/\s/.test(text[end]) && text[end] !== '=') end++;
  if (end === index && text[index] === '=') return { value: '=', end: index + 1 };
  if (end === index) throw new Error(`无法解析参数: ${text.slice(index)}`);
  return { value: text.slice(index, end), end };
}

function tokenizeArgs_ACU(body: string): ParsedToken_ACU[] {
  const tokens: ParsedToken_ACU[] = [];
  let index = 0;
  while (index < body.length) {
    index = skipSpaces_ACU(body, index);
    if (index >= body.length) break;
    const ch = body[index];
    if (ch === '"' || ch === "'") {
      const quoted = readQuoted_ACU(body, index);
      tokens.push({ type: 'quoted', value: quoted.value });
      index = quoted.end;
    } else if (ch === '{' || ch === '[') {
      const json = readJsonValue_ACU(body, index);
      tokens.push({ type: 'json', value: json.value });
      index = json.end;
    } else {
      const word = readWord_ACU(body, index);
      tokens.push({ type: 'word', value: word.value });
      index = word.end;
    }
  }
  return tokens;
}

function parseNamedArgs_ACU(tokens: ParsedToken_ACU[], startIndex = 0): Record<string, ParsedToken_ACU> {
  const args: Record<string, ParsedToken_ACU> = {};
  for (let i = startIndex; i < tokens.length; i++) {
    const keyToken = tokens[i];
    if (keyToken.type !== 'word') throw new Error('命名参数必须以 key=value 形式书写');
    const key = keyToken.value;
    if (!key || key === '=') throw new Error('命名参数缺少 key');
    const equal = tokens[++i];
    if (!equal || equal.type !== 'word' || equal.value !== '=') throw new Error(`命名参数必须以 key=value 形式书写: ${key}`);
    const value = tokens[++i];
    if (!value) throw new Error(`缺少参数值: ${key}`);
    args[key] = value;
  }
  return args;
}

function tokenStringValue_ACU(token: ParsedToken_ACU | undefined, key: string): string | undefined {
  if (!token) return undefined;
  if (token.type === 'json') throw new Error(`${key} 必须是字符串`);
  return token.value;
}

function parseScriptVariable_ACU(raw: string): ScriptVariableCall_ACU | null {
  const inner = raw.slice(2, -2).trim();
  const { command, body } = splitCommand_ACU(inner);
  if (command === 'script_output') {
    const tokens = tokenizeArgs_ACU(body);
    let outputKey = '';
    let namedStart = 0;
    if (tokens[0]?.type === 'quoted') {
      outputKey = tokens[0].value;
      namedStart = 1;
    }
    const args = parseNamedArgs_ACU(tokens, namedStart);
    const allowed = new Set(['key', 'ttl', 'scope', 'error']);
    Object.keys(args).forEach(key => { if (!allowed.has(key)) throw new Error(`未知 script_output 参数: ${key}`); });
    outputKey = tokenStringValue_ACU(args.key, 'key') || outputKey;
    const outputTtl = tokenStringValue_ACU(args.ttl, 'ttl') || tokenStringValue_ACU(args.scope, 'scope');
    if (outputTtl && !['request', 'chat', 'session'].includes(outputTtl)) throw new Error(`未知 script_output 生命周期: ${outputTtl}`);
    if (!outputKey) throw new Error('script_output 缺少 output key');
    return {
      raw,
      kind: 'read_output',
      outputKey,
      outputTtl: outputTtl as ScriptVariableCall_ACU['outputTtl'],
      errorPlaceholder: tokenStringValue_ACU(args.error, 'error'),
    };
  }
  if (command !== 'script') return null;
  const tokens = tokenizeArgs_ACU(body);
  let scriptName = '';
  let namedStart = 0;
  if (tokens[0]?.type === 'quoted') {
    scriptName = tokens[0].value;
    namedStart = 1;
  }
  let positionalInput: unknown = undefined;
  if (tokens[namedStart]?.type === 'json') {
    positionalInput = parseJsonLoose_ACU(tokens[namedStart].value);
    namedStart++;
  }
  const args = parseNamedArgs_ACU(tokens, namedStart);
  const allowed = new Set(['id', 'input', 'error']);
  Object.keys(args).forEach(key => { if (!allowed.has(key)) throw new Error(`未知 script 参数: ${key}`); });
  const scriptId = tokenStringValue_ACU(args.id, 'id');
  const input = args.input ? parseJsonLoose_ACU(args.input.value) : positionalInput;
  if (!scriptId && !scriptName) throw new Error('script 缺少脚本名称或 id');
  return {
    raw,
    kind: 'execute',
    scriptId,
    scriptName: scriptId ? undefined : scriptName,
    input,
    errorPlaceholder: tokenStringValue_ACU(args.error, 'error'),
  };
}

export async function replaceScriptVariables_ACU(text: string, sourceContext: Record<string, unknown> = {}, requestContext?: ScriptRequestContext_ACU): Promise<string> {
  if (!text || typeof text !== 'string' || !text.includes('{[script')) return text || '';
  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{[script', cursor);
    if (start < 0) {
      result += text.slice(cursor);
      break;
    }
    const afterCommandPrefix = text[start + '{[script'.length] || '';
    const startsScriptOutput = text.startsWith('{[script_output', start);
    const boundary = startsScriptOutput ? (text[start + '{[script_output'.length] || '') : afterCommandPrefix;
    if (!startsScriptOutput && boundary && !/\s|\]/.test(boundary)) {
      result += text.slice(cursor, start + '{[script'.length);
      cursor = start + '{[script'.length;
      continue;
    }
    if (startsScriptOutput && boundary && !/\s|\]/.test(boundary)) {
      result += text.slice(cursor, start + '{[script_output'.length);
      cursor = start + '{[script_output'.length;
      continue;
    }
    result += text.slice(cursor, start);
    const end = findVariableEnd_ACU(text, start);
    if (end < 0) {
      result += text.slice(start);
      break;
    }
    const raw = text.slice(start, end);
    try {
      const call = parseScriptVariable_ACU(raw);
      if (!call) result += raw;
      else if (call.kind === 'read_output') {
        const output = getScriptOutput_ACU(call.outputKey || '', call.outputTtl, {
          requestId: resolveScriptRequestIdFromInputs_ACU({ sourceContext, requestContext }),
          scope: safeGetCurrentScriptScope_ACU(),
        });
        result += output ? stringifyScriptValue_ACU(output.value) : (call.errorPlaceholder || '');
      }
      else {
        const run = await runScriptVariable_ACU(call, { sourceContext, requestContext });
        result += run.success ? stringifyScriptValue_ACU(run.value) : (call.errorPlaceholder || '');
      }
    } catch (error) {
      logScriptVariableError_ACU(raw, error);
      result += extractErrorPlaceholderFromRaw_ACU(raw);
    }
    cursor = end;
  }
  return result;
}

import { logWarn_ACU } from '../../shared/utils';

export const API_THINKING_EFFORT_VALUES_ACU = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

const LEGACY_API_THINKING_EFFORT_ALIASES_ACU: Record<string, ApiThinkingEffort_ACU> = {
    max: 'xhigh',
};

export type ApiThinkingEffort_ACU = typeof API_THINKING_EFFORT_VALUES_ACU[number];

export interface ApiRequestOptions_ACU {
    extraBodyParams: string;
    excludedBodyParams: string;
    extraHeaders: string;
    thinkingEnabled: boolean;
    thinkingEffort: ApiThinkingEffort_ACU;
}

export const DEFAULT_API_REQUEST_OPTIONS_ACU: ApiRequestOptions_ACU = {
    extraBodyParams: '',
    excludedBodyParams: '',
    extraHeaders: '',
    thinkingEnabled: false,
    thinkingEffort: 'none',
};

const PROTECTED_BODY_KEYS_ACU = new Set([
    'messages',
    'model',
    'reverse_proxy',
    'custom_url',
    'custom_include_headers',
    'chat_completion_source',
]);

function normalizeText_ACU(value: any): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeThinkingEffort_ACU(value: any): ApiThinkingEffort_ACU {
    const normalized = normalizeText_ACU(value);
    const mapped = LEGACY_API_THINKING_EFFORT_ALIASES_ACU[normalized] || normalized;
    return API_THINKING_EFFORT_VALUES_ACU.includes(mapped as ApiThinkingEffort_ACU)
        ? mapped as ApiThinkingEffort_ACU
        : DEFAULT_API_REQUEST_OPTIONS_ACU.thinkingEffort;
}

export function normalizeApiRequestOptions_ACU(apiConfig: any): ApiRequestOptions_ACU {
    const source = apiConfig && typeof apiConfig === 'object' ? apiConfig : {};
    return {
        extraBodyParams: normalizeText_ACU(source.extraBodyParams),
        excludedBodyParams: normalizeText_ACU(source.excludedBodyParams),
        extraHeaders: normalizeText_ACU(source.extraHeaders),
        thinkingEnabled: source.thinkingEnabled === true,
        thinkingEffort: normalizeThinkingEffort_ACU(source.thinkingEffort),
    };
}

export function getDefaultApiConfigRequestOptions_ACU(): ApiRequestOptions_ACU {
    return { ...DEFAULT_API_REQUEST_OPTIONS_ACU };
}

function stripInlineComment_ACU(line: string): string {
    const hashIndex = line.indexOf('#');
    return hashIndex >= 0 ? line.slice(0, hashIndex).trim() : line.trim();
}

function parseScalar_ACU(rawValue: string): any {
    const value = rawValue.trim();
    if (!value) return '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

export function parseApiExtraBodyParams_ACU(raw: any): Record<string, any> {
    const text = normalizeText_ACU(raw);
    if (!text) return {};

    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        // fall through to restricted YAML-like parser
    }

    const result: Record<string, any> = {};
    const lines = text.split(/\r?\n/);
    for (const sourceLine of lines) {
        const line = stripInlineComment_ACU(sourceLine);
        if (!line) continue;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            logWarn_ACU(`[API附加主体参数] 忽略无法解析的行: ${sourceLine}`);
            continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        if (!key || /\s/.test(key)) {
            logWarn_ACU(`[API附加主体参数] 忽略非法字段名: ${key}`);
            continue;
        }
        result[key] = parseScalar_ACU(line.slice(separatorIndex + 1));
    }
    return result;
}

export function parseApiExcludedBodyParams_ACU(raw: any): string[] {
    const text = normalizeText_ACU(raw);
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed.map(item => normalizeText_ACU(item)).filter(Boolean);
        }
    } catch {
        // fall through to restricted YAML-like parser
    }

    return text
        .split(/\r?\n|,/)
        .map(line => stripInlineComment_ACU(line).replace(/^-\s*/, '').trim())
        .filter(Boolean);
}

export function parseApiExtraHeaders_ACU(raw: any): Record<string, string> {
    const text = normalizeText_ACU(raw);
    if (!text) return {};

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.fromEntries(
                Object.entries(parsed)
                    .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
                    .filter(([key, value]) => key && value),
            );
        }
    } catch {
        // fall through to restricted YAML-like parser
    }

    const result: Record<string, string> = {};
    const lines = text.split(/\r?\n/);
    for (const sourceLine of lines) {
        const line = stripInlineComment_ACU(sourceLine);
        if (!line) continue;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            logWarn_ACU(`[API附加请求头] 忽略无法解析的行: ${sourceLine}`);
            continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;
        result[key] = value;
    }
    return result;
}

export function mergeCustomIncludeHeaders_ACU(apiKey: any, extraHeadersRaw: any): string {
    const lines: string[] = [];
    const normalizedApiKey = normalizeText_ACU(apiKey);
    if (normalizedApiKey) {
        lines.push(`Authorization: Bearer ${normalizedApiKey}`);
    }

    const extraHeaders = parseApiExtraHeaders_ACU(extraHeadersRaw);
    Object.entries(extraHeaders).forEach(([key, value]) => {
        if (!key || !value) return;
        if (key.toLowerCase() === 'authorization' && normalizedApiKey) {
            logWarn_ACU('[API附加请求头] 已存在 API Key，忽略附加 Authorization 头，避免覆盖鉴权。');
            return;
        }
        lines.push(`${key}: ${value}`);
    });

    return lines.join('\n');
}

export function applyApiRequestOptionsToBody_ACU(requestBody: Record<string, any>, apiConfig: any): Record<string, any> {
    const body = requestBody && typeof requestBody === 'object' ? requestBody : {};
    const options = normalizeApiRequestOptions_ACU(apiConfig);
    const extraBodyParams = parseApiExtraBodyParams_ACU(options.extraBodyParams);

    Object.entries(extraBodyParams).forEach(([key, value]) => {
        if (PROTECTED_BODY_KEYS_ACU.has(key)) {
            logWarn_ACU(`[API附加主体参数] 跳过受保护字段: ${key}`);
            return;
        }
        body[key] = value;
    });

    if (options.thinkingEnabled && options.thinkingEffort !== 'none') {
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = options.thinkingEffort;
    }

    const excludedBodyParams = parseApiExcludedBodyParams_ACU(options.excludedBodyParams);
    excludedBodyParams.forEach((key) => {
        if (key) delete body[key];
    });

    return body;
}

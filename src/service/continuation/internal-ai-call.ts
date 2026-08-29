import { callAIWithResolvedPreset_ACU, type AiUsageMetadata_ACU } from '../ai/api-call';
import type { ContinuationResolvedApiPreset_ACU } from './api-preset';
import type { ContinuationInternalAiRequestIdentity_ACU } from './model';
import {
  beginContinuationInternalAiMainApiInvocation_ACU,
  beginContinuationInternalAiRequest_ACU,
  endContinuationInternalAiMainApiInvocation_ACU,
  settleContinuationInternalAiRequest_ACU,
} from './internal-ai-events';

export type { AiUsageMetadata_ACU };

/** 内部 AI 调用的缓存与用量选项。全部可选：不传时行为与历史版本完全一致。 */
export interface ContinuationInternalAiCallOptions_ACU {
  /**
   * 是否注入 prompt_cache_key 并订阅 usage 统计（对应续写设置 promptCacheEnabled）。
   * 仅 custom（chat-completions）路径生效；tavern / 主 API 路径不受影响。
   */
  promptCacheEnabled?: boolean;
  /**
   * 缓存命名空间的调用方标识（如 'agent-main'、'sub-mainline-planner'、'outline'）。
   * 不同调用方的提示词前缀不同，分开命名空间可避免互相挤占缓存路由。缺省用 identity.source。
   */
  cacheScope?: string;
  /** 响应带回 token 用量时回调。并发调用各自持有闭包，互不干扰。 */
  onUsage?: (usage: AiUsageMetadata_ACU) => void;
}

/**
 * fnv-1a 32 位哈希（十六进制）。缓存 key 只需要稳定与低碰撞，不需要密码学强度；
 * chatIdentity 可能含中文与路径分隔符，哈希后得到纯 [0-9a-f] 串，满足请求体注入通道的字符白名单。
 */
function fnv1aHex_ACU(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 组装本次调用的 prompt_cache_key。只含稳定因子（聊天身份哈希 + 调用方 scope），
 * 不含任何随迭代/轮次变化的内容——key 每轮都变会让跨轮缓存命中归零。
 */
function buildPromptCacheKey_ACU(identity: ContinuationInternalAiRequestIdentity_ACU, scope: string): string {
  const safeScope = scope.replace(/[^A-Za-z0-9_-]/g, '-');
  return `acu-cont-${fnv1aHex_ACU(identity.chatIdentity)}-${safeScope}`;
}

/**
 * 把一次调用的用量渲染成会话流条目里的紧凑标签，如「输入 15.0k · ⚡缓存 14.2k · 输出 0.8k」。
 * ⚡ 是缓存命中数（含在输入内）；恒常显示，命中为 0 时用户能直接看到未命中。
 */
export function formatAgentUsageLabel_ACU(usage: AiUsageMetadata_ACU): string {
  const compact = (value: number): string => (value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`);
  return `输入 ${compact(usage.promptTokens)} · ⚡缓存 ${compact(usage.cachedTokens)} · 输出 ${compact(usage.completionTokens)}`;
}

/**
 * Executes one continuation-owned internal request with explicit provenance.
 * It never writes host input or continuation state; callers must gate returned
 * text again before scheduling a later side effect.
 */
export async function callContinuationInternalAi_ACU(
  messages: Array<{ role: string; content: string }>,
  preset: ContinuationResolvedApiPreset_ACU,
  identity: ContinuationInternalAiRequestIdentity_ACU,
  signal?: AbortSignal | null,
  options?: ContinuationInternalAiCallOptions_ACU,
): Promise<string | null> {
  beginContinuationInternalAiRequest_ACU(identity);
  const cacheEnabled = options?.promptCacheEnabled === true;
  try {
    return await callAIWithResolvedPreset_ACU(
      messages,
      preset,
      signal,
      {
        beforeMainApiCall: () => beginContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
        afterMainApiCall: () => endContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
        ...(cacheEnabled && options?.onUsage ? { onUsage: options.onUsage } : {}),
      },
      cacheEnabled ? { promptCacheKey: buildPromptCacheKey_ACU(identity, options?.cacheScope || identity.source) } : undefined,
    );
  } finally {
    // A bound host lifecycle remains registered until its matching ended event.
    // An unbound request is removed, so later unrelated events are never claimed.
    settleContinuationInternalAiRequest_ACU(identity.requestId);
  }
}

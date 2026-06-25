/**
 * 通用 ACU 模板变量入口。
 *
 * 现有变量处理散落在 prompt、剧情推进、正文优化等链路中。脚本变量需要异步执行，
 * 因此先把既有 random/calc/max/min/db/sql/if 顺序收口到同一个 async 入口。
 */

import {
  parseCalcTags_ACU,
  parseMaxTags_ACU,
  parseMinTags_ACU,
  parseRandomTags_ACU,
  replaceCalcVariables_ACU,
  replaceMaxVariables_ACU,
  replaceMinVariables_ACU,
  replaceRandomVariables_ACU,
} from './var-store-and-tags';
import { parseIfBlockRecursive_ACU, parseIfBlocksInContent_ACU } from './if-block-parser';
import { replaceDbSqlVariables } from './sql-query-var';
import { replaceScriptVariables_ACU } from '../../scripts/script-variable-resolver';
import type { ScriptRequestContext_ACU } from '../../scripts/script-request-context';

export interface AcuTemplateVariableOptions_ACU {
  contextForCalc?: any;
  contextForIf?: any;
  ifDepth?: number;
  ifMode?: 'recursive' | 'content';
  enableCalc?: boolean;
  enableDbSql?: boolean;
  enableIf?: boolean;
  enableRandom?: boolean;
  enableScript?: boolean;
  sourceContext?: Record<string, unknown>;
  requestContext?: ScriptRequestContext_ACU;
}

export async function replaceAcuTemplateVariables_ACU(
  content: string,
  options: AcuTemplateVariableOptions_ACU = {},
): Promise<string> {
  if (!content || typeof content !== 'string') return content || '';

  let result = content;
  if (options.enableRandom !== false) {
    result = parseRandomTags_ACU(result);
    result = replaceRandomVariables_ACU(result);
  }

  if (options.enableCalc !== false) {
    const contextForCalc = options.contextForCalc || {};
    result = parseCalcTags_ACU(result, contextForCalc);
    result = parseMaxTags_ACU(result, contextForCalc);
    result = parseMinTags_ACU(result, contextForCalc);
    result = replaceCalcVariables_ACU(result);
    result = replaceMaxVariables_ACU(result);
    result = replaceMinVariables_ACU(result);
  }

  if (options.enableDbSql !== false) {
    result = replaceDbSqlVariables(result);
  }

  if (options.enableScript !== false) {
    result = await replaceScriptVariables_ACU(result, options.sourceContext || {}, options.requestContext);
  }

  if (options.enableIf !== false && options.contextForIf) {
    const depth = options.ifDepth ?? 0;
    result = options.ifMode === 'content'
      ? parseIfBlocksInContent_ACU(result, options.contextForIf, depth)
      : parseIfBlockRecursive_ACU(result, options.contextForIf, depth);
  }

  return result;
}

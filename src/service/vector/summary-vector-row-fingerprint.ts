/**
 * service/vector/summary-vector-row-fingerprint.ts — 纪要行内容指纹的单一来源
 *
 * 所有行指纹必须经由这里计算，避免多处内联公式漂移。
 * 输入字段顺序与 join 分隔符不得变更：指纹参与增量归档的行复用判定
 * 与查询时的实时纪要表对账，公式漂移会导致全量行 mismatch（检索被永久 fail-closed）
 * 或复用判定失效（改行不重新 embedding）。
 *
 * 独立成模块的原因：archive-service 与 storage-service 都需要此公式，
 * 而两者已存在 archive → storage 的单向依赖，公式放任一侧都会成环。
 */

import { hashUserInput_ACU } from '../../shared/utils';

export function buildSummaryRowFingerprint_ACU(source: {
    rowId: string;
    timeSpan: string;
    location: string;
    summary: string;
    indexCode: string;
    vectorSourceText: string;
}): string {
    return hashUserInput_ACU([
        source.rowId,
        source.timeSpan,
        source.location,
        source.summary,
        source.indexCode,
        source.vectorSourceText,
    ].join('\n'));
}

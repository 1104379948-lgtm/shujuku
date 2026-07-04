# 手动重填操作链重构设计

## 结论

手动重填不能直接和自动填表合并为同一套历史增量链路。

原因不是“手动触发”和“自动触发”本身不同，而是手动重填支持只选择部分表。已有历史里一条填表操作可能同时包含 A/B/C 多张表，当前 V2 log 只能可靠判断某条 entry 可能影响哪些表，不能可靠地把混合 `table_edit_dsl` / `sql_batch` 按 sheet 拆开并只删除 A 表部分。因此，不能把“重填 A 表”实现为对旧历史 log 的精确删改。

推荐方案：保留当前手动重填的事务式最终 checkpoint 模型，但在该 checkpoint 上额外保存一条本次手动重填生成的可回放操作链。

```text
最新 full checkpoint
+ manualRefillChain.baseCheckpoint
+ manualRefillChain.batches[].operations
```

下次用户从某楼重填到最新时，优先从最新 checkpoint 的 `manualRefillChain` 恢复该楼之前的基底，而不是要求聊天历史里必须存在范围前 full checkpoint。

本设计不引入每批 after snapshot。恢复只依赖：

```text
baseCheckpoint + 前置 batch operations
```

## 当前真实执行模型

手动填表入口：

```text
src/presentation-v2/composables/useManualUpdate.ts
  runManualUpdate()
    -> orchestrateManualUpdate_ACU(..., { clearBeforeUpdate: true })
```

核心编排：

```text
src/service/table/update-orchestrator.ts
  orchestrateManualUpdate_ACU
  processGroupedRuntimeChunk_ACU
  applyUnifiedGroupFillResponses_ACU
  applySqlResponsesToCurrentRuntime_ACU
```

### 手动范围

当前手动范围不是用户显式选择起止楼层，而是：

```ts
const effectiveAiIndices = uiSkip > 0 ? allAiMessageIndices.slice(0, -uiSkip) : allAiMessageIndices.slice();
const contextScopeIndices = uiThreshold > 0 ? effectiveAiIndices.slice(-uiThreshold) : effectiveAiIndices;
```

`uiThreshold` 来自手动 UI 临时桥接到的 `settings_ACU.autoUpdateThreshold`。

### 手动分组

手动选择表后，只尊重表的 `groupId`，不尊重每张表的自动调度参数 `updateFrequency/contextDepth/skipFloors`。

当前 group key：

```ts
const groupKey = `${tableGroupId}|${contextScopeIndices.join(',')}|${uiBatchSize}`;
```

含义：

```text
同 groupId、同手动范围、同手动 batchSize 的表合并为一个手动 group。
```

所以在当前手动路径中，每个表自己的自动分批策略不生效；手动批大小由 UI 的 `manualUpdateBatchSize` 统一决定。

### 外层 chunk

`orchestrateManualUpdate_ACU` 按 `settings_ACU.maxConcurrentGroups` 把 groupKeys 切成 chunk：

```ts
for (let start = 0; start < groupKeys.length; start += maxConcurrentGroups) {
  const chunkKeys = groupKeys.slice(start, start + maxConcurrentGroups);
  await processGroupedRuntimeChunk_ACU(groupedChunk, ...);
}
```

这个外层是串行的：chunk 1 成功后才进入 chunk 2。

这也是当前手动路径不够合理的地方。手动路径已经统一了：

```text
1. 所有手动 group 使用同一个 contextScopeIndices。
2. 所有手动 group 使用同一个 uiBatchSize。
3. 每个 group 的 batch 边界天然一致。
4. 每个 batch 的 saveTargetIndex 天然一致。
```

因此，同一批次下的多个 group 本应并发请求，然后在同一个 bucket 内统一 apply。当前外层 chunk 会在 `maxConcurrentGroups` 小于 group 数时，把本来属于同一批次的 group 拆成多个顺序 chunk，导致：

```text
chunk 1: group A 的 1~3 -> apply -> checkpoint
chunk 2: group B 的 1~3 -> apply -> checkpoint
```

而更合理的手动语义应是：

```text
bucket 1~3:
  group A 并发请求
  group B 并发请求
  group C 并发请求
  -> 收齐后按确定顺序统一 apply
  -> 写一次 checkpoint / chain bucket
```

也就是说，手动路径里 `maxConcurrentGroups` 不应该先把 groupKeys 切成外层串行 chunk。它更适合被解释为“同一 bucket 内最多同时发起多少个 group AI 请求”的限流参数，而不是“先把 group 分块后每块单独跑完整批次”。

### 内层 bucket

`processGroupedRuntimeChunk_ACU` 内部会把每个 group 再按自己的 `batchSize` 切成批次：

```ts
for (let i = 0; i < group.indices.length; i += batchSize) {
  groupBatches.push(group.indices.slice(i, i + batchSize));
}
```

然后把 planned jobs 聚成 transaction bucket：

```ts
const bucketKey = `${finalSaveTargetIndex}|${batchNumber}|${updateMode}|${isImportMode}`;
```

bucket 的含义：

```text
同 saveTargetIndex、同 batchNumber、同 updateMode、同 import mode 的多个 group job 可以一起收集 AI 响应，并统一 apply。
```

bucket 排序：

```ts
orderedBuckets.sort((a, b) => a.saveTargetIndex - b.saveTargetIndex || a.batchNumber - b.batchNumber)
```

因此内层 bucket 是按楼层落点顺序串行推进的。bucket 内多个 group 的 AI 请求通过 `Promise.allSettled` 并发收集。

这层模型才是手动路径应保留的并发边界：

```text
1. bucket 之间按 saveTargetIndex 串行，保证 deferredWorkingData 顺序推进。
2. bucket 内 group 并发请求，收齐后统一 apply，保证同一批次只产生一个事务结果。
3. bucket 内 apply 顺序仍由 sortGroupFillResponses_ACU 固定，避免并发响应顺序影响结果。
```

所以重构时应删除或绕开外层 chunk 对手动 group 的拆分，让所有手动 group 进入同一个 `processGroupedRuntimeChunk_ACU` 调用，再在 bucket 内做并发限流。

### deferPersist 手动重填

手动重填启用时：

```ts
deferPersist: true
forceSnapshotApply: true
checkpointTargetIndex: manualRefillTargetIndex
checkpointBaseData: manualRefillCheckpointData
manualRefillProgress
```

此时 `processGroupedRuntimeChunk_ACU` 每个 bucket 成功后：

```text
1. 使用 deferredWorkingData 作为下一 bucket 的 base。
2. 把当前 bucket 影响到的 sheet 覆盖进 deferredCheckpointData。
3. 在 manualRefillTargetIndex 写入 full checkpoint，reason=manual。
4. checkpoint 内保存 manualRefillProgress。
```

当前问题是：这个 full checkpoint 只有最终状态，没有保存“本次从基底到最终状态的操作链”。如果它是唯一 checkpoint，则下次从范围中间重填时，系统仍然找不到范围前 checkpoint。

## 不采用的方案

### 不修改旧历史 log

理想上，重填 A 表时可以删除旧历史中 A 表操作、保留 B/C 表操作、再写入新 A 表操作。但当前做不到可靠实现。

原因：

```text
1. sheet_replace / row_upsert / row_delete / meta_update 有 sheetKey，可以准确过滤。
2. table_edit_dsl 是一段文本，可能混合多张表，当前没有正式的按 sheet 拆分和重写逻辑。
3. sql_batch 是 SQL 语句集合，复杂 SQL 可能同时读写多表，当前只能提取涉及表，不能可靠判定可删除的写入子集。
4. data_replace 是整库替换，不存在可删除的单表操作片段。
```

所以不能把“部分表手动重填”建立在旧 log 精确拆分上。

### 不把手动重填直接改成普通自动填表持久化

如果只是取消 `deferPersist`，让手动重填像自动填表一样按每个 batch 追加 V2 log，会出现旧 A 操作和新 A 操作叠加：

```text
旧 A + 旧 B + 旧 C + 新 A
```

这不是替换 A 表。

### 不保存 batch after snapshot

本方案不保存每批 after snapshot。原因：

```text
1. 目标是记录本次手动重填产生的操作链，而不是再造一套隐藏 checkpoint 系统。
2. 下次恢复时应使用 baseCheckpoint + 前置 operations。
3. 若 operations 不能重放，说明该手动重填链本身不可用，应失败并退回安全提示，而不是用快照掩盖。
```

## 目标模型

在 `TableCheckpointV2_ACU` 上增加手动重填链：

```ts
export interface ManualRefillChainV2_ACU {
  kind: 'manual_refill_chain';
  version: 1;
  status: 'in_progress' | 'complete';
  selectedSheetKeys: string[];
  originalStartMessageIndex: number;
  targetMessageIndex: number;
  contextMessageIndices: number[];
  baseCheckpoint: TableDataObject_ACU;
  chunks: ManualRefillChainChunkV2_ACU[];
  createdAt: number;
  updatedAt: number;
}

export interface ManualRefillChainChunkV2_ACU {
  chunkIndex: number;
  groupKeys: string[];
  buckets: ManualRefillChainBucketV2_ACU[];
}

export interface ManualRefillChainBucketV2_ACU {
  bucketIndex: number;
  saveTargetIndex: number;
  batchNumber: number;
  updateMode: string;
  jobGroupKeys: string[];
  messageIndices: number[];
  sheetKeys: string[];
  operations: TableMutationOperationV2_ACU[];
  filledSheetKeys: string[];
  changedSheetKeys: string[];
  groupKeys: string[];
}
```

`TableCheckpointV2_ACU`：

```ts
export interface TableCheckpointV2_ACU {
  kind: 'full';
  createdAt: number;
  reason: 'init' | 'periodic' | 'manual' | 'schema_change' | 'compaction' | 'import' | 'migration';
  data: TableDataObject_ACU;
  scheduleSummary?: Record<string, TableCheckpointScheduleSummaryV2_ACU>;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  manualRefillChain?: ManualRefillChainV2_ACU;
}
```

说明：

```text
1. baseCheckpoint 是本次手动重填真正使用的事务式基底。
2. chunks 在本版固定为单 chunk，仅作为未来结构扩展；不表达 `maxConcurrentGroups` 限流批次。
3. buckets 保留按 saveTargetIndex/batchNumber 聚合后的事务边界。
4. operations 是本 bucket 真实 apply 成功的操作。
5. 不记录 AI 原文，避免进一步放大存储体积；如需要调试，可后续加可选 debug 字段。
```

## 恢复语义

当用户下次从某个楼层重填到最新时，构造基底的优先级：

```text
1. 先尝试从聊天历史回放到重填起点前；如果成功，直接使用该基底。
2. 如果历史回放失败，再尝试使用 compatible manualRefillChain。
3. 如果 chain 覆盖当前请求，则用 chain.baseCheckpoint + 前置 bucket operations 恢复。
4. 如果历史回放失败且 chain 缺失、不覆盖、不兼容或回放失败，则阻止局部重填并返回结构化失败原因。
```

chain 可用条件：

```text
1. checkpoint.reason === 'manual'。
2. 普通局部重填只接受 `checkpoint.manualRefillChain.status === 'complete'`；中断续跑使用 matchedProgress 路径处理 `in_progress` chain。
3. 当前 targetKeys 必须等于 chain.selectedSheetKeys。本版不支持子集复用。
4. 当前 targetMessageIndex 必须等于 chain.targetMessageIndex。本版只解决“到最新 checkpoint”的重填。
5. 当前重填起点不能早于 chain.originalStartMessageIndex。
6. 当前 contextMessageIndices 必须是 chain.contextMessageIndices 的后缀或从中间截断到 target 的连续子范围。
```

本版要求 `targetKeys` 完全一致，不做子集复用。原因是上一次手动重填链只保证这些表一起经过同一串 bucket 操作，子集复用需要额外验证 operations 是否会触碰未选表。该限制是正式设计约束，不是分期遗留。

### batch 边界

恢复只能从 bucket 边界前开始。

如果用户选择的起点落在某个 bucket 内，实际重填起点回退到该 bucket 的第一个 messageIndex。

示例：

```text
chain buckets:
  1~3 -> save 3
  4~6 -> save 6
  7~9 -> save 9

用户要求从 8 重填到最新
实际恢复到 6 后状态，再重填 7~最新
```

UI 文案应明确：

```text
当前会从包含目标楼层的填表批次起点开始重填。
```

## 构造 chain 的执行点

### 创建 chain

在 `orchestrateManualUpdate_ACU` 中，确定 `manualRefillInitialData` 后创建 chain draft：

```text
baseCheckpoint = manualRefillInitialData
selectedSheetKeys = targetKeys sorted
originalStartMessageIndex = contextScopeIndices[0]
targetMessageIndex = manualRefillTargetIndex
contextMessageIndices = contextScopeIndices
status = in_progress
chunks = []
```

如果本次是从已有 matched progress 续跑：

```text
1. 优先读取 checkpoint.manualRefillChain。
2. 保留已完成 chunks/buckets。
3. 后续 bucket 继续追加或替换同 chunkIndex 后的内容。
```

### 收集 bucket operations

当前 `applyUnifiedGroupFillResponses_ACU` 已经在普通路径构造 `operations`，但 deferPersist 成功返回只包含：

```ts
{ success: true, modifiedKeys, tableData }
```

需要扩展 `CardUpdateResult`：

```ts
export interface CardUpdateResult {
  success: boolean;
  modifiedKeys: string[];
  tableData?: Record<string, any>;
  operations?: TableMutationOperationV2_ACU[];
  filledSheetKeys?: string[];
  changedSheetKeys?: string[];
  groupKeys?: string[];
  error?: string;
  aborted?: boolean;
}
```

`applyUnifiedGroupFillResponses_ACU` 在 `options.deferPersist` 分支返回：

```ts
return {
  success: true,
  modifiedKeys,
  tableData: workingTableData,
  operations,
  filledSheetKeys: fillAttemptKeys,
  changedSheetKeys: keysToTrack,
  groupKeys: fillAttemptKeys,
};
```

SQLite deferred runtime 分支 `applySqlResponsesToCurrentRuntime_ACU` 也必须返回 operations。当前它只执行 SQL 并返回 `modifiedKeys/tableData`，需要同步收集：

```text
responses -> tableEditText -> buildSqlBatchOperationsFromText_ACU -> operations
```

### 并发模型调整

手动路径应调整为：

```text
1. orchestrateManualUpdate_ACU 构建所有 updateGroups。
2. 不再按 maxConcurrentGroups 切外层 chunk。
3. 一次性把所有 groups 传入 processGroupedRuntimeChunk_ACU。
4. processGroupedRuntimeChunk_ACU 仍按 bucket 串行推进。
5. bucket 内对 jobs 做并发限流，请求并发上限使用 maxConcurrentGroups。
6. 同一 bucket 的所有成功 responses 统一 apply。
```

当前代码里的：

```ts
for (let start = 0; start < groupKeys.length; start += maxConcurrentGroups) {
  const chunkKeys = groupKeys.slice(start, start + maxConcurrentGroups);
  await processGroupedRuntimeChunk_ACU(groupedChunk, ...);
}
```

应重构为：

```ts
const groupedChunk = groupKeys.map(toGroupedRuntimeUpdateGroup);
const chunkResult = await processGroupedRuntimeChunk_ACU(groupedChunk, 'manual_independent', {
  ...,
  maxConcurrentJobs: Math.max(1, Number(settings_ACU.maxConcurrentGroups) || 1),
});
```

`processGroupedRuntimeChunk_ACU` 内部将：

```ts
Promise.allSettled(jobs.map(...))
```

替换为带并发上限的 job runner。这样同一 bucket 的 group 仍属于同一事务 apply，但不会无限并发压垮 API。

这个调整和 `manualRefillChain` 是配套的：chain 的 chunk 层级在本版固定为单 chunk，bucket 才是关键恢复边界。若以后还需要记录限流批次，可以在 bucket 上记录 `jobBatches`，但不要让限流批次改变数据事务边界。

### 记录 chain bucket

`processGroupedRuntimeChunk_ACU` 当前只返回：

```ts
{ success, failedGroups, error, tableData, checkpointData }
```

不新增 `chainChunk` 返回值。bucket 成功后直接更新 `manualRefillChainDraft`，并在本 bucket 的 checkpoint commit 中持久化当前 draft。bucket record 内容：

```text
bucketIndex
saveTargetIndex
batchNumber
updateMode
jobGroupKeys = jobs.map(job.groupKey)
messageIndices = union jobs.messagesForContext 对应的 AI message index 范围，或直接使用 plannedJob first..last 的 union
sheetKeys = bucketSheetKeys
operations = applyResult.operations
filledSheetKeys = applyResult.filledSheetKeys
changedSheetKeys = applyResult.changedSheetKeys
groupKeys = applyResult.groupKeys
```

注意：`messagesForContext` 可能包含前置 user message，不应该作为 batch messageIndices。应使用 planned jobs 的 `firstMessageIndexOfBatch..lastMessageIndexOfBatch`。

### 保存 chain

当前每个 bucket 成功后都会在 `manualRefillTargetIndex` 写 full checkpoint。这个行为可以保留，因为它支持中断续跑。

每次 checkpoint commit 时，把当前 chain draft 一并写入：

```ts
persist: {
  forceCheckpoint: true,
  checkpointReason: 'manual',
  manualRefillProgress: progress,
  manualRefillChain: chainDraft,
}
```

因此 `TableUpdateCommitPersistOverride_ACU`、`PersistTableMutationV2Options_ACU`、`persistTableMutationLogV2_ACU` 都需要透传 `manualRefillChain`。

最后一个 bucket 完成时，将 chain status 改为 `complete`。

## 从 chain 构建手动重填基底

新增函数：

```ts
async function buildManualRefillInitialDataFromChain_ACU(
  chain: ManualRefillChainV2_ACU,
  requestedStartMessageIndex: number,
  selectedSheetKeys: string[],
  latestState: Record<string, any>,
): Promise<{
  success: true;
  data: Record<string, any>;
  effectiveStartMessageIndex: number;
} | {
  success: false;
  failure: ManualRefillChainFailure_ACU;
}>
```

流程：

```text
1. 校验 selectedSheetKeys 与 chain.selectedSheetKeys 完全一致。
2. 找到所有 end/saveTargetIndex < requestedStartMessageIndex 的 buckets。
3. 如果 requestedStartMessageIndex 落在某个 bucket 内，则 effectiveStartMessageIndex 回退到该 bucket 的起点。
4. 从 chain.baseCheckpoint 深拷贝出 workingData。
5. 按 chunkIndex、bucketIndex、saveTargetIndex、batchNumber 顺序回放前置 bucket operations。
6. 将 latestState 中未选中的 sheet 保持为最新状态。
7. 返回 workingData 与 effectiveStartMessageIndex。
```

回放使用现有：

```ts
applyTableOperationV2_ACU
```

SQL 操作回放需要和 V2 replay 一样使用 `SqliteEngine + SyncBridge`，不能直接在全局 runtime provider 上执行。

## 与现有 progress 的关系

`manualRefillProgress` 继续负责：

```text
1. 中断后知道哪些 sheet 已经完成到哪个 messageIndex。
2. 判断是否可续跑。
3. UI 风险提示和状态恢复。
```

`manualRefillChain` 负责：

```text
1. 完整记录本次手动重填生成的可回放操作链。
2. 为下一次局部重填构造起点前基底。
```

两者不要合并。progress 是执行状态；chain 是恢复数据。

## 失败与中断

### bucket 失败

如果某 bucket 失败：

```text
1. 不追加该 bucket 到 chain。
2. checkpoint 中 chain.status 保持 in_progress。
3. progress.completedSheetMessageIndexByKey 只记录已经成功的 sheet/bucket。
4. 下次 matchedProgress 续跑时继续从未完成 bucket 开始。
```

### 用户终止

终止语义同 bucket 失败。已成功 bucket 的 chain 保留。

### chain 回放失败

回放失败时不能静默从零基底开始。必须返回错误原因，让 UI 提示：

```text
无法从上次手动重填操作链恢复指定楼层前状态。本次局部重填已终止；如需继续，必须另行显式发起从更早批次或从头开始的重填。
```

## 与自动合并总结的关系

当前 `orchestrateManualUpdate_ACU` 在手动更新成功后会检测自动合并总结。该逻辑保持不变。

但如果自动合并总结写入了额外 checkpoint/log，它不应修改手动重填 checkpoint 的 `manualRefillChain`。chain 只描述本次手动重填，不描述后续 merge summary。

## UI 影响

本版无需新增复杂 UI。

建议调整确认文案：

```text
本次手动重填完成后，会在最新 checkpoint 中保存本次重填的批次操作链。
后续如果从该范围中间重填，系统会优先从操作链恢复到目标批次前，而不是从头重填。
如果目标楼层落在某个批次内部，会从该批次起点开始重填。
```

如果从 chain 恢复导致 effectiveStartMessageIndex 早于用户输入起点，进度提示应显示实际范围。

## 完整实现门禁

本功能按一次完整闭环实现，不定义可发布的中间态。

实现完成必须满足：

```text
1. 手动重填能写入 manualRefillChain。
2. 下次手动重填能从 manualRefillChain 恢复起点前基底。
3. 起点落在 bucket 内时能回退到 bucket 起点并重填。
4. chain 不兼容或回放失败时明确阻止/提示，不静默从头或 zeroBase。
5. bucket 内 group 并发、bucket 间串行的执行模型完成。
6. 相关测试全部通过。
```

只完成“记录 chain 但不使用 chain 恢复”的代码没有产品意义，不能合入主功能路径。

### 原子任务 1：打通 chain 写入

目标：让数据结构和写入链路可测试，并作为完整闭环的一部分。

改动：

```text
1. 新增 ManualRefillChainV2_ACU 类型。
2. 扩展 TableCheckpointV2_ACU.manualRefillChain。
3. 扩展 persist 透传字段。
4. 扩展 CardUpdateResult，deferPersist 返回 operations。
5. processGroupedRuntimeChunk_ACU 收集 chunk/bucket chain。
6. manual checkpoint 写入 chain。
7. 手动路径取消外层 group chunk，改为 bucket 内并发限流。
8. 测试 checkpoint 中 chain 内容与 bucket 顺序。
```

验收：

```text
1. 手动重填成功后，latest manual checkpoint 包含 baseCheckpoint 和 buckets。
2. buckets 顺序与 orderedBuckets 一致。
3. chain.chunks 固定为单 chunk，限流不会产生额外数据 chunk。
4. SQLite 和 DSL 路径都能记录 operations。
5. 失败/终止时只记录已成功 bucket。
```

### 原子任务 2：启用 chain 恢复

目标：当范围前无 checkpoint 时，从 latest manual checkpoint 的 chain 构造基底。

改动：

```text
1. 新增 buildManualRefillInitialDataFromChain_ACU。
2. buildManualRefillInitialData_ACU 找不到范围前 checkpoint 时尝试 chain。
3. 支持 effectiveStartMessageIndex 回退到 bucket 起点。
4. orchestrateManualUpdate_ACU 用 effectiveStartMessageIndex 修正 pendingContextScopeIndices 和 progress.originalStartMessageIndex。
5. UI/Toast 显示实际重填范围。
```

验收：

```text
1. 只有一个最新 manual checkpoint 时，从中间 bucket 后重填不会从头开始。
2. 起点落在 bucket 内时，会回退到 bucket 起点。
3. selectedSheetKeys 不一致时拒绝 chain 恢复。
4. chain 回放失败时不静默降级到 zeroBase。
```

### 原子任务 3：续跑与 chain 合并

目标：中断后续跑时保留已有 chain，并追加新的 bucket。

改动：

```text
1. matchedProgress 时读取现有 chain。
2. 删除或覆盖未完成区间之后的 stale buckets。
3. 新成功 bucket 追加到 chain。
4. 完成后 status=complete。
```

验收：

```text
1. 中断后 checkpoint 中 chain.status=in_progress。
2. 续跑后不会重复记录已完成 bucket。
3. 续跑失败不会污染已完成 bucket。
```

## 必测用例

### 单 group 单批

```text
范围 1~3，batchSize=3，选择 A 表。
期望：chain.baseCheckpoint 存在，buckets=1，saveTargetIndex=第 3 层，operations 非空。
```

### 单 group 多批

```text
范围 1~6，batchSize=3，选择 A 表。
期望：buckets=2，分别对应 1~3、4~6。
```

### 多 group 同 bucket

```text
A 表 groupId=1，B 表 groupId=2，范围 1~3，batchSize=3，maxConcurrentGroups>=2。
期望：外层一个 chunk，内层一个 bucket，bucket.jobGroupKeys 包含两个 group，operations 按 sortGroupFillResponses_ACU 顺序记录。
```

### 多 group 多 chunk

```text
A/B/C 三组，maxConcurrentGroups=1。
期望：不再拆成 3 个数据 chunk；同一 bucket 内按 maxConcurrentGroups=1 限流串行请求，但所有 group responses 仍在同一个 bucket 统一 apply，并只记录一个 chain bucket。
```

### 多 group 同批并发

```text
A/B/C 三组，maxConcurrentGroups=2，范围 1~3，batchSize=3。
期望：bucket 1~3 内最多 2 个 group 同时请求；收齐 A/B/C 后统一 apply；checkpoint/chain 只记录一个 bucket。
```

### SQLite deferred runtime

```text
SQLite 模式手动重填，deferPersist=true。
期望：applySqlResponsesToCurrentRuntime_ACU 返回 sql_batch operations，chain 记录 SQL operations。
```

### 从 chain 中间恢复

```text
已有 chain: 1~3、4~6、7~9。
请求从 7 重填。
期望：baseCheckpoint + 1~3 + 4~6 operations 得到基底，实际重填 7~9。
```

### 起点落在 bucket 内

```text
已有 chain: 1~3、4~6、7~9。
请求从 8 重填。
期望：恢复到 6 后状态，实际重填 7~9，并提示实际范围回退。
```

### 表选择不一致

```text
已有 chain selectedSheetKeys=[A,B]。
请求只重填 A。
期望：拒绝使用 chain，提示需从头或重新选择相同表集合。
```

## 风险

1. chain 会增加 checkpoint 体积，尤其是 SQL/DSL 操作很长时。
2. 如果用户频繁大范围手动重填，latest checkpoint 会包含较长操作链。
3. chain 恢复依赖 operation replay；旧 operation 若本身不可 replay，必须失败而不是降级。
4. 本版不支持 selectedSheetKeys 子集复用，会牺牲一部分灵活性，但能避免错误恢复。
5. bucket 之间必须串行，不能为了并发跨 bucket 跑，否则 deferredWorkingData 顺序会失真。
6. bucket 内可以并发 group 请求，但必须收齐后统一 apply，不能每个 group 单独 apply。

## 非目标

1. 不重写自动填表调度。
2. 不把手动重填直接变成自动填表普通 log。
3. 不拆旧历史 log 中的 A/B/C 混合操作。
4. 不支持 selectedSheetKeys 子集复用。
5. 不引入每批 after snapshot。
6. 不改变当前自动合并总结流程。
7. 不跨 bucket 并发执行手动重填。

## 程序设计

本节把前面的方案落到代码结构、函数签名和改造顺序。目标是让实现时不再重新讨论概念，只按接口推进。

### 设计原则

```text
1. 最小侵入：保留当前手动重填 deferPersist + final checkpoint 机制。
2. 单一权威：最新 manual checkpoint.data 仍是当前最终状态权威。
3. 可恢复链：manualRefillChain 只用于构造下次重填起点前基底。
4. 不改旧历史：不删除、不拆分、不重写旧 logEntries。
5. bucket 是事务边界：同一 bucket 内多 group 并发请求，统一 apply，统一记录 chain bucket。
6. 限流不是事务边界：maxConcurrentGroups 只限制同一 bucket 内同时请求数。
7. 回放失败必须显式失败，不能静默降级到 zeroBase。
```

### 类型改造

文件：`src/service/table/storage-frame-v2-types.ts`

新增类型：

```ts
export interface ManualRefillChainV2_ACU {
  kind: 'manual_refill_chain';
  version: 1;
  status: 'in_progress' | 'complete';
  selectedSheetKeys: string[];
  contextMessageIndices: number[];
  originalStartMessageIndex: number;
  targetMessageIndex: number;
  batchSize: number;
  baseCheckpoint: TableDataObject_ACU;
  chunks: ManualRefillChainChunkV2_ACU[];
  createdAt: number;
  updatedAt: number;
}

export interface ManualRefillChainChunkV2_ACU {
  chunkIndex: number;
  groupKeys: string[];
  buckets: ManualRefillChainBucketV2_ACU[];
}

export interface ManualRefillChainBucketV2_ACU {
  bucketIndex: number;
  saveTargetIndex: number;
  batchNumber: number;
  updateMode: string;
  jobGroupKeys: string[];
  messageIndices: number[];
  sheetKeys: string[];
  operations: TableMutationOperationV2_ACU[];
  filledSheetKeys: string[];
  changedSheetKeys: string[];
  groupKeys: string[];
}
```

扩展 `TableCheckpointV2_ACU`：

```ts
manualRefillChain?: ManualRefillChainV2_ACU;
```

扩展 `TableSheetReplaceOperationV2_ACU.reason` 和 `TableDataReplaceOperationV2_ACU.reason` 暂不需要。本版 chain 只保存实际填表产生的 `table_edit_dsl` / `sql_batch`，不新增 `manual_refill` reason。

### persist 透传改造

文件：`src/service/table/table-update-commit.ts`

扩展 `TableUpdateCommitPersistOverride_ACU`：

```ts
manualRefillChain?: ManualRefillChainV2_ACU;
```

在 `persistTablesToChatMessage_ACU` 调用中透传：

```ts
manualRefillChain: persistOptions.manualRefillChain,
```

文件：`src/service/table/table-service.ts`

扩展 `TableChatPersistOptions_ACU`：

```ts
manualRefillChain?: ManualRefillChainV2_ACU;
```

在 `persistTableMutationLogV2_ACU` 调用中透传：

```ts
manualRefillChain,
```

文件：`src/service/table/storage-frame-v2-persist.ts`

扩展 `PersistTableMutationV2Options_ACU`：

```ts
manualRefillChain?: ManualRefillChainV2_ACU;
```

写 checkpoint 时增加：

```ts
...(options.manualRefillChain ? { manualRefillChain: deepClone_ACU(options.manualRefillChain) } : {}),
```

注意：只有 `shouldCheckpoint === true` 时保存 chain。普通 log entry 不保存 chain。

### 结果类型改造

文件：`src/service/table/update-orchestrator.ts`

扩展 `CardUpdateResult`：

```ts
export interface CardUpdateResult {
  success: boolean;
  modifiedKeys: string[];
  tableData?: Record<string, any>;
  operations?: TableMutationOperationV2_ACU[];
  filledSheetKeys?: string[];
  changedSheetKeys?: string[];
  groupKeys?: string[];
  error?: string;
  aborted?: boolean;
}
```

新增内部返回类型：

```ts
interface ProcessGroupedRuntimeChunkResult_ACU {
  success: boolean;
  failedGroups: string[];
  error?: string;
  tableData?: Record<string, any>;
  checkpointData?: Record<string, any>;
}
```

将 `processGroupedRuntimeChunk_ACU` 返回类型替换为该接口。chain 状态由 `manualRefillChainDraft` 在函数内部更新，并随每个 bucket checkpoint 一起持久化；不再通过返回 `chainChunk` 让上层二次合并，避免两个状态源互相打架。

### apply 结果补 operations

文件：`src/service/table/update-orchestrator.ts`

#### `applyUnifiedGroupFillResponses_ACU`

在非 SQLite runtime SQL 路径中，已有：

```ts
const operations: TableMutationOperationV2_ACU[] = [];
```

deferPersist 分支从：

```ts
if (options.deferPersist) {
  return { success: true, modifiedKeys, tableData: workingTableData as any };
}
```

改为：

```ts
if (options.deferPersist) {
  const fillAttemptKeys = [...allTargetSheetKeySet]
    .filter(sheetKey => Boolean((workingTableData as any)?.[sheetKey]))
    .sort();
  const keysToTrack = [...new Set(modifiedKeys)].sort();
  return {
    success: true,
    modifiedKeys,
    tableData: workingTableData as any,
    operations,
    filledSheetKeys: fillAttemptKeys,
    changedSheetKeys: keysToTrack,
    groupKeys: fillAttemptKeys,
  };
}
```

SQLite runtime SQL 非 deferPersist 路径也可以返回 operations 以保持一致，但不是本功能必需项。

#### `applySqlResponsesToCurrentRuntime_ACU`

当前它只执行 SQL 并返回 `modifiedKeys/tableData`。需要收集 operations：

```ts
const operations: TableMutationOperationV2_ACU[] = [];

for (const response of sortedResponses) {
  ...
  sqlTexts.push(response.tableEditText);
  operations.push(...buildSqlBatchOperationsFromText_ACU(response.tableEditText));
}
```

成功返回：

```ts
return {
  success: true,
  modifiedKeys,
  tableData: runtimeData,
  operations,
  filledSheetKeys: sorted unique response.job.targetSheetKeys,
  changedSheetKeys: modifiedKeys,
  groupKeys: sorted unique response.job.targetSheetKeys,
};
```

### 并发限流 runner

文件：`src/service/table/update-orchestrator.ts`

新增工具函数：

```ts
async function runGroupFillJobsWithLimit_ACU(
  jobs: GroupFillJob_ACU[],
  limit: number,
  run: (job: GroupFillJob_ACU) => Promise<GroupFillResponse_ACU>,
): Promise<PromiseSettledResult<GroupFillResponse_ACU>[]> {
  const results: PromiseSettledResult<GroupFillResponse_ACU>[] = new Array(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await run(jobs[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
```

扩展 `processGroupedRuntimeChunk_ACU` options：

```ts
maxConcurrentJobs?: number;
manualRefillChainDraft?: ManualRefillChainV2_ACU;
```

替换：

```ts
const settledResponses = await Promise.allSettled(jobs.map(job => collectGroupFillResponse_ACU(...)))
```

为：

```ts
const settledResponses = await runGroupFillJobsWithLimit_ACU(
  jobs,
  Math.max(1, Number(options.maxConcurrentJobs) || jobs.length),
  job => collectGroupFillResponse_ACU(job, collectFeedback, options.abortController, {
    onProgress: event => emitBucketProgress(bucketIndex, event),
  }),
);
```

SQLite 格式重试里的 `retryJobs` 也要使用同一个限流 runner。

### 手动外层 chunk 移除

文件：`src/service/table/update-orchestrator.ts`

`orchestrateManualUpdate_ACU` 当前逻辑：

```ts
for (let start = 0; start < groupKeys.length; start += maxConcurrentGroups) {
  const chunkKeys = groupKeys.slice(start, start + maxConcurrentGroups);
  const groupedChunk = chunkKeys.map(...);
  const chunkResult = await processGroupedRuntimeChunk_ACU(groupedChunk, ...);
}
```

改为：

```ts
const groupedChunk: GroupedRuntimeUpdateGroup_ACU[] = groupKeys.map(toGroupedRuntimeUpdateGroup);
const chunkResult = await processGroupedRuntimeChunk_ACU(groupedChunk, 'manual_independent', {
  onProgress: options.onProgress,
  deferPersist: manualRefillEnabled,
  forceSnapshotApply: manualRefillEnabled,
  initialData: manualRefillInitialData,
  checkpointTargetIndex: manualRefillTargetIndex,
  checkpointBaseData: manualRefillCheckpointData,
  manualRefillProgress,
  manualRefillChainDraft: manualRefillChain,
  maxConcurrentJobs: Math.max(1, Number(settings_ACU.maxConcurrentGroups) || 1),
});
```

为避免重复代码，提取：

```ts
function buildGroupedRuntimeUpdateGroup_ACU(
  groupKey: string,
  group: ManualRuntimeUpdateGroup_ACU,
  templateData: Record<string, any>,
): GroupedRuntimeUpdateGroup_ACU
```

### chain 创建和更新

文件：`src/service/table/update-orchestrator.ts`

新增 helper：

```ts
function createManualRefillChain_ACU(input: {
  selectedSheetKeys: string[];
  contextMessageIndices: number[];
  targetMessageIndex: number;
  batchSize: number;
  baseCheckpoint: Record<string, any>;
}): ManualRefillChainV2_ACU
```

实现要点：

```text
1. selectedSheetKeys 去重排序。
2. contextMessageIndices 拷贝。
3. originalStartMessageIndex = contextMessageIndices[0]。
4. baseCheckpoint 深拷贝。
5. status = in_progress。
6. chunks = []。
```

在 `orchestrateManualUpdate_ACU` 中：

```ts
let manualRefillChain: ManualRefillChainV2_ACU | undefined;

if (manualRefillEnabled && !matchedProgress) {
  manualRefillChain = createManualRefillChain_ACU({ ... });
}
```

matchedProgress 场景必须复用旧 chain：

```text
1. 从目标 checkpoint 读取已有 manualRefillChain。
2. 校验 chain 与当前 selectedSheetKeys/context/target 兼容。
3. 保留已完成 bucket。
4. 删除或覆盖未完成区间之后的 stale buckets。
5. 后续成功 bucket 继续追加到同一条 chain。
```

不能在续跑时丢弃旧 chain 后重新写一条新 chain，否则会破坏中断恢复语义。

`processGroupedRuntimeChunk_ACU` bucket 成功后，如果 `options.manualRefillChainDraft` 存在，构造 bucket record：

```ts
const chainBucket: ManualRefillChainBucketV2_ACU = {
  bucketIndex,
  saveTargetIndex: bucket.saveTargetIndex,
  batchNumber: bucket.batchNumber,
  updateMode: bucket.updateMode,
  jobGroupKeys: jobs.map(job => job.groupKey).sort(),
  messageIndices: collectBucketMessageIndices_ACU(bucket.plannedJobs),
  sheetKeys: bucketSheetKeys,
  operations: JSON.parse(JSON.stringify(applyResult.operations || [])),
  filledSheetKeys: sorted unique applyResult.filledSheetKeys,
  changedSheetKeys: sorted unique applyResult.changedSheetKeys,
  groupKeys: sorted unique applyResult.groupKeys,
};
```

收集 AI message index：

```ts
function collectBucketMessageIndices_ACU(plannedJobs: PlannedGroupedRuntimeJob_ACU[]): number[] {
  const set = new Set<number>();
  for (const job of plannedJobs) {
    for (let i = job.firstMessageIndexOfBatch; i <= job.lastMessageIndexOfBatch; i++) {
      set.add(i);
    }
  }
  return [...set].sort((a, b) => a - b);
}
```

`processGroupedRuntimeChunk_ACU` 确保 draft 里存在单一 chunk：

```ts
ensureManualRefillChainChunk_ACU(options.manualRefillChainDraft, groups);
```

bucket 成功且 checkpoint commit 前：

```ts
appendManualRefillChainBucket_ACU(options.manualRefillChainDraft, groups, chainBucket);
```

本版固定使用一个 chunk：`chunkIndex = 0`，`groupKeys = groups.map(g => g.key).sort()`。`maxConcurrentJobs` 的限流批次不进入 chain 结构。

### 每个 bucket checkpoint 写 chain

当前 bucket 成功后立刻 checkpoint commit。这里需要在 commit 前更新 chain draft：

```ts
if (options.manualRefillChainDraft && chainBucket) {
  appendManualRefillChainBucket_ACU(options.manualRefillChainDraft, groups, chainBucket);
  options.manualRefillChainDraft.updatedAt = Date.now();
}
```

判断是否 complete：

```ts
const progressStatus = allSelectedSheetsComplete ? 'complete' : 'in_progress';
if (options.manualRefillChainDraft) {
  options.manualRefillChainDraft.status = progressStatus;
  options.manualRefillChainDraft.updatedAt = Date.now();
}
```

checkpoint persist 增加：

```ts
manualRefillChain: options.manualRefillChainDraft,
```

这样中断时，checkpoint 里已有已完成 bucket 的 chain；完成时 status=complete。

### 从 checkpoint 读取 chain

文件：`src/service/table/update-orchestrator.ts`

新增：

```ts
function getManualRefillChainAtMessage_ACU(chat: any[], messageIndex: number): ManualRefillChainV2_ACU | null
```

类似 `getManualRefillProgressAtMessage_ACU`：

```ts
const chain = tagData.storageFrame?.checkpoint?.manualRefillChain;
return chain?.kind === 'manual_refill_chain' ? chain as ManualRefillChainV2_ACU : null;
```

新增：

```ts
function findLatestManualRefillChainCheckpoint_ACU(
  chat: any[],
  targetMessageIndex: number,
): { chain: ManualRefillChainV2_ACU; messageIndex: number } | null
```

查找规则应一次设计完整：优先查 `targetMessageIndex` 对应 checkpoint；如果该点没有兼容 chain，再向前找最新 compatible manual checkpoint。不能只实现前半段后续再返工。

### chain 恢复函数

文件：建议新建 `src/service/table/manual-refill-chain.ts`，避免 `update-orchestrator.ts` 继续膨胀。

导出：

```ts
export function manualRefillChainMatchesRequest_ACU(
  chain: ManualRefillChainV2_ACU,
  selectedSheetKeys: string[],
  contextMessageIndices: number[],
  targetMessageIndex: number,
): { ok: true } | { ok: false; failure: ManualRefillChainFailure_ACU }
```

匹配规则：

```text
1. chain.status === 'complete'。
2. selectedSheetKeys unordered equal。
3. targetMessageIndex === chain.targetMessageIndex。
4. contextMessageIndices[0] >= chain.originalStartMessageIndex。
5. contextMessageIndices 最后一项 === chain.targetMessageIndex。
```

导出：

```ts
export async function buildManualRefillBaseFromChain_ACU(input: {
  chain: ManualRefillChainV2_ACU;
  requestedStartMessageIndex: number;
  latestState: Record<string, any>;
}): Promise<{
  success: true;
  data: Record<string, any>;
  effectiveStartMessageIndex: number;
} | {
  success: false;
  failure: ManualRefillChainFailure_ACU;
}>
```

算法：

```text
1. workingData = deepClone(chain.baseCheckpoint)。
2. 找到 requestedStart 所在 bucket：bucket.messageIndices 包含 requestedStart。
3. effectiveStart = 所在 bucket 的 min(messageIndices)；如果不在任何 bucket，则 effectiveStart=requestedStart。
4. replayBuckets = 所有 max(bucket.messageIndices) < effectiveStart 的 buckets。
5. 按 chunkIndex、bucketIndex、saveTargetIndex、batchNumber 排序 replayBuckets。
6. 对每个 operation 调用 applyTableOperationV2_ACU。
7. replay 完成后，把 latestState 中未在 chain.selectedSheetKeys 的 sheet 覆盖回 workingData。
8. 返回 workingData。
```

注意：

```text
1. 第 7 步用于保持未选中表为最新状态，因为 chain 只用于选中表重填基底。
2. 如果 operation replay 抛错，返回 `operation_replay_failed`。
3. SQL replay 必须使用本地 SqliteEngine/SyncBridge，不得污染全局 runtime。
```

`applyTableOperationV2_ACU` 当前未导出 runtime helper。若新文件要复用它，需要：

```text
方案 A：从 storage-frame-v2-replay.ts 导出 applyTableOperationV2_ACU，并提供可复用 SQL replay runtime helper。
方案 B：把 operation replay 封装成新导出函数 replayTableOperationsV2_ACU(state, operations)。
```

推荐 B：

```ts
export async function replayTableOperationsV2_ACU(
  state: TableDataObject_ACU,
  operations: TableMutationOperationV2_ACU[],
): Promise<void>
```

内部持有一个 SQL replay runtime，按顺序调用 `applyTableOperationV2_ACU`，最后 export runtime。

### 接入 buildManualRefillInitialData_ACU

当前旧逻辑：

```ts
refillBase = await loadTableStateFromFramesV2_ACU(chatHistory, isolationKey, {
  maxMessageIndex: firstMessageIndexOfRange - 1,
});

if (!refillBase) refillBase = zeroBase;
```

新逻辑必须移除这个静默 `zeroBase` 分支，改为：

```ts
if (!refillBase) {
  const chainResult = await tryBuildManualRefillInitialDataFromLatestChain_ACU(...);
  if (chainResult.success) {
    refillBase = chainResult.data;
    effectiveStartMessageIndex = chainResult.effectiveStartMessageIndex;
  } else {
    return { success: false, failure: chainResult.failure };
  }
}
```

这要求 `buildManualRefillInitialData_ACU` 返回更丰富结构：

```ts
type ManualRefillInitialDataResult_ACU =
  | {
      success: true;
      data: Record<string, any>;
      effectiveStartMessageIndex: number;
      source: 'history_replay' | 'manual_refill_chain';
    }
  | {
      success: false;
      failure: ManualRefillChainFailure_ACU;
    };
```

`source` 不包含 `zero_base`。如果范围前没有历史 checkpoint，且没有 compatible chain，就返回 `missing_chain` 或 `range_not_covered`，并终止当前局部重填。显式从头重填必须是另一次用户确认后的独立动作，不属于局部重填调用内的 fallback。

`orchestrateManualUpdate_ACU` 使用 `effectiveStartMessageIndex` 修正：

```ts
const effectiveContextScopeIndices = contextScopeIndices.filter(index => index >= effectiveStartMessageIndex);
```

并用它更新：

```text
manualRefillProgress.originalStartMessageIndex
manualRefillProgress.contextMessageIndices
updateGroups[gKey].indices
```

### 原子实现边界

完整功能由三块组成，缺任意一块都不能认为实现完成：

```text
1. 写入：manual checkpoint 必须保存 manualRefillChain。
2. 恢复：buildManualRefillInitialData_ACU 必须能使用 manualRefillChain 构造起点前基底。
3. 续跑：中断后必须复用已有 manualRefillChain，保留已完成 bucket，并追加后续 bucket。
```

代码提交可以为了 review 拆 commit，但同一功能分支最终必须同时包含上述三块和对应测试。不能留下“只写不读”或“只读不续跑”的主路径。

### 测试文件规划

新增或扩展：

```text
tests/service/table/manual-refill-chain.test.ts
tests/service/table/update-orchestrator.test.ts
tests/service/table/storage-frame-v2-persist.test.ts
tests/service/table/storage-frame-v2-replay.test.ts
```

重点测试：

```text
1. persistTableMutationLogV2_ACU 能把 manualRefillChain 写入 checkpoint。
2. 非 checkpoint log 不写 chain。
3. applyUnifiedGroupFillResponses_ACU deferPersist 返回 operations。
4. applySqlResponsesToCurrentRuntime_ACU deferPersist 返回 sql_batch operations。
5. processGroupedRuntimeChunk_ACU bucket 内多 group 统一生成一个 chain bucket。
6. maxConcurrentJobs=1 时请求限流串行，但 apply 仍统一一次。
7. orchestrateManualUpdate_ACU 不再按 maxConcurrentGroups 拆外层 chunk。
8. buildManualRefillBaseFromChain_ACU 能从 base + 前置 operations 恢复。
9. 起点落在 bucket 内时 effectiveStart 回退。
10. selectedSheetKeys 不一致时 chain match=false。
```

### 推荐实现清单

```text
1. 加类型和 persist 透传，不接业务。
2. 扩展 CardUpdateResult，补 deferPersist operations 返回。
3. 增加 maxConcurrentJobs runner。
4. 移除手动外层 chunk，改 bucket 内限流。
5. 加 manualRefillChainDraft 创建与 bucket 追加。
6. checkpoint commit 透传 manualRefillChain。
7. 新建 manual-refill-chain.ts，实现 chain match/replay。
8. 接入 buildManualRefillInitialData_ACU。
9. 实现 matchedProgress 下旧 chain 复用、stale bucket 裁剪和继续追加。
10. 写完整测试：写入、恢复、续跑、并发限流、失败提示。
11. 修正 UI 文案，显示实际重填起点和 chain 恢复失败原因。
12. 完整验收。
```

### 完整交付失败处理

本功能不允许存在“只写 chain 不读 chain”的主路径。

完整交付后的失败处理只允许走安全失败，禁止任何静默降级：

```text
1. 如果 chain 缺失、不兼容或回放失败，阻止本次局部重填。
2. UI 明确提示：无法从上次手动重填链恢复指定楼层前状态。
3. 当前局部重填调用必须终止；用户若要继续，只能另行显式发起从更早批次/从头重填。
4. 不允许静默退回 zeroBase。
5. 不允许假装使用 chain 但实际从头重填。
6. 不允许静默忽略 manualRefillChain。
7. 不允许静默改写用户选择的重填范围。
8. 不允许 chain 恢复失败后自动改用历史 replay，除非历史 replay 本来就是本次请求的第一优先级且成功发生在 chain 尝试之前。
9. 不允许把“不兼容”当作“无 chain”处理；必须返回具体不兼容原因。
```

`manualRefillChain` 是完整功能的一部分，而不是可有可无的附加调试字段。实现验收必须同时覆盖写入、恢复、续跑和失败提示。

### 失败返回结构

所有 chain 恢复失败必须返回结构化原因，不能只返回字符串后让上层猜测：

```ts
type ManualRefillChainFailureCode_ACU =
  | 'missing_chain'
  | 'selected_sheets_mismatch'
  | 'target_mismatch'
  | 'range_not_covered'
  | 'bucket_replay_failed'
  | 'operation_replay_failed'
  | 'schema_incompatible';

interface ManualRefillChainFailure_ACU {
  code: ManualRefillChainFailureCode_ACU;
  message: string;
  detail?: Record<string, unknown>;
}
```

`buildManualRefillBaseFromChain_ACU` 失败时返回：

```ts
{
  success: false;
  failure: ManualRefillChainFailure_ACU;
}
```

`orchestrateManualUpdate_ACU` 收到该失败后必须终止本次局部重填，并把 `failure.message` 交给 UI。不得在同一调用中继续执行 `zeroBase` 或其他隐式基底。

### 禁止行为测试

必须增加以下负向测试，防止以后又把问题藏起来：

```text
1. chain 缺失且范围前无 checkpoint：返回 missing_chain，不调用 AI。
2. selectedSheetKeys 不一致：返回 selected_sheets_mismatch，不调用 AI。
3. targetMessageIndex 不一致：返回 target_mismatch，不调用 AI。
4. 请求范围不被 chain 覆盖：返回 range_not_covered，不调用 AI。
5. operation replay 抛错：返回 operation_replay_failed，不调用 AI。
6. chain 恢复失败时 currentJsonTableData_ACU 不被 zeroBase 覆盖。
7. chain 恢复失败时不会写入新的 checkpoint。
```

# 手动重填选表与单表操作记录重构说明

## 目标

手动填表需要支持“只重填某些表”。当前实现曾通过在最新 AI 楼写 full checkpoint / 手动进度 checkpoint 来规避旧日志中多表混合操作记录难以局部清理的问题。这个方向是错误的：它把手动重填变成另一套恢复逻辑，也掩盖了操作记录粒度不正确的问题。

本重构目标是让手动重填与自动填表使用同一套 V2 操作记录语义：按楼层、按单表操作记录回放，不引入手动专用 checkpoint 兜底。

## 核心语义

业务层真正需要的清理单位只有一个：**单表操作记录**。

“log entry”和“operation”不是两个业务概念。它们只是同一条记录里的两层数据：

- 外层记录本次操作的来源、楼层、时间、表归属等元信息。
- 内层记录具体动作，例如 SQL、DSL、行更新、行删除、元数据更新。

V2 当前不是只有 SQL 日志。`operations` 里已经并存多种动作表达：

- SQL 路径：`sql_batch`
- DSL 路径：`table_edit_dsl`
- 结构化 CRUD 路径：`row_upsert` / `row_delete` / `meta_update` / `sheet_replace`
- 全量替换路径：`data_replace`

本重构不把所有日志改成 SQL，也不把 SQL 改成 row diff。目标只有一个：**无论内层动作是哪一种，外层操作记录都必须只归属一张表。**

对 SQLite/SQL 自动填表路径，日志本体就是 `sql_batch.statements`，以及与 statement 同索引的 `sql_batch.params`。单表化的核心不是删除 `sql_batch`，而是把原来混在一个 `sql_batch.statements` 里的多张表 SQL，按每条 statement 的写入目标表分组，写成多条单表 SQL 操作记录。

自动填表 SQL statement 是单写入目标表语句，例如：

- `INSERT INTO table_a ...`
- `UPDATE table_a ...`
- `DELETE FROM table_a ...`

因此拆分时只需要识别每条 statement 的写入目标表，并映射到对应 sheet key。一个 `sql_batch` 可以包含多条 SQL，但这些 SQL 必须属于同一张表。拆分或分组时必须同步移动 `params[i]`，保持 `params[i]` 与 `statements[i]` 的索引对应关系不变。

## 存储结构边界

本重构不新增 V2 存储结构字段。细化不是改 schema，而是把现有记录组织方式规范成“单表操作记录”。

SQL 路径保留现有 `sql_batch` 结构。`sql_batch.statements` 是 SQL 回放内容，不是调试 metadata。需要改变的是它所在记录的粒度：一条记录只能包含一张表的 SQL。

表归属由现有外层字段表达：

```ts
interface TableMutationLogEntryV2_ACU {
  changedSheetKeys: ['sheet_a'];
  operations: [
    { kind: 'sql_batch', statements: ['UPDATE table_a ...'] }
  ];
}
```

旧结构本身已经能表达单表操作记录：

- `TableMutationLogEntryV2_ACU.changedSheetKeys`
- `TableMutationLogEntryV2_ACU.filledSheetKeys`
- `TableMutationLogEntryV2_ACU.groupKeys`
- 已带 `sheetKey` 的 row / meta / sheet 动作
- SQL statement 的写入目标表可由业务层在生成时映射到唯一 sheet，并写入单表操作记录的 `changedSheetKeys`

错误形态不是“缺少新字段”，而是“一条单表操作记录混入多张表的动作，导致后续不能按表清理”。

不推荐形态：

```ts
{
  changedSheetKeys: ['sheet_a', 'sheet_b'],
  operations: [
    { kind: 'sql_batch', statements: ['UPDATE table_a ...', 'UPDATE table_b ...'] }
  ]
}
```

正确形态：

```ts
{
  changedSheetKeys: ['sheet_a'],
  operations: [
    { kind: 'sql_batch', statements: ['UPDATE table_a ...'] }
  ]
}

{
  changedSheetKeys: ['sheet_b'],
  operations: [
    { kind: 'sql_batch', statements: ['UPDATE table_b ...'] }
  ]
}
```

## 写入职责

新写入链路必须直接生成单表操作记录，不能把本次多表结果先写成粗粒度记录再交给持久化层拆。

对于 SQL 自动填表：

- AI 生成的每条 SQL statement 应当只写入一张业务表。
- 生成操作记录时按 statement 的写入目标表分组。
- 每组生成一条单表操作记录。
- 每条记录的 `changedSheetKeys` 只包含该组对应的 sheet key。
- 每条记录里的 `sql_batch.statements` 只包含该表的 SQL。
- 如果原 `sql_batch` 带 `params`，每条记录里的 `sql_batch.params` 必须随 `statements` 同步分组，保持 `params[i]` 与 `statements[i]` 对齐。

对于 DSL / row / meta / sheet 动作，也必须在生成时归属到唯一 sheet key；不能依赖 `targetSheetKeys` 事后补语义。

`targetSheetKeys` 不能作为真实写入语义来源。它最多只能作为 UI 输入、请求范围、旧接口兼容字段或校验字段。

持久化层职责：

- 校验本次写入的记录是否为单表操作记录。
- 从 `operations` 推导或校验 `changedSheetKeys`。
- 校验外部传入的 tracking / changed 信息不能与 `operations` 冲突。

持久化层不负责：

- 拆分本次新写入的多表 SQL batch。
- 用 `targetSheetKeys` 补操作记录的表归属。
- 在普通写入时拆分本次粗粒度记录。
- 操作记录缺失时构造 `data_replace` 或 `sheet_replace` 兜底。

如果普通写入仍然试图写多表混合记录，必须直接失败。这是上游生成 bug，不能在持久化层通过归一化掩盖。

## 历史记录归一化

兼容旧 V2 存储结构，不等于保留粗粒度记录继续参与新语义。读取粗粒度聊天数据、导入聊天数据、显式修复或手动重填前，应先把已有 V2 操作记录归一化为单表操作记录。

归一化只处理既有历史记录或显式修复流程，不处理普通新写入。

新增文件：

- `src/service/table/storage-frame-v2-normalize.ts`

新增入口：

```ts
interface NormalizeV2OperationLogOptions {
  chat: any[];
  isolationKey: string;
  mode: 'on_import' | 'before_manual_refill' | 'repair';
}

interface NormalizeV2OperationLogResult {
  changed: boolean;
  errors: string[];
}

function normalizeV2OperationLogToSingleTableRecords_ACU(
  options: NormalizeV2OperationLogOptions,
): NormalizeV2OperationLogResult;
```

归一化规则：

- 已经是单表操作记录的，保持不变。
- 一条记录包含多张表，但内部动作都天然带 `sheetKey`，按 `sheetKey` 拆成多条单表操作记录。
- 一条记录包含 SQL 动作时，按每条 statement 的写入目标表分组，映射到 sheet key 后拆分；拆分时必须同步拆分 `params`，保持原 `params[i]` 与 `statements[i]` 的对应关系。
- 一条记录同时包含多种动作时，先按每个动作的唯一 sheet key 分组，再生成多条单表操作记录。
- 拆分后的多条单表操作记录保留原 `source` / `targetMessageIndex` / `aiFloor` 等原有元信息。
- 拆分后的 `seq` 必须重新分配，保持同一 frame 内稳定有序。
- 拆分后的 `entryId` 必须重新生成，避免多个记录共享同一个 entry id。
- 拆分后的 `changedSheetKeys` 必须只包含该记录对应的一张表。
- 拆分后的 `filledSheetKeys` / `groupKeys` 只保留属于该表的 key。
- 原记录有 `writeSet` 时，拆分后按单表记录的目标表重建为对应表级 writeSet；不要保留旧的多表 writeSet。

归一化触发点：

- 聊天数据导入后，发现已有 V2 `storageFrame.logEntries` 时立即执行。
- 手动重填开始前必须执行一次；如果归一化失败，不能进入清旧阶段。
- 显式 repair 流程执行归一化。
- legacy-v1 迁移到 V2 后不需要拆旧日志，因为当前迁移只写 full checkpoint；但如果迁移流程未来保留旧 V2 日志，也必须执行归一化。

归一化不是 fallback。它是把旧聊天数据升级到新协议组织方式的迁移步骤。不能写 full checkpoint 假装成功，也不能跳过旧记录。

## 手动重填语义

手动重填某些表时，语义不是“在最新楼追加最终态”，也不是“把旧单表操作记录在原楼层逐条原位替换”。

正确语义：

1. 用户选择一组表，例如 `sheet_a`。
2. 用户选择或配置一段重填范围，例如 AI 楼 10 到 AI 楼 20。
3. 系统先确保该范围内历史操作记录已经归一化为单表操作记录。
4. 系统在该范围内清除 `sheet_a` 的所有旧单表操作记录。
5. 非选中表的单表操作记录必须保留。
6. 系统按本次手动重填实际配置重新跑填表。
7. 新产生的 `sheet_a` 单表操作记录写入本次重填实际批次对应的楼层。

旧记录只决定“清理范围”，不决定“新记录落点”。因为用户本次手动重填的批次、上下文深度、跳过楼层、选表范围都可能与旧记录不同。

手动重填必须按当前聊天里的 V2 数据状态分两种情况处理。

1. 当前聊天没有表格数据或没有可用 V2 基底时，复用旧手动重填逻辑生成第一个完整 full checkpoint。这个 checkpoint 内容必须是从本次处理起点累计执行到该保存点后的完整表格状态；不能只保存保留窗口内几楼的局部结果。第一个完整 full checkpoint 建好后，后续批次按自动填表同一套 V2 增量写入逻辑继续写单表操作记录。
2. 当前聊天已经有可用 V2 数据时，不新增最新楼兜底 checkpoint。手动重填先在本次范围内删除 selectedSheetKeys 的旧单表操作记录，保留非选中表记录，然后按自动填表同一套 V2 增量写入逻辑，把本次重新生成的 selectedSheetKeys 单表操作记录写到本次实际批次对应的 `saveTargetIndex`。如果重填范围内原本存在 checkpoint，该 checkpoint 缓存了旧表格状态，必须按清旧写新后的历史重建。

因此，正确原则是：没数据时，旧逻辑生成完整 full checkpoint，然后接自动填表式增量更新；有数据时，删旧数据，然后接自动填表式增量更新，范围内原有 checkpoint 按改写后的历史重建。checkpoint 不能作为已有 V2 数据场景下的最新楼最终态兜底。

示例：

```text
旧历史：
AI 楼 10: sheet_a op, sheet_b op
AI 楼 12: sheet_a op
AI 楼 15: sheet_a op

本次手动重填范围：
AI 楼 10..20
选中表：
sheet_a

本次重新执行后的批次落点：
AI 楼 14: sheet_a new op
AI 楼 20: sheet_a new op

正确结果：
AI 楼 10: sheet_b op
AI 楼 12: 无 sheet_a 旧 op
AI 楼 14: sheet_a new op
AI 楼 15: 无 sheet_a 旧 op
AI 楼 20: sheet_a new op
```

手动重填事务包含两个阶段：

```text
阶段 A：清旧
  扫描重填范围内所有 V2 frame / logEntries
  删除 selectedSheetKeys 对应的单表操作记录
  保留其他表的单表操作记录

阶段 B：写新
  按本次手动重填配置重新执行
  按本次批次 saveTargetIndex 写入新的 selectedSheetKeys 单表操作记录
```

清旧和每个写新批次分别作为独立完整提交：清旧成功后先保存；后续按本次批次逐批执行，成功一批写入并保存一批。某一批失败时停止，保留清旧结果以及此前已成功保存的批次结果，不保留失败批次的部分写入。

已有 V2 数据场景下，手动重填必须可续跑：本次重填按范围、选中表和批大小生成稳定 refill id；每个成功批次写入确定性 `batchId`。再次执行同一手动重填配置时，清旧阶段必须保留同一 refill id 下已完成批次的新 entry，并跳过这些已完成批次，只继续未完成批次。

清旧伪代码：

```ts
for messageIndex in startMessageIndex..endMessageIndex:
  frame = readV2Frame(messageIndex)
  for entry of frame.logEntries:
    const keys = deriveEntrySheetKeys(entry)
    assert(keys.length === 1)
    if (selectedSheetKeys.includes(keys[0])):
      remove entry
      continue
    entry.changedSheetKeys = deriveChangedSheetKeys(entry.operations)
    entry.filledSheetKeys = entry.filledSheetKeys.filter(key => !selectedSheetKeys.includes(key))
    entry.groupKeys = entry.groupKeys.filter(key => !selectedSheetKeys.includes(key))
  frame.logEntries = frame.logEntries.filter(entry => entry.operations.length > 0 || hasNonDataEvent(entry))
```

写新伪代码：

```ts
for [messageIndex, operations] of newOperationsByMessageIndex:
  assert(messageIndex >= startMessageIndex && messageIndex <= endMessageIndex)
  assert(entrySheetKey is within selectedSheetKeys)
  append single-table operation record into messageIndex V2 frame
  entry.changedSheetKeys = deriveChangedSheetKeys(operations)
  entry.filledSheetKeys = deriveFilledKeysForThisManualBatch(operations)
```

新单表操作记录的落点由本次手动重填实际批次决定，而不是旧单表操作记录的原始落点。

## Checkpoint 语义

checkpoint 仍是通用 V2 恢复加速机制，也可以出现在手动重填后的历史里。关键限制是：checkpoint 不能作为手动重填专用兜底，也不能被写到最新楼来掩盖范围内历史没有被正确改写的问题。

手动重填中的 checkpoint 规则：

- 当前聊天没有表格数据或没有可用 V2 基底时，复用旧手动重填逻辑生成第一个完整 full checkpoint。该 checkpoint 是后续自动填表式增量更新的 V2 基底。
- 当前聊天已有可用 V2 数据时，本次重填不新增最新楼兜底 checkpoint；结果通过删除旧单表操作记录并写入新的单表增量操作记录表达。
- 如果重填范围内原本存在 checkpoint，必须按清旧写新后的历史重建该 checkpoint，不能原样保留旧 checkpoint。
- checkpoint 不能被写到最新楼来表达已有 V2 数据场景下的手动重填最终结果。

手动重填不应该：

- 在最新楼写 full checkpoint 表达手动重填最终结果。
- 在已有 V2 数据场景，用手动专用 progress checkpoint 或最新楼 full checkpoint 表达手动重填最终结果。
- 通过 checkpoint 隐藏范围内旧单表操作记录没有被正确清理的问题。

## 回放语义

回放仍按 V2 frame 顺序执行：

1. 从最新可用 checkpoint 或初始结构开始。
2. 顺序重放 `logEntries` 中的单表操作记录。
3. 每条单表操作记录按自身 `changedSheetKeys` / 动作内容修改对应表。

手动重填完成后，不需要特殊读取逻辑。因为历史已经被改写成“清旧后的普通单表操作记录”。

## 禁止事项

- 禁止用最新楼 full checkpoint 作为手动重填结果。
- 禁止在已有可用 V2 数据场景写手动重填专用 checkpoint 作为最终结果兜底。
- 禁止在已有可用 V2 数据场景 fallback 到旧的最新楼 full checkpoint / progress checkpoint 结果路径。
- 禁止在单表操作记录缺少表归属时继续保存。
- 禁止依赖 `targetSheetKeys` 表达真实写入语义。
- 禁止通过前后快照 diff 猜单表操作记录。
- 禁止让旧记录的楼层分布约束新记录的楼层分布。
- 禁止遇到无法清理的单表操作记录时静默跳过。
- 禁止在普通写入路径中拆分本次粗粒度记录来掩盖上游生成问题。

失败就中止并报错。不要兜底。

## 代码改动范围

### 1. Operation 类型

文件：

- `src/service/table/storage-frame-v2-types.ts`

任务：

- 不为 SQL 新增专用表归属字段。
- 如果前期临时改过 `sql_batch.sheetKey`，应撤销。
- 明确文档和类型注释：SQL 回放内容仍在 `sql_batch.statements`，表归属由所在单表操作记录表达。

### 2. Operation 生成

文件：

- `src/service/table/update-orchestrator.ts`
- `src/service/table/sql-table-service.ts`
- `src/presentation/bootstrap/api-groups/sql-api.ts`
- `src/service/visualizer/visualizer-data-ops.ts`

任务：

- SQL 自动填表生成操作记录时，必须按 statement 的写入目标表分组。
- 多表 SQL batch 必须拆成多条单表 SQL 操作记录。
- 每条单表 SQL 操作记录里的 `sql_batch.statements` 只能属于同一张表。
- 如果 SQL batch 带 `params`，必须随 statement 同步分组，保持 `params[i]` 与 `statements[i]` 对齐。

### 3. 持久化校验

文件：

- `src/service/table/storage-frame-v2-persist.ts`
- `src/service/table/table-service.ts`
- `src/service/table/table-update-commit.ts`

任务：

- 从 `operations` 推导 changed sheet keys。
- 拒绝缺少表归属的操作记录。
- 不再把 `targetSheetKeys` 当作 changed keys 来源。
- 只校验本次写入的记录是否为单表操作记录。
- 本次写入如果仍是多表混合操作记录，直接失败。
- 新增批量写入单表 log entry 的 V2 持久化入口；不得通过循环调用现有单 entry `persistTableMutationLogV2_ACU` 实现。
- `runTableUpdateCommit_ACU` / `persistTablesToChatMessage_ACU` 增加明确的批量 entry persist 参数。

### 4. 历史记录归一化

文件：

- 新增：`src/service/table/storage-frame-v2-normalize.ts`
- `src/service/table/storage-v2-migration.ts`
- `src/presentation/triggers/import-process.ts`
- `src/service/import/import-executor.ts`
- `src/service/table/table-import-service.ts`
- `src/service/table/update-orchestrator.ts`

任务：

- 新增 `normalizeV2OperationLogToSingleTableRecords_ACU`。
- 在聊天数据导入后，对已有 V2 `storageFrame.logEntries` 执行归一化。
- 在手动重填开始前执行归一化，成功后再进入清旧阶段。
- 归一化只处理既有历史记录或显式修复流程，不处理普通新写入。
- 对 SQL 动作按 statement 的写入目标表分组后拆分。
- 对 SQL 动作拆分时同步拆分 `params`，保持 `params[i]` 与 `statements[i]` 对齐。
- 对 row / meta / sheet 动作按已有 `sheetKey` 拆分。

### 5. 手动重填清旧与写新

文件：

- `src/service/table/update-orchestrator.ts`
- 新增：`src/service/table/manual-refill-log-rewrite.ts`

任务：

- 无表格数据或无可用 V2 基底时，复用旧手动重填逻辑生成第一个完整 full checkpoint。
- 第一个完整 full checkpoint 生成后，后续批次按自动填表式 V2 增量写入逻辑写单表操作记录。
- 新增范围内按表清理单表操作记录的服务。
- 新增本次批次单表操作记录写回对应楼层的服务。
- 有可用 V2 数据时，先删除范围内 selectedSheetKeys 的旧单表操作记录，再按自动填表式 V2 增量写入逻辑写入新的 selectedSheetKeys 单表操作记录。
- 有可用 V2 数据且重填范围内原本存在 checkpoint 时，按清旧写新后的历史重建该 checkpoint。
- 有可用 V2 数据时，禁止用 `forceCheckpoint` 写 `manual_refill_progress_checkpoint` 或最新楼 full checkpoint 来表达手动重填最终结果。
- 清旧作为一个完整提交；后续每个写新批次作为一个完整提交，成功一轮写一轮。

### 6. UI 文案

文件：

- `src/presentation-v2/composables/useManualUpdate.ts`
- `src/presentation-v2/pages/FormFillPage.vue`

任务：

- 去掉“会写新的完整 checkpoint”的说明。
- 改为说明“会在重填范围内清理选中表旧记录，并按本次批次重写这些表的记录”。
- 手动重填时，说明系统会按自动填表同一套 V2 历史规则写入：无数据或无可用 V2 基底时先用旧手动重填逻辑生成第一个完整 full checkpoint，后续批次写普通增量；有可用 V2 数据时先删除选中表旧记录，再按本次批次写新的单表增量记录；范围内原有 checkpoint 会按改写后历史重建；不会在最新楼写完整 checkpoint 兜底。

## 临时代码改动状态

讨论过程中曾产生以下未完成代码改动，现已撤销：

- `TableSqlBatchOperationV2_ACU` 已临时增加 `sheetKey`。这个方向会改变存储结构，应撤销；表归属应由外层单表操作记录表达。
- `storage-frame-v2-persist.ts` 已临时增加 operation sheet key 校验和 changed keys 推导。应改为校验单表操作记录，而不是校验 `sql_batch.sheetKey`。
- `table-service.ts` 的首次初始化判断已临时要求 `sql_batch.sheetKey`。应撤销。
- `update-orchestrator.ts` 的 `buildSqlBatchOperationsFromText_ACU` 已临时改为返回带 `sheetKey` 的 SQL 动作。应改为生成单表操作记录或单表动作组，不改变 SQL 动作结构。

后续实施时不应恢复这些 schema 变更。正确方向是保持旧 V2 存储结构，规范单表操作记录的组织方式。

## 验收标准

### 协议层

- 所有普通写入的单表操作记录都能推导出唯一 sheet key。
- SQL 动作不新增专用表归属字段。
- 普通填表、手动填表、SQL API、可视化保存不再产生多表混合操作记录。
- SQL 自动填表可以继续使用 `sql_batch`，但每条记录里的 `sql_batch.statements` 只能属于同一张表。
- 普通写入路径不会修复或拆分本次粗粒度记录；出现本次粗粒度写入时直接失败。
- 持久化层不依赖 `targetSheetKeys` 生成 changed keys。
- 已有粗粒度 V2 记录在导入、修复或手动重填前被归一化为单表操作记录。
- 旧多表 SQL batch 会按 statement 写入目标表拆成多条单表 SQL 操作记录。

### 手动重填

- 只重填 `sheet_a` 时，范围内 `sheet_b` / `sheet_c` 的历史单表操作记录保持不变。
- 范围内所有 `sheet_a` 旧单表操作记录被清除，不管旧记录原先落在哪些楼层。
- 新 `sheet_a` 单表操作记录只写入本次手动重填实际批次对应楼层。
- 本次批次与旧批次不一致时，结果仍正确。
- 当前聊天没有表格数据或没有可用 V2 基底时，手动重填用旧逻辑生成第一个完整 full checkpoint，后续批次按各自 `saveTargetIndex` 写增量操作记录。
- 当前聊天已有可用 V2 数据时，手动重填清理范围内选中表旧记录，保留非选中表记录，并按本次批次写入新的单表增量操作记录；范围内原有 checkpoint 按改写后历史重建。
- 手动重填不在最新楼写 full checkpoint 兜底。
- 有可用 V2 数据时，手动重填不通过 progress checkpoint 或最新楼 full checkpoint 表达最终结果；范围内原有 checkpoint 必须按改写后历史重建。

### 失败行为

- 遇到无表归属操作记录，失败。
- 清旧后写新失败时，不落盘任何部分结果。
- 已有可用 V2 数据场景不允许 fallback 到最新楼 full checkpoint、progress checkpoint、data_replace、sheet_replace 或旧结果路径。

## 测试计划

### 单元测试

- `deriveChangedSheetKeys` 从操作记录推导 changed keys。
- 本次写入的多表混合操作记录持久化失败。
- 单表 SQL batch 生成一条单表 SQL 操作记录。
- 多表 SQL batch 在业务层按 statement 写入目标表拆成多条单表 SQL 操作记录。
- 粗粒度历史 SQL 记录在归一化时按 statement 写入目标表拆成多条单表 SQL 操作记录。
- 粗粒度历史 row / meta / sheet 动作按 `sheetKey` 拆成多条单表操作记录。
- 归一化保留原有必要元信息，并重新分配 `seq` / `entryId`。
- 手动重填清理范围内选中表单表操作记录，保留非选中表单表操作记录。
- 手动重填新批次落点不同于旧批次时，按新批次写入。
- 当前聊天无表格数据且从 0 开始填时，系统从 AI 1 开始计算；进入保留窗口后的第一个 `saveTargetIndex` 写首个 checkpoint，checkpoint 内容包含从 AI 1 累计到该保存点的完整表格状态；后续批次按各自 `saveTargetIndex` 写增量操作记录。
- 当前聊天已有表格数据、重填 AI 楼 900..1000 时，清理范围内选中表旧记录，保留非选中表记录，并按本次批次写入新的单表增量操作记录。

### 集成测试

- 先自动填表多轮，再手动只重填一张表。
- 导入包含粗粒度 V2 多表 SQL 记录的聊天后，先归一化，再手动只重填一张表。
- 重填前后非选中表数据和操作记录不变。
- 选中表数据来自本次重填结果。
- 刷新聊天后从操作记录回放出的最终数据正确。
- SQLite 模式和非 SQLite 模式都覆盖。

## 实施任务清单

### 0. 手动重填场景判定

- [x] 在手动重填入口明确判定当前聊天属于“无表格数据或无可用 V2 基底”还是“已有可用 V2 数据”。
- [x] 无表格数据或无可用 V2 基底时，进入旧手动重填 full checkpoint 初始化路径。
- [x] 已有可用 V2 数据时，进入“归一化、清旧、自动填表式增量写新、范围内原有 checkpoint 重建”路径。
- [x] 两条路径不得混用：已有可用 V2 数据时不得走 `manual_refill_progress_checkpoint` 最终结果路径；无可用 V2 基底时不得执行范围内 V2 log 清旧。

### 1. 单表操作记录判定

- [x] 保持 V2 存储结构不新增字段，不给 `TableSqlBatchOperationV2_ACU` 增加 `sheetKey` 或其它 SQL 专用表归属字段。
- [x] 在 `storage-frame-v2-types.ts` 中明确类型注释：SQL 回放内容仍在 `sql_batch.statements` / `sql_batch.params`，表归属由所在单表 log entry 表达。
- [x] 新增 `deriveOperationSheetKey_ACU` / `deriveLogEntrySheetKey_ACU`，从 `operations` 推导唯一 sheet key。
- [x] 校验单条 log entry 的 `changedSheetKeys` 只能包含该 sheet key。
- [x] 校验 `filledSheetKeys` / `groupKeys` / `writeSet` 不得与该单表归属冲突。
- [x] 校验外部传入的 `trackingSheetKeys` / `candidateChangedSheetKeys` / `updateGroupKeys` 不能与 `operations` 推导出的表归属冲突。
- [x] 遇到无归属、多归属、归属冲突时直接失败。
- [x] 持久化层只校验本次写入是否已经是单表操作记录，不替上游拆普通新写入。
- [x] 自动填表和手动重填中，操作记录缺失或无法归属时不得构造 `data_replace` / `sheet_replace` / full checkpoint 兜底。

### 2. SQL 单表分组

- [x] 新增 `deriveSqlStatementTargetSheetKey_ACU`，逐条识别 SQL statement 的写入目标表。
- [x] 使用现有 sheet uid/name/DDL 映射逻辑，将 SQL table name 映射到唯一 sheet key。
- [x] 新增 `groupSqlBatchOperationsBySheet_ACU`，按 sheet key 分组生成单表 `sql_batch`。
- [x] 拆分或分组时同步移动 `params[i]`，保持 `params[i]` 与 `statements[i]` 对齐。
- [x] SQL statement 无法识别唯一写入目标表时直接失败，不通过 `targetSheetKeys` 或快照 diff 猜测归属。
- [x] 无法识别目标表、无法映射 sheet key、映射不唯一时直接失败。
- [x] 每条生成后的单表 SQL 操作记录只能包含同一张表的 SQL。

### 3. DSL / row / meta / sheet 单表分组

- [x] 新增 `groupTableEditDslBySheet_ACU`，按 DSL 命令里的 table index 映射到 sheet key 后分组。
- [x] 多表 DSL text 必须拆成多条单表 DSL 操作记录，不能原样塞进一条单表 entry。
- [x] 无法解析 DSL 命令或无法映射 sheet key 时直接失败。
- [x] `row_upsert` / `row_delete` / `meta_update` / `sheet_replace` 按已有 `sheetKey` 分组。
- [x] 同一条 entry 同时包含多种动作时，按动作归属 sheet key 分组生成多条单表 entry。

### 4. 新增批量写入单表 entry 入口

- [x] 新增 `persistTableMutationLogEntriesV2_ACU`，用于一次业务提交写入多条单表 log entry；禁止通过循环调用现有单 entry `persistTableMutationLogV2_ACU` 实现。
- [x] 批量入口必须复用现有 `TableWriteTransactionContext`，并在同一个 commit lock 内完成全部 entry 写入。
- [x] 批量入口必须在内存中完成全部 entry 构造和校验后，只触发一次聊天保存。
- [x] 每条 entry 独立生成 `seq` / `entryId` / revision 信息，并按写入顺序更新 frame `headRevision`。
- [x] 任一 entry 校验失败时整批失败，不保存部分结果。
- [x] `runTableUpdateCommit_ACU` / `persistTablesToChatMessage_ACU` 增加明确的批量 entry persist 参数，不再只传单个 `operations` 数组表达一条 log entry。

### 5. 改造普通写入链路

- [x] 自动填表 SQL 写入链路按 statement 目标表分组生成多条单表 entry。
- [x] 非 SQL 自动填表链路按 DSL 命令归属生成单表 entry；结构化操作按 `sheetKey` 生成单表 entry。
- [x] SQL API 的 mutation / batch 写入生成单表 SQL entry。
- [x] 可视化编辑器保存链路按目标表分组 SQL 和 params 后生成单表 entry。
- [x] `targetSheetKeys` 只作为请求范围和越权校验字段，不作为真实写入语义来源。
- [x] 普通写入如果仍传入多表混合 entry，直接失败。

### 6. 历史 V2 归一化

- [x] 新增 `src/service/table/storage-frame-v2-normalize.ts`。
- [x] 实现 `normalizeV2OperationLogToSingleTableRecords_ACU`。
- [x] 已经是单表 entry 的记录保持不变。
- [x] 粗粒度 SQL entry 按 statement 目标表拆分，并同步拆分 `params`。
- [x] 粗粒度 DSL entry 按命令目标表拆分。
- [x] row / meta / sheet 动作按 `sheetKey` 拆分。
- [x] 拆分后的多条 entry 保留原 `source` / `targetMessageIndex` / `aiFloor` / `requestId` / `batchId` / `error` 等必要元信息。
- [x] 拆分后在同一 frame 内稳定重建 `seq`。
- [x] 拆分后重新生成唯一 `entryId`，避免多个 entry 共享旧 id。
- [x] 拆分后重建 `changedSheetKeys` / `filledSheetKeys` / `groupKeys` / `writeSet`，只保留该单表 entry 对应的 key。
- [x] 无法归属、无法拆分、无法校验时直接失败。
- [x] 归一化失败时不写 full checkpoint、`data_replace`、`sheet_replace` 或任何最终态兜底。
- [x] legacy-v1 迁移未来如果保留旧 V2 logEntries，必须在迁移后执行归一化；当前只写 full checkpoint 的迁移不拆旧日志。

### 7. 接入归一化入口

- [x] 聊天数据导入后，发现已有 V2 `storageFrame.logEntries` 时执行归一化。
- [x] 手动重填开始前执行归一化，失败则禁止进入清旧阶段。
- [x] 新增显式 repair 入口调用 `normalizeV2OperationLogToSingleTableRecords_ACU`。
- [x] 普通新写入路径不调用归一化修复本次粗粒度记录。

### 8. 手动重填清旧

- [x] 根据本次重填范围扫描 V2 frames。
- [x] 对范围内每条 entry 推导唯一 sheet key。
- [x] 删除 selectedSheetKeys 对应的旧单表 entry。
- [x] 保留非选中表 entry。
- [x] 更新保留 entry 的 `changedSheetKeys` / `filledSheetKeys` / `groupKeys` / `writeSet`。
- [x] 清旧后删除无 operation 且无非数据事件的空 entry。
- [x] 遇到无法归属 entry 时直接失败，不静默跳过。

### 9. 手动重填写新

- [x] 有可用 V2 数据时，按自动填表同一套 V2 增量写入逻辑重新执行填表。
- [x] 有可用 V2 数据时，手动重填写新不得使用 `deferPersist` + `manual_refill_progress_checkpoint` 保存最终结果，必须走普通 V2 增量持久化路径。
- [x] 新 entry 写入本次批次对应的 `saveTargetIndex`。
- [x] 新 entry 的 `targetMessageIndex` 必须落在本次重填范围内。
- [x] 不沿用旧 entry 的原始楼层分布。
- [x] 新 entry 必须全部归属 selectedSheetKeys 范围内的单表记录。
- [x] 新 entry 的 `changedSheetKeys` 从新 operations 推导，`filledSheetKeys` / `groupKeys` 按本次手动批次的实际填表范围写入。
- [x] 任一新 entry 归属不正确时直接失败。

### 10. 手动重填分阶段提交

- [x] 有可用 V2 数据时，`manual-refill-log-rewrite.ts` 在内存 clone 的 chat / isolatedData 上完成归一化和清旧，校验成功后先保存清旧结果。
- [x] 重建范围内原有 checkpoint 时，保持 checkpoint 原本所在 messageIndex，不移动到最新楼。
- [x] 重建范围内原有 checkpoint 时，从范围前最近有效 V2 基底开始，按已完成改写后的历史回放到该 checkpoint 所在楼层生成 checkpoint data。
- [x] 清旧作为一个完整提交保存，后续每个成功批次分别写入并保存。
- [x] 失败时不保存失败批次的部分结果，保留此前已成功提交的清旧和批次结果。
- [x] 写新批次失败后可续跑：同一 refill id 的已完成批次 entry 不会在下次清旧时被删除，并会跳过已完成 saveTargetIndex。
- [x] 不允许边清旧边保存未校验完成的部分清旧结果。
- [x] 不允许写新失败后保留失败批次的部分结果。

### 11. 无基底首个 full checkpoint

- [x] 无表格数据或无可用 V2 基底时，复用旧手动重填逻辑生成第一个完整 full checkpoint。
- [x] 第一个完整 full checkpoint 生成后，后续批次按自动填表式 V2 增量写入逻辑写单表操作记录。
- [x] 手动重填不在最新楼写 full checkpoint 兜底。
- [x] 有可用 V2 数据时，不新增最新楼兜底 checkpoint，不用 progress checkpoint 或最新楼 full checkpoint 表达手动重填最终结果。
- [x] 有可用 V2 数据且重填范围内原本存在 checkpoint 时，按清旧写新后的历史重建该 checkpoint。

### 12. 回放与读取

- [x] 手动重填完成后不新增专用读取逻辑，继续使用普通 V2 checkpoint + logEntries 回放。
- [x] 验证 `loadTableStateFromFramesV2_ACU` 从范围前有效 checkpoint 或首个 full checkpoint 开始，按改写后的单表 entry 顺序回放得到正确最终数据。
- [x] 验证范围内原有 checkpoint 重建后不会重新带回 selectedSheetKeys 的旧结果。

### 13. UI 文案

- [x] 删除“会写新的完整 checkpoint”说明。
- [x] 改为说明会在重填范围内清理选中表旧记录。
- [x] 说明新记录按本次批次落点写入。
- [x] 说明无数据或无可用 V2 基底时先生成第一个完整 full checkpoint，后续写增量；有可用 V2 数据时先删旧记录，再按自动填表式增量写新，范围内原有 checkpoint 会按改写后历史重建。
- [x] 说明失败时中止，不保存部分结果。

### 14. 测试与清理

- [x] 补充 SQL 单表分组、SQL params 对齐、DSL 分组、row/meta/sheet 分组测试。
- [x] 补充多表混合普通写入失败测试。
- [x] 补充 `targetSheetKeys` / tracking 信息不能补真实操作归属、与 operations 冲突时失败的测试。
- [x] 补充无法识别 SQL 写入目标表、SQL 表名无法唯一映射 sheet key 时失败的测试。
- [x] 补充历史归一化成功和失败测试。
- [x] 补充归一化保留必要元信息、重建 `seq` / `entryId` / `changedSheetKeys` / `filledSheetKeys` / `groupKeys` / `writeSet` 的测试。
- [x] 补充有可用 V2 数据时手动重填保留非选中表、删除选中表旧 entry、新 entry 按本次批次落点写入测试。
- [x] 补充清旧后空 entry 被删除、非数据事件 entry 被保留的测试。
- [x] 补充写新失败批次不保留部分结果、此前成功提交保持有效的测试。
- [x] 补充无表格数据或无可用 V2 基底时旧逻辑生成首个完整 full checkpoint，后续批次写增量的测试。
- [x] 补充有可用 V2 数据时不新增最新楼兜底 checkpoint、不用 progress checkpoint 表达最终结果的测试。
- [x] 补充有可用 V2 数据且范围内原本存在 checkpoint 时按清旧写新后历史重建 checkpoint 的测试。
- [x] 补充手动重填后刷新聊天只走普通 V2 回放、无需手动重填专用读取逻辑的测试。
- [x] 补充不写最新楼 full checkpoint 兜底测试。
- [x] 清理有可用 V2 数据场景中把 progress checkpoint 当作最终结果的代码；保留无基底场景旧逻辑生成首个完整 full checkpoint 的能力。

## 最终判断

真正需要修的是操作记录的表级可裁剪能力。无表格数据或无可用 V2 基底时，手动重填先用旧逻辑生成第一个完整 full checkpoint，再接自动填表式增量更新；已有可用 V2 数据时，手动重填应该改写范围内的单表操作记录，而不是写最新楼 checkpoint 兜底，也不是按旧记录的落点做原位替换。旧历史只用于确定清理范围，新历史落点由本次重填批次决定。

# V2 存储旧聊天自动迁移约束

## 目标

原版旧聊天和 V1 旧聊天在新版插件加载当前聊天数据库时，自动迁移到 V2 存储结构。

迁移只改变存储结构，不改变业务可见数据：迁移前旧合并链路看到什么，迁移后的 V2 checkpoint 就保存什么。

SPv7.9 升级过程中若同时检测到 legacy 与旧 V2 痕迹，不得仅因 mixed 状态让整库不可见。满足以下条件时，以可无损修复的 legacy 合并结果作为升级源，静默重建单一 V2 full checkpoint：

- legacy 来源楼层不早于 V2 full anchor；
- V2 没有合法 migration provenance；
- V2 full anchor 所在 frame 及其后续 frame 没有 operation 或 per-sheet checkpoint 等业务后继活动；
- V2 replay 不包含 legacy 候选中不存在的业务表；否则静默重建会删除 V2 专有表；
- legacy audit/repair 可以无损完成。

畸形或不完整的 V2 marker 同样属于历史证据，不能绕过 mixed 检查后清理 legacy；其 replay 不可用时必须 fail closed。被替换的旧 V2 frame 必须写入迁移审计备份。新 checkpoint、备份与 legacy 清理必须在同一个候选聊天中一次严格保存；成功后再次打开聊天只能进入 V2 replay，不得再次进入 mixed migration。

## 业务触发点

迁移只发生在一个业务时机：

> 当前聊天、当前隔离标签的数据库加载阶段。

典型链路：

```text
进入/切换聊天
→ 应用当前模板/隔离标签
→ 加载聊天数据库
→ 检测存储策略
→ legacy-v1：合并旧数据并迁移为 V2 checkpoint
→ mixed 升级残留：验证无 V2 后继活动后，以 legacy 重建 V2 checkpoint
→ v2：回放 V2 storageFrame
```

切换隔离标签不是独立业务场景，本质仍是重新加载当前聊天数据库。迁移单位是 `当前聊天 + 当前 isolationKey`。

写入阶段不承担业务迁移。如果写入时仍检测到 `legacy-v1`，说明加载迁移链路漏掉了，应直接失败；不能继续写 V1，也不能偷偷兜底迁移。

## 输入旧格式

迁移覆盖两类旧格式：

1. 原版顶层字段：
   - `TavernDB_ACU_IndependentData`
   - `TavernDB_ACU_Data`
   - `TavernDB_ACU_SummaryData`
   - `TavernDB_ACU_ModifiedKeys`
   - `TavernDB_ACU_UpdateGroupKeys`
   - `TavernDB_ACU_Identity`
2. V1 隔离槽字段：
   - `TavernDB_ACU_IsolatedData[isolationKey].independentData`
   - `TavernDB_ACU_IsolatedData[isolationKey].incrementalData`
   - `modifiedKeys`
   - `updateGroupKeys`
   - `_acu_storage_mode = checkpoint | delta | legacy`
   - `_acu_storage_version = 1`

## 输出 V2 结构

迁移写入最新 AI 楼层，形成一个 V2 full checkpoint：

```ts
{
  _acu_storage_version: 2,
  storageFrame: {
    version: 2,
    headRevision: 'checkpoint:migration:...',
    checkpoint: {
      kind: 'full',
      reason: 'migration',
      createdAt: number,
      data: mergedLegacyData,
      scheduleSummary: migratedLegacyScheduleSummary
    },
    logEntries: []
  }
}
```

迁移 checkpoint 不写 `event`。原因：迁移不是一次填表事件，不能把所有表的 `lastFilledAiFloor` 推进到迁移所在楼层。

## 不生成历史 operations

旧聊天没有真实 V2 operation 语义。迁移不得把旧快照或 V1 delta 反向猜测成：

- `sql_batch`
- `table_edit_dsl`
- `row_upsert`
- `row_delete`
- `meta_update`
- `sheet_replace`

迁移只写 full checkpoint。checkpoint 之后的新写入才必须携带真实 operations。

## scheduleSummary 迁移

迁移需要从旧消息扫描当前隔离标签的历史状态，生成 `checkpoint.scheduleSummary`，避免迁移后表状态退回未初始。

规则：

- `updateGroupKeys` 命中的表：更新 `lastFilledAiFloor`。
- `modifiedKeys` 命中的表：更新 `lastFilledAiFloor` 与 `lastChangedAiFloor`。
- `incrementalData` 命中的表：更新 `lastFilledAiFloor` 与 `lastChangedAiFloor`。
- 旧消息没有 keys 但包含表数据：按旧语义视为该楼层提供过数据，更新 `lastFilledAiFloor` 与 `lastChangedAiFloor`。

只记录迁移后数据中仍存在的 `sheet_*`，不复活当前模板/指导表已过滤掉的旧表。

## 清理旧字段

V2 checkpoint 写入成功后，必须清理当前隔离标签下的旧字段，否则 `legacy-v1 wins` 会导致下一次加载继续走旧链路。

清理规则：

- 只清理当前 `isolationKey`。
- 保留其他隔离标签的数据。
- 保留已写入的 V2 `storageFrame`。
- 顶层旧字段只在 `TavernDB_ACU_Identity` 匹配当前隔离配置时清理。
- mixed 升级收敛时，旧 V2 frame 先复制到 `migrationAuditBackup.supersededV2Frames`，再从普通 replay 路径移除。
- checkpoint、backup 与 cleanup 不能拆成多次宿主保存。

以下 mixed 状态不得静默覆盖：

- V2 anchor 比最后 legacy 来源更新；
- V2 anchor 所在 frame 或后续 frame 已包含业务日志或单表 checkpoint；
- V2 provenance 能证明它已继承 legacy 并产生了后继状态；
- legacy 修复需要用户确认或无法恢复。

## 失败语义

迁移没有兜底。

- 旧数据合并为空：失败。
- 没有 AI 目标楼层：失败。
- 写入或保存失败：失败。
- 失败时不清理旧字段。
- 写入阶段检测到 legacy-v1：失败。
- mixed 收敛严格保存失败时，必须同时恢复 legacy 与被替换的旧 V2 frame。

不允许在失败时悄悄初始化新库、继续写 V1、或通过快照 diff 猜测 operations。

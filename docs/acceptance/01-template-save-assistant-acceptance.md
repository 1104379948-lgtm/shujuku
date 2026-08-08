# 模板保存与 AI 改表助手 · 生产级验收矩阵

> 依据 `.limcode/plans/template-assistant-and-pristine-save-optimization.md` 阶段 F 建立。
> 每个条目标注验收动作与预期：**应自动归一** / **应重试** / **应要求确认** / **应零写入阻断**。
> 符号与文件为当前工作区实测位置；若符号改名或文件移动，先更新本矩阵再验收。

## 1. 协议解析层

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 1.1 | AI 输出含代码围栏/前后噪声/多标签对，取最后一个合法标签块 | 跑 parse-fallback 用例 | 提取最后一个合法 `templateAssistantDraft` 块 | 应自动归一 | `parseTemplateAssistantDraft_ACU`（service.ts:842）；tests/service/template-assistant/parse-fallback.test.ts |
| 1.2 | 顶层键缺失（protocolVersion/mode/atomic/baseFingerprint/selectedSheetKey/operations） | 协议校验 | validate 失败，记 lastFailure.kind=validate | 应重试 | `validateTemplateAssistantDraft_ACU`（service.ts:1194）；service.test.ts:145-181 |
| 1.3 | 无标签垃圾文本 | 解析 | parse 失败，lastFailure.kind=parse 且携带原文 | 应重试 | service.test.ts:653-670 |
| 1.4 | 操作名使用 type/operation/action 别名，或不在白名单内 | 编译 | 拒绝（未知 op），记 validate | 应重试 | service.ts:1235-1248（白名单 v1 8 种 / v2 11 种，`patch_sheet_content/schema/locks` 仅 v2）；service.test.ts:363-404 |
| 1.5 | v1 草稿使用仅 v2 的 operation（content/schema/locks） | 协议校验 | 拒绝（白名单按 protocolVersion 动态展开） | 应重试 | service.ts:1244；service.test.ts:163-181 |
| 1.6 | add_sheet.sourceData / patch_sheet_source_data 混入 ddl/sql/schema/createTable | 编译 | 拒绝 | 应重试 | compiler.test.ts:169-181；service.test.ts:183-222 |
| 1.7 | v1 缺 requestId | 协议校验 | 拒绝 | 应重试 | service.test.ts:170-181 |
| 1.8 | 未知表/未知列/不存在的 sheetKey | 编译 | 拒绝，不猜测 | 应零写入阻断 | compiler.ts:assertPatchTargetsCurrentSheet_ACU:165-175；compiler.test.ts:465-481 |
| 1.9 | 重复表头 / 表名 canonical 冲突 / row_id 作业务表头 | 编译 | 拒绝 | 应零写入阻断 | compiler.test.ts:126-167 |

## 2. 低风险操作（应低阻力通过）

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 2.1 | 只改 updateFrequency（更新频率） | 编译 | 唯一 `patch_sheet_update_config`，不混入 content/schema/sourceData | — | compiler.ts:buildDefaultUpdateConfig_ACU:213-223；compiler.test.ts:221-240 |
| 2.2 | 只改 contextDepth/batchSize/sendLatestRows | 编译 | 同 2.1 | — | compiler.test.ts:221-240 |
| 2.3 | 只改 Note（sourceData.note） | 编译 | 唯一 `patch_sheet_source_data` | — | compiler.ts:buildDefaultSourceData_ACU:225-256 |
| 2.4 | 单元格更新 / 增行 / 删行 | 编译 | `patch_sheet_content`（updateCells/addRows/deleteRows，1-based rowNumber） | 应自动归一 | compiler.ts:applySheetContentPatch_ACU:396-474；compiler.test.ts:266-292 |
| 2.5 | 只改 exportConfig（导出/索引开关） | 编译 | `patch_sheet_export_config`，默认值完整 | — | compiler.test.ts:242-252 |
| 2.6 | 只改全局注入配置 | 编译 | `patch_global_injection_config` | — | compiler.test.ts:254-264 |
| 2.7 | 只改锁（行/列/单元格） | 编译 | `patch_sheet_locks` → lockChanges | — | compiler.test.ts:436-463 |
| 2.8 | v2 跨表 patch（焦点表之外的 sheetKey） | 编译 | 允许（v2 契约） | — | compiler.test.ts:230-240；service.test.ts:283-300 |

## 3. schema 操作（显示表头 vs 物理列分离）

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 3.1 | 只改中文显示表头 | 编译 | `renameColumns`（from→to），**不输出 `headers`**；本地同步既有 DDL 注释 | — | compiler.ts:applySheetSchemaPatch_ACU renameColumns 分支:502-526；compiler.test.ts:294-380 |
| 3.2 | 增列（addColumns） | 编译 | 合法，非破坏性 | — | compiler.ts:548-564 |
| 3.3 | 删列（deleteColumns） | 编译 | 合法但标记高风险 | 应要求确认 | compiler.ts:528-546；compiler.test.ts:294-322 |
| 3.4 | 列顺序变化（move_sheet / schema） | 编译 | 合法，diff 记录 movedSheets | — | compiler.ts:moveSheetAroundAnchor_ACU:315-337 |
| 3.5 | DDL 物理列名与中文表头映射（英文物理列名 + `-- 中文表头` 注释） | 编译 | 合法；**中文物理列名拒绝** | 应零写入阻断 | compiler.ts:validateDdlAgainstHeaders_ACU:377-379；compiler.test.ts:324-434 |
| 3.6 | row_id INTEGER PRIMARY KEY 缺失/顺序错 | 编译 | 拒绝 | 应零写入阻断 | compiler.test.ts:155-167 |

## 4. 高风险操作（应要求确认 / 应零写入阻断）

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 4.1 | 物理列迁移（physicalColumnMappings） | 编译+preflight | 需 `migrationIntent` 完整；preflight 通过才可应用 | 应要求确认 | compiler.test.ts:356-380；service.test.ts:406-448 |
| 4.2 | 类型变更（conversions） | 编译+preflight | 需 identity/stringify/integer_strict/real_strict | 应要求确认 | service.test.ts:227-239 |
| 4.3 | 删除列 / 破坏性变更 | preflight | 需 `destructiveChangeConfirmed` | 应要求确认 | service.test.ts:227-239 |
| 4.4 | 有损转换 | preflight | 需 `lossyConversionConfirmed` | 应要求确认 | service.test.ts:227-239 |
| 4.5 | 畸形 migrationIntent（缺字段） | preflight | **不接受快路径**，拒绝 | 应零写入阻断 | service.test.ts:262-281 |
| 4.6 | schema/DDL 高风险项 | UI | 确认前 `canApplyTurn=false` | 应要求确认 | useVisualizerAssistant.test.ts:266-289 |
| 4.7 | 跨表变更派生高风险确认 | UI | 确认前不能应用 | 应要求确认 | useVisualizerAssistant.test.ts:291-331 |

## 5. 空表模板保存（P0 核心）

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 5.1 | 空表仅改 updateFrequency | 降级预检 | `template_only_root` 降级成功、**零 full checkpoint** | 应自动归一 | `demoteTemplateOnlyRootToScopeOnly_ACU` + `diffHeaderOnlyReplayStructures_ACU`（storage-frame-v2-persist.ts）；storage-frame-v2-persist.test.ts:4760+；pristine-template-commit.integration.test.ts |
| 5.2 | 仅 mate.updateConfigUiSentinel / sourceData.note 不同 | 降级预检 | 降级成功（非结构配置排除） | 应自动归一 | storage-frame-v2-persist.test.ts |
| 5.3 | 仅 exportConfig / contextDepth / batchSize / groupId 不同 | 降级预检 | 不误阻断 | 应自动归一 | 同 5.1 |
| 5.4 | 表头列改名 | 降级预检 | 拒绝降级，reason 含 `sheet_a.headerChanged`，零写入 | 应零写入阻断 | storage-frame-v2-persist.test.ts |
| 5.5 | 模板 DDL 对 sheet 删列 | 降级预检 | 拒绝，root 保留 | 应零写入阻断 | pristine-template-commit.integration.test.ts |
| 5.6 | 真实数据行存在 / 多 full checkpoint / 后缀 artifact | 降级预检 | 保持既有 fail-closed | 应零写入阻断 | pristine-template-commit.integration.test.ts |
| 5.7 | 保存失败时 saveChatStrict 不写入，原 frame/recovery backup 不损坏 | 保存 | 零写入 + backup 保留 | 应零写入阻断 | pristine-template-commit.integration.test.ts |

## 6. V2 存储与回放

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 6.1 | template-only root 清理 | 保存 | 旧 header-only full checkpoint 被移除 | — | pristine-template-commit.integration.test.ts |
| 6.2 | 真实数据 root 保留 | 保存 | 有业务数据不降级 | — | pristine-template-commit.integration.test.ts |
| 6.3 | 后缀 artifact / 多 root / legacy 漂移 | 回放 | 既有 fail-closed 不变 | 应零写入阻断 | pristine-template-commit.integration.test.ts |
| 6.4 | recovery backup 在拒绝时保留 | 回放 | 拒绝写入时 backup 可恢复 | 应零写入阻断 | pristine-template-commit.integration.test.ts |

## 7. AI 失败分类与重试

| # | 场景 | 验收动作 | 预期 | 自动归一 | 测试/代码锚点 |
|---|------|---------|------|:---:|--------------|
| 7.1 | parse 失败 | 会话 | lastFailure.kind=parse，携带原文 | 应重试 | service.test.ts:653-670 |
| 7.2 | validate 失败 | 会话 | lastFailure.kind=validate | 应重试 | service.test.ts:145-181, 627-651 |
| 7.3 | fingerprint 失败 | 会话 | lastFailure.kind=fingerprint | 应重试 | service.test.ts:320-323（结构级 fingerprint 稳定） |
| 7.4 | preflight 失败 | 会话 | lastFailure.kind=preflight | 应重试 | service.test.ts:672-690 |
| 7.5 | 环境失败（SqliteRuntimeUnavailableError_ACU） | 会话 | **不重试、不消耗 repairRetries、不回喂 AI** | — | service.test.ts:550-577 |
| 7.6 | repair 重试耗尽 | 会话 | 透出结构化 lastFailure（分类+原文） | — | service.test.ts:627-651 |
| 7.7 | `operations=[]` 且用户要求修改 | UI | stopReason=empty_operations → “AI 未生成任何修改（可继续重试）”，可一键重新生成，不伪装成功 | — | useVisualizerAssistant.ts:368-376, 778-786；use-visualizer-assistant.test.ts:624-676 |
| 7.8 | repair prompt 只修失败 operation | 会话 | 二次请求不再重生成整份草稿 | 应自动归一 | service.ts:buildSessionRoundUserRequest_ACU（repair 分支） |

## 8. 真实宿主手工验收（阶段 G，需人工）

| # | 场景 | 验收动作 | 预期 | 备注 |
|---|------|---------|------|------|
| 8.1 | 空表加载 → 只改 updateFrequency → 保存本地模板 | 3 次 | 成功、无伪 full checkpoint | 记录保存前后 checkpoint 列表 |
| 8.2 | 已有数据保存 | 3 次 | 成功、数据完整 | 记录保存/重载/回放状态一致 |
| 8.3 | AI 只改更新频率 | 3 次 | 唯一 patch_sheet_update_config | 记录 AI 原始输出与编译结果 |
| 8.4 | AI 只改中文显示表头 | 3 次 | renameColumns，DDL 注释同步 | 记录 AI 原始输出与编译结果 |
| 8.5 | AI 改 DDL / 物理迁移 | 3 次 | 走 schema preflight + migrationIntent，需确认 | 记录确认流 |
| 8.6 | 刷新/重载/回放后状态一致 | 3 次 | V2 replay 后结构与数据一致 | 记录前后 fingerprint |

## 9. 门禁执行记录（阶段 G）

- [ ] `pnpm vitest run`（全量，基线 6241 passed / 28 skipped @ C/D/E 后）
- [ ] `pnpm typecheck`（tsc --noEmit）
- [ ] `pnpm build`（rollup 构建，产物核对）
- [ ] 文档漂移守护：`docs/自定义表建表指南.md:168-176` 操作对照表逐项 vs `service.ts:1235-1245` 白名单核对（已人工核对一致：update_config/source_data/content/schema/renameColumns/addColumns/deleteColumns/ddl/migrationIntent/locks/global_injection 全在 v2 白名单内，无 `<tableEdit>`）
- [ ] 真实宿主空表保存 ≥3 次（矩阵 8.1，人工）
- [ ] 真实宿主已有数据保存 ≥3 次（矩阵 8.2，人工）
- [ ] 真实宿主 AI 改频率/改表头/改 DDL 各 ≥3 次（矩阵 8.3-8.5，人工）
- [ ] 回滚证据冻结：`git diff` 快照已存 `docs/acceptance/01-source-diff-freeze-before-g.md`（10 文件 +952/-697），回滚 = `git checkout -- <src>` + 恢复 backups
- [ ] 发布与回滚证据冻结（源码 diff + 产物 diff，不自动发布）

## 10. 已评估的暂缓项（不阻塞 P0/P1 验收）

| 项 | 结论 | 依据 |
|----|------|------|
| C.7 参考文档注入裁剪 | 暂缓：默认提示词明确声明“两份文档原文分块嵌入”是设计意图，AI 需要内置表名/ORM/条件语法参考生成合法 sourceData；全量注入是字节级兼容行为，核心协议卡已承担“短路由表”职责。硬裁剪会破坏默认路径兼容且使 AI 失去模板语法参考，风险大于收益。 | service.ts:1307（默认提示词声明）；reference-docs.ts:9-387（8 个 chunk 均为模板语法/内置表参考） |
| D.3 maxRepairRetries=2 | 保持 1：改 2 增加 API 成本无明确收益，成功率提升证据不足；计划要求“以 API 成本、延迟和成功率为验收依据”，当前无线上成功率基线。 | service.ts:DEFAULT_TEMPLATE_ASSISTANT_MAX_REPAIR_RETRIES_ACU=1 |
| D.4 意图判别字段（无修改 vs 未生成修改） | 已在 UI 层用 stopReason=empty_operations 文案区分并允许重试；服务层未新增判别字段，避免破坏 canApply 语义与存量结果结构。 | useVisualizerAssistant.ts:368-376, 778-786；use-visualizer-assistant.test.ts:624-676 |
| D.5 失败面板展示阶段/字段/建议 | 已具备“查看 AI 原始输出”disclosure + lastFailure（kind/message/rawText）透出；未新增逐字段高亮（阶段/字段/建议已在 lastFailure.message 中由服务端结构化，UI 透出）。 | VisualizerAssistantPanel.vue:93-102；useVisualizerAssistant.ts:378-382 |

## 11. 遗留提示（需用户决策）

1. `.acu-old-uva.txt`（500 行）是 D 阶段前旧版 useVisualizerAssistant 源码备份，非本计划产物，未删除；确认后可由用户删除或归档。
2. `scripts/check-backup-hash.ps1` 用于比对 `backups/index.js` 与 `backups/index.baseline.js` 的 SHA256（回滚证据校验），保留。
3. 真实宿主手工验收（矩阵 8.x）需在 SillyTavern 环境执行，本工作区无法代替；执行后回填 9.x 勾选与截图/指纹证据。

# World 资产证据记录

本文只记录可审计事实，不把静态验证等同于运行时验收。

## 已生成产物

- `dist/world-database-template.json`
- `dist/world-script-package.json`

## 维护源文件

- `world-template.js`
- `world-scripts.js`
- `index.js`
- `export-assets.mjs`
- `verify-assets.mjs`

## 已执行命令

```bash
node "world-engine-database-native-design/export-assets.mjs"
node "world-engine-database-native-design/verify-assets.mjs"
```

输出：

```text
World assets exported to world-engine-database-native-design/dist/.
World assets verified.
World exported assets verified.
```

## 文件哈希

```text
785848fed28f3ec26960773f70fcfc022cc3c6814586fa6c9b2321ec0e346932  world-engine-database-native-design/dist/world-database-template.json
766b0f6a65fa4507a52a7826e95a63fd4313468ed2d7d36c7304c99e2e831a97  world-engine-database-native-design/dist/world-script-package.json
110375b6982271b70b9c1b2daab571fc8eb64dcc58587e027cc37d5def9db527  world-engine-database-native-design/world-template.js
6addd98d9b1aafb768913ec99bad26b5044d38ac151e50a7f0fe09e38593b76b  world-engine-database-native-design/world-scripts.js
22fc30bfd49bc63b3ff46c1704d56a65065e3e8ce55c44288c73b0c39da7618b  world-engine-database-native-design/verify-assets.mjs
```

## 静态验证脚本断言

`verify-assets.mjs` 中写有以下断言；是否充分由审查者自行复核：

- 模板包含 `mate`。
- 模板保留默认表，且默认表 UID、表名、DDL、导出配置、orderNo 未被改写。
- 模板追加 16 张 `we_*` 表。
- 每张 World 表 DDL 第一列包含 `row_id INTEGER PRIMARY KEY, -- 行号`。
- World 表 DDL 包含字段注释。
- 后台表 `updateConfig` 为禁用常规填表值。
- 除 `we_world_digest` 外，后台表默认不导出。
- `we_world_digest` 导出配置启用，注入模板为 `<world_state>\n$1\n</world_state>`。
- 脚本包格式为 `acu_user_script_v1`。
- 脚本包包含 8 个脚本：初始化器、推演器、摘要器、世界书读取器、机制执行器、同步器、预设生成器、恢复器。
- 脚本定义包含名称、描述、源码、scope、bindings、默认变量、超时和 order。
- 脚本源码不直接依赖 `window.`。
- 脚本源码未包含明显硬编码 API key。
- 推演器源码包含 requestId、失败 ledger、strictMode、模型输出校验、targetSheetKeys、跳过逻辑、checkpoint、API 覆盖、世界书策略、重要角色表兼容。
- 摘要器源码包含 hidden_digest 和 refreshDataAndWorldbook，且不读取黑盒全文作为摘要。
- 世界书读取器源码包含本轮 AI 回复、主角状态，不直接查询 `we_blackbox`。
- 机制执行器源码包含风声衰减、区域事件持续/冷却、生命周期过期、黑盒暴露状态处理。
- 同步器源码包含 `quests_events` 回流，且不插入 `chronicle` 或 `options`。
- 恢复器源码包含 emergency checkpoint 和 refreshDataAndWorldbook。
- 导出的两个 JSON 文件可解析，且格式字段符合预期。
- 初始化器包含 `generateWorldId` 稳定生成规则：优先显式配置，其次当前聊天标识哈希 `world_chat_*`，缺失时生成可追踪本地 ID `world_local_*`。
- 初始化器在 `we_meta.world_id` 为空或可判定为跨聊天旧默认值时按当前聊天刷新，并向 `we_ledger` 写入 `world_id_refresh` 诊断，诊断只记录 `chatIdentityHash` 而不保存聊天标识明文。
- 推演器包含降级消息去重 `message_id_degraded`、prompt 模板回退 `prompt_template_fallback`、严格 JSON 解析、无有效字段失败、禁用模块 warning、跨模块传导跳过记录、`merge_strategy` 合并、strictMode checkpoint 回滚和 debugMode prompt digest。
- 世界书读取器支持 `none/current/selected` 策略，`selected` 缺少公开选择参数时降级，并只读取接近暴露黑盒的非敏感关键词。
- 摘要器按事件、风声、势力、声誉、经济、仇敌、区域事件设置查询上限，并对可见摘要做总长度裁剪。
- 机制执行器包含 Dice、Stage、Lifecycle、黑盒暴露痕迹条件和 `mechanics_preview` 诊断。
- 同步器通过 `PRAGMA table_info` 动态遵守默认表字段，只在公开/曝光且有证据时回流任务事件、重要角色、地点和黑盒曝光。
- 预设生成器支持正式世界书链路、模块数量策略、JSON 配置字段校验和内置字段冲突校验。
- 恢复器使用 `buildWorldSnapshot` 和 `validateWorldSnapshot`，恢复失败时尝试回滚 emergency checkpoint 并写失败 ledger。
- mutation helper 会在 SQL 失败时记录 `sqlName`、`targetSheetKeys` 和错误，不记录完整敏感 prompt。
- 已修复 `buildWorldSnapshot()` 自递归问题；当前实现直接查询 `we_meta`、最近 10 条 `we_world_digest`、启用模块状态表和 `we_custom_state`，并通过 `restoreWorldSnapshotRows()` 统一恢复逻辑。
- `verify-assets.mjs` 已增加防回归断言：`buildWorldSnapshot` 函数体不得包含 `buildWorldSnapshot()` 自调用，且必须包含最近摘要、`we_custom_state` 和启用模块状态表查询。
- 机制执行已抽为共享 `runWorldMechanics(round, source)`，推演器通过 `runWorldMechanics(round, 'evolver')` 调用，机制脚本通过 `runWorldMechanics(round, 'mechanics_script')` 调用；包含 Dice 条件、Stage 字段/状态/终局配置、Lifecycle 过期/终局/status/数量上限清理和 `mechanics_preview` 诊断。
- 同步器在 `strictMode` 下写 `before_synchronizer` checkpoint，回流失败时通过 `restoreWorldSnapshotFromCheckpoint(..., 'synchronizer_failed')` 回滚，宽松模式记录失败 ledger 后返回。
- `verify-assets.mjs` 已使用 `sql.js` 对每张 `we_*` 表 DDL 执行 SQLite 建表校验。
- `we_world_digest.exportConfig` 静态验证覆盖：启用导出、constant entry、system depth placement、`<world_state>\n$1\n</world_state>` 注入模板、后台明细表禁用导出。
- 恢复逻辑 `restoreWorldSnapshotRows()` 已改为优先调用公开 `ctx.api.executeSqlBatch(..., { targetSheetKeys, skipNotify: true })` 执行多语句恢复；无 batch API 时才回退逐条参数化 mutation。
- 机制复用证据已加强：`previewWorldMechanics()` 被摘要器写入 `hidden_digest`，并被恢复器写入恢复 ledger；`runWorldMechanics()` 仍由推演器和机制脚本共享调用。
- `verify-assets.mjs` 已显式断言 `we_world_digest` 是正文注入表、导出配置启用、注入模板和 system depth placement 符合表格世界书链路要求。

## 未验证范围

以下内容没有在真实 shujuku/酒馆运行环境执行过，不能标记为通过：

- `importTemplateFromData` 实际导入 `dist/world-database-template.json` 后建表成功。
- `importUserScripts` 实际导入 `dist/world-script-package.json` 后脚本注册成功。
- `chat.loaded` / `db.loaded` 实际触发初始化器。
- 初始化器实际写入 `we_meta`、`we_modules`、`we_prompt_templates`、`we_reputation`、`we_world_digest`。
- `main_reply.after_response` 实际触发推演器。
- `ctx.api.callAI` 实际调用并返回可解析 JSON。
- `ctx.api.renderWorldbookForPrompt` 实际根据扫描文本命中世界书。
- `executeSqlMutation` / `executeSqlBatch` 在宿主环境实际写库成功。
- `we_world_digest` 实际刷新并通过表格世界书链路注入正文。
- 禁用 World 后实际跳过推演。
- 重复消息实际跳过推演。
- API 失败或 JSON 失败时实际不破坏已有世界状态。
- checkpoint 实际恢复并可重推演。
- free/mixed 自定义模块在真实聊天中工作。

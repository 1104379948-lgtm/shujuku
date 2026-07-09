# World 数据库原生完整实现任务清单

来源设计：`docs/world-engine-database-native-design.md`

目标：把 World 的非 UI 能力完整落地为 `shujuku` 可导入、可运行、可测试、可诊断的数据库原生实现。实施口径是完整实现，不按“第一阶段/第二阶段”拆最小版本；所有任务都以最终交付可用为标准。

执行规则：必须按本文档顺序推进。未完成前置确认时，不继续实现后续资产；每完成一项立即勾选，不能先做后面的任务再回头补记录。

验收规则：本目录 `verify-assets.mjs` 只能证明静态资产结构、脚本包格式和源码约束；凡涉及真实导入、挂载点触发、AI 调用、SQLite 写库、世界书刷新、checkpoint 恢复的项目，必须在实际 shujuku/酒馆运行环境完成后才能勾选。

证据规则：所有已勾选项必须能在 `EVIDENCE.md`、维护源文件、生成产物或真实运行记录中找到证据。没有证据的勾选视为无效。

## 0. 实施边界确认

- [x] 确认实现必须保留当前默认 8 张业务表和 `mate` 元数据，World 表只能追加，不能替换默认表。
- [x] 确认所有 `we_*` 后台状态表只由 World 脚本维护，常规填表 AI 不写入。
- [x] 确认 `we_world_digest` 是默认唯一导出到世界书的 World 表。
- [x] 确认推演模型调用默认使用用户已有主 API/剧情推进 API，只允许通过 `we_meta.api_preset_override` 可选覆盖。
- [x] 确认交付物不创建必需的 World 专用 API 预设，也不修改用户现有 API 配置。
- [x] 确认脚本只调用公开 `ctx.api`、`ctx.tavern`、`ctx.log`、`ctx.event`、`ctx.config`、`ctx.variables`，不依赖未公开内部变量。
- [x] 确认 World 推演不直接写 `chronicle` 和 `options`，避免与默认填表链路抢写。
- [x] 确认私密行为和未传播信息必须进入 `we_blackbox` 或保持隐藏，不能直接改变公开声誉、风声或正文注入。
- [x] 确认实现不复刻 `reference/World` 的 UI、按钮、SVG、内部函数名或存储 key，只实现非 UI 后台能力。
- [x] 确认所有 World 数据随聊天表格数据隔离，不使用全局共享状态保存单个聊天的后台世界。

## 1. 公开能力与资产格式确认

- [x] 确认可复用当前默认表模板对象作为 World 模板基底，不复制或替换默认表。
- [x] 确认可通过现有 `importTemplateFromData(templateData, { scope: 'chat', presetName: 'World数据库模板' })` 导入模板资产。
- [x] 确认表格资产需要包含 sheet key、orderNo、DDL 注释、Note、Init、Insert、Update、Delete、updateConfig、exportConfig。
- [x] 确认 `we_world_digest` 的表格导出世界书配置字段名和注入位置写法。
- [x] 确认脚本包导入格式为现有 `acu_user_script_v1`，不新增插件内置脚本机制。
- [x] 确认脚本只使用公开 API：`querySql`、`executeSqlMutation`、`executeSqlBatch`、`insertRow`、`callAI`、`renderWorldbookForPrompt`、`refreshDataAndWorldbook`。
- [x] 确认脚本挂载点名称使用现有公开挂载点：`chat.loaded`、`db.loaded`、`main_reply.after_response`、`plot_worldbook.before_render`、`table_fill_worldbook.before_render`。
- [x] 确认模板变量能力 `{[script ...]}`、`{[sql "..."]}`、`{[db...]}`、`<if>` 只作为用户可选用法，不要求改插件解析器。
- [x] 确认 `we_meta.world_id` 和 `last_message_id` 只能从脚本运行上下文或公开事件字段中取值，不能依赖内部变量。
- [x] 确认验证方式使用本目录内的资产验证脚本，不要求改项目主测试配置。

## 2. World 表格模板完整实现

- [x] 新建或扩展 World 数据库模板构建入口，确保以 `buildDefaultTableTemplateObject_ACU()` 结果为基底追加 World 表。
- [x] 为 `we_meta` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_modules` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_prompt_templates` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_world_digest` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和导出世界书配置。
- [x] 为 `we_events` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_factions` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_winds` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_reputation` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_economy` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_enemies` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_influence_chain` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_blackbox` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_regional_incident` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_custom_state` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_ledger` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 为 `we_checkpoints` 实现 sheet 定义、DDL、Note、Init、Insert、Update、Delete、orderNo 和后台表更新配置。
- [x] 确保所有 `we_*` DDL 第一列统一为 `row_id INTEGER PRIMARY KEY, -- 行号`。
- [x] 确保所有新增表表名、列名使用英文，中文含义写在 SQL 注释中。
- [x] 确保所有后台表 `updateConfig.uiSentinel/contextDepth/updateFrequency/batchSize/skipFloors` 均为 `-1`。
- [x] 确保所有后台明细表 `exportConfig.enabled=false`、`preventRecursion=true`、`injectIntoWorldbook=false` 或等价禁用。
- [x] 确保所有后台明细表 `exportConfig.splitByRow=false`、`extraIndexEnabled=false`、`injectionTemplate=""` 或项目等价字段已显式禁用。
- [x] 确保 `we_world_digest.exportConfig.enabled=true` 且 `injectionTemplate` 使用 `<world_state>\n$1\n</world_state>`。
- [x] 确保 `we_world_digest.exportConfig.entryName="World后台摘要"`、`entryType="constant"`、`splitByRow=false`、`preventRecursion=true`、`extraIndexEnabled=false`。
- [x] 确保 `we_world_digest` 注入位置为 system depth，并沿用当前项目兼容的 entry placement 字段。
- [x] 确保所有 `we_*` 表的 Note/Init/Insert/Update/Delete 含有“World后台表，本表仅供 World 脚本维护，常规填表AI禁止插入、更新、删除”的约束说明。
- [x] 确保 World 表 orderNo 从 100 起，且不打乱默认表顺序。
- [x] 确保新增 sheet key 命名稳定，例如 `sheet_we_meta` 到 `sheet_we_checkpoints`。
- [x] 确保模板导入后默认表 UID、表名、DDL、Note、导出配置和 orderNo 不被改写。

## 3. 初始化数据完整实现

- [x] 为 `we_meta` 提供默认单行：`world_id`、`mode='classic'`、`active_preset='default'`、`round=0`、`enabled='是'`、`evolve_every=1`。
- [x] 为 `we_meta.world_id` 设计稳定默认值生成规则，优先使用当前聊天标识，缺失时使用可追踪的本地生成 ID。
- [x] 为 `we_modules` 提供 classic 内置模块描述符：世界运转、事件链、势力、风声、影响链、主动接触/信息传播规则、声誉、经济、仇敌录、区域突发事件、信息黑盒、天下大势。
- [x] 为每个 classic 模块提供 `module_id`、`module_name`、`kind`、`enabled`、`container`、`state_table`、`item_key`、`rules`、`output_contract`、`mechanics_json`、`display_json`、`lifecycle_json`、`merge_strategy`。
- [x] 为 `we_prompt_templates` 提供 `default` 模板，包含 system prompt、user prompt 模板、output contract JSON、final directive、worldbook_strategy、context_turns。
- [x] 为 `we_prompt_templates.default.output_contract_json` 提供完整顶层 schema，覆盖 `world_digest`、`events`、`factions`、`winds`、`reputation`、`economy`、`enemies`、`influence_chain`、`blackbox`、`regional_incident`、`custom`。
- [x] 为默认 prompt 明确“只输出本轮发生变化的记录”“只输出启用模块”“严格 JSON、无自由文本”的要求。
- [x] 为 `we_reputation` 提供默认声誉轴，覆盖市井、势力、法律/秩序或项目约定的基础维度。
- [x] 为 `we_world_digest` 提供第 0 轮摘要，内容说明 World 后台已启用且没有公开事件。
- [x] 确保所有初始化 JSON 字段是合法 JSON 字符串。
- [x] 确保所有初始化数据可重复导入或由初始化器幂等补齐。
- [x] 确保初始化数据不包含具体世界观硬编码，只包含通用规则和空状态。

## 4. 模板资产交付

- [x] 在 `world-engine-database-native-design/` 内提供 `World数据库模板` 生成器或 JSON 资产。
- [x] 提供可直接传给 `importTemplateFromData(templateData, { scope: 'chat', presetName: 'World数据库模板' })` 的数据结构。
- [x] 确保聊天级导入依赖现有导入 API，不新增 UI、不新增插件内部模板注册。
- [x] 确保模板资产包含默认表和新增 World 表。
- [x] 确保重复导入同名模板的行为交给现有模板系统处理。

## 5. World 脚本包资产结构

- [x] 设计脚本包在本目录中的存放位置、构建方式和导入格式。
- [x] 实现 `World 初始化器` 脚本资产，绑定 `chat.loaded` 和 `db.loaded`。
- [x] 实现 `World 推演器` 脚本资产，绑定 `main_reply.after_response`。
- [x] 实现 `World 摘要器` 脚本资产，可被推演器调用并支持手动运行。
- [x] 实现 `World 世界书读取器` 脚本资产，支持被推演器调用，并可绑定世界书 before_render 挂载点。
- [x] 实现 `World 机制执行器` 脚本资产，作为库脚本或可复用函数集合。
- [x] 实现 `World 预设生成器` 脚本资产，支持从世界书/角色信息生成模块描述符。
- [x] 实现 `World 恢复器` 脚本资产，支持按 checkpoint 恢复和重推演准备。
- [x] 为每个脚本提供名称、描述、默认输入 JSON、绑定 config JSON、推荐挂载点和启用状态。
- [x] 确保脚本包可通过现有 `ctx.api.importUserScripts` 或脚本导入 UI 一次性导入。
- [x] 确保脚本包导入不会覆盖用户同名脚本，或提供明确冲突处理策略。

## 6. World 初始化器

- [x] 检查 World 所需表是否存在，缺失时提示导入 World 数据库模板。
- [x] 检查 `we_meta` 是否存在默认行，缺失时插入。
- [x] 检查 `we_modules` 是否包含 classic 模块描述符，缺失时补齐。
- [x] 检查 `we_prompt_templates` 是否包含 `default` 模板，缺失时补齐。
- [x] 检查 `we_reputation` 默认声誉轴，缺失时补齐。
- [x] 检查 `we_world_digest` 第 0 轮摘要，缺失时补齐。
- [x] 检查 `we_meta.world_id` 是否为空或跨聊天重复，必要时按当前聊天重新生成并记录诊断。
- [x] 根据 `we_meta.mode`、模块开关和 `active_preset` 生成运行配置缓存。
- [x] 清理或标记孤儿 `we_custom_state` 行，避免已禁用模块继续参与推演。
- [x] 初始化时不调用 AI，不修改默认前台表。
- [x] 初始化操作幂等，多次运行不会重复插入唯一键冲突数据。
- [x] 初始化错误写入 `we_meta.last_error` 并通过 `ctx.log` 输出。

## 7. World 推演器主流程

- [x] 从 `we_meta` 读取 `enabled`、`evolve_every`、`round`、`last_message_id`、`api_preset_override`。
- [x] 从挂载点上下文读取本轮 message id 或可稳定去重的消息标识。
- [x] 在没有稳定 message id 时使用楼层、响应哈希和时间窗口组合去重，并把降级策略写入 ledger。
- [x] 在 `enabled='否'` 时写 `we_ledger.status='skipped'` 或静默跳过，行为需一致。
- [x] 在不满足 `evolve_every` 时跳过且不改变世界状态。
- [x] 在 `last_message_id` 已处理当前消息时跳过，避免重复推演。
- [x] 推演前调用快照逻辑写入 `we_checkpoints`。
- [x] 推演开始写入 `we_ledger.status='running'`。
- [x] 读取默认前台表：`global_state`、`protagonist_info`、重要角色表、`protagonist_skills`、`inventory`、`quests_events`、`chronicle`。
- [x] 自动兼容重要角色表名 `important_non_romance` 和 `important_characters`。
- [x] 读取 World 后台表：`we_meta`、`we_modules`、`we_events`、`we_factions`、`we_winds`、`we_reputation`、`we_economy`、`we_enemies`、`we_influence_chain`、`we_blackbox`、`we_regional_incident`、`we_custom_state`。
- [x] 读取启用 prompt 模板，优先 `we_meta.active_preset`，缺失时回退 `default` 并记录警告。
- [x] 按 `we_prompt_templates.worldbook_strategy` 执行世界书策略：`none` 不读取、`current` 使用当前正式链路、`selected` 使用公开选项限定范围。
- [x] 获取最近正文上下文，使用模板中的 `context_turns`。
- [x] 构造世界书扫描文本，包含本轮 AI 回复、最近剧情、时间地点、纪要、任务、后台事件、势力、风声和区域事件。
- [x] 仅在 `worldbook_strategy` 不是 `none` 时调用 `ctx.api.renderWorldbookForPrompt(scanText, options?)`，只传扫描文本和公开选项，不自行匹配世界书条目。
- [x] 从 `we_prompt_templates` 和 `we_modules.rules` 提取短额外关键词加入扫描文本，但不得加入完整 prompt 或完整规则库。
- [x] 执行本地确定性机制：风声衰减、生命周期清理、冷却扣减、阶段进度、区域骰子。
- [x] 组装 World 推演 prompt，替换 `{{world_state}}`、`{{default_tables}}`、`{{recent_story}}`、`{{worldbook}}`、`{{module_rules}}`、`{{output_contract}}`。
- [x] 调用 `ctx.api.callAI(messages, options)`，仅当 `api_preset_override` 非空时传入 `presetName`。
- [x] 解析严格 JSON，拒绝自由文本包裹或提供稳健 JSON 提取策略并记录警告。
- [x] 校验输出只包含启用模块。
- [x] 校验模型输出只包含本轮变化；若输出完整状态快照，按 merge_strategy 处理或拒绝并记录。
- [x] 校验所有数组记录包含主键字段。
- [x] 校验枚举字段符合 DDL CHECK 约束。
- [x] 校验数值字段范围，例如 progress、intensity、severity、exposure_risk。
- [x] 校验私密行为因果链：无目击者/痕迹时不得进入公开风声、声誉或势力态度。
- [x] 校验声誉变化必须引用公开事件、风声或证据。
- [x] 校验势力行动必须基于目标、资源、已知信息或利益。
- [x] 校验仇敌追踪必须有信息来源。
- [x] 校验经济变化必须有原因和范围。
- [x] 校验跨模块传导必须写入 `we_influence_chain` 或记录跳过原因。
- [x] 合并模型输出前先完成字段标准化和默认值补齐。
- [x] 按每个模块的 `merge_strategy` 执行合并，不把全部模块都硬编码为 upsert。
- [x] 使用参数化 SQL 或安全批处理合并，不把模型原文拼接进 SQL。
- [x] 多表写入时显式传入 `targetSheetKeys` 或项目等价保存范围参数，避免只改内存未持久化。
- [x] 合并 `world_digest` 到 `we_world_digest`。
- [x] 合并 `events` 到 `we_events`。
- [x] 合并 `factions` 到 `we_factions`。
- [x] 合并 `winds` 到 `we_winds`。
- [x] 合并 `reputation` 到 `we_reputation`。
- [x] 合并 `economy` 到 `we_economy`。
- [x] 合并 `enemies` 到 `we_enemies`。
- [x] 合并 `influence_chain` 到 `we_influence_chain`。
- [x] 合并 `blackbox` 到 `we_blackbox`。
- [x] 合并 `regional_incident` 到 `we_regional_incident`。
- [x] 合并 `custom` 到 `we_custom_state` 或对应专属表。
- [x] 成功后更新 `we_meta.round`、`last_message_id`、`last_checkpoint_id`、`updated_at`、清空或保留历史 `last_error` 策略。
- [x] 成功后更新 `we_ledger.status='success'`、`raw_response`、`parsed_json`、`finished_at`。
- [x] 成功后调用摘要器并刷新表格世界书；若摘要器失败，按 strictMode 决定是否整体失败或仅记录警告。
- [x] 失败时只更新 `we_ledger` 和 `we_meta.last_error`，不合并世界状态。
- [x] 严格模式下单模块合并失败要回滚 checkpoint；宽松模式下可跳过该模块并记录错误。

## 8. World 机制执行器

- [x] 实现 Dice 机制，读取 `mechanics_json` 的概率、冷却、持续轮次和触发条件。
- [x] 实现 Stage 机制，支持字段名、状态列表、终局状态、进度阈值和自动推进。
- [x] 实现 Verdict 机制，支持枚举等级到自然语言判词映射。
- [x] 实现 Lifecycle 机制，按 `expires_round`、`remaining_rounds`、`terminal`、`status`、数量上限清理。
- [x] 实现 Merge 机制，支持 `upsert`、`replace`、`append`、`patch`、`ignore`。
- [x] 为 `append` 和 `patch` 定义 JSON 字段合并规则，避免数组重复膨胀或对象覆盖丢字段。
- [x] 实现风声衰减：`decay_rounds` 递减，未可见且衰减为 0 的风声可清理。
- [x] 实现区域事件冷却和剩余轮次扣减。
- [x] 实现影响链过期清理。
- [x] 实现黑盒暴露风险推进，从 `hidden` 到 `leaking` 到 `exposed` 必须有痕迹或传播原因。
- [x] 确保机制执行器可以被推演器、摘要器、恢复器复用。
- [x] 确保机制执行结果写库前可预览或记录到 ledger。

## 9. World 摘要器与正文注入

- [x] 查询后台状态并按可见性筛选，禁止泄露 `we_blackbox` 隐藏全文。
- [x] 生成 `visible_digest`，只包含正文模型可合理使用的信息。
- [x] 生成 `digest`，包含玩家可理解的总摘要，但不能破坏正文角色信息边界。
- [x] 生成 `hidden_digest`，记录调试信息、黑盒概况和状态膨胀提醒，不通过世界书导出。
- [x] 控制摘要长度，按事件、风声、势力、声誉、经济、仇敌、区域事件设置上限。
- [x] 摘要中加入叙事约束：角色不能知道黑盒秘密，未传播信息不能直接改变公众态度，不在场 NPC 可以行动但正文只呈现可接触结果。
- [x] 写入最新轮次 `we_world_digest`，避免重复 round 唯一键冲突。
- [x] 摘要更新后调用 `ctx.api.refreshDataAndWorldbook()`。
- [ ] 确认正文生成时通过表格导出世界书链路读取 `we_world_digest`。
- [x] 确认后台明细表不会被导出或递归注入。

## 10. World 世界书读取器

- [x] 实现扫描文本构建函数，覆盖设计文档列出的输入来源。
- [x] 实现 `worldbook_strategy='none'` 时跳过扫描文本和世界书调用。
- [x] 实现 `worldbook_strategy='selected'` 时仅使用公开 API 支持的选择参数，若当前 API 不支持则降级为 `current` 或记录不可用。
- [x] 扫描文本包含本轮 AI 回复 `ctx.event.aiResponse`。
- [x] 扫描文本包含最近正文 `ctx.api.getStoryContext(N)` 或项目已有等价 API。
- [x] 扫描文本包含默认表中的当前时间、地点、主角状态、重要角色、纪要、任务。
- [x] 扫描文本包含 World 后台事件、势力、公开风声和激活区域事件。
- [x] 扫描文本包含 `we_prompt_templates` 或 `we_modules.rules` 中提取的短额外关键词。
- [x] 扫描文本只允许包含 `we_blackbox` 接近暴露的非敏感关键词，不包含秘密全文。
- [x] 扫描文本不包含全部数据库、全部世界书、ledger、checkpoints、完整 prompt 模板。
- [x] 调用 `ctx.api.renderWorldbookForPrompt(scanText, options?)` 并返回正式世界书链路处理后的文本。
- [x] 在世界书读取失败时降级为空文本并记录 ledger 警告，不阻断非严格模式推演。

## 11. World 同步器与默认表回流

- [x] 明确同步器是推演器最后阶段或独立脚本，且只能在可见条件满足时回流默认表。
- [x] 支持将公开或主角接触的后台事件写入/更新 `quests_events`。
- [x] 支持将正式登场或明确识别的后台人物写入/更新重要角色表。
- [x] 支持将确定成为正文事实的时间/地点变化写入 `global_state`。
- [x] 支持把 `we_blackbox.public_status='exposed'` 且具备传播证据的秘密转入 `we_winds`、`we_events` 或默认表。
- [x] 禁止直接写 `chronicle`，仍由默认纪要链路维护。
- [x] 禁止直接写 `options`，仍由默认选项生成链路维护。
- [x] 回流时遵守默认表 DDL、Note 和字段约束。
- [x] 回流动作写入 `we_ledger` 或 `we_influence_chain`，保留因果证据。
- [x] 回流失败不应破坏后台状态，需记录错误并按 strictMode 处理。

## 12. World 预设生成器

- [x] 读取当前世界书文本或通过正式世界书链路获得设定材料。
- [x] 读取角色卡描述或项目公开 API 中可用的角色设定信息。
- [x] 支持用户指定 `classic`、`free`、`mixed` 模式。
- [x] 支持模块数量策略：AI 自决、固定 N 个、保留已有模块后补齐。
- [x] 调用 `ctx.api.callAI` 生成 `modules[]` JSON。
- [x] 预设生成器只生成 `we_modules` 行和可选状态初始化数据，不生成需要新增内核能力的代码。
- [x] 校验 `module_id` 唯一。
- [x] 校验 `state_table` 存在或等于 `we_custom_state`。
- [x] 校验 `item_key` 存在于输出字段。
- [x] 校验 `mechanics_json`、`display_json`、`lifecycle_json` 是合法 JSON。
- [x] 校验固定 N 个模块时启用模块数量等于 N。
- [x] 校验模块字段不与内置状态字段冲突。
- [x] 写入 `we_modules` 和可选 `we_custom_state` 初始行。
- [x] 生成失败时不写入半成品模块。

## 13. World 恢复器与重推演

- [x] 实现快照生成，包含 `we_meta`、最近 N 条 `we_world_digest`、所有启用状态表、`we_custom_state`。
- [x] 每次推演前写入 `we_checkpoints`，包含 `checkpoint_id`、`round`、`message_id`、`snapshot_json`、`reason`、`created_at`。
- [x] 实现按 `checkpoint_id` 读取快照。
- [x] 恢复前校验快照 JSON 完整性和目标表存在性。
- [x] 使用安全批处理清理并恢复相关 World 表。
- [x] 恢复 `we_meta.last_message_id` 到 checkpoint 对应消息。
- [x] 恢复后允许用户手动重新运行推演器。
- [x] 恢复后调用 `refreshDataAndWorldbook()` 或提示用户刷新，确保 `we_world_digest` 与世界书导出同步。
- [x] 恢复失败时不应留下半恢复状态；必要时保留恢复前 emergency checkpoint。
- [x] 恢复操作写入 `we_ledger`。

## 14. 错误处理与诊断日志

- [x] 所有脚本捕获顶层异常并写 `ctx.log`。
- [x] 所有推演请求有唯一 `request_id`。
- [x] API 调用前写 `we_ledger.status='running'`。
- [x] API 失败时写 raw error、finished_at、`we_meta.last_error`。
- [x] JSON 解析失败时保存 raw response，不合并状态。
- [x] 输出字段不在启用模块中时丢弃并记录 warning。
- [x] 没有任何有效字段时标记 failed。
- [x] 参数化 SQL 执行失败时记录 SQL 名称、目标表和错误，不记录敏感 prompt 全文。
- [x] 支持配置 strictMode：严格模式回滚，宽松模式跳过失败模块。
- [x] 支持 debugMode：ledger 中保存 prompt_digest 和必要片段，不默认保存完整敏感 prompt。
- [x] 支持状态膨胀诊断：当某表行数超过阈值时写 hidden_digest 或 ledger warning。

## 15. 安全与约束

- [x] 所有模型输出写库前必须先解析为对象，再按字段白名单取值。
- [x] 所有 SQL 写入必须使用参数绑定或项目已有安全 mutation API。
- [x] 禁止把 raw JSON 直接拼接进 SQL。
- [x] 禁止脚本读取或注入全部世界书原文，除非通过公开世界书渲染链路返回。
- [x] 禁止脚本通过 `window`、全局内部对象或未公开 SillyTavern 内部变量绕过公开 API。
- [x] 禁止把 `we_blackbox` hidden 内容写入 `visible_digest`。
- [x] 禁止后台表默认导出到世界书。
- [x] 禁止常规填表 prompt 把 `we_*` 明细表作为更新目标。
- [x] 确保导入资产不包含用户 API key、私有 preset、外部服务密钥。
- [x] 确保脚本错误不会中断主回复显示，只影响后台推演。

## 16. 测试：模板结构

- [x] 测试 World 模板包含默认 8 张业务表和 `mate`。
- [x] 测试 World 模板追加全部 16 张 `we_*` 表。
- [x] 测试默认表 UID、表名、DDL、导出配置和 orderNo 不被 World 模板改变。
- [x] 测试每张 `we_*` 表 DDL 可通过 SQLite 模板校验。
- [x] 测试所有 DDL 第一列是 `row_id INTEGER PRIMARY KEY, -- 行号`。
- [x] 测试所有唯一键、CHECK 约束和字段注释存在。
- [x] 测试后台明细表 exportConfig 被禁用。
- [x] 测试 `we_world_digest` exportConfig 被启用且注入模板正确。
- [x] 测试后台表 updateConfig 全部为禁用常规填表值。
- [x] 测试 orderNo 从默认表之后开始且稳定。
- [x] 测试 `we_world_digest` entryName、entryType、placement、splitByRow、preventRecursion、extraIndexEnabled 配置符合设计。

## 17. 测试：初始化与导入

- [ ] 测试导入 World 数据库模板后可以创建所有表。
- [ ] 测试初始化器首次运行能插入默认 meta、modules、prompt template、reputation、digest。
- [ ] 测试 `we_meta.world_id` 在不同聊天中不同，在同一聊天重复初始化时稳定。
- [ ] 测试初始化器重复运行幂等，不产生重复唯一键行。
- [ ] 测试缺表时初始化器给出明确错误。
- [ ] 测试导入失败时不会破坏现有默认表数据。
- [ ] 测试模板 UI 或 API 能选择/导入 World 数据库模板。

## 18. 测试：推演主流程

- [ ] 测试 `enabled='否'` 时推演跳过。
- [ ] 测试 `evolve_every` 不满足时推演跳过。
- [ ] 测试同一 message id 重复触发时不会重复推演。
- [ ] 测试推演前写 checkpoint。
- [ ] 测试推演开始写 running ledger。
- [ ] 测试默认表事实摘要读取正确。
- [ ] 测试 World 后台状态摘要读取正确。
- [ ] 测试世界书扫描文本不包含黑盒全文、ledger、checkpoint、完整 prompt。
- [ ] 测试 callAI 默认不传 presetName。
- [ ] 测试 `api_preset_override` 非空时传入 presetName。
- [ ] 测试交付物不会创建或要求 World 专用 API 预设。
- [ ] 测试 `worldbook_strategy='none'` 不调用 `renderWorldbookForPrompt`。
- [ ] 测试 `worldbook_strategy='current'` 调用正式世界书链路。
- [ ] 测试 `worldbook_strategy='selected'` 在 API 支持时传递公开选择参数，不支持时按设计降级。
- [ ] 测试合法 JSON 输出可合并到各表。
- [ ] 测试非法 JSON 输出只写 ledger failed，不写状态表。
- [ ] 测试越界枚举或数值被拒绝或修正并记录。
- [ ] 测试输出完整状态快照或禁用模块字段时按策略拒绝、裁剪或记录。
- [ ] 测试只输出启用模块，禁用模块输出被丢弃。
- [ ] 测试成功后更新 round、last_message_id、last_checkpoint_id。

## 19. 测试：机制、摘要、同步、恢复

- [ ] 测试风声衰减和清理。
- [ ] 测试区域事件剩余轮次和冷却扣减。
- [ ] 测试影响链过期清理。
- [ ] 测试阶段机按配置推进。
- [ ] 测试黑盒暴露风险不会直接泄露到 visible_digest。
- [ ] 测试摘要器只导出可见事件、公开风声、合理势力态势和声誉。
- [ ] 测试摘要器调用 `refreshDataAndWorldbook()`。
- [ ] 测试同步器只在可见条件满足时写默认表。
- [ ] 测试同步器不写 `chronicle` 和 `options`。
- [ ] 测试 checkpoint 恢复可以还原 World 表状态。
- [ ] 测试恢复失败不会留下半恢复状态。
- [ ] 测试恢复后 `we_world_digest` 和世界书导出刷新同步。

## 20. 验证：脚本包与公开 API

- [x] 验证脚本包格式可被现有 `importUserScripts` 接收。
- [x] 验证脚本绑定推荐挂载点正确。
- [x] 验证脚本默认输入 JSON 和 config JSON 可解析。
- [x] 验证脚本只使用公开 API。
- [ ] 验证 `renderWorldbookForPrompt` 失败时非严格模式降级。
- [x] 验证 `executeSqlBatch` 或多 mutation 的 targetSheetKeys 保存范围正确。
- [x] 验证日志不泄露 API key 或用户私密配置。

## 21. 文档与用户说明

- [x] 编写 World 数据库模板导入说明。
- [x] 编写 SQLite 模式要求说明。
- [x] 编写脚本包导入说明。
- [x] 编写挂载点绑定说明。
- [x] 编写 `we_meta` 配置说明，包括 enabled、mode、evolve_every、api_preset_override。
- [x] 编写 classic/free/mixed 模式配置说明。
- [x] 编写自定义模块 `we_modules` 字段说明和示例。
- [x] 编写 `we_world_digest` 导出世界书说明。
- [x] 编写失败诊断、ledger 查看、checkpoint 恢复和重推演说明。
- [x] 编写安全边界说明：黑盒、可见性、默认表回流条件。
- [x] 编写常见问题：没有推演、没有注入、JSON 失败、世界书未命中、重复触发。
- [x] 编写如何用现有公开 API 导入模板资产和脚本包资产的说明。

## 22. 最终验收

- [ ] 新聊天导入 World 数据库模板后，默认表和 World 表同时存在。
- [ ] 导入 World 脚本包后，初始化器自动补齐默认数据。
- [ ] 正文回复后 `main_reply.after_response` 自动触发 World 推演。
- [ ] 后台状态能按事件、势力、风声、声誉、经济、仇敌、黑盒、区域事件结构化保存。
- [ ] 每轮推演前有 checkpoint，每轮推演后有 ledger。
- [ ] `we_world_digest` 更新并通过表格世界书链路注入正文。
- [ ] 私密信息不会进入正文可见摘要。
- [ ] 禁用 World 后不再推演。
- [ ] 重复触发同一消息不会重复推演。
- [ ] API 失败或 JSON 失败不会破坏既有世界状态。
- [ ] 不创建必需的 World 专用 API 预设，用户不配置覆盖预设也能运行。
- [ ] checkpoint 恢复后可重推演。
- [ ] free/mixed 自定义模块可通过 `we_modules` 和 `we_custom_state` 工作。
- [ ] 预设生成器可从设定材料生成可校验模块描述符。
- [x] 本目录资产验证脚本通过。
- [x] 文档可指导用户从空聊天完成导入、启用、诊断和恢复。

## 23. 执行记录

- [x] 已将任务目录移动到根目录：`world-engine-database-native-design/`
- [x] 已创建完整任务清单：`world-engine-database-native-design/tasks.md`
- [x] 已按实现需求口径清理过度设计项，保留数据库模板、脚本包、推演、摘要、同步、恢复、测试和文档任务。
- [x] 已修正执行规则：后续必须按任务清单顺序推进，禁止跳过前置任务直接实现后续资产。
- [x] 已撤回未经真实运行环境验证的测试/最终验收勾选；静态验证只保留资产结构和源码约束结论。

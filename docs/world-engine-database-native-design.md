# World 能力的数据库原生实现设计

## 目标

本文档设计一种在 `shujuku` 内实现 `reference/World` 核心需求的方案。方案只使用 `shujuku` 已经暴露给用户的能力：SQLite 表、表格模板、公开 CRUD/SQL API、脚本管理与挂载点、脚本变量、用户已配置的主 API/剧情推进 API、世界书链路和模板变量。

本方案不以新增插件内部能力为前提，也不要求照搬 `reference/World` 的 UI 或 JavaScript 引擎。核心目标是实现 World 的非 UI 需求：世界状态持久化、后台推演、因果规则、模块化状态、状态合并、正文注入、预设化、自由扩展和可调试。

## World 的真实需求

World 的用户需求不是“显示一个世界面板”，而是让 RP 世界拥有一个持续演化的后台状态层。

需要实现的能力包括：

- 按聊天隔离维护世界状态。
- 每轮正文回复后读取最近剧情并推进世界后台。
- 世界不围绕主角冻结，不在场 NPC、势力、事件也会继续发展。
- 使用结构化数据记录世界，而不是只记录散文摘要。
- 私密行为、信息传播、声誉变化、势力行动、经济变化、仇敌追踪必须遵循因果链。
- 将对正文有用的世界状态注入下一轮 prompt，约束正文生成。
- 支持 classic 固定模块、free 自定义模块、mixed 混合模块。
- 支持阶段、骰子、裁决、生命周期、数组合并等通用机制。
- 支持从世界书/角色卡生成或辅助配置世界模块。
- 支持存档点、重推演、诊断日志和失败回退。

可不复刻的内容包括：

- World 原插件的面板布局、卡片样式、按钮样式和 SVG 资源。
- World 原插件的内部函数名、存储 key、模块文件拆分方式。
- 专属 UI 渲染器。`shujuku` 中可用数据库表、可视化表格和表格导出世界书替代。

## shujuku 可用能力映射

| World 需求 | shujuku 已暴露能力 | 设计用法 |
| --- | --- | --- |
| 持久世界状态 | SQLite 表格、表格模板、聊天持久化 | 用一组 `we_*` 表保存状态、预设、模块、日志和存档点 |
| 复杂查询/合并 | `querySql`、`executeSqlMutation`、`executeSqlBatch` | 用 SQL 做状态读取、增量合并、生命周期清理、统计和注入摘要 |
| 每轮推演 | `main_reply.after_response` 脚本挂载点 | 正文完成后自动运行推演脚本 |
| 正文注入 | 表格导出配置、世界书注入链路、`refreshDataAndWorldbook()` | 将可见 World 摘要表导出为世界书条目，正文通过成熟的表格世界书注入链路读取 |
| 推演模型调用 | `ctx.api.callAI(messages, options?)`、用户已配置的主 API/剧情推进 API | 默认不指定 `presetName`，直接使用用户在数据库/插件中配置好的主 API；仅在表内显式填写覆盖值时才指定调用预设 |
| 世界书参与 | `ctx.api.renderWorldbookForPrompt(scanText, options?)` | World 推演器只传扫描文本，由 shujuku 复用现有正式世界书渲染链路返回已处理后的世界书内容 |
| Prompt 管理 | SQLite 表、模板导入 API、表格模板 | 用 `we_prompt_templates` 表保存 World 推演 prompt、输出契约和最终指令 |
| 自定义逻辑 | 脚本管理、默认输入 JSON、绑定 config JSON | 将 World 的初始化器、推演器、同步器、生成器拆成用户脚本包 |
| 模板变量 | `{[script ...]}`、`{[sql "..."]}`、`{[db...]}`、`<if>` | 允许用户在提示词中引用世界状态或条件显示内容 |
| 回滚/诊断 | 数据表 + 脚本日志 + 存档表 | 每轮推演前写 checkpoint，推演后写 ledger 和 raw response |

## 总体架构

方案采用“数据库即世界引擎”的架构，但最终交付的不是一套替代默认表的孤立模板，而是在当前 `shujuku` 默认表模板上追加 World 后台表。

当前默认表模板由 8 张业务表和 `mate` 元数据组成：

- `全局数据表` / `global_state`：当前地点、时间、经过时间。
- `主角信息表` / `protagonist_info`：主角身份、近况、位置、随身财物。
- `重要角色表` / 当前默认恋爱覆盖为 `important_non_romance`：已登场重要角色、位置、在场状态、人际关系、交互选项。
- `主角技能表` / `protagonist_skills`：主角技能。
- `背包物品表` / `inventory`：主角物品。
- `任务与事件表` / `quests_events`：主角已接触/已触发的任务与事件。
- `纪要表` / `chronicle`：每轮正文事实纪要和索引。
- `选项表` / `options`：每轮可选行动。

World 模板必须以 `buildDefaultTableTemplateObject_ACU()` 生成的当前默认模板为基底，然后增量追加 `we_*` 后台表。不能删除、替换或弱化默认表，因为默认表负责正文填表、世界书导出、纪要索引、选项生成等现有链路。

整合后的职责边界：

| 层 | 表 | 职责 |
| --- | --- | --- |
| 默认剧情数据库 | `global_state`、`protagonist_info`、`important_non_romance`/`important_characters`、`protagonist_skills`、`inventory`、`quests_events`、`chronicle`、`options` | 主角视角、正文已经发生的事实、可见角色、任务、物品、技能、选项和纪要 |
| World 后台数据库 | `we_meta`、`we_modules`、`we_events`、`we_factions`、`we_winds`、`we_reputation`、`we_economy`、`we_enemies`、`we_influence_chain`、`we_blackbox`、`we_regional_incident`、`we_custom_state`、`we_ledger`、`we_checkpoints` | 不一定被主角知道的后台世界状态、因果传播、势力计划、黑盒秘密、机制状态、推演日志和存档点 |
| 桥接脚本 | World 推演器、摘要器、同步器 | 从默认表读取事实输入，写入 World 后台表；从 World 后台表筛选可见内容写入摘要表；必要时把公开结果同步回默认表 |

默认表和 World 表之间不是重复关系，而是“前台事实层 + 后台模拟层”的关系。默认表记录主角和正文已明确接触到的内容；World 表记录世界后台如何继续运转、哪些信息已经传播、哪些内容仍在黑盒中。

```text
正文回复完成
  -> main_reply.after_response 脚本触发
  -> SQL 读取默认表事实层：global_state / protagonist_info / 重要角色表 / quests_events / chronicle
  -> SQL 读取 World 后台层：we_meta / we_modules / 各 we_* 状态表
  -> 读取最近剧情 / 世界书
  -> 本地机制结算：骰子、阶段、生命周期、冷却
  -> ctx.api.callAI 调用世界推演 API
  -> 校验 JSON 输出
  -> SQL 合并写入各状态表
  -> 写入 we_ledger / we_checkpoints
  -> 更新 we_world_digest 可见摘要表
  -> refreshDataAndWorldbook 同步表格导出世界书
  -> 正文通过表格世界书注入链路读取 World 摘要
```

方案中的“引擎”不是新内核，而是一组用户可导入的表格模板和脚本包。脚本只调用公开的 `ctx.api`、`ctx.tavern`、`ctx.log`、`ctx.event`、`ctx.config`，不依赖 `window` 内部变量或未公开接口。World 推演 prompt 存在数据库表中；模型/API 连接默认使用用户已经配置好的主 API 或剧情推进 API，不额外交付 World 专用 API 预设。

## 数据表设计

所有新增 World 表使用 SQLite 模式。DDL 第一列统一为 `row_id INTEGER PRIMARY KEY, -- 行号`，表名和列名使用英文，中文含义写在注释中，方便 AI 和 NameMapper 识别。

这些 `we_*` 表是追加表，不替换当前默认表。最终模板应保留默认 8 张表的原有 UID、表名、DDL、Note、导出配置和 orderNo，再追加 World 表，World 表的 `orderNo` 建议从 `100` 起，避免打乱默认表顺序。

重要约束：新增 `we_*` 表不是填表 AI 的更新目标。它们属于 World 脚本维护的后台状态表，只能由 `World 初始化器`、`World 推演器`、`World 机制执行器`、`World 同步器`、`World 恢复器` 通过公开 CRUD/SQL API 写入。常规填表 AI 仍只负责默认剧情数据库中的前台事实表。

新增 `we_*` 后台状态表在模板中的统一配置原则：

- `updateConfig.uiSentinel = -1`。
- `updateConfig.contextDepth = -1`。
- `updateConfig.updateFrequency = -1`。
- `updateConfig.batchSize = -1`。
- `updateConfig.skipFloors = -1`。
- `exportConfig.enabled = false`。
- `exportConfig.splitByRow = false`。
- `exportConfig.preventRecursion = true`。
- `exportConfig.injectionTemplate = ""`。
- `exportConfig.extraIndexEnabled = false`。
- `exportConfig.injectIntoWorldbook = false`，如果该字段存在。

这些配置适用于 `we_events`、`we_factions`、`we_winds`、`we_reputation`、`we_economy`、`we_enemies`、`we_influence_chain`、`we_blackbox`、`we_regional_incident`、`we_custom_state`、`we_ledger`、`we_checkpoints` 等后台状态/日志/存档表。它们不直接导出到世界书，避免把黑盒、日志、内部字段原样暴露给正文模型。

例外：`we_world_digest` 是 World 摘要导出表，应启用表格导出/世界书注入。World 推演器或摘要器负责把后台状态压缩为“正文可见摘要”写入 `we_world_digest`，再由 `shujuku` 现有表格导出世界书链路注入正文。

`we_world_digest` 的推荐导出配置：

- `exportConfig.enabled = true`。
- `exportConfig.splitByRow = false`。
- `exportConfig.entryName = "World后台摘要"`。
- `exportConfig.entryType = "constant"`。
- `exportConfig.preventRecursion = true`。
- `exportConfig.injectionTemplate = "<world_state>\n$1\n</world_state>"`。
- `exportConfig.extraIndexEnabled = false`。
- `exportConfig.entryPlacement.position = "at_depth_as_system"`。
- `exportConfig.entryPlacement.depth` 使用比普通纪要更靠前但不覆盖角色定义的位置，具体沿用当前模板导出配置习惯。

这些配置的目标不是依赖某个单一开关“保证绝对不会被填表 AI 看到”，而是明确职责：后台明细表不导出，摘要表导出。

每张 `we_*` 表的 Note / Init / Insert / Update / Delete 也必须写明：

```text
【World后台表】本表仅供 World 脚本维护。常规填表AI禁止插入、更新、删除本表。若剧情产生相关变化，请先写入默认前台表或由 World 推演器在正文后统一结算。
```

### `we_meta` 世界元数据表

单行表，记录当前聊天的世界运行状态。

```sql
CREATE TABLE we_meta ( -- World元数据表
  row_id INTEGER PRIMARY KEY, -- 行号
  world_id TEXT NOT NULL UNIQUE, -- 世界ID
  mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','free','mixed')), -- 模式
  active_preset TEXT NOT NULL DEFAULT 'default', -- 当前预设
  round INTEGER NOT NULL DEFAULT 0 CHECK(round >= 0), -- 推演轮次
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  evolve_every INTEGER NOT NULL DEFAULT 1 CHECK(evolve_every >= 1), -- 每N轮推演
  api_preset_override TEXT, -- 推演API覆盖预设；为空时使用用户当前主API/剧情推进API配置
  last_message_id TEXT, -- 上次处理消息ID
  last_checkpoint_id TEXT, -- 最近存档点ID
  last_error TEXT, -- 最近错误
  updated_at TEXT -- 更新时间
);
```

### `we_modules` 模块描述符表

每一行表示一个世界模块。classic 模块也以描述符记录，free/mixed 模块通过新增行扩展。

```sql
CREATE TABLE we_modules ( -- World模块描述符表
  row_id INTEGER PRIMARY KEY, -- 行号
  module_id TEXT NOT NULL UNIQUE, -- 模块ID
  module_name TEXT NOT NULL, -- 模块名称
  kind TEXT NOT NULL CHECK(kind IN ('builtin','custom')), -- 模块类型
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  container TEXT NOT NULL CHECK(container IN ('array','object','scalar','none')), -- 状态容器类型
  state_table TEXT, -- 状态表名
  item_key TEXT, -- 数组合并主键列
  order_no INTEGER NOT NULL DEFAULT 100, -- 排序
  rules TEXT NOT NULL DEFAULT '', -- 推演规则
  output_contract TEXT NOT NULL DEFAULT '', -- 输出契约JSON
  mechanics_json TEXT NOT NULL DEFAULT '{}', -- 机制配置JSON
  display_json TEXT NOT NULL DEFAULT '{}', -- 展示配置JSON
  lifecycle_json TEXT NOT NULL DEFAULT '{}', -- 生命周期配置JSON
  merge_strategy TEXT NOT NULL DEFAULT 'upsert' CHECK(merge_strategy IN ('upsert','replace','append','patch','ignore')), -- 合并策略
  updated_at TEXT -- 更新时间
);
```

### `we_prompt_templates` World推演提示词模板表

保存 World 推演器要使用的 system prompt、user prompt 模板、输出契约和最终指令。它是数据库模板的一部分，不使用剧情推进预设充当提示词仓库。

```sql
CREATE TABLE we_prompt_templates ( -- World推演提示词模板表
  row_id INTEGER PRIMARY KEY, -- 行号
  template_name TEXT NOT NULL UNIQUE, -- 模板名称
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  system_prompt TEXT NOT NULL, -- 系统提示词
  user_prompt_template TEXT NOT NULL, -- 用户提示词模板
  output_contract_json TEXT NOT NULL, -- 输出契约JSON
  final_directive TEXT NOT NULL DEFAULT '', -- 最终指令
  worldbook_strategy TEXT NOT NULL DEFAULT 'current' CHECK(worldbook_strategy IN ('none','current','selected')), -- 世界书策略
  context_turns INTEGER NOT NULL DEFAULT 3 CHECK(context_turns >= 0), -- 读取最近轮数
  updated_at TEXT -- 更新时间
);
```

`World 推演器` 读取 `we_meta.active_preset`，再从 `we_prompt_templates.template_name` 找到对应模板。模板字段中允许使用占位符，例如：

- `{{world_state}}`：当前 `we_*` 后台状态摘要。
- `{{default_tables}}`：默认前台事实表摘要。
- `{{recent_story}}`：最近正文。
- `{{worldbook}}`：世界书内容。
- `{{module_rules}}`：启用模块规则。
- `{{output_contract}}`：输出 JSON 契约。

这样做比复用剧情推进预设更直接：World 的 prompt 本来就是数据库驱动的配置，存在表里能随模板一起导入、导出、备份和按聊天隔离。

### `we_world_digest` 世界摘要表

单行或多版本摘要表，用于注入正文。

```sql
CREATE TABLE we_world_digest ( -- World世界摘要表
  row_id INTEGER PRIMARY KEY, -- 行号
  round INTEGER NOT NULL UNIQUE, -- 推演轮次
  digest TEXT NOT NULL, -- 世界摘要
  visible_digest TEXT, -- 角色可感知摘要
  hidden_digest TEXT, -- 玩家可见但角色未知摘要
  created_at TEXT -- 创建时间
);
```

### `we_events` 事件链表

对应 World 的持续事件链。

```sql
CREATE TABLE we_events ( -- World事件链表
  row_id INTEGER PRIMARY KEY, -- 行号
  event_key TEXT NOT NULL UNIQUE, -- 事件键
  title TEXT NOT NULL, -- 事件标题
  event_type TEXT NOT NULL CHECK(event_type IN ('conflict','progress','custom')), -- 事件类型
  stage TEXT NOT NULL, -- 阶段
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100), -- 进度
  scope TEXT, -- 影响范围
  actors TEXT, -- 参与方JSON
  cause TEXT, -- 起因
  current_state TEXT, -- 当前状态
  next_pressure TEXT, -- 后续压力
  visibility TEXT NOT NULL DEFAULT 'unknown' CHECK(visibility IN ('public','rumor','private','unknown')), -- 可见性
  terminal TEXT NOT NULL DEFAULT '否' CHECK(terminal IN ('是','否')), -- 是否终局
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_factions` 势力表

```sql
CREATE TABLE we_factions ( -- World势力表
  row_id INTEGER PRIMARY KEY, -- 行号
  faction_key TEXT NOT NULL UNIQUE, -- 势力键
  name TEXT NOT NULL, -- 势力名称
  type TEXT, -- 势力类型
  scope TEXT, -- 活动范围
  status TEXT NOT NULL DEFAULT '稳固', -- 势力状态
  relation_to_user TEXT NOT NULL DEFAULT '中立', -- 对主角关系
  goal TEXT, -- 当前目标
  resources TEXT, -- 资源
  core_people TEXT, -- 核心人物JSON
  internal_conflict TEXT, -- 内部矛盾
  known_info TEXT, -- 已知信息
  last_action TEXT, -- 最近行动
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_winds` 风声/信息传播表

```sql
CREATE TABLE we_winds ( -- World风声表
  row_id INTEGER PRIMARY KEY, -- 行号
  wind_key TEXT NOT NULL UNIQUE, -- 风声键
  topic TEXT NOT NULL, -- 主题
  content TEXT NOT NULL, -- 内容
  source TEXT, -- 来源
  channel TEXT, -- 传播渠道
  scope TEXT, -- 覆盖范围
  credibility TEXT NOT NULL DEFAULT '未证实' CHECK(credibility IN ('真实','半真半假','谣言','未证实')), -- 可信度
  intensity INTEGER NOT NULL DEFAULT 1 CHECK(intensity >= 0 AND intensity <= 10), -- 强度
  decay_rounds INTEGER NOT NULL DEFAULT 3 CHECK(decay_rounds >= 0), -- 剩余衰减轮次
  visible_to_user TEXT NOT NULL DEFAULT '否' CHECK(visible_to_user IN ('是','否')), -- 主角是否可知
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_reputation` 声誉表

```sql
CREATE TABLE we_reputation ( -- World声誉表
  row_id INTEGER PRIMARY KEY, -- 行号
  axis_key TEXT NOT NULL UNIQUE, -- 声誉维度键
  axis_name TEXT NOT NULL, -- 声誉维度名称
  level TEXT NOT NULL, -- 声誉等级
  verdict TEXT NOT NULL, -- 裁决文本
  evidence TEXT, -- 变化依据
  last_change TEXT, -- 最近变化
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_economy` 经济与环境信号表

```sql
CREATE TABLE we_economy ( -- World经济表
  row_id INTEGER PRIMARY KEY, -- 行号
  economy_key TEXT NOT NULL UNIQUE, -- 经济键
  scope TEXT NOT NULL, -- 范围
  climate TEXT NOT NULL DEFAULT '平稳', -- 气候
  signal TEXT, -- 信号
  cause TEXT, -- 原因
  impact TEXT, -- 影响
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_enemies` 仇敌录表

```sql
CREATE TABLE we_enemies ( -- World仇敌录表
  row_id INTEGER PRIMARY KEY, -- 行号
  enemy_key TEXT NOT NULL UNIQUE, -- 仇敌键
  name TEXT NOT NULL, -- 仇敌名称
  enemy_type TEXT, -- 仇敌类型
  grudge TEXT NOT NULL, -- 仇恨原因
  severity INTEGER NOT NULL DEFAULT 1 CHECK(severity >= 1 AND severity <= 10), -- 严重度
  stage TEXT NOT NULL DEFAULT '潜伏', -- 报复阶段
  resources TEXT, -- 可用资源
  knows_user_info TEXT, -- 掌握的主角信息
  current_plan TEXT, -- 当前计划
  terminal TEXT NOT NULL DEFAULT '否' CHECK(terminal IN ('是','否')), -- 是否终结
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_influence_chain` 影响链表

```sql
CREATE TABLE we_influence_chain ( -- World影响链表
  row_id INTEGER PRIMARY KEY, -- 行号
  chain_key TEXT NOT NULL UNIQUE, -- 影响链键
  source_module TEXT NOT NULL, -- 源模块
  source_key TEXT, -- 源记录键
  direct_effect TEXT NOT NULL, -- 直接影响
  propagated_to TEXT, -- 传导目标JSON
  evidence TEXT, -- 因果证据
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled','expired')), -- 状态
  created_round INTEGER NOT NULL, -- 创建轮次
  expires_round INTEGER -- 过期轮次
);
```

### `we_blackbox` 信息黑盒表

记录未公开行为、秘密资产和暴露风险，防止“未被发现的信息”直接改变公开世界。

```sql
CREATE TABLE we_blackbox ( -- World信息黑盒表
  row_id INTEGER PRIMARY KEY, -- 行号
  secret_key TEXT NOT NULL UNIQUE, -- 秘密键
  category TEXT NOT NULL CHECK(category IN ('action','asset','knowledge','relationship','other')), -- 秘密类别
  content TEXT NOT NULL, -- 秘密内容
  owner TEXT, -- 归属者
  witnesses TEXT, -- 目击者JSON
  traces TEXT, -- 留痕JSON
  exposure_risk INTEGER NOT NULL DEFAULT 0 CHECK(exposure_risk >= 0 AND exposure_risk <= 100), -- 暴露风险
  public_status TEXT NOT NULL DEFAULT 'hidden' CHECK(public_status IN ('hidden','leaking','exposed')), -- 公开状态
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_regional_incident` 区域突发事件表

```sql
CREATE TABLE we_regional_incident ( -- World区域突发事件表
  row_id INTEGER PRIMARY KEY, -- 行号
  incident_key TEXT NOT NULL UNIQUE, -- 事件键
  active TEXT NOT NULL DEFAULT '否' CHECK(active IN ('是','否')), -- 是否激活
  title TEXT, -- 标题
  incident_type TEXT, -- 类型
  scope TEXT, -- 范围
  impact TEXT, -- 影响
  remaining_rounds INTEGER NOT NULL DEFAULT 0 CHECK(remaining_rounds >= 0), -- 剩余轮次
  cooldown INTEGER NOT NULL DEFAULT 0 CHECK(cooldown >= 0), -- 冷却轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);
```

### `we_custom_state` 自定义模块状态表

对自定义模块采用通用 JSON 行存储，避免每个模块都要求用户建新物理表。需要强约束的自定义模块也可以额外建专属表，并在 `we_modules.state_table` 指向该表。

```sql
CREATE TABLE we_custom_state ( -- World自定义模块状态表
  row_id INTEGER PRIMARY KEY, -- 行号
  module_id TEXT NOT NULL, -- 模块ID
  item_key TEXT NOT NULL, -- 条目键
  item_json TEXT NOT NULL, -- 条目JSON
  stage TEXT, -- 阶段
  verdict TEXT, -- 裁决
  score INTEGER, -- 分值
  visibility TEXT DEFAULT 'unknown', -- 可见性
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0, -- 更新轮次
  UNIQUE(module_id, item_key)
);
```

### `we_ledger` 推演台账表

```sql
CREATE TABLE we_ledger ( -- World推演台账表
  row_id INTEGER PRIMARY KEY, -- 行号
  request_id TEXT NOT NULL UNIQUE, -- 请求ID
  round INTEGER NOT NULL, -- 推演轮次
  message_id TEXT, -- 消息ID
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','skipped')), -- 状态
  prompt_digest TEXT, -- Prompt摘要
  raw_response TEXT, -- 原始响应
  parsed_json TEXT, -- 解析JSON
  error TEXT, -- 错误
  started_at TEXT, -- 开始时间
  finished_at TEXT -- 结束时间
);
```

### `we_checkpoints` 存档点表

```sql
CREATE TABLE we_checkpoints ( -- World存档点表
  row_id INTEGER PRIMARY KEY, -- 行号
  checkpoint_id TEXT NOT NULL UNIQUE, -- 存档点ID
  round INTEGER NOT NULL, -- 推演轮次
  message_id TEXT, -- 消息ID
  snapshot_json TEXT NOT NULL, -- 状态快照JSON
  reason TEXT, -- 原因
  created_at TEXT -- 创建时间
);
```

## Classic 模块到表的映射

| World 模块 | 数据表 | 说明 |
| --- | --- | --- |
| 世界运转 | `we_meta`、`we_world_digest`、`we_modules.rules` | 全局原则和摘要 |
| 事件链 | `we_events` | 阶段推进、终局、消散 |
| 势力 | `we_factions` | 组织状态、目标、态度 |
| 风声 | `we_winds` | 信息传播与可见性 |
| 影响链 | `we_influence_chain` | 跨模块因果传导 |
| 主动接触/信息传播规则 | `we_modules.rules` | 纯规则模块，可 `container='none'` |
| 声誉 | `we_reputation` | 维度、等级、判词 |
| 经济 | `we_economy` | 经济气候和信号 |
| 仇敌录 | `we_enemies` | 长期报复者 |
| 区域突发事件 | `we_regional_incident` | 概率触发、持续、冷却 |
| 信息黑盒 | `we_blackbox` | 未公开秘密与暴露风险 |
| 天下大势 | `we_custom_state` 或专属 `we_trends` | 可作为 custom/builtin 模块保存长期大势 |

## 与默认表的读写整合

World 推演不是绕开默认填表系统另跑一套剧情数据库。它必须把默认表作为事实输入，并且只在合适时把后台结果回流到默认表。

### 默认表作为推演输入

| 默认表 | World 使用方式 | 原因 |
| --- | --- | --- |
| `global_state` | 读取当前时间、地点层级、经过时间，作为本轮世界推进的时间轴和区域锚点 | 区域事件、风声传播、势力行动都需要时间地点 |
| `protagonist_info` | 读取主角身份、近况、当前位置、随身财物 | 判断主角能感知什么、哪些事件可影响主角 |
| `important_non_romance` / `important_characters` | 读取已登场角色、位置、在场状态、人际关系、交互选项 | 已登场角色可映射到势力、仇敌、信息传播节点 |
| `protagonist_skills` | 读取主角能力边界 | 判断主角行为造成的后果是否合理 |
| `inventory` | 读取关键物品 | 判断黑盒资产、物资线索、经济/势力争夺点 |
| `quests_events` | 读取主角已接触任务 | 与 `we_events` 对齐：默认表是主角任务视角，`we_events` 是后台事件链视角 |
| `chronicle` | 读取最近正文事实和概要索引 | 作为推演的事实依据，避免模型凭空改写 |
| `options` | 默认不作为后台推演依据，只在注入后由填表系统继续生成 | 选项是前台行动建议，不是世界状态源 |

### World 表作为后台状态

`we_events` 不替代 `quests_events`。区别是：

- `quests_events`：主角已经接到、看见、触发或需要处理的任务。
- `we_events`：世界后台持续发展的事件链，可以发生在主角视野外。

`we_factions` 不替代 `important_non_romance` / `important_characters`。区别是：

- 默认重要角色表：具体已经登场或对当前剧情产生作用的人。
- `we_factions`：组织、群体、机构、家族、帮派、公司、宗门等集体行动者。

`we_winds` 不替代 `chronicle`。区别是：

- `chronicle`：正文中已经发生的事实记录。
- `we_winds`：事实、谣言、公告、舆情在世界中的传播状态，可能真也可能假。

`we_blackbox` 不替代任何默认表。它记录“还不能进入默认表/公开世界书”的秘密，例如未暴露行为、秘密资产、无人知晓的计划。只有暴露后才可转入 `we_winds`、`we_events`、默认重要角色表或任务表。

### 回流默认表的条件

World 后台结果只有在“主角或正文世界应该看见”时，才允许回流默认表。

| 回流目标 | 允许写入条件 | 写入方式 |
| --- | --- | --- |
| `quests_events` | 后台事件已经被主角接触、收到委托、公开成为任务，或对当前剧情形成明确目标 | 插入/更新任务行，`quest_name` 与 `we_events.event_key/title` 对齐 |
| `important_non_romance` / `important_characters` | 后台势力人物、仇敌或关键 NPC 正式登场或被正文明确识别 | 插入/更新重要角色行 |
| `global_state` | 推演确认本轮时间/地点变化应成为正文事实 | 更新当前时间、经过时间、地点层级 |
| `chronicle` | 不由 World 后台直接写入常规纪要，仍交给默认填表/纪要链路维护 | World 可读取，不应抢写，避免重复纪要 |
| `options` | 不直接写入；默认填表根据注入后的世界状态生成选项 | 避免 World 推演器和选项生成互相覆盖 |

回流动作由 `World 同步器` 脚本执行，可以并入 `World 推演器` 的最后阶段。同步器必须遵守默认表自身 Note 和 DDL 约束，优先使用公开 CRUD API 或参数化 SQL。

### 表格模板交付形态

最终交付的 `World 数据库模板` 应是“当前默认模板 + World 增量表”的组合：

```js
const base = buildDefaultTableTemplateObject_ACU();
const worldTemplate = {
  ...base,
  sheet_we_meta: weMetaSheet,
  sheet_we_modules: weModulesSheet,
  sheet_we_prompt_templates: wePromptTemplatesSheet,
  sheet_we_world_digest: weWorldDigestSheet,
  sheet_we_events: weEventsSheet,
  sheet_we_factions: weFactionsSheet,
  sheet_we_winds: weWindsSheet,
  sheet_we_reputation: weReputationSheet,
  sheet_we_economy: weEconomySheet,
  sheet_we_enemies: weEnemiesSheet,
  sheet_we_influence_chain: weInfluenceChainSheet,
  sheet_we_blackbox: weBlackboxSheet,
  sheet_we_regional_incident: weRegionalIncidentSheet,
  sheet_we_custom_state: weCustomStateSheet,
  sheet_we_ledger: weLedgerSheet,
  sheet_we_checkpoints: weCheckpointsSheet,
};
```

交付时应通过 `importTemplateFromData(templateData, { scope: 'chat', presetName: 'World数据库模板' })` 或模板导入 UI 注入当前聊天。模板不能只包含 `we_*` 表，否则会丢失默认填表所需的主角、角色、纪要、任务、选项等核心表。

## 脚本包设计

脚本包是本方案的运行层。所有脚本都可通过 `ctx.api.importUserScripts` 导入，绑定到公开挂载点。

### 脚本 1：`World 初始化器`

绑定挂载点：`chat.loaded`、`db.loaded`。

职责：

- 检查 `we_meta` 是否存在初始行。
- 检查 `we_modules` 是否已有 classic 模块描述符。
- 缺失时用 `insertRow` 或 `executeSqlMutation` 初始化默认数据。
- 根据当前聊天读取模式、模块开关和可选 API 覆盖配置；默认沿用用户当前主 API/剧情推进 API。
- 将孤儿自定义状态标记为 inactive 或清理。

### 脚本 2：`World 推演器`

绑定挂载点：`main_reply.after_response`。

职责：

- 判断 `we_meta.enabled`、`evolve_every`、`last_message_id`，避免重复推演。
- 在推演前调用 `World 快照器` 生成 checkpoint。
- 用 SQL 读取当前状态、启用模块、规则、最近剧情、世界书文本。
- 执行本地确定性机制：阶段进度、风声衰减、生命周期清理、冷却扣减、区域骰子。
- 组装世界推演 prompt。
- 调用 `ctx.api.callAI(messages, options)`；默认 `options` 不传 `presetName`，仅当 `we_meta.api_preset_override` 非空时传 `{ presetName: api_preset_override }`。
- 解析并校验 JSON。
- 按模块合并写库。
- 写入 `we_ledger`。
- 更新 `we_meta.round`、`last_message_id`、`updated_at`。

写入策略：

- 推演器是 `we_*` 状态表的唯一常规写入入口。
- 推演前先写 `we_checkpoints`，再写 `we_ledger.status='running'`。
- 本地机制结算和模型返回合并应尽量分批执行：先更新机制字段，再合并模型输出，最后写台账成功状态。
- 多表写入使用 `executeSqlBatch` 或多次参数化 `executeSqlMutation`，并显式传入 `targetSheetKeys`，避免保存范围不清晰。
- 模型原始 JSON 不得直接拼进 SQL；脚本必须先解析 JSON，再用参数绑定或安全转义写入。
- 推演器不直接写 `chronicle` 和 `options`，避免与默认填表链路抢写。
- 如需回流默认表，交给 `World 同步器`，且同步器必须遵守默认表 Note/DDL。

### 脚本 3：`World 摘要器`

由 `World 推演器` 在合并状态后调用，也可以手动运行。

职责：

- 查询 `we_*` 后台状态。
- 只挑选正文模型可见、可用、不会泄露黑盒的信息。
- 生成 `we_world_digest.visible_digest`、`digest`、`hidden_digest`。
- 控制长度，例如事件、风声、势力各最多 N 条。
- 写入 `we_world_digest` 最新轮次。
- 调用 `ctx.api.refreshDataAndWorldbook()`，让表格导出世界书链路同步最新摘要。

### 脚本 4：`World 世界书读取器`

绑定挂载点：`plot_worldbook.before_render`、`table_fill_worldbook.before_render`，也可被推演器手动调用。

职责：

- 调用 `ctx.api.renderWorldbookForPrompt(scanText, options?)`，传入 World 推演扫描文本。
- 获取已经经过 shujuku 正式世界书链路处理后的文本。
- 将处理后的世界书内容写入推演 prompt。
- 生成模块时作为设定来源。

### World 推演扫描文本来源

`renderWorldbookForPrompt(scanText)` 里的 `scanText` 只用于触发现有世界书系统，不是最终推演 prompt，也不负责自行选择世界书条目。

决策边界：

- World 推演器负责构造能代表当前后台推演时刻的扫描文本。
- `shujuku` 正式世界书链路负责根据扫描文本、当前世界书配置、启用状态、关键词、递归和过滤规则决定命中哪些条目。
- World 推演器不得自行读取全部世界书、不得自行匹配条目、不得新增世界书来源表。

扫描文本来源：

| 来源 | 获取方式 | 用途 |
| --- | --- | --- |
| 本轮 AI 回复 | `ctx.event.aiResponse` | 本轮真实发生的剧情 |
| 最近正文 | `ctx.api.getStoryContext(N)` | 补足上下文 |
| 当前地点/时间 | 查询 `global_state` | 触发地点、时代、区域设定 |
| 主角状态 | 查询 `protagonist_info` | 触发身份、近况、位置相关设定 |
| 重要角色 | 查询当前默认重要角色表 | 触发角色相关世界书 |
| 最近纪要 | 查询 `chronicle` 最近几条概览/纪要 | 触发持续事件相关设定 |
| 当前任务 | 查询 `quests_events` | 触发任务/事件设定 |
| World 后台事件 | 查询 `we_events` 活跃事件 | 触发后台事件、地点、参与方设定 |
| World 势力 | 查询 `we_factions` 活跃或相关势力 | 触发组织/势力设定 |
| World 风声 | 查询 `we_winds` 高强度或公开风声 | 触发舆情/地区设定 |
| World 区域事件 | 查询 `we_regional_incident` 激活行 | 触发灾害/区域设定 |
| 额外关键词 | `we_prompt_templates` 或 `we_modules.rules` 中的简短关键词 | 补足世界观核心触发词 |

扫描文本不应包含：

- 全部数据库。
- 全部世界书。
- `we_blackbox` 全文。
- `we_ledger` 日志。
- `we_checkpoints` 存档。
- `we_prompt_templates` 完整提示词。

`we_blackbox` 只允许提供接近暴露的非敏感关键词，例如地点、物件名、传闻标签；不得把秘密行为全文写入扫描文本。

推荐扫描文本格式：

```text
<worldbook_scan_for_world_evolution>
当前时间：2026-02-04 08:30
当前地点：东京都 / 新宿区 / 御苑

本轮剧情：
主角在御苑听到镖局失踪案的流言，黑市商人提到青河帮最近内斗。

最近纪要：
- AM0031：主角在新宿车站遇见黑市商人，得知南城粮价异常上涨。
- AM0032：艾莉丝提到校长近期很少露面，学院内部传出失踪传闻。

当前任务：
- 调查镖局失踪案：刚接触线索，发布者为黑市商人。

已登场重要角色：
- 黑市商人：城南杂货铺，主角旧识。
- 艾莉丝：御苑，在场。

活跃后台事件：
- 镖局失踪案：阶段=发酵，范围=南城，参与方=青河帮/镖局。
- 学院失踪传闻：阶段=萌芽，范围=学院。

相关势力：
- 青河帮：状态=内斗，活动范围=南城。
- 学院理事会：状态=稳固，活动范围=学院。

公开风声：
- 南城粮价上涨，可信度=半真半假，范围=南城。
- 镖局失踪案，可信度=未证实，范围=市井。

额外关键词：
城市治安、黑市、学院、失踪案
</worldbook_scan_for_world_evolution>
```

最小实现伪代码：

```js
const aiResponse = ctx.event.aiResponse || '';
const recentStory = ctx.api.getStoryContext(3);

const global = ctx.api.querySql(`
  SELECT current_location, current_minor_region, current_major_region, cur_time
  FROM global_state
  WHERE row_id = 1
`)?.objects?.[0];

const chronicle = ctx.api.querySql(`
  SELECT code_index, summary
  FROM chronicle
  ORDER BY row_id DESC
  LIMIT 5
`)?.objects || [];

const events = ctx.api.querySql(`
  SELECT title, stage, scope, actors, current_state
  FROM we_events
  WHERE terminal = '否'
  ORDER BY updated_round DESC
  LIMIT 10
`)?.objects || [];

const factions = ctx.api.querySql(`
  SELECT name, status, scope, goal
  FROM we_factions
  ORDER BY updated_round DESC
  LIMIT 10
`)?.objects || [];

const winds = ctx.api.querySql(`
  SELECT topic, scope, credibility, intensity
  FROM we_winds
  WHERE intensity >= 3
  ORDER BY intensity DESC, updated_round DESC
  LIMIT 10
`)?.objects || [];

const scanText = [
  '<worldbook_scan_for_world_evolution>',
  `当前时间：${global?.cur_time || ''}`,
  `当前地点：${[global?.current_major_region, global?.current_minor_region, global?.current_location].filter(Boolean).join(' / ')}`,
  '',
  `本轮剧情：\n${aiResponse}`,
  '',
  `最近正文：\n${recentStory}`,
  '',
  `最近纪要：\n${chronicle.map(r => `- ${r.code_index}：${r.summary}`).join('\n')}`,
  '',
  `活跃后台事件：\n${events.map(r => `- ${r.title}：${r.stage || ''}；${r.scope || ''}；${r.current_state || ''}`).join('\n')}`,
  '',
  `相关势力：\n${factions.map(r => `- ${r.name}：${r.status || ''}；${r.scope || ''}；${r.goal || ''}`).join('\n')}`,
  '',
  `公开风声：\n${winds.map(r => `- ${r.topic}：${r.scope || ''}；${r.credibility || ''}`).join('\n')}`,
  '</worldbook_scan_for_world_evolution>',
].join('\n');

const worldbook = await ctx.api.renderWorldbookForPrompt(scanText);
```

实现时可以继续补充 `protagonist_info`、重要角色表、`quests_events`、`we_regional_incident` 等查询，但不得改变核心原则：扫描文本表达当前语境，条目命中交给 `renderWorldbookForPrompt` 的正式世界书链路。

### 脚本 5：`World 机制执行器`

可作为库脚本被其他脚本通过脚本变量或复制函数体复用。

职责：

- Dice：基于 `mechanics_json` 中的概率、冷却、持续轮次执行触发。
- Stage：根据 `stage`、`progress`、终局态执行推进。
- Verdict：根据枚举值写入自然语言判词。
- Lifecycle：按 `expires_round`、终局状态、数量上限清理。
- Merge：根据 `merge_strategy` 执行 upsert、replace、append、patch。

### 脚本 6：`World 预设生成器`

可手动运行或绑定到管理流程。

职责：

- 读取世界书和角色描述。
- 调用 `ctx.api.callAI` 生成 `we_modules` 描述符 JSON。
- 校验模块数量、字段、状态表、机制配置。
- 写入 `we_modules` 和可选自定义表模板。

## 推演 Prompt 契约

推演器发送给模型的消息必须要求输出严格 JSON，不允许自由文本。

核心结构：

```json
{
  "world_digest": {
    "digest": "...",
    "visible_digest": "...",
    "hidden_digest": "..."
  },
  "events": [
    {
      "event_key": "...",
      "title": "...",
      "event_type": "conflict",
      "stage": "发酵",
      "progress": 40,
      "current_state": "...",
      "visibility": "rumor"
    }
  ],
  "factions": [],
  "winds": [],
  "reputation": [],
  "economy": [],
  "enemies": [],
  "influence_chain": [],
  "blackbox": [],
  "regional_incident": [],
  "custom": {
    "module_id": []
  }
}
```

规则要求：

- 只输出启用模块。
- 只输出本轮发生变化的记录。
- 所有数组记录必须包含主键字段。
- 私密行为如果没有目击者或痕迹，必须进入 `blackbox`，不能直接改变 `winds`、`reputation` 或公开势力态度。
- 声誉变化必须引用风声、公开事件或可验证证据。
- 势力行动必须基于目标、资源、已知信息和利益。
- 仇敌追踪必须有信息来源。
- 经济变化必须有原因和范围。
- `influence_chain` 必须记录跨模块传导。

## SQL 合并策略

推演响应解析后，脚本使用公开 SQL 写入 API 合并。

### 数组模块 upsert

以 `we_events` 为例：

```sql
INSERT INTO we_events (
  row_id, event_key, title, event_type, stage, progress, scope, actors,
  cause, current_state, next_pressure, visibility, terminal, expires_round, updated_round
) VALUES (
  (SELECT COALESCE(MAX(row_id),0)+1 FROM we_events), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(event_key) DO UPDATE SET
  title=excluded.title,
  event_type=excluded.event_type,
  stage=excluded.stage,
  progress=excluded.progress,
  scope=COALESCE(excluded.scope,we_events.scope),
  actors=COALESCE(excluded.actors,we_events.actors),
  current_state=excluded.current_state,
  next_pressure=COALESCE(excluded.next_pressure,we_events.next_pressure),
  visibility=excluded.visibility,
  terminal=excluded.terminal,
  expires_round=excluded.expires_round,
  updated_round=excluded.updated_round;
```

实际脚本中优先使用参数化 `executeSqlMutation`。多记录可用 `executeSqlBatch`，但要确保 SQL 字符串由脚本安全生成，而不是直接拼接模型原文。

### 生命周期清理

```sql
DELETE FROM we_winds
WHERE decay_rounds <= 0 AND visible_to_user = '否';

UPDATE we_winds
SET decay_rounds = MAX(decay_rounds - 1, 0)
WHERE decay_rounds > 0;

DELETE FROM we_influence_chain
WHERE status = 'expired'
   OR (expires_round IS NOT NULL AND expires_round < ?);
```

### 阶段推进

阶段机配置存在 `we_modules.mechanics_json`。脚本读取 JSON 后在 JavaScript 中计算下一阶段，再用 SQL 写回。阶段机不需要新增数据库能力。

## 表格世界书注入设计

World 不直接通过 `main_reply.before_generation` 或 `setExtensionPrompt` 注入正文。状态已经存在表格中，应优先使用 `shujuku` 成熟的表格导出世界书链路。

注入路径：

```text
we_* 后台状态表
  -> World 摘要器筛选可见信息
  -> 写入 we_world_digest
  -> 表格导出配置生成世界书条目
  -> refreshDataAndWorldbook 同步
  -> 正文生成时由世界书注入
```

`we_world_digest` 是唯一默认导出的 World 表。其他后台明细表默认不导出。

`we_world_digest.visible_digest` 推荐内容：

```text
<world_state>
轮次：12
世界摘要：...

当前可感知事件：
- 镖局失踪案正在发酵，城中已有流言。

公开风声：
- 南城粮价上涨的消息正在扩散，可信度：半真半假。

势力态势：
- 青河帮：状态=内斗；对主角=冷淡；最近行动=...

声誉：
- 市井之间：受人尊敬。判词：...
</world_state>
```

### 叙事约束

摘要中必须包含必要叙事约束：

- 不要让角色知道黑盒秘密。
- 不要让未传播的信息直接改变公众态度。
- 不在场 NPC 可以行动，但正文只呈现角色能合理接触到的结果。

### 玩家调试信息

玩家调试信息默认不写入 `visible_digest`。如需记录，写入 `hidden_digest` 或 `we_ledger`，不通过世界书导出。

- 最近推演错误。
- 黑盒概况。
- 需要用户关注的状态膨胀。

## World Prompt 模板的用法

World 推演 prompt 不使用剧情推进预设保存，而是直接保存在 `we_prompt_templates` 表中。

用途：

- 保存推演系统提示词。
- 保存 user prompt 模板。
- 保存输出 JSON 契约。
- 保存最终指令。
- 保存世界书读取策略和最近正文轮数。

每轮自动触发仍由 `main_reply.after_response` 脚本执行，因为该挂载点能直接拿到本次正文 `aiResponse`。

执行流程：

```text
World 推演器
  -> 读取 we_meta.active_preset
  -> 查询 we_prompt_templates 中启用的同名模板
  -> 读取默认表事实层、we_* 后台状态、最近正文、世界书
  -> 替换模板占位符
  -> ctx.api.callAI(messages)
  -> 解析 JSON
  -> 写回 we_* 表
```

这样 World 的 prompt、状态、模块、日志都属于同一个数据库模板交付物，用户导入一个表格模板即可得到完整配置。

## 自由模式实现

自由模式不需要新增 UI 引擎。用户通过 `we_modules` 表定义模块。

最小模块描述符示例：

```json
{
  "module_id": "cultivation",
  "module_name": "修为",
  "kind": "custom",
  "container": "array",
  "state_table": "we_custom_state",
  "item_key": "realm_key",
  "rules": "记录重要角色的修为境界、瓶颈、突破风险和因果牵连。",
  "output_contract": {
    "fields": {
      "realm_key": "唯一键",
      "name": "角色名",
      "realm": "境界",
      "bottleneck": "瓶颈",
      "risk": "风险"
    }
  },
  "mechanics_json": {
    "stages": {
      "field": "realm",
      "states": ["炼气", "筑基", "金丹", "元婴"],
      "terminalStates": []
    },
    "verdicts": {
      "field": "risk",
      "levels": ["低", "中", "高"]
    }
  }
}
```

混合模式只需在 `we_modules` 中同时保留 builtin 与 custom 行，并按 `order_no` 排序组装规则和输出契约。

## 预设生成实现

`World 预设生成器` 调用 AI 生成 `we_modules` 行，而不是生成代码。

输入：

- 当前世界书文本。
- 角色卡描述。
- 用户指定模式：classic、free、mixed。
- 模块数量策略：AI 自决或固定 N 个。
- 当前已有模块列表。

输出：

- `modules[]` JSON。
- 每个模块的规则、输出字段、合并主键、机制配置。
- 对 classic 模块的启用/禁用建议。

校验：

- `module_id` 必须唯一。
- `state_table` 必须存在或等于 `we_custom_state`。
- `item_key` 必须存在于输出字段。
- `mechanics_json` 必须是合法 JSON。
- 固定 N 个模块时，启用模块数量必须等于 N。
- 与内置状态字段冲突时拒绝写入。

## 回滚与重推演

每次推演前，`World 推演器` 将当前状态导出为快照写入 `we_checkpoints.snapshot_json`。

快照包含：

- `we_meta`
- `we_world_digest` 最近 N 条
- 所有启用状态表
- `we_custom_state`

重推演流程：

- 用户手动运行 `World 恢复器` 脚本，指定 `checkpoint_id`。
- 脚本读取 `snapshot_json`。
- 使用 `executeSqlBatch` 清理并恢复相关表。
- 将 `we_meta.last_message_id` 回退到 checkpoint 对应消息。
- 再运行 `World 推演器`。

这实现 World 的存档点和 reroll 需求，不依赖未暴露的聊天内部消息编辑能力。

## 失败处理

推演必须是“先验证，后写库”。

流程：

- API 调用前写 `we_ledger.status='running'`。
- API 失败时只更新 `we_ledger` 和 `we_meta.last_error`，不修改世界状态。
- JSON 解析失败时保存 raw response，状态不合并。
- 输出字段不在启用模块中时丢弃并记录警告。
- 没有任何有效字段时标记失败。
- 单模块合并失败时回滚到 checkpoint 或跳过该模块并写错误，具体由 `ctx.config.strictMode` 决定。

## 初始交付物

为了落地该方案，需要交付以下用户可导入资产：

- `World 数据库模板`：以当前 `shujuku` 默认 8 表 + `mate` 元数据为基底，追加上述 `we_*` 表和 classic 默认模块行。不能只交付 `we_*` 表。
- `World 脚本包`：初始化器、推演器、摘要器、机制执行器、预设生成器、恢复器。
- `World API 配置策略`：默认使用用户已配置的主 API/剧情推进 API；只提供 `api_preset_override` 作为可选覆盖字段，不创建必需的专用 API 预设。
- `World 使用说明`：说明如何切换 SQLite 模式、导入模板、导入脚本、绑定挂载点、启用 `we_world_digest` 表格导出世界书。

数据库模板的具体组成：

| 类别 | 表 |
| --- | --- |
| 保留默认表 | `全局数据表`、`主角信息表`、`重要角色表`、`主角技能表`、`背包物品表`、`任务与事件表`、`纪要表`、`选项表`、`mate` |
| 新增 World 表 | `World元数据表`、`World模块描述符表`、`World推演提示词模板表`、`World世界摘要表`、`World事件链表`、`World势力表`、`World风声表`、`World声誉表`、`World经济表`、`World仇敌录表`、`World影响链表`、`World信息黑盒表`、`World区域突发事件表`、`World自定义模块状态表`、`World推演台账表`、`World存档点表` |
| 初始化数据 | `we_meta` 单行默认配置、`we_modules` classic 模块描述符、`we_prompt_templates` 默认推演模板、`we_reputation` 默认声誉轴、可选 `we_world_digest` 第 0 轮摘要 |

## 覆盖性检查

| World 非 UI 需求 | 是否覆盖 | 实现点 |
| --- | --- | --- |
| 聊天隔离世界状态 | 是 | shujuku 表格数据随聊天持久化，`we_meta.world_id` 区分 |
| 与默认表整合 | 是 | 以当前默认 8 表为基底追加 World 表，默认表做前台事实层，`we_*` 做后台模拟层 |
| 每轮自动推演 | 是 | `main_reply.after_response` |
| 结构化状态 | 是 | `we_*` SQLite 表 |
| 因果规则 | 是 | `we_modules.rules` + prompt 契约 + `we_influence_chain`/`we_blackbox` |
| 信息传播 | 是 | `we_winds` + 可见性字段 |
| 声誉/势力/经济/仇敌 | 是 | 对应专表 |
| 区域随机事件 | 是 | `we_regional_incident` + Dice 机制脚本 |
| 阶段机 | 是 | `mechanics_json` + 机制执行器 |
| 裁决机制 | 是 | `we_reputation.verdict`、自定义 verdict 配置 |
| 生命周期清理 | 是 | SQL 定时清理 + `expires_round` |
| 自定义模块 | 是 | `we_modules` + `we_custom_state` |
| mixed 模式 | 是 | builtin/custom 行混合启用 |
| 世界书参与 | 是 | `ctx.api.renderWorldbookForPrompt(scanText, options?)` |
| 正文注入 | 是 | `we_world_digest` 表格导出 + 世界书注入链路 + `refreshDataAndWorldbook()` |
| 模型调用 | 是 | `ctx.api.callAI` + 用户当前主 API/剧情推进 API；可选 `api_preset_override` 覆盖 |
| 失败诊断 | 是 | `we_ledger` + 脚本日志 |
| 回滚/重推演 | 是 | `we_checkpoints` |
| 导入导出 | 是 | 表格模板和脚本包导入导出；World prompt 随 `we_prompt_templates` 表进入模板 |

## 关键结论

World 的非 UI 需求可以用 `shujuku` 已提供给用户的能力实现。核心不是复制 `reference/World` 的引擎文件，而是把 World 的“状态、规则、推演、合并、注入、预设”全部数据库化：SQLite 表负责状态与约束，脚本负责流程编排和机制结算，`we_prompt_templates` 负责推演任务模板，模型调用默认走用户已配置的主 API/剧情推进 API，世界书链路负责设定输入，`we_world_digest` 通过表格导出世界书负责正文注入。

该方案满足“用数据库自身的能力实现它”的要求，并且没有要求新增 `shujuku` 未暴露给用户的内部能力。

# 脚本执行模块挂载点审计

这份文档只审一件事：脚本 hook 能放进业务时间线里的哪个明确挂载点。

正确格式是：

```text
A -> B -> C -> [hook 挂载点] -> D -> E
```

不能写成清晰业务时间线的 hook，不是清晰挂载点，而是实现混杂。

## 0. 审计规则

- 时间线必须描述业务流程，不描述 hook runner 内部流水账。
- hook 必须作为业务流程中的独立挂载点出现。
- hook 前面的状态必须已经由上游流程保证成立。
- hook 函数不得自己制造它声称监听的状态。
- 无法写成 `A -> B -> [hook] -> C` 的 hook，语义或实现入口有问题。

## 1. 总览

```text
打开插件/切聊天
  -> 聊天上下文稳定
  -> [chat.loaded]
  -> 数据库运行时稳定
  -> [db.loaded]

用户发送主回复
  -> 插件完成输入/剧情/纪要预处理
  -> [main_reply.before_generation]
  -> 最终 prompt 渲染
  -> AI 请求发出
  -> AI 回复落定
  -> [main_reply.after_response]
  -> 自动填表/循环/后续流程

自动填表
  -> 确定本次填表任务并使用本轮发送 request
  -> [table_fill.before_request]
  -> 渲染填表世界书
  -> [table_fill_worldbook.before_render]
  -> 渲染填表 prompt
  -> AI 请求发出
  -> AI 返回 tableEdit
  -> 表格修改提交成功
  -> [table_fill.after_commit]

剧情任务
  -> 确定剧情任务并使用本轮发送 request
  -> 渲染剧情世界书
  -> [plot_worldbook.before_render]
  -> 准备任务 prompt draft
  -> [plot.before_task_request]
  -> AI 请求发出
  -> AI 返回任务结果
  -> [plot.after_task_response]

手动保存表格
  -> 用户提交保存
  -> 表格修改提交成功
  -> [manual_table_save.after_commit]

模板渲染
  -> 文本进入模板替换
  -> [script / script_output 变量]
  -> 文本继续后续模板处理
```

## 2. loaded hook

### 2.1 挂载点定义

`chat.loaded` 挂载点：

```text
宿主完成聊天切换/初始化
  -> 插件确认当前 chatId、聊天消息、metadata、模板作用域属于同一个聊天
  -> 插件刷新当前聊天运行时状态
  -> [chat.loaded]
  -> 后续依赖聊天已加载的流程
```

`db.loaded` 挂载点：

```text
当前聊天上下文已稳定
  -> 插件完成当前聊天数据库运行时重建
  -> 插件确认数据库可查询
  -> [db.loaded]
  -> 后续依赖数据库已加载的流程
```

### 2.2 当前实现

当前实现已经收敛为统一 chat ready 入口：

```text
initializeCurrentChatFromHost_ACU / CHAT_CHANGED
  -> resetScriptStateForNewChat_ACU
  -> loadPresetAndCleanCharacterData_ACU
  -> handleChatReady_ACU(chatId, reason)
  -> 读取聊天消息
  -> 应用模板作用域
  -> 重建 SQLite
  -> 刷新运行时表格数据和 UI
  -> 产出 LoadedHookRuntime { reason, chatId, dbRuntimeReady }
  -> dispatchLoadedScriptHooks_ACU(runtime)
  -> [chat.loaded]
  -> dbRuntimeReady 为 true 时触发 [db.loaded]
```

`dispatchLoadedScriptHooks_ACU` 现在只做 hook 派发和去重，不再加载聊天、重建数据库或刷新 UI。

### 2.3 初始化入口

当前入口时间线可以写成：

```text
插件启动
  -> 注册事件监听
  -> initializeCurrentChatFromHost_ACU()
  -> resetScriptStateForNewChat_ACU(chatId)
  -> loadPresetAndCleanCharacterData_ACU()
  -> handleChatReady_ACU(chatId, 'initial_load')
  -> 读取当前聊天消息
  -> 应用模板作用域
  -> 重建 SQLite
  -> 刷新运行时表格数据和 UI
  -> 产出 LoadedHookRuntime
  -> dispatchLoadedScriptHooks_ACU(runtime)
  -> [chat.loaded]
  -> dbRuntimeReady 为 true 时触发 [db.loaded]
```

结论：初始化不再使用 `setTimeout(..., 0)`、`setTimeout(..., 1000)` 或 chatId 轮询。当前 host 已提供 chatId 或 chat metadata 时进入 `handleChatReady_ACU`；未提供时由后续 `CHAT_CHANGED` 事件进入。

### 2.4 切聊天入口

当前入口时间线是：

```text
CHAT_CHANGED 到达
  -> 清理旧聊天 chat 级脚本输出
  -> 清理脚本临时状态
  -> 清空 loaded 去重 Set
  -> 清理运行时表格数据和派生缓存
  -> 设置 currentChatFileIdentifier 为新聊天
  -> 停止自动循环
  -> 加载剧情预设
  -> 确保 TavernHelper.generate 包装
  -> handleChatReady_ACU(chatFileName, 'chat_changed')
  -> 校验 currentChatFileIdentifier 仍是目标聊天
  -> 读取当前聊天消息
  -> 应用模板作用域
  -> 重建 SQLite
  -> 刷新运行时表格数据和 UI
  -> 产出 LoadedHookRuntime
  -> dispatchLoadedScriptHooks_ACU(runtime)
  -> [chat.loaded]
  -> dbRuntimeReady 为 true 时触发 [db.loaded]
  -> 预热纪要向量索引缓存
  -> 恢复纪要向量索引归档队列
  -> 刷新状态显示
```

这是清晰的插件侧挂载点，不再使用 1200ms 经验延迟。

依据 `reference/SillyTavern/public/script.js`，`CHAT_CHANGED` 是聊天加载完成后的事件：

```text
getChat()
  -> 写入 chat_metadata
  -> 写入 chat
  -> getChatResult()
     -> loadItemizedPrompts()
     -> printMessages()
     -> select_selected_character()
     -> eventSource.emit(CHAT_CHANGED, getCurrentChatId())
```

因此当前实现把 `CHAT_CHANGED` 作为 chat ready 边界是确定事实。

### 2.5 原审计点处理

原审计点：页面刚打开就立刻切聊天，初始加载任务和切聊天任务交错。

处理：打 X。

原因：用户行为不是问题本体。当前实现已移除 initial_load timer 和切聊天 timer，统一走 `handleChatReady_ACU`。

原审计点：`chat.loaded` 和 `db.loaded` 的去重靠内存 Set，不是持久状态。

处理：打 X。

原因：loaded hook 不等于“一生只执行一次”。内存 Set 只是当前运行期防重复。

原审计点：`db.loaded` 第一次因为数据库失败被跳过后，后续恢复时补跑。

处理：打 X。

原因：`db.loaded` 表示数据库已加载且可查询。失败时不触发是正确语义。“恢复补跑”不是默认 hook 义务。

结论：酒馆源码确认 `CHAT_CHANGED` 是聊天加载完成后的事件。在 SillyTavern `getChat()` 主路径中，宿主先写入 `chat_metadata` 和 `chat`，再执行 `getChatResult()`；`getChatResult()` 内部完成 `loadItemizedPrompts()`、`printMessages()`、`select_selected_character()` 后，才 `await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId())`。因此当前实现把 `CHAT_CHANGED` 作为 chat ready 边界，不使用 timer 兜底。

## 3. 主回复 before_generation

### 3.1 应有挂载点

`main_reply.before_generation` 时间线：

```text
用户发送主回复
  -> 插件取得本轮有效用户输入
  -> 插件完成初始 seed checkpoint
  -> 插件完成纪要向量索引处理
  -> 插件完成剧情规划/输入改写
  -> 插件创建 main reply request id
  -> 插件记录 prompt draft 和当前输入
  -> [main_reply.before_generation]
  -> 最终 prompt 渲染读取 script_output
  -> AI 请求发出
```

这个 hook 的语义不是“用户刚点击发送”，而是“插件内部预处理完成后、最终请求发出前”。

### 3.2 TavernHelper.generate 路径

```text
TavernHelper.generate 被调用
  -> quiet/automatic_trigger 直接透传
  -> 读取用户输入
  -> 初始 seed checkpoint
  -> 纪要向量索引处理
  -> 剧情规划编排
  -> 按剧情结果进入 loop retry、输入改写或透传
  -> 创建 main reply request id
  -> 写入 request id 到运行时和生成参数
  -> 记录原始输入和最终有效输入
  -> 写入 main_reply prompt draft
  -> [main_reply.before_generation]
  -> 调用原始 TavernHelper.generate
  -> CHAT_COMPLETION_SETTINGS_READY
  -> 替换最终 prompt 脚本变量
  -> AI 请求发出
```

这个路径可以写出清晰挂载点。

已确认点：

- `before_generation` 在调用原始 `TavernHelper.generate` 前 `await` 完成。
- request id 在创建 cycle 时写入运行时当前 request，并同步写入 `options._acu_main_reply_request_id`。
- `CHAT_COMPLETION_SETTINGS_READY` 的模板替换使用当前 main reply request id，因此 request 级 `script_output` 可以被同一正文模板读取。
- 该链路已有集成测试覆盖：`main_reply.before_generation outputKey 可被同一正文模板读取，after_response 后清理 request`。

因此 `before_generation` 输出能被后续正文模板读取，是当前实现的确定行为。

### 3.3 GENERATION_AFTER_COMMANDS 路径

```text
GENERATION_AFTER_COMMANDS 到达
  -> 已被插件处理过则退出
  -> dryRun/quiet/automatic_trigger 则退出或跳过主回复脚本
  -> 创建 main reply request id
  -> 写入 request id 到生成参数
  -> 记录原始用户输入
  -> 判断纪要向量索引需求
  -> 判断剧情推进需求
  -> 按门控结果执行初始 seed checkpoint
  -> 按门控结果执行纪要向量索引处理
  -> 按门控结果执行剧情策略 1/策略 2
  -> 按剧情结果改写用户输入或生成参数
  -> 清空本次发送意图时间戳
  -> [main_reply.before_generation]
  -> 后续由宿主继续生成流程
```

这个路径也可以写出挂载点。

已确认点：

- 剧情规划层面的重复处理已有两层防护：`TavernHelper.generate` 规划成功后写入 `_qrf_processed_by_hook`，`GENERATION_AFTER_COMMANDS` 入口会直接跳过；同时 `markPlotIntercept_ACU` / `shouldSkipPlotIntercept_ACU` 会在短时间窗口内按相同文本跳过重复剧情拦截。
- main reply request cycle 层面当前仍是两个入口各自创建 cycle：`TavernHelper.generate` 入口调用 `beginMainReplyCycle_ACU('tavernhelper_generate', options)`，`GENERATION_AFTER_COMMANDS` 入口调用 `beginMainReplyCycle_ACU('generation_after_commands', params)`。
- 依据 `reference/SillyTavern/public/script.js`，宿主主发送链路在 `Generate()` 中触发 `GENERATION_STARTED`，执行 slash commands，然后触发 `GENERATION_AFTER_COMMANDS`，之后继续正文生成。该链路没有调用 `TavernHelper.generate`。
- `TavernHelper.generate` 是脚本 API/插件直接调用的独立生成入口，不是宿主主发送链路上的另一个事件阶段。

因此这里不能表述为“同一次真实用户发送同时经过 TavernHelper.generate 和 GENERATION_AFTER_COMMANDS”。按当前引用的 SillyTavern 源码，真实用户主发送走 `GENERATION_AFTER_COMMANDS`，脚本 API 直接生成走 `TavernHelper.generate`，二者是不同入口，不是同一次发送的两个阶段。两个入口各自创建 main reply request cycle 是正确边界，不跨入口复用 `_acu_main_reply_request_id`。

## 4. 主回复 after_response

### 4.1 应有挂载点

`main_reply.after_response` 时间线：

```text
AI 主回复生成完成
  -> 插件定位本次回复文本
  -> 插件确认本次 main reply request cycle 仍存在
  -> 插件写入当前 AI 回复缓存
  -> [main_reply.after_response]
  -> 清理 request 输出
  -> 自动填表/循环等后续流程
```

### 4.2 TavernHelper.generate 返回路径

```text
原始 TavernHelper.generate 返回
  -> 返回值是字符串，写入当前 AI 回复缓存
  -> [main_reply.after_response]
  -> 清理本轮 request 输出
```

依据 `reference/SillyTavern/public/script.js`，`generateQuietPrompt()` 和 `generateRaw()` 的返回契约都是 `Promise<string>`。当前实现里的 `typeof response === 'string'` 只是防御分支，不是已知业务分支；`TavernHelper.generate` 返回路径可以按字符串回复处理。

### 4.3 GENERATION_ENDED 路径

```text
GENERATION_ENDED(message_id) 到达
  -> 解析已有 request id
     -> 优先 generationGate 参数里的 request id
     -> 否则 pendingMainReplyRequestId
     -> 找不到已有 active request 时跳过 after_response
  -> 宿主传入 chat.length
  -> 插件将 chat.length 归一化为 chat.length - 1
  -> 定位最后一条消息
  -> 写入当前 AI 回复缓存
  -> [main_reply.after_response]
  -> 结束本轮 main reply request cycle
  -> 判断自动填表门控
  -> 执行循环结束处理
```

这个路径可以写出挂载点。当前实现不再凭空新建 `generation_ended` request 来执行 after hook；找不到 active request 时只跳过 after hook，不影响自动填表/循环等后续流程。

已确认点：

- 依据 `reference/SillyTavern/public/script.js`，`hideStopButton()` 触发 `eventSource.emit(event_types.GENERATION_ENDED, chat.length)`，传入的是当前聊天长度，不是最后一条消息下标。
- 当前实现已在 `getMainReplyMessageTextById_ACU(message_id)` 中把 `message_id === chat.length` 归一化为 `chat.length - 1`，主链路不再把最近 assistant 回退作为正常定位路径。
- `runMainReplyHook_ACU('main_reply.after_response', ...)` 用 `completedMainReplyAfterResponse_ACU` 按 requestId 去重；TavernHelper 返回路径和 `GENERATION_ENDED` 路径即使都到达，也不会对同一 requestId 重复执行 after hook。

## 5. 自动填表

### 5.1 table_fill.before_request

应有挂载点：

```text
自动填表流程确定本次表组
  -> 使用本轮发送 request
  -> [table_fill.before_request]
  -> 准备填表 AI 输入
  -> 渲染世界书和 prompt
  -> AI 请求发出
```

当前时间线：

```text
自动填表流程决定处理某组表
  -> 读取当前发送 request context
  -> [table_fill.before_request]
  -> 保存 before_request outputKey 到本轮发送 request 输出
  -> 准备 AI 输入
```

这个挂载点成立。

已确认点：

- `collectGroupFillResponse_ACU()` 不再为 group/job 创建 table_fill request id。
- `table_fill.before_request`、`prepareAIInput_ACU()`、`callCustomOpenAI_ACU()` 使用当前发送 request context；同一轮正文、剧情、填表、世界书变量替换读写同一份 request 输出缓存。
- 重试发生在同一个发送 request 内，不创建重试 request。
- collect 失败、abort、prepareAIInput 失败不清理 request 输出；request 输出生命周期由本轮发送周期统一管理。
- 多组表、并发 group、unified commit 不再合成 `table_fill_commit_*` request，也不再按 group request 清理。

因此填表内部 request 模型已收敛为“本轮发送一个 request”。

### 5.2 table_fill_worldbook.before_render

应有挂载点：

```text
正式填表 prompt 组装
  -> 通用世界书管线只收集/筛选本次世界书文本
  -> prepareAIInput_ACU 确认该文本将进入本次填表 AI 输入
  -> [table_fill_worldbook.before_render]
  -> 替换世界书里的脚本变量
  -> 世界书内容进入填表 prompt 组装
```

当前时间线：

```text
collectGroupFillResponse_ACU
  -> 使用当前发送 request
  -> [table_fill.before_request]
  -> prepareAIInput_ACU
     -> getCombinedWorldbookContent_ACU 只收集/筛选世界书内容
     -> renderTableFillWorldbookForPrompt_ACU
        -> [table_fill_worldbook.before_render]
        -> replaceScriptVariables_ACU
     -> worldbookContent 进入填表 dynamicContent
  -> callCustomOpenAI_ACU
```

已修正：`table_fill_worldbook.before_render` 不再挂在通用 `getCombinedWorldbookContent_ACU()` 内。通用世界书收集、预览、扫描、缓存候选内容只返回原始组合文本，不触发填表世界书 hook，也不替换 `table_fill_worldbook` 脚本变量。挂载点现在位于正式填表 prompt 组装路径 `prepareAIInput_ACU()` 内。

### 5.3 table_fill.after_commit

应有挂载点：

```text
填表流程开始
  -> 按配置分组/分批
  -> 并发收集多个 group 的 AI tableEdit
  -> 按失败结果重试 group 或整个 unified commit
  -> 所有 tableEdit 解析完成
  -> 所有表格修改提交完成
  -> 本轮填表相关运行时/持久状态刷新完成
  -> 确认不会再继续本轮填表
  -> [table_fill.after_commit]
  -> 填表流程外的后续动作
```

当前时间线：

```text
填表外层入口 processUpdatesBatch_ACU / orchestrateManualUpdate_ACU / 自动 grouped 入口 / import flow
  -> 所有内部 collect / retry / apply / persist / refresh 完成
  -> [table_fill.after_commit]
  -> 填表流程外的后续动作
```

已修正：`table_fill.after_commit` 不再由 `applyUnifiedGroupFillResponses_ACU()` 或 `executeCardUpdateCore_ACU()` 这类中段提交函数派发。它现在由外层填表入口在确认整轮填表完成后派发一次，并使用当前发送 request context。

## 6. 剧情推进任务

### 6.1 plot_worldbook.before_render

应有挂载点：

```text
剧情任务开始准备世界书上下文
  -> 根据任务 prompt 标签构造世界书触发文本
  -> 读取匹配的剧情世界书文本
  -> [plot_worldbook.before_render]
  -> 替换剧情世界书里的脚本变量
  -> 世界书内容进入任务 prompt 组装
```

这个挂载点成立，但它是渲染挂载点，不是剧情任务生命周期 hook。当前实现不再允许渲染函数自己创建临时 request；剧情世界书渲染、任务 hook、任务 prompt 变量替换都使用本轮发送 request。

结论：这里不审“按 task/request 隔离”。并发剧情任务属于同一轮发送，request 级输出按本轮共享；任务差异只能通过 `taskId` 体现在事件 payload、sourceContext 和任务临时状态里。

### 6.2 plot.before_task_request

应有挂载点：

```text
剧情任务确定
  -> 使用本轮发送 request
  -> 渲染剧情世界书
  -> 准备任务 prompt draft
  -> 写入脚本临时状态
  -> [plot.before_task_request]
  -> 替换最终任务 prompt 脚本变量
  -> AI 请求发出
```

当前时间线可以写成该挂载点。

已确认点：剧情任务 prompt draft 通过 `setScriptPromptDraft_ACU('plot_task', ..., taskId)` 写入，底层 key 是 `kind:taskId`；任务结果通过 `setScriptPlotTaskRuntimeResult_ACU(taskId, ...)` 写入 `Map<taskId, result>`。同阶段并发任务不会覆盖同一个裸全局槽位，除非配置层本身出现重复 taskId。

### 6.3 plot.after_task_response

应有挂载点：

```text
剧情任务 AI 请求成功结束
  -> 取得 rawResponse 并提取 tags
  -> 写入成功任务结果临时状态
  -> [plot.after_task_response]
```

当前时间线：

```text
AI 返回任务文本
  -> 提取标签和结构化片段
  -> 记录 rawResponse 和 extractedTags
  -> [plot.after_task_response]

用户 abort
  -> 直接抛出 abort
  -> 不执行 [plot.after_task_response]

非 abort 错误
  -> 构造失败状态
  -> 不执行 [plot.after_task_response]
```

这个挂载点只对成功任务成立。失败和 abort 都不触发，因为它是成功响应后的生命周期 hook，不是失败回调。

已确认点：abort 是用户主动停止，不构造成功任务结果，也不触发 `plot.after_task_response`。非 abort 失败只作为剧情编排内部失败结果返回，不触发脚本后置挂载点。

## 7. 手动保存表格

### 7.1 manual_table_save.after_commit

应有挂载点：

```text
用户提交手动保存
  -> 应用表格修改
  -> 持久化成功
  -> 当前运行时表格数据已更新
  -> [manual_table_save.after_commit]
```

旧 UI 当前时间线：

```text
用户保存
  -> applyVisualizerPendingDataOps_ACU 返回
  -> [manual_table_save.after_commit]
```

V2 UI 当前时间线：

```text
用户保存
  -> 执行一组 commit
  -> 汇总 committedSheetKeys
  -> [manual_table_save.after_commit]
```

这个 hook 能写成“提交成功且当前运行时表格数据已更新后”的挂载点。它不能被描述成“所有后续通知/可读世界书/向量队列/UI 刷新都完成后”的挂载点。

当前实现不再为 `manual_table_save.after_commit` 创建独立 request cycle。该 hook 使用当前 request context；不处于主发送轮次时也不额外发明 request 模型。

已确认点：

- 旧 UI 在 `applyVisualizerPendingDataOps_ACU()` 成功且 `changed === true` 后触发 hook，传入 `result.changedSheetKeys`。
- V2 UI 在每个 `runTableUpdateCommit_ACU()` 成功后汇总 `committedSheetKeys`，只在集合非空时触发 hook。
- 两条入口传入的都是“已提交成功的 sheet key 集合”，不是独立 request key，也不是 task key。

明确结论：

- `runTableUpdateCommit_ACU()` 成功返回前已经调用 `_set_currentJsonTableData_ACU(cloneTableData_ACU(applied.tableData))`，所以 hook 执行时读取 `currentJsonTableData_ACU` 可以看到提交后的表格运行时数据。
- 旧 UI 当前在 `runPostSaveRefresh_ACU()` 之前触发 hook；这个刷新函数后续执行 `refreshMergedDataAndNotifyWithUI_ACU()`、纪要向量索引入队、`updateReadableLorebookEntry_ACU()`、通知 UI 等动作。
- V2 UI 当前在 `refreshMergedDataAndNotify_ACU()`、纪要向量索引入队和表格更新通知之前触发 hook。
- `manual_table_save.after_commit` 的精确定义是“持久化提交成功且 `currentJsonTableData_ACU` 已更新后”。它不是“所有后续派生刷新/通知完成后”，也不需要等待这些后续副作用。

## 8. 模板脚本变量

模板脚本变量不是生命周期 hook，但仍然可以写成渲染挂载点。

应有挂载点：

```text
文本进入模板替换
  -> random/calc/db 等变量处理
  -> [script / script_output]
  -> if 等后续变量处理
  -> 返回最终文本
```

当前事实：

- `script` / `script_output` 在 `if` 前执行。
- 业务链调用统一模板替换入口且未显式传 `enableScript: false` 时，脚本变量会执行。
- 主回复里，即使模板总开关关闭，脚本变量仍会执行；关闭的只是 random/calc/db/if 等能力。
- 通用模板入口已提供 `enableScript: false`，正文优化等非正式生命周期渲染会显式关闭脚本变量。

已确认点：

- `replaceAcuTemplateVariables_ACU()` 默认执行脚本变量，只有调用方显式传 `enableScript: false` 时才禁用。
- 正文优化等非正式生命周期渲染已经显式传 `enableScript: false`。
- 主回复模板里，即使模板总开关关闭，脚本变量仍会执行；关闭的只是 random/calc/db/if 等普通模板能力。

明确结论：

- “脚本变量跟随模板总开关关闭”不是当前实现；当前实现明确选择“不跟随”。
- “拆出统一模板入口”不是当前 hook 时间线问题；当前入口已经有 `enableScript: false` 作为硬开关。
- 代码侧约束：所有预览、扫描、缓存、优化等非正式渲染入口必须显式传 `enableScript: false`。

## 9. 收敛结论

### 9.1 loaded hook 挂载点已收敛

`chat.loaded` / `db.loaded` 已经从混合 runner 拆成：

```text
准备 LoadedHookRuntime -> dispatchLoadedScriptHooks_ACU -> [hook]
```

当前挂载点链路是：

```text
CHAT_CHANGED
  -> 插件读取到稳定 chat/messages/metadata
  -> LoadedHookRuntime
  -> [chat.loaded]
```

`reference/SillyTavern/public/script.js` 已确认 `CHAT_CHANGED` 在 `chat_metadata` 和 `chat` 写入、`getChatResult()` 完成后触发；当前实现不再依赖固定延迟。

### 9.2 主回复 request 对齐

`before_generation` 已收敛到 main reply request lifecycle owner：入口创建 cycle，before/after 绑定同一个 requestId，after 完成或主动中止时结束 cycle。`before_generation` 的 request 级输出已确认能被后续 `CHAT_COMPLETION_SETTINGS_READY` 正文模板读取。依据 `reference/SillyTavern/public/script.js`，真实用户主发送走 `GENERATION_AFTER_COMMANDS`，脚本 API 直接生成走 `TavernHelper.generate`，二者不是同一次发送的两个阶段；两个入口各自创建 main reply request cycle 是正确边界。

### 9.3 after_response 回复定位不强

`after_response` 可以写成挂载点，且不再允许无 active request 时凭空创建 after request。依据 `reference/SillyTavern/public/script.js`，`GENERATION_ENDED` 传入的是 `chat.length`；当前实现已将该值归一化为 `chat.length - 1` 后定位回复文本，不再把最近 assistant 回退作为正常路径。

### 9.4 渲染挂载点副作用边界

世界书 before_render 和模板 `script` 变量都能写成渲染挂载点。当前约束是：正式业务渲染可以执行脚本；预览、扫描、缓存、优化等非正式渲染必须显式传 `enableScript: false` 或 `runScriptHook: false`。

### 9.5 request 输出清理

request 输出生命周期只由本轮 request owner 管理：`beginScriptRequestCycle_ACU()` 开启本轮 request，`endScriptRequestCycle_ACU()` 结束本轮 request。正文、填表、剧情和 worldbook 渲染都不再自建 request，也不在内部步骤里清理 request 输出。

### 9.6 manual_table_save.after_commit 非问题

`manual_table_save.after_commit` 当前实际语义是“持久化提交成功且 `currentJsonTableData_ACU` 已更新后”。这个位置正确。可读世界书、纪要向量队列、UI 通知等后续派生刷新不是该 hook 的前置条件；把 hook 后移只会把脚本挂载点绑到无关副作用后面，没有业务收益。

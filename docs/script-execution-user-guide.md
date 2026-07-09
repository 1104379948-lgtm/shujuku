# 脚本功能用户手册

## 这是什么

脚本功能允许你在数据库、填表、剧情推进、正文生成和手动保存等流程中运行自己的 JavaScript 逻辑。

你可以用脚本完成这些事情：

- 查询数据库并生成一段文本，插入到提示词或世界书中。
- 在填表前计算额外约束，让 AI 按规则更新表格。
- 在填表或手动保存后，自动生成派生字段、统计值或清洗数据。
- 在剧情推进任务前后读取任务上下文，补充变量、日志或结果。
- 在聊天加载、数据库加载完成后自动执行初始化逻辑。
- 为不同角色卡绑定不同脚本，也可以写全局脚本。

脚本不是新的数据库系统。脚本通过已有的公共 API 读写数据，保存仍走原本的数据库和表格保存链路。

## 安全提醒

脚本不是沙箱。

脚本会在当前页面中运行，拥有页面 JavaScript 权限。只导入、启用和运行你信任的脚本。

脚本运行时会收到一个 `ctx` 对象。本文后面会完整列出 `ctx` 里每个字段、`ctx.tavern` 的每个方法、`ctx.api` 当前公开的全部方法，以及每个挂载点的 `ctx.event` 字段。

脚本推荐通过 `ctx.api`、`ctx.tavern`、`ctx.log`、`ctx.event`、`ctx.input`、`ctx.config` 工作。下面逐项列出这些接口的字段、方法、参数和返回值。

不要依赖 `window`、宿主全局对象或页面内部变量。那些属于不受支持的脚本行为，版本变化后可能失效。

## 入口在哪里

打开插件界面中的“脚本管理”。

页面上可以做这些操作：

- 新增脚本
- 保存脚本
- 复制脚本
- 删除脚本
- 启用或禁用脚本
- 导入脚本包
- 导出当前脚本
- 导出全部脚本
- 设置作用域
- 设置挂载点
- 手动运行
- 查看执行日志

## 最简单的脚本

新增脚本后，在“函数体源码”里只写函数体，不需要写外层函数。

例如：

```js
ctx.log.info('脚本开始运行');
return '你好，这是脚本输出';
```

系统会自动把它包装成可运行函数。

你可以在任意支持脚本变量的文本位置写：

```text
{[script "脚本名称"]}
```

运行时，这个变量会执行脚本，并把脚本返回值替换到当前位置。

## 脚本返回值

脚本可以返回不同类型的值：

- 返回字符串：原样输出。
- 返回数字或布尔值：转成文本。
- 返回对象或数组：转成紧凑 JSON 文本。
- 返回 `null` 或 `undefined`：当作空字符串。

示例：

```js
return { mood: 'happy', score: 8 };
```

输出类似：

```json
{"mood":"happy","score":8}
```

## 用 JSON 输入调用脚本

脚本可以读取 `ctx.input`。

提示词里这样调用：

```text
{[script "统计最近事件" {"limit":5}]}
```

脚本里这样读取：

```js
const limit = ctx.input?.limit ?? 3;
ctx.log.info(`统计条数: ${limit}`);
return `本次统计 ${limit} 条`; 
```

也可以用脚本 ID 调用，避免脚本改名后变量失效：

```text
{[script id="script_xxx" input={"limit":5}]}
```

脚本 ID 可以在脚本列表卡片中看到。

## 默认变量输入 JSON

每个脚本都有“默认变量输入 JSON”。

当你用 `{[script "脚本名称"]}` 调用脚本，但没有传入 input 时，脚本可以使用这个默认输入。

适合放这些配置：

- 默认查询条数
- 默认表名
- 默认过滤条件
- 默认格式选项

示例默认输入：

```json
{"limit":5,"format":"brief"}
```

脚本中读取：

```js
const limit = ctx.input?.limit ?? 5;
const format = ctx.input?.format ?? 'brief';
return `limit=${limit}, format=${format}`;
```

## 作用域

脚本有两种作用域。

全局：

- 对所有角色卡生效。
- 适合通用统计、通用清洗、通用提示词变量。

角色卡：

- 只对指定角色卡生效。
- 适合某个角色专用规则、专用表格、专用剧情逻辑。

设置角色卡作用域时，可以点击“绑定当前角色”。系统会读取当前角色卡名称并填入。

## 启用和禁用

脚本本身有“启用脚本”开关。

绑定挂载点也有单独的启用开关。

脚本会自动运行，必须同时满足：

- 脚本本身已启用。
- 当前作用域匹配。
- 绑定的挂载点已启用。
- 当前流程触发了这个挂载点。

禁用脚本后：

- 挂载点不会自动运行它。
- 脚本变量通常也不会执行它。
- 手动运行用于调试时仍可能选择执行保存后的脚本，具体以页面提示为准。

## 排序

脚本有“排序”。绑定也有“binding order”。

当多个脚本绑定到同一个挂载点时，系统会按稳定顺序执行。

建议：

- 需要先运行的脚本设置较小排序值。
- 依赖其他脚本输出的脚本放到后面。
- 不要让多个脚本争抢同一个输出 key。

## `ctx` 完整说明

每次脚本运行时，系统都会把 `ctx` 传给你的脚本函数体。

你写的函数体：

```js
ctx.log.info(ctx.callType);
return 'done';
```

实际会以类似下面的形式运行：

```js
async function run(ctx) {
  ctx.log.info(ctx.callType);
  return 'done';
}
```

### `ctx` 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ctx.apiVersion` | `number` | 脚本上下文版本。当前为 `1`。 |
| `ctx.hook` | `string \| undefined` | 当前挂载点名称。变量调用脚本没有挂载点时可能为空。 |
| `ctx.callType` | `'hook' \| 'variable' \| 'manual'` | 调用来源：挂载点自动运行、脚本变量运行、手动运行。 |
| `ctx.variable` | `object \| undefined` | 通过 `{[script ...]}` 调用时的变量解析信息。非变量调用时为空。 |
| `ctx.config` | 任意 JSON 值 | 当前绑定的 `config JSON`。未配置时是 `{}`。 |
| `ctx.input` | 任意 JSON 值 | 变量调用或手动运行传入的 JSON。没有输入时是 `{}`；变量调用未传 input 时会使用脚本的“默认变量输入 JSON”。 |
| `ctx.event` | `object` | 当前挂载点事件载荷。每个挂载点的字段见“挂载点事件字段”。 |
| `ctx.source` | `object` | 当前调用链来源信息，例如 prompt 类型、sourceType、任务 ID 等。主要用于诊断。 |
| `ctx.scope` | `object` | 当前聊天和角色作用域信息。 |
| `ctx.api` | `object` | 插件公开 API。全部方法见“`ctx.api` 完整接口”。 |
| `ctx.tavern` | `object` | 酒馆上下文读取接口。全部方法见“`ctx.tavern` 完整接口”。 |
| `ctx.outputs` | `object` | 读取已产生的脚本命名输出。 |
| `ctx.controller` | `object \| undefined` | 当前挂载点提供的流程控制器。只有部分挂载点有。 |
| `ctx.log` | `object` | 脚本日志接口。 |
| `ctx.signal` | `AbortSignal` | 脚本超时或中止时会变为 aborted。长任务应主动检查。 |

### `ctx.scope`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ctx.scope.chatId` | `string` | 当前聊天 ID。读取不到时为空字符串。 |
| `ctx.scope.characterName` | `string` | 当前角色卡名称。角色卡作用域匹配会用它。 |

示例：

```js
ctx.log.info(`chat=${ctx.scope.chatId}, character=${ctx.scope.characterName}`);
return ctx.scope.characterName;
```

### `ctx.log`

| 方法 | 说明 |
| --- | --- |
| `ctx.log.info(...args)` | 写 info 日志。 |
| `ctx.log.warn(...args)` | 写 warn 日志。 |
| `ctx.log.error(...args)` | 写 error 日志。 |
| `ctx.log.debug(...args)` | 写 debug 日志。 |

参数会被转成字符串并显示在脚本管理页的执行日志中。

示例：

```js
ctx.log.info('开始处理', ctx.event);
ctx.log.warn('这是一条警告');
ctx.log.error('这是一条错误日志');
```

### `ctx.outputs`

脚本可以读取已经产生的命名输出。

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `ctx.outputs.get(key, options?)` | 任意值或 `undefined` | 读取指定 `outputKey` 的原始返回值。 |

`options` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ttl` | `'request' \| 'chat' \| 'session'` | 输出生命周期。不传时读取 `request` 输出。 |
| `defaultValue` | 任意值 | 找不到输出时返回的默认值。不传时返回 `undefined`。 |

示例：

```js
const hint = ctx.outputs.get('fillHint');
if (!hint) return '没有前序填表提示';
return `前序提示：${typeof hint === 'string' ? hint : JSON.stringify(hint)}`;
```

带默认值：

```js
const hint = ctx.outputs.get('fillHint', { defaultValue: '暂无额外提示' });
return `前序提示：${hint}`;
```

说明：

- 只能读取已经执行完成并写入 `outputKey` 的脚本输出。
- 同一个挂载点下，排序靠后的脚本可以读取排序靠前脚本的输出。
- 排序靠前的脚本不能读取排序靠后脚本尚未产生的输出。
- `request` 输出只在当前请求周期内有效。
- `chat` 输出按当前聊天和角色隔离。
- `session` 输出按当前角色隔离。
- 找不到输出时返回 `options.defaultValue`；没有设置默认值时返回 `undefined`。

### `ctx.controller`

部分挂载点会提供流程控制器。没有控制器的挂载点里，`ctx.controller` 是 `undefined`。

当前 `plot.after_stage` 提供剧情推进阶段控制器。

| 方法 | 说明 |
| --- | --- |
| `ctx.controller.skipStage(stage, reason?)` | 跳过后续指定 stage。 |
| `ctx.controller.skipStages(stages, reason?)` | 跳过后续多个 stage。 |
| `ctx.controller.stop(reason?)` | 停止后续剧情推进 stage。 |

示例：

```js
const route = ctx.outputs.get('route', { defaultValue: 'normal' });
if (route === 'talk') {
  ctx.controller?.skipStage(2, '进入谈判路线，跳过战斗阶段');
}
if (route === 'end') {
  ctx.controller?.stop('剧情已经结束');
}
return `路线判断：${route}`;
```

说明：

- `ctx.controller` 的调用不影响脚本返回值。
- 脚本返回值仍然按普通规则处理；如果绑定设置了 `outputKey`，返回值照常保存。
- 同一个 hook 下多个脚本按排序依次执行，控制结果会合并。
- 脚本执行失败时，本次脚本里调用过的 controller 操作不会提交。

### `ctx.variable`

这一节只和 `{[script ...]}` 有关。

当你在提示词、世界书或其他文本里写：

```text
{[script "统计最近事件" {"limit":5}]}
```

系统会执行名为“统计最近事件”的脚本。脚本 `return` 的内容会替换掉这整段变量。

例如脚本写：

```js
return '最近发生了 5 件重要事件';
```

那么文本里的：

```text
{[script "统计最近事件" {"limit":5}]}
```

最终会变成：

```text
最近发生了 5 件重要事件
```

`ctx.variable` 的作用只是让脚本知道“我是被哪一段 `{[script ...]}` 变量调用的”。大多数脚本不需要读取它，直接用 `ctx.input` 就够了。

| 字段 | 说明 |
| --- | --- |
| `ctx.variable.raw` | 这次触发脚本的完整原始变量文本。例如 `{[script "统计最近事件" {"limit":5}]}`。 |
| `ctx.variable.scriptId` | 如果用户用 `{[script id="script_xxx"]}` 调用脚本，这里是那个脚本 ID。 |
| `ctx.variable.scriptName` | 如果用户用 `{[script "脚本名称"]}` 调用脚本，这里是那个脚本名称。 |
| `ctx.variable.input` | 变量里传入的 JSON 输入，和 `ctx.input` 是同一份输入。一般直接读 `ctx.input` 更简单。 |
| `ctx.variable.errorPlaceholder` | 变量里配置的错误占位文本。例如 `{[script "统计" error="统计失败"]}` 里的 `统计失败`。 |

最常用写法：

```js
const limit = ctx.input?.limit ?? 3;
return `本次统计 ${limit} 条`;
```

如果你想调试这段脚本是从哪条变量来的，可以这样写：

```js
ctx.log.info('变量原文:', ctx.variable?.raw || '不是变量调用');
ctx.log.info('变量输入:', ctx.input);
return '调试完成';
```

## `ctx.tavern` 完整接口

`ctx.tavern` 直接等于酒馆官方的 `SillyTavern.getContext()` 返回值，不做二次封装，不删字段，不改方法名。

因此你在脚本里可以按酒馆扩展写法直接用：

```js
const chat = ctx.tavern.chat;
const metadata = ctx.tavern.chatMetadata;
const rendered = ctx.tavern.substituteParams('角色：{{char}}，用户：{{user}}');
```

如果当前页面还没有提供 `SillyTavern.getContext()`，`ctx.tavern` 会是 `{}`。

### 基础状态字段

| 字段 | 说明 |
| --- | --- |
| `ctx.tavern.chat` | 当前聊天消息数组。消息对象通常包含 `mes`、`name`、`is_user`、`is_system`、`message_id`、`extra` 等字段。 |
| `ctx.tavern.characters` | 角色列表。 |
| `ctx.tavern.groups` | 群组列表。 |
| `ctx.tavern.name1` | 当前用户名。 |
| `ctx.tavern.name2` | 当前角色名或当前聊天显示角色名。 |
| `ctx.tavern.characterId` | 当前角色在酒馆角色列表中的 ID。 |
| `ctx.tavern.groupId` | 当前群组 ID。非群聊时通常为空。 |
| `ctx.tavern.chatId` | 当前聊天 ID。 |
| `ctx.tavern.chatMetadata` | 当前聊天元数据对象。 |
| `ctx.tavern.onlineStatus` | 当前连接状态。 |
| `ctx.tavern.maxContext` | 当前最大上下文长度。 |
| `ctx.tavern.mainApi` | 当前主 API 类型。 |
| `ctx.tavern.extensionSettings` | 酒馆扩展设置对象。 |
| `ctx.tavern.powerUserSettings` | 酒馆 power user 设置对象。 |
| `ctx.tavern.chatCompletionSettings` | 酒馆聊天补全设置对象。 |
| `ctx.tavern.textCompletionSettings` | 酒馆文本补全设置对象。 |
| `ctx.tavern.extensionPrompts` | 当前扩展注入 prompt 集合。 |
| `ctx.tavern.tags` | 标签列表。 |
| `ctx.tavern.tagMap` | 标签映射。 |
| `ctx.tavern.menuType` | 当前右侧菜单类型。 |
| `ctx.tavern.createCharacterData` | 当前创建/编辑角色用的数据对象。 |

读取最近消息示例：

```js
const messages = Array.isArray(ctx.tavern.chat) ? ctx.tavern.chat : [];
const last = messages[messages.length - 1];
return last?.mes || '';
```

读取当前角色示例：

```js
const id = ctx.tavern.characterId;
const character = ctx.tavern.characters?.[id];
return character?.name || ctx.tavern.name2 || '';
```

### 聊天和消息方法

| 方法 | 说明 |
| --- | --- |
| `ctx.tavern.getCurrentChatId()` | 返回当前聊天 ID。 |
| `ctx.tavern.reloadCurrentChat()` | 重载当前聊天。 |
| `ctx.tavern.renameChat(...)` | 重命名聊天。 |
| `ctx.tavern.saveChat(...)` | 保存聊天。 |
| `ctx.tavern.saveMetadata()` | 保存聊天元数据。 |
| `ctx.tavern.saveMetadataDebounced()` | 防抖保存聊天元数据。 |
| `ctx.tavern.updateChatMetadata(...)` | 更新聊天元数据。 |
| `ctx.tavern.addOneMessage(...)` | 向界面添加一条消息。 |
| `ctx.tavern.deleteLastMessage(...)` | 删除最后一条消息。 |
| `ctx.tavern.deleteMessage(...)` | 删除指定消息。 |
| `ctx.tavern.updateMessageBlock(...)` | 更新指定消息块显示。 |
| `ctx.tavern.printMessages(...)` | 重新打印消息。 |
| `ctx.tavern.clearChat()` | 清空当前聊天。 |
| `ctx.tavern.sendSystemMessage(...)` | 发送系统消息。 |
| `ctx.tavern.saveReply(...)` | 保存回复。 |
| `ctx.tavern.openCharacterChat(...)` | 打开角色聊天。 |
| `ctx.tavern.openGroupChat(...)` | 打开群聊。 |

更新聊天元数据示例：

```js
ctx.tavern.chatMetadata.my_script_note = '已处理';
await ctx.tavern.saveMetadata();
return 'metadata saved';
```

### 生成和请求方法

| 方法 | 说明 |
| --- | --- |
| `ctx.tavern.generate(...)` | 触发酒馆生成。 |
| `ctx.tavern.generateQuietPrompt(...)` | 执行安静生成。 |
| `ctx.tavern.generateRaw(...)` | 原始生成接口。 |
| `ctx.tavern.generateRawData(...)` | 原始生成数据接口。 |
| `ctx.tavern.sendGenerationRequest(...)` | 发送生成请求。 |
| `ctx.tavern.sendStreamingRequest(...)` | 发送流式请求。 |
| `ctx.tavern.stopGeneration()` | 停止当前生成。 |
| `ctx.tavern.getRequestHeaders(...)` | 获取请求头。 |
| `ctx.tavern.ConnectionManagerRequestService` | 酒馆连接管理请求服务。 |
| `ctx.tavern.ChatCompletionService` | 聊天补全请求服务。 |
| `ctx.tavern.TextCompletionService` | 文本补全请求服务。 |

### 宏、变量和 slash command

| 方法或字段 | 说明 |
| --- | --- |
| `ctx.tavern.substituteParams(text, options?)` | 替换酒馆宏，例如 `{{user}}`、`{{char}}`。 |
| `ctx.tavern.substituteParamsExtended(text, additionalMacro?)` | 扩展宏替换。 |
| `ctx.tavern.macros` | 酒馆宏系统。 |
| `ctx.tavern.variables.local` | 当前聊天局部变量操作集合，含 `get`、`set`、`del`、`add`、`inc`、`dec`、`has`。 |
| `ctx.tavern.variables.global` | 全局变量操作集合，含 `get`、`set`、`del`、`add`、`inc`、`dec`、`has`。 |
| `ctx.tavern.executeSlashCommandsWithOptions(...)` | 执行 slash command。 |
| `ctx.tavern.executeSlashCommands(...)` | 旧 slash command 执行入口。 |
| `ctx.tavern.SlashCommandParser` | slash command 解析器。 |
| `ctx.tavern.SlashCommand` | slash command 类型。 |

宏替换示例：

```js
return ctx.tavern.substituteParams('当前用户是 {{user}}，当前角色是 {{char}}');
```

变量示例：

```js
ctx.tavern.variables.local.set('last_script_run', String(Date.now()));
return ctx.tavern.variables.local.get('last_script_run');
```

### 事件方法

| 字段或方法 | 说明 |
| --- | --- |
| `ctx.tavern.eventSource` | 酒馆事件总线。 |
| `ctx.tavern.eventTypes` | 酒馆事件名表。 |
| `ctx.tavern.event_types` | 兼容旧命名的事件名表。 |

示例：

```js
const eventName = ctx.tavern.eventTypes?.MESSAGE_UPDATED;
if (eventName) {
  ctx.tavern.eventSource.emit(eventName, 0);
}
return 'event emitted';
```

### 扩展 prompt 和 UI 方法

| 方法或字段 | 说明 |
| --- | --- |
| `ctx.tavern.setExtensionPrompt(...)` | 设置扩展 prompt 注入。 |
| `ctx.tavern.extensionPrompts` | 当前扩展 prompt 集合。 |
| `ctx.tavern.activateSendButtons()` | 启用发送按钮。 |
| `ctx.tavern.deactivateSendButtons()` | 禁用发送按钮。 |
| `ctx.tavern.callGenericPopup(...)` | 打开通用弹窗。 |
| `ctx.tavern.Popup` | 弹窗类。 |
| `ctx.tavern.POPUP_TYPE` | 弹窗类型常量。 |
| `ctx.tavern.POPUP_RESULT` | 弹窗结果常量。 |
| `ctx.tavern.loader` | 酒馆 loader 对象。 |
| `ctx.tavern.renderExtensionTemplateAsync(...)` | 渲染扩展模板。 |
| `ctx.tavern.openThirdPartyExtensionMenu(...)` | 打开第三方扩展菜单。 |

### 角色、群组、标签和世界书方法

| 方法或字段 | 说明 |
| --- | --- |
| `ctx.tavern.getCharacters(...)` | 获取角色列表。 |
| `ctx.tavern.getOneCharacter(...)` | 获取一个角色。 |
| `ctx.tavern.getCharacterCardFields(...)` | 获取角色卡字段。 |
| `ctx.tavern.getCharacterSource(...)` | 获取角色来源。 |
| `ctx.tavern.selectCharacterById(...)` | 选择角色。 |
| `ctx.tavern.unshallowCharacter(...)` | 展开角色数据。 |
| `ctx.tavern.unshallowGroupMembers(...)` | 展开群组成员数据。 |
| `ctx.tavern.importTags(...)` | 导入标签。 |
| `ctx.tavern.loadWorldInfo(...)` | 加载世界书。 |
| `ctx.tavern.saveWorldInfo(...)` | 保存世界书。 |
| `ctx.tavern.reloadWorldInfoEditor(...)` | 重载世界书编辑器。 |
| `ctx.tavern.updateWorldInfoList(...)` | 更新世界书列表。 |
| `ctx.tavern.convertCharacterBook(...)` | 转换角色书。 |
| `ctx.tavern.getWorldInfoPrompt(...)` | 获取世界书 prompt。 |
| `ctx.tavern.getWorldInfoNames()` | 获取世界书名称列表。 |

### Token、媒体、滑动和工具调用

| 方法或字段 | 说明 |
| --- | --- |
| `ctx.tavern.tokenizers` | tokenizer 集合。 |
| `ctx.tavern.getTextTokens(...)` | 获取文本 token。 |
| `ctx.tavern.getTokenCount(...)` | 获取 token 数，官方标记为旧接口。 |
| `ctx.tavern.getTokenCountAsync(...)` | 异步获取 token 数。 |
| `ctx.tavern.getTokenizerModel()` | 获取 tokenizer 模型。 |
| `ctx.tavern.appendMediaToMessage(...)` | 给消息追加媒体。 |
| `ctx.tavern.ensureMessageMediaIsArray(...)` | 确保消息媒体字段为数组。 |
| `ctx.tavern.getMediaDisplay(...)` | 获取媒体显示信息。 |
| `ctx.tavern.getMediaIndex(...)` | 获取媒体索引。 |
| `ctx.tavern.scrollChatToBottom(...)` | 滚动聊天到底部。 |
| `ctx.tavern.scrollOnMediaLoad(...)` | 媒体加载后滚动。 |
| `ctx.tavern.swipe.left()` | 左滑。 |
| `ctx.tavern.swipe.right()` | 右滑。 |
| `ctx.tavern.swipe.to(...)` | 滑动到指定 swipe。 |
| `ctx.tavern.swipe.show()` | 显示 swipe 按钮。 |
| `ctx.tavern.swipe.hide()` | 隐藏 swipe 按钮。 |
| `ctx.tavern.swipe.refresh()` | 刷新 swipe 按钮。 |
| `ctx.tavern.swipe.isAllowed()` | 是否允许 swipe。 |
| `ctx.tavern.swipe.state()` | 当前 swipe 状态。 |
| `ctx.tavern.registerFunctionTool(...)` | 注册函数工具。 |
| `ctx.tavern.unregisterFunctionTool(...)` | 注销函数工具。 |
| `ctx.tavern.isToolCallingSupported()` | 是否支持工具调用。 |
| `ctx.tavern.canPerformToolCalls()` | 当前是否能执行工具调用。 |
| `ctx.tavern.ToolManager` | 工具调用管理器。 |

## `ctx.api` 完整接口

`ctx.api` 是当前插件挂到 `AutoCardUpdaterAPI` 上的公开方法集合。脚本里调用时写 `ctx.api.方法名(...)`。

下面列出当前全部公开方法。带 `_` 开头的方法是内部通知入口，脚本通常不需要主动调用，除非你明确知道要刷新对应回调。

### 回调 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `registerTableUpdateCallback(callback)` | `void` | 注册表格更新回调。回调参数是最新表格 JSON。 |
| `unregisterTableUpdateCallback(callback)` | `void` | 注销表格更新回调。 |
| `_notifyTableUpdate()` | `void` | 内部通知：触发表格更新回调。 |
| `registerTableFillStartCallback(callback)` | `void` | 注册填表开始回调。 |
| `_notifyTableFillStart()` | `void` | 内部通知：触发填表开始回调。 |

### 表格 CRUD API

这些方法支持中文显示表名、英文物理表名；列名支持中文表头或英文列名。`rowIndex` 从 `1` 开始表示第一行数据，`0` 是表头。

通用 options：

| 参数 | 说明 |
| --- | --- |
| `skipChatSave` / `skipSave` / `isImportMode` | 为 true 时不写入聊天持久化。谨慎使用。 |
| `skipNotify` / `silent` / `isSilent` / `suppressNotify` / `suppressNotification` | 为 true 时减少 UI 通知。 |

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `updateCell(tableName, rowIndex, colIdentifier, value)` | `Promise<boolean>` | 更新单元格。`colIdentifier` 可传列名或列索引。 |
| `updateCell({ tableName, rowIndex, colIdentifier, value, ...options })` | `Promise<boolean>` | 对象参数写法。也接受 `table`、`sheetName`、`name`，`row`、`index`，`column`、`colName`、`colIndex`、`columnIndex`。 |
| `updateRow(tableName, rowIndex, data)` | `Promise<boolean>` | 更新一行的多个字段。 |
| `updateRow({ tableName, rowIndex, data, ...options })` | `Promise<boolean>` | 对象参数写法。`data` 也可写作 `values` 或 `rowData`。 |
| `insertRow(tableName, data)` | `Promise<number>` | 插入一行，返回新行索引；失败返回 `-1`。 |
| `insertRow({ tableName, data, ...options })` | `Promise<number>` | 对象参数写法。 |
| `deleteRow(tableName, rowIndex)` | `Promise<boolean>` | 删除一行。不能删除表头行。 |
| `deleteRow({ tableName, rowIndex, ...options })` | `Promise<boolean>` | 对象参数写法。 |

示例：

```js
await ctx.api.updateCell('角色表', 1, '好感度', 80);
await ctx.api.updateRow('角色表', 1, { 好感度: 90, 状态: '开心' });
const newIndex = await ctx.api.insertRow('事件表', { 事件: '发现线索', 地点: '图书馆' });
return `新增行：${newIndex}`;
```

### 表格锁定 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getTableLockState(sheetKey)` | `{ rows:number[], cols:number[], cells:string[] } \| null` | 读取某个 sheet 的锁定状态。 |
| `setTableLockState(sheetKey, lockState, options?)` | `boolean` | 设置锁定状态。`options.merge=true` 时合并到现有锁定。 |
| `clearTableLocks(sheetKey)` | `boolean` | 清空某个 sheet 的行/列/单元格锁定。 |
| `lockTableRow(sheetKey, rowIndex, locked=true)` | `boolean` | 锁定或解锁行。 |
| `lockTableCol(sheetKey, colIndex, locked=true)` | `boolean` | 锁定或解锁列。 |
| `lockTableCell(sheetKey, rowIndex, colIndex, locked=true)` | `boolean` | 锁定或解锁单元格。 |
| `toggleTableRowLock(sheetKey, rowIndex)` | `boolean` | 切换行锁定。 |
| `toggleTableColLock(sheetKey, colIndex)` | `boolean` | 切换列锁定。 |
| `toggleTableCellLock(sheetKey, rowIndex, colIndex)` | `boolean` | 切换单元格锁定。 |
| `getSpecialIndexLockEnabled(sheetKey)` | `boolean \| null` | 读取特殊索引锁定开关。 |
| `setSpecialIndexLockEnabled(sheetKey, enabled)` | `boolean` | 设置特殊索引锁定开关。 |

示例：

```js
ctx.api.lockTableRow('sheet_0', 1, true);
return ctx.api.getTableLockState('sheet_0');
```

### SQL API

SQL API 适合复杂查询和批量写入。读取类只允许 `SELECT`、`PRAGMA`、`EXPLAIN`、`WITH` 等只读语句。

SQL 参数写法：

```js
ctx.api.querySql('SELECT * FROM `people` WHERE name = ?', ['小玉']);
ctx.api.querySql({ sql: 'SELECT * FROM `people` LIMIT 5', limit: 5, offset: 0 });
```

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `executeSqlQuery(sqlOrOptions, params?, options?)` | `PublicSqlQueryResult \| null` | 执行只读 SQL 查询。 |
| `querySql(sqlOrOptions, params?, options?)` | `PublicSqlQueryResult \| null` | `executeSqlQuery` 的别名。 |
| `queryTableRows(options)` | `PublicSqlQueryResult \| null` | 按表、列、过滤条件构造查询。 |
| `executeSqlMutation(sqlOrOptions, params?, options?)` | `Promise<PublicSqlMutationResult>` | 执行单条写入 SQL，并走标准提交链路。 |
| `executeSqlBatch(sqlOrOptions, options?)` | `Promise<PublicSqlBatchResult>` | 执行多条写入 SQL 批处理；不支持 params。 |
| `executeSql(sqlOrOptions, params?, options?)` | `Promise<{ type:'query'\|'mutation', result:any } \| null>` | 自动判断读写；读走查询，写走 mutation。 |

常见查询返回结构：

```ts
{
  columns: string[];
  rows: any[][];
  objects?: Record<string, any>[];
  sql?: string;
  limit?: number;
  offset?: number;
}
```

常见写入返回结构：

```ts
{
  changes: number;
  errors: string[];
  saved?: boolean;
  messageIndex?: number;
}
```

示例：

```js
const result = ctx.api.querySql('SELECT name, score FROM `people` ORDER BY score DESC LIMIT 3');
const rows = result?.objects || [];
return rows.map(row => `${row.name}: ${row.score}`).join('\n');
```

写入示例：

```js
const result = await ctx.api.executeSqlMutation(
  'UPDATE `people` SET score = ? WHERE name = ?',
  [100, '小玉']
);
if (result.errors?.length) throw new Error(result.errors.join('; '));
return `更新 ${result.changes} 行`;
```

### 模板预设 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getTemplatePresetNames()` | `string[]` | 获取模板预设名称列表。 |
| `switchTemplatePreset(presetName, options?)` | `Promise<{ success:boolean, scope:string, message:string }>` | 切换模板预设。`options.scope` 可为 `global` 或 `chat`。 |
| `injectTemplatePresetToCurrentChat(presetName)` | `Promise<{ success:boolean, message:string }>` | 把模板预设应用到当前聊天。 |
| `importTemplateFromData(templateData, options?)` | `Promise<{ success:boolean, message:string, presetName?:string }>` | 从对象或字符串导入模板。`options.scope` 可为 `global` 或 `chat`。 |
| `getTableTemplate(options?)` | `object \| null` | 获取模板 JSON。`options.scope` 可为 `chat` 或 `global`，也可传 `presetName`。 |

### 剧情推进预设 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getPlotPresets()` | `object[]` | 获取剧情推进预设列表。 |
| `getCurrentPlotPreset()` | `string` | 获取当前聊天生效的剧情推进预设名。 |
| `switchPlotPreset(presetName)` | `boolean` | 切换当前聊天剧情推进预设。 |
| `injectPlotPresetToCurrentChat(presetName)` | `boolean` | 将剧情推进预设注入当前聊天。 |
| `getPlotPresetDetails(presetName)` | `object \| null` | 获取某个剧情推进预设详情。 |
| `getPlotPresetNames()` | `string[]` | 获取剧情推进预设名称列表。 |
| `importPlotPresetFromData(presetData, options?)` | `Promise<{ success:boolean, message:string, presetName?:string }>` | 导入一个剧情推进预设。`options.overwrite` 控制覆盖，`options.switchTo` 控制导入后是否切换。 |
| `importPlotPresetsFromData(presetsArray, options?)` | `Promise<{ success:boolean, message:string, imported:number, failed:number, details:any[] }>` | 批量导入剧情推进预设。 |
| `exportAllPlotPresets()` | `object[]` | 导出全部剧情推进预设。 |
| `initGameSession(characterData, options?)` | `Promise<object>` | 游戏初始化：可注入模板、加载剧情预设、刷新设置。 |

### 设置和配置 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `openVisualizer()` | `void` | 打开可视化编辑器。 |
| `openSettings()` | `Promise<any \| false>` | 打开设置面板。 |
| `manualUpdate()` | `Promise<any \| false>` | 执行手动更新。 |
| `getUpdateConfigParams()` | `{ autoUpdateThreshold:number, autoUpdateFrequency:number, updateBatchSize:number, autoUpdateTokenThreshold:number }` | 获取更新参数。 |
| `setUpdateConfigParams(params)` | `boolean` | 设置更新参数并保存。 |
| `getManualSelectedTables()` | `{ selectedTables:string[], hasManualSelection:boolean }` | 获取手动更新选中的表。 |
| `setManualSelectedTables(sheetKeys)` | `boolean` | 设置手动更新选中的表。 |
| `clearManualSelectedTables()` | `boolean` | 清空手动选表。 |
| `getApiPresets()` | `object[]` | 获取 API 预设列表。 |
| `getTableApiPreset()` | `string` | 获取填表 API 预设名。 |
| `setTableApiPreset(presetName)` | `boolean` | 设置填表 API 预设；空字符串表示使用当前配置。 |
| `getPlotApiPreset()` | `string` | 获取剧情推进 API 预设名。 |
| `setPlotApiPreset(presetName)` | `boolean` | 设置剧情推进 API 预设；空字符串表示使用当前配置。 |
| `saveApiPreset(presetData)` | `boolean` | 保存 API 预设。 |
| `loadApiPreset(presetName)` | `boolean` | 加载 API 预设到当前配置。 |
| `deleteApiPreset(presetName)` | `boolean` | 删除 API 预设。 |

### 世界书和 AI API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `syncWorldbookEntries(options?)` | `Promise<boolean>` | 同步可读世界书注入条目。`options.createIfNeeded` 默认为 true。 |
| `refreshDataAndWorldbook()` | `Promise<boolean>` | 刷新运行时数据并更新世界书。 |
| `renderWorldbookForPrompt(scanText, options?)` | `Promise<string>` | 按正式填表世界书链路渲染当前扫描文本可见的世界书内容，会处理世界书触发、过滤和数据库/SQL/脚本变量。 |
| `reoptimizeMessage(messageIndex)` | `Promise<any \| false>` | 重新优化指定消息。 |
| `cancelContentOptimization(reason)` | `boolean` | 取消正文优化。 |
| `deleteInjectedEntries()` | `Promise<boolean>` | 删除插件生成的世界书注入条目。 |
| `setOutlineEntryEnabled(enabled)` | `Promise<boolean>` | 设置大纲条目启用状态。 |
| `setZeroTkOccupyMode(modeEnabled)` | `Promise<boolean>` | 设置 0TK 占用模式。 |
| `callAI(messages, options?)` | `Promise<string \| null>` | 调用 AI。`messages` 为 `{ role, content }[]`。`options.presetName` 可指定 API 预设。 |
| `getStoryContext(maxTurns?)` | `string` | 获取最近若干轮 AI 剧情文本，默认 3 轮。 |

AI 调用示例：

```js
const text = await ctx.api.callAI([
  { role: 'system', content: '请简短总结。' },
  { role: 'user', content: ctx.event.aiResponse || ctx.tavern.chat?.at?.(-1)?.mes || '' },
], { presetName: ctx.config.presetName || '' });
return text || '';
```

### 数据管理和导入 API

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `importTemplate(options?)` | `Promise<any \| false>` | 打开或执行模板导入流程。 |
| `exportTemplate(options?)` | `Promise<any \| false>` | 导出模板。 |
| `resetTemplate(options?)` | `Promise<any \| false>` | 重置模板。 |
| `resetAllDefaults()` | `Promise<any \| false>` | 重置全部默认设置。 |
| `exportJsonData()` | `Promise<any \| false>` | 导出当前 JSON 数据。 |
| `importCombinedSettings()` | `Promise<any \| false>` | 导入组合设置。 |
| `exportCombinedSettings()` | `Promise<any \| false>` | 导出组合设置。 |
| `overrideWithTemplate()` | `Promise<any \| false>` | 用模板覆盖当前数据层。 |
| `migrateLegacyVectorIndex()` | `Promise<any \| false>` | 执行向量索引维护工具。普通脚本不建议调用。 |
| `openVisualizer()` | `Promise<any \| false> \| void` | 打开可视化编辑器。该方法在设置 API 和数据管理 API 中都存在。 |
| `importTxtAndSplit()` | `Promise<any \| false>` | 导入 TXT 并拆分。 |
| `injectImportedSelected()` | `Promise<any \| false>` | 注入选中的导入片段。 |
| `injectImportedStandard()` | `Promise<any \| false>` | 标准模式注入导入片段。 |
| `injectImportedSummary()` | `Promise<any \| false>` | 纪要模式注入导入片段。 |
| `injectImportedFull()` | `Promise<any \| false>` | 全量模式注入导入片段。 |
| `deleteImportedEntries()` | `Promise<any \| false>` | 删除导入条目。 |
| `clearImportedEntries(clearAll?)` | `Promise<any \| false>` | 清理导入条目。 |
| `clearImportCache(clearAll?)` | `Promise<any \| false>` | 清理导入缓存。 |
| `mergeSummaryNow()` | `Promise<any \| false>` | 立即执行手动合并总结。 |

### 脚本管理 API

这些方法也会出现在 `ctx.api` 上。脚本一般不需要在运行时改写脚本配置，但如果你写的是管理脚本，可以使用它们。

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `listUserScripts()` | `UserScriptDefinition[]` | 获取脚本列表快照。 |
| `saveUserScript(script)` | `{ success:boolean, script?:object, id?:string, saved?:boolean, error?:string }` | 保存或更新一个脚本。 |
| `deleteUserScript(scriptId)` | `{ success:boolean, deleted?:boolean, scriptId?:string, error?:string }` | 删除脚本。 |
| `exportUserScripts(scriptIds?)` | `object` | 导出脚本包；不传则导出全部。 |
| `importUserScripts(payload)` | `{ success:boolean, scripts?:object[], importedCount?:number, ids?:string[], error?:string }` | 导入脚本包。 |
| `getScriptLogs(scriptId?)` | `ScriptLogEntry[]` | 获取脚本日志；传 `scriptId` 时只看该脚本。 |
| `runScriptHook(hook, options?)` | `Promise<{ success:boolean, mode?:string, warning?:string, hook?:string, results?:any[], error?:string }>` | 调试/兼容入口，正式生命周期 hook 由业务流程触发。 |
| `runScriptVariable(call, options?)` | `Promise<{ success:boolean, result?:any, error?:string }>` | 手动执行脚本变量调用。 |
| `runScriptManual(scriptId, options?)` | `Promise<{ success:boolean, result?:any, error?:string }>` | 手动运行脚本。 |
| `clearScriptRequestOutputs()` | `void` | 清理 request 输出。 |
| `clearScriptChatOutputs()` | `void` | 清理 chat 输出。 |
| `clearAllScriptOutputs()` | `void` | 清理全部脚本输出。 |

## 挂载点是什么

挂载点决定脚本什么时候自动运行。

脚本不会因为存在就自动执行。只有绑定到挂载点，并且流程走到对应时刻，才会运行。

每个挂载点都会把事件信息放在 `ctx.event`。下面的字段表就是该挂载点可读取的完整事件字段。

### `chat.loaded`

当前聊天加载完成后触发。

适合：

- 初始化聊天级缓存。
- 记录当前聊天信息。
- 根据角色或聊天状态准备脚本输出。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'chat.loaded'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 本次脚本请求 ID。 |
| `chatId` | `string` | 当前聊天 ID。 |
| `characterName` | `string` | 当前角色卡名称。 |
| `characterName` | `string` | 当前角色名。 |

示例：

```js
ctx.log.info(`加载聊天: ${ctx.event.chatId}`);
return `当前角色：${ctx.event.characterName}`;
```

### `db.loaded`

当前运行时数据库可用后触发。

适合：

- 启动后检查表格数据。
- 预计算统计值。
- 生成 session 级脚本输出。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'db.loaded'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 本次脚本请求 ID。 |
| `sheetKeys` | `string[]` | 当前数据库中的 sheet key，例如 `sheet_0`。 |
| `tableNames` | `string[]` | 表显示名列表。当前与 `tableDisplayNames` 一致。 |
| `tableDisplayNames` | `string[]` | 表显示名列表。 |
| `storageMode` | `string` | 当前表格存储模式。 |

示例：

```js
return `当前数据库表：${ctx.event.tableDisplayNames.join('、')}`;
```

### `table_fill.before_request`

填表 AI 请求发送前触发。

适合：

- 根据当前数据库计算填表约束。
- 生成一段文本，通过 `{[script_output ...]}` 插入填表提示词。
- 对不同目标表生成不同提示。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'table_fill.before_request'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 本次填表请求 ID。 |
| `targetSheetKeys` | `string[]` | 本次填表目标 sheet key。 |
| `updateMode` | `string` | 本次填表模式。 |

示例：

```js
return `本次只允许更新：${ctx.event.targetSheetKeys.join(', ')}`;
```

典型用法：

1. 绑定脚本到 `table_fill.before_request`。
2. 设置 `outputKey`，例如 `fillHint`。
3. 脚本返回提示词片段。
4. 在填表提示词中写 `{[script_output "fillHint"]}`。

### `table_fill.after_commit`

填表结果成功提交后触发。

适合：

- 自动修正派生字段。
- 根据变更表执行二次 SQL。
- 写日志或更新统计。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'table_fill.after_commit'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 本次填表请求 ID。 |
| `changedSheets` | `string[]` | 本次业务变更的 sheet key。 |
| `modifiedSheets` | `string[]` | 本次修改的 sheet key。 |
| `persistedSheets` | `string[]` | 本次实际持久化涉及的 sheet key。 |
| `appliedEdits` | `number \| null` | 可靠编辑数。无法可靠计算时为 `null`。 |
| `success` | `true` | 提交成功标记。 |

示例：

```js
if (!ctx.event.changedSheets.includes('sheet_0')) return '未涉及 sheet_0';
return `填表提交完成，编辑数：${ctx.event.appliedEdits ?? '未知'}`;
```

说明：

- `appliedEdits` 是可靠编辑数；如果当前路径无法可靠计算，会是 `null`。
- 这个挂载点发生在提交成功后。脚本如果继续写库，会发起新的标准提交。

### `plot.before_task_request`

单个剧情推进任务请求 AI 前触发。

适合：

- 为某个剧情任务生成辅助提示。
- 根据任务 ID 准备输出。
- 让剧情任务 prompt 读取脚本输出。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'plot.before_task_request'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前剧情任务请求 ID。 |
| `presetName` | `string` | 当前剧情推进预设名称。 |
| `taskId` | `string` | 当前剧情任务 ID。 |
| `phase` | `'before_request'` | 当前阶段。 |

示例：

```js
ctx.log.info('剧情任务请求前:', ctx.event.taskId);
return `请重点检查任务 ${ctx.event.taskId} 的输出一致性。`;
```

典型用法：

1. 绑定到 `plot.before_task_request`。
2. 设置 `outputKey`，例如 `plotHint`。
3. 在剧情任务 prompt 中写 `{[script_output "plotHint"]}`。

### `plot.after_task_response`

单个剧情推进任务成功响应并解析后触发。

适合：

- 读取任务响应。
- 读取任务抽取标签。
- 根据成功任务结果写库或记录日志。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'plot.after_task_response'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前剧情任务请求 ID。 |
| `presetName` | `string` | 当前剧情推进预设名称。 |
| `taskId` | `string` | 当前剧情任务 ID。 |
| `success` | `true` | 当前剧情任务已成功。 |

示例：

```js
ctx.log.info('剧情任务完成:', ctx.event.taskId, ctx.event.success);
return `任务 ${ctx.event.taskId} 已完成`;
```

### `plot.after_stage`

剧情推进某个 stage 内所有任务成功完成后、下一 stage 开始前触发。

适合：

- 读取刚完成 stage 的任务输出。
- 为后续 stage 生成 `outputKey`。
- 通过 `ctx.controller` 决定后续 stage 是否跳过或停止。

失败说明：

- 当前 stage 内任一任务失败时不触发。
- 用户 abort 时不触发。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'plot.after_stage'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前剧情推进请求 ID。 |
| `presetName` | `string` | 当前剧情推进预设名称。 |
| `stage` | `number` | 刚成功完成的 stage。 |
| `nextStage` | `number \| null` | 按当前计划下一个 stage；没有时为 `null`。 |
| `isLastStage` | `boolean` | 当前是否已经是最后一个待执行 stage。 |
| `taskIds` | `string[]` | 当前 stage 的任务 ID。 |
| `successfulTaskIds` | `string[]` | 当前 stage 成功任务 ID。 |
| `remainingStages` | `number[]` | 当前 stage 后面尚未执行且未跳过的 stage。 |
| `allStages` | `number[]` | 本轮一开始确定的全部 stage。 |
| `success` | `true` | 当前 stage 已成功完成。 |

示例：

```js
ctx.log.info(`完成 stage ${ctx.event.stage}，后续 stage: ${ctx.event.remainingStages.join(',')}`);
const route = ctx.outputs.get('route', { defaultValue: 'normal' });
if (route === 'talk') ctx.controller?.skipStage(2, '谈判路线跳过战斗阶段');
return `stage ${ctx.event.stage} 门控完成`;
```

### `main_reply.before_generation`

正文生成前触发。

适合：

- 根据用户输入生成额外提示。
- 生成正文 prompt 中要读取的脚本输出。
- 记录最终将要发送的用户输入。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'main_reply.before_generation'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前正文生成请求 ID。 |
| `phase` | `'before_generation'` | 当前阶段。 |
| `source` | `string` | 触发来源，例如普通生成或剧情改写后的生成。 |

示例：

```js
const lastUser = [...(ctx.tavern.chat || [])].reverse().find(message => message?.is_user);
const input = lastUser?.mes || '';
ctx.log.info(input);
return `当前输入长度：${input.length}`;
```

可以配合正文提示词中的变量：

```text
{[script_output "replyHint"]}
```

### `main_reply.after_response`

正文回复完成后触发。

适合：

- 读取本次 AI 回复。
- 根据回复内容写入数据库。
- 做回复后检查或日志记录。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'main_reply.after_response'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前正文生成请求 ID。 |
| `phase` | `'after_response'` | 当前阶段。 |
| `source` | `string` | 触发来源。 |
| `aiResponse` | `string \| null` | 本次正文内容。读取失败时为 `null`。 |
| `responseSource` | `string \| undefined` | 正文来源说明。 |
| `messageId` | `string \| undefined` | 对应消息 ID。 |

示例：

```js
const reply = ctx.event.aiResponse || '';
ctx.log.info(reply || '没有读取到回复');
return reply ? reply.slice(0, 100) : '';
```

### `plot_worldbook.before_render`

剧情推进使用的世界书文本进入 prompt 前触发。

适合：

- 为剧情推进世界书中的 `{[script_output ...]}` 准备输出。
- 根据剧情推进上下文生成世界书辅助内容。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'plot_worldbook.before_render'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前请求 ID。 |

注意：

- 这个挂载点只针对插件控制的剧情推进世界书链路。
- 不承诺覆盖酒馆原生世界书注入流程。

### `table_fill_worldbook.before_render`

填表使用的世界书文本进入 prompt 前触发。

适合：

- 为填表世界书中的 `{[script_output ...]}` 准备输出。
- 根据填表上下文生成世界书辅助内容。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'table_fill_worldbook.before_render'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 当前请求 ID。 |

注意：

- 这个挂载点只针对插件控制的填表世界书链路。
- 不承诺覆盖酒馆原生世界书注入流程。

### `manual_table_save.after_commit`

用户手动保存表格数据成功后触发。

适合：

- 手动编辑后自动补派生字段。
- 手动保存后刷新统计。
- 校验用户直接改表后是否满足规则。

`ctx.event` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hook` | `'manual_table_save.after_commit'` | 当前挂载点名称。 |
| `timestamp` | `number` | 触发时间戳，毫秒。 |
| `requestId` | `string` | 本次手动保存请求 ID。 |
| `changedSheets` | `string[]` | 本次手动保存变更的 sheet key。 |
| `success` | `true` | 保存成功标记。 |

示例：

```js
return `手动保存完成：${ctx.event.changedSheets.join(', ')}`;
```

## 绑定配置

每个绑定可以设置这些字段。

### `hook`

挂载点名称。

例如：

```text
table_fill.before_request
```

### `enabled`

是否启用这个绑定。

脚本启用但绑定禁用时，这个挂载点不会运行该脚本。

### `order`

绑定排序。

多个脚本或多个绑定在同一个挂载点运行时，用于决定执行顺序。

### `outputKey`

命名输出。

当绑定设置了 `outputKey`，脚本返回值会保存到这个 key。

后续可以在文本里用变量读取：

```text
{[script_output "outputKey"]}
```

也可以在后执行的脚本里读取：

```js
const value = ctx.outputs.get('outputKey');
```

建议：

- 使用清晰英文或拼音 key，例如 `fillHint`、`plotHint`、`summaryText`。
- 不要多个有效脚本使用同一个 outputKey。
- outputKey 是给变量读取用的，不是日志名称。

### `outputTtl`

输出生命周期。

可选值：

- `request`：只在当前请求周期内有效。
- `chat`：当前聊天内有效，按聊天和角色隔离。
- `session`：当前页面会话内有效，按角色隔离。

推荐用法：

- 填表前、正文前、剧情任务前生成的 prompt 片段：用 `request`。
- 当前聊天内反复使用的临时结果：用 `chat`。
- 本次页面打开期间跨聊天复用的角色级结果：用 `session`。

读取非 request 输出时，需要在变量里指定 ttl：

```text
{[script_output key="dailySummary" ttl="chat"]}
{[script_output key="roleCache" ttl="session"]}
```

### `failurePolicy`

脚本失败时怎么处理。

`continue`：

- 记录错误日志。
- 当前流程继续。
- 适合提示词补充、日志、非关键统计。

`block`：

- 脚本失败会阻断对应流程。
- 适合必须成功的校验或关键写库逻辑。

建议先用 `continue` 调试稳定，再对关键脚本改成 `block`。

### `config JSON`

绑定专用配置。

脚本里通过 `ctx.config` 读取。

示例配置：

```json
{"minScore":60,"targetSheet":"sheet_0"}
```

脚本读取：

```js
const minScore = ctx.config.minScore ?? 0;
const targetSheet = ctx.config.targetSheet;
return `目标表 ${targetSheet}，最低分 ${minScore}`;
```

## 脚本变量

脚本变量可以放在支持变量替换的文本中，例如提示词、世界书、剧情任务 prompt、填表提示词等插件可控文本。

### 立即执行脚本

按名称调用：

```text
{[script "脚本名称"]}
```

按名称并传 JSON：

```text
{[script "脚本名称" {"limit":5}]}
```

按 ID 调用：

```text
{[script id="script_xxx" input={"limit":5}]}
```

失败时显示占位文本：

```text
{[script "脚本名称" error="脚本执行失败"]}
```

### 读取挂载点输出

读取 request 输出：

```text
{[script_output "fillHint"]}
```

在脚本里读取同一个 request 输出：

```js
const fillHint = ctx.outputs.get('fillHint');
```

读取 chat 输出：

```text
{[script_output key="dailySummary" ttl="chat"]}
```

在脚本里读取 chat 输出：

```js
const dailySummary = ctx.outputs.get('dailySummary', { ttl: 'chat' });
```

读取 session 输出：

```text
{[script_output key="roleCache" ttl="session"]}
```

在脚本里读取 session 输出：

```js
const roleCache = ctx.outputs.get('roleCache', { ttl: 'session' });
```

找不到输出时显示占位文本：

```text
{[script_output key="fillHint" error="暂无填表提示"]}
```

## 手动运行

手动运行用于测试脚本。

特点：

- 点击“保存并手动运行”会先保存当前脚本。
- 执行的是已保存版本，不是未保存草稿。
- 可以选择一个绑定作为测试挂载点。
- 可以输入 JSON，脚本从 `ctx.input` 读取。
- 手动运行允许真实写库。
- 运行结果和日志会显示在页面中。

测试建议：

1. 先写只返回文本的脚本。
2. 手动运行确认输出正确。
3. 再添加数据库读取。
4. 最后添加写库逻辑。
5. 写库脚本先绑定到非自动流程，确认安全后再启用自动挂载点。

## 导入和导出

脚本包格式为 JSON。

导入脚本包时：

- 会先显示导入预览。
- 会校验脚本字段。
- 确认导入只保存配置，不会自动执行脚本。
- 如果名称重复，系统会自动追加后缀。
- 导入后是否自动运行，取决于脚本是否启用、绑定是否启用，以及后续是否触发挂载点。

导出脚本包时会包含：

- 脚本名称
- 描述
- 启用状态
- 作用域
- 绑定挂载点
- 配置 JSON
- 默认变量输入 JSON
- 函数体源码

不要导入不可信来源的脚本包。

### 剧情推进固定挂载点绑定

剧情推进任务和阶段挂载点不是泛化到所有预设、所有 stage 后再让脚本自行判断。绑定必须指向固定挂载点实例。

任务级挂载点绑定目标：

```json
{
  "hook": "plot.before_task_request",
  "enabled": true,
  "target": {
    "presetName": "剧情预设A",
    "stage": 1,
    "taskId": "task_001"
  },
  "outputKey": "task001Hint",
  "outputTtl": "request"
}
```

阶段级挂载点绑定目标：

```json
{
  "hook": "plot.after_stage",
  "enabled": true,
  "target": {
    "presetName": "剧情预设A",
    "stage": 1
  },
  "outputKey": "stage1Gate",
  "outputTtl": "request"
}
```

匹配规则：

- `plot.before_task_request` 和 `plot.after_task_response` 必须同时匹配 `target.presetName`、`target.stage`、`target.taskId`。
- `plot.after_stage` 必须同时匹配 `target.presetName`、`target.stage`。
- 不匹配的绑定不会执行，不需要在脚本里写 `if (ctx.event.stage !== 2) return` 这类过滤。
- 缺少 `target` 或目标字段无效的剧情推进绑定会被导入/保存校验拒绝。

## 执行日志

脚本管理页会显示执行日志。

日志包含：

- 运行 ID
- 调用类型：hook、variable、manual
- 挂载点名称
- 开始时间
- 耗时
- 错误信息
- 脚本中 `ctx.log` 写出的内容

脚本里写日志：

```js
ctx.log.info('普通信息');
ctx.log.warn('警告信息');
ctx.log.error('错误信息');
```

日志适合用来排查：

- 脚本有没有运行。
- 运行的是哪个挂载点。
- `ctx.event` 里有哪些字段。
- 输入 JSON 是否正确。
- 数据库查询是否返回预期结果。

## 常用写法

### 输出一段固定文本

```js
return '这是一段由脚本生成的提示词';
```

变量：

```text
{[script "固定提示"]}
```

### 读取输入 JSON

```js
const name = ctx.input?.name ?? '未知对象';
return `当前对象：${name}`;
```

变量：

```text
{[script "显示对象" {"name":"小玉"}]}
```

### 挂载点生成输出，再由提示词读取

绑定：

```text
table_fill.before_request
```

绑定设置：

```text
outputKey = fillHint
outputTtl = request
```

脚本：

```js
const sheets = ctx.event.targetSheetKeys || [];
return `本次只允许更新这些表：${sheets.join(', ')}`;
```

填表提示词里写：

```text
{[script_output "fillHint"]}
```

### 失败时不中断流程

绑定设置：

```text
failurePolicy = continue
```

脚本：

```js
try {
  return '可选提示';
} catch (error) {
  ctx.log.error(String(error?.message || error));
  return '';
}
```

### 失败时阻断流程

绑定设置：

```text
failurePolicy = block
```

脚本：

```js
if (!ctx.event.targetSheetKeys?.length) {
  throw new Error('没有目标表，禁止继续填表');
}
return '目标表检查通过';
```

## 排错

### 脚本没有运行

检查这些项：

- 脚本是否启用。
- 绑定是否启用。
- 作用域是否匹配当前角色。
- 是否真的触发了对应挂载点。
- 脚本是否保存成功。
- 执行日志里是否有错误。

### `{[script "名称"]}` 没有输出

检查这些项：

- 脚本名称是否完全一致。
- 是否存在同名脚本导致无法唯一匹配。
- 脚本是否启用。
- 脚本是否抛错。
- 是否设置了错误占位，例如 `error="执行失败"`。
- 日志里是否记录了变量执行错误。

建议稳定使用脚本 ID：

```text
{[script id="script_xxx" input={"limit":5}]}
```

### `{[script_output "key"]}` 没有输出

检查这些项：

- 是否有脚本绑定设置了相同的 `outputKey`。
- 这个脚本是否真的在当前请求周期运行过。
- `outputTtl` 是否正确。
- 读取 chat/session 输出时是否写了 `ttl="chat"` 或 `ttl="session"`。
- 当前聊天或角色是否和写入输出时一致。
- 输出是否已经过期或被清理。

### JSON 配置保存失败

检查这些项：

- JSON 是否是合法格式。
- 字符串必须使用双引号。
- 不要写注释。
- 不要在最后一项后面加多余逗号。

正确示例：

```json
{"limit":5,"enabled":true}
```

错误示例：

```json
{limit:5,}
```

### 写库脚本结果不符合预期

建议按这个顺序排查：

1. 先让脚本只 `return` 将要写入的内容。
2. 用手动运行确认结果。
3. 用 `ctx.log.info(...)` 打印关键输入和 SQL。
4. 确认当前挂载点是否允许写库。
5. 确认失败策略是否应该是 `continue` 还是 `block`。
6. 确认写库 API 返回值是否成功。

### 脚本超时

检查这些项：

- 是否有长时间等待的请求。
- 是否有无限循环。
- 是否查询了过大的数据。
- 是否可以减少输入数量或查询范围。
- 是否需要调大“超时 秒”。

注意：当前执行模型不能强制终止所有已经逃逸的异步副作用。写脚本时不要在超时后继续依赖后台任务完成。

## 使用建议

建议这样组织脚本：

- 一个脚本只做一类事情。
- 先用手动运行测试，再绑定自动挂载点。
- 关键写库脚本先用 `continue` 调试，稳定后再改 `block`。
- 输出 key 命名要清楚，不要重复。
- 复杂配置放到 `config JSON` 或默认变量输入 JSON。
- 需要插入提示词的位置，用 `{[script_output ...]}` 明确控制。
- 不要让脚本偷偷改正文输入，优先通过变量把输出放到你指定的位置。
- 导入脚本前先看源码和绑定挂载点。

## 推荐入门流程

1. 新增一个脚本。
2. 名称填“测试脚本”。
3. 函数体写：

```js
ctx.log.info('hello');
return 'hello from script';
```

4. 点击“保存脚本”。
5. 在任意支持变量替换的文本里写：

```text
{[script "测试脚本"]}
```

6. 确认输出正常。
7. 再尝试绑定 `main_reply.before_generation`，设置 `outputKey = replyHint`。
8. 把正文提示词里需要的位置写成：

```text
{[script_output "replyHint"]}
```

9. 发送一轮正文，查看执行日志。
10. 确认行为稳定后，再写数据库读取或写库逻辑。

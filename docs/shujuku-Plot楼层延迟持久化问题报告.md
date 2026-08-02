# shujuku Plot 用户楼层延迟持久化问题：现象、代码线索与验证建议

> 编写日期：2026-08-02  
> 文档用途：供 `shujuku` 维护者及协助排查的 AI 阅读。  
> 说明：本文区分“已观察事实”“代码事实”“工作假设”和“待验证事项”，不试图替维护者预先确定唯一根因或强制指定修复方案。

## 1. 问题摘要

在部分聊天中，剧情推进（Plot）任务已经返回了非空结果，但结果没有及时出现在其对应用户消息的持久化 Plot 字段中。

为避免楼层角色产生歧义，本文中的 `X`、`X+2` 均表示**用户消息楼层**，中间的 `X+1` 是 AI 回复楼层。

观察到的典型表现：

1. 当前用户楼层为 `X` 时，推进任务已经产生返回内容，但聊天持久化数据中的 `X.qrf_plot` 为空或不存在。
2. 当下一用户楼层 `X+2` 出现后，`X.qrf_plot` 又出现在持久化数据中。
3. 此时 `X+2.qrf_plot` 反而为空或不存在。
4. 现象不是每个聊天都会出现；新聊天通常正常，聊天达到数百楼后更容易遇到。
5. 已确认这不是“把 Plot 读取到了 AI 楼层”或提取脚本自行重排楼层造成的显示问题。

该现象看起来像 Plot 数据在运行时内存中已经存在，但对应聊天文件的提交时间晚于字段写入时间，并可能被下一次聊天保存顺带提交。这个描述目前应视为优先调查方向，而不是未经运行时复现就认定的最终结论。

## 2. 本次参考的代码版本

- `AlbusKen/shujuku`：`99f432cd48e25c247b5b47a57e04d91239b1b16e`
- `Illustar0/plot-manager`：`c33afa7fb952ffdbea092b9930ffebc2cfc8623e`
- `SillyTavern/SillyTavern`：`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`

后续若代码已经更新，请先确认相关函数是否仍保持本文描述的结构。

## 3. 预期行为

对每个用户消息楼层 `U(n)`：

1. 推进任务根据当前用户输入和上一轮 Plot 执行。
2. 本轮推进结果应写入 `U(n)` 的 `qrf_plot`、`qrf_plot_preset`，以及存在任务级结果时的 `qrf_plot_tasks`。
3. 写入完成后，应在合理时间内提交到当前 SillyTavern 聊天记录的持久化载体。
4. 下一用户楼层 `U(n+1)` 的 `$6` 应读取 `U(n).qrf_plot`，而不是更早一轮的数据。

## 4. 代码调用链

### 4.1 推进结果进入临时状态

`plot-task-engine.ts` 在推进任务结束后，将本轮结果保存进 `tempPlotToSave_ACU`，随后调用：

```ts
await savePlotToLatestMessage_ACU(true);
```

参考：

- [`plot-task-engine.ts` 暂存并调用保存函数](https://github.com/AlbusKen/shujuku/blob/99f432cd48e25c247b5b47a57e04d91239b1b16e/src/service/runtime/plot-runtime/plot-task-engine.ts#L910-L927)

### 4.2 `savePlotToLatestMessage_ACU()` 当前的异步语义

该函数声明为 `async`，但内部通过 `setTimeout` 启动轮询。函数注册第一个定时器后即可结束，因此调用方的 `await` 目前不一定代表以下动作已经完成：

- 找到目标用户消息；
- 写入 Plot 字段；
- 提交聊天保存。

参考：

- [`savePlotToLatestMessage_ACU()` 和轮询结构](https://github.com/AlbusKen/shujuku/blob/99f432cd48e25c247b5b47a57e04d91239b1b16e/src/service/runtime/plot-runtime/plot-history-preset.ts#L255-L390)

### 4.3 找到目标消息后的字段写入

轮询找到目标后，会修改当前聊天数组中的消息对象，主要操作包括：

```ts
target.qrf_plot = plotContent;
target.qrf_plot_preset = currentPresetName;
```

并可能写入 `target.qrf_plot_tasks`。

从当前代码结构看，该成功分支在写完字段后清空 `tempPlotToSave_ACU`。值得重点确认的是：该分支中没有明显等待一次 `saveChatToHost_ACU()` 的调用。文件虽然导入了 `saveChatToHost_ACU`，但当前可见调用位于其他迁移逻辑中。

这并不能单独证明宿主后续一定不会保存这些字段，因为 SillyTavern 可能在本轮生成的其他阶段执行聊天保存；但它意味着 Plot 的持久化依赖于后续宿主行为及其时序，而不是由 Plot 写入流程自身明确完成。

### 4.4 SillyTavern 保存行为相关线索

在参考版本中：

- 用户消息加入聊天后，会调用 `saveChatConditional()`。
- AI 生成结束路径也会调用聊天保存。
- `saveChat()` 会从当前聊天数组构造待发送快照并序列化。
- `getContext().saveChat` 对应的是 `saveChatConditional`。
- `saveChatConditional()` 在等待其他保存结束超时后可能直接返回；其内部也会处理异常，而不一定向调用方抛出可用于确认“真实落盘成功”的错误。

参考：

- [`saveChat()` 构造聊天快照](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7336-L7388)
- [`saveChatConditional()`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L9352-L9378)
- [`getContext().saveChat` 的映射](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/st-context.js#L114-L155)

维护者可能需要结合实际支持的 SillyTavern 版本、群聊路径、插件运行方式和是否存在其他保存调用，判断这里是否确实构成了持久化竞态。

## 5. 一个与现象相符的候选时序

以下只是需要通过日志或复现验证的工作假设：

```text
1. 用户消息 X 被加入聊天并保存；此时尚无 X.qrf_plot。
2. 推进任务完成。
3. savePlotToLatestMessage_ACU() 注册延迟回调并返回。
4. 延迟回调把 Plot 写入运行时 chat[X]，但没有在该分支明确提交聊天保存。
5. 若本轮后续宿主保存没有捕获这次修改，持久化文件中的 X 仍无 Plot。
6. 用户发送下一条消息 X+2。
7. SillyTavern 在处理新用户消息时保存当前聊天，顺带把内存中的 X.qrf_plot 提交。
8. 随后 X+2 的 Plot 又只停留在内存，形成“X 出现、X+2 缺失”的视觉结果。
```

如果运行日志证明本轮 AI 回复结束后的保存确实发生在 Plot 字段写入之后，并且请求体已经包含这些字段，则需要继续调查其他方向，例如：

- 保存请求覆盖或完整性检查；
- 并发保存使用了更早的聊天快照；
- 群聊和单人聊天保存路径差异；
- 其他扩展对消息对象或聊天数组的替换；
- 保存超时或网络失败被宿主内部处理；
- 当前聊天标识在延迟回调执行前发生变化。

## 6. `plot-manager` 能说明什么、不能说明什么

`plot-manager` 直接读取：

```ts
SillyTavern.getContext().chat[messageId]
```

它没有将用户楼层重新映射到其他楼层，也没有把 `X+2` 的 Plot 搬到 `X`。因此它不太像造成楼层延迟的写入源。

同时，它读到的是当前运行时聊天数组，所以：

- 它可以证明内存对象当前是否有 `qrf_plot`；
- 它不能仅凭显示结果证明聊天文件已经持久化；
- 它自己编辑或删除 Plot 后会调用 `getContext().saveChat()`，这可作为比较实现，但不自动证明相同调用就是 `shujuku` 的唯一正确修复。

参考：

- [`plot-manager` 直接读取聊天数组](https://github.com/Illustar0/plot-manager/blob/c33afa7fb952ffdbea092b9930ffebc2cfc8623e/src/plot-manager/plot-data.ts#L51-L60)
- [`plot-manager` 写入后调用聊天保存](https://github.com/Illustar0/plot-manager/blob/c33afa7fb952ffdbea092b9930ffebc2cfc8623e/src/plot-manager/plot-data.ts#L486-L515)

## 7. 对推进 AI `$6` 的可能影响

推进任务构建共享上下文时，`$6` 来自 `getPlotFromHistory_ACU()` 返回的 `lastPlotContent`。

已有当前用户消息时，代码会尝试以当前输入哈希定位当前用户楼层，并把历史检索上界限制在当前用户楼层之前。因此理论上的对应关系是：

```text
处理用户楼层 X 时：$6 应为 X-2 的 Plot
处理用户楼层 X+2 时：$6 应为 X 的 Plot
```

参考：

- [`$6` 的获取和替换](https://github.com/AlbusKen/shujuku/blob/99f432cd48e25c247b5b47a57e04d91239b1b16e/src/service/runtime/plot-runtime/plot-task-engine.ts#L189-L198)
- [历史锚点和检索上界](https://github.com/AlbusKen/shujuku/blob/99f432cd48e25c247b5b47a57e04d91239b1b16e/src/service/runtime/plot-runtime/plot-history-preset.ts#L125-L175)

### 7.1 连续运行、未重新加载聊天

如果 `X.qrf_plot` 已写入运行时聊天数组，只是尚未落盘，那么处理 `X+2` 时，`getPlotFromHistory_ACU()` 仍可能从内存中正确读取 X。此时数据库延迟不必然意味着本轮发给推进 AI 的 `$6` 错误。

### 7.2 写入后发生刷新、切换聊天或运行时状态丢失

如果 `X+2.qrf_plot` 尚未持久化就刷新页面、重启、重新打开聊天或丢失运行时状态，那么下一轮处理 `X+4` 时只能读取持久化文件。此时 `$6` 可能回退到 X，形成一轮滞后；如果没有更早的可用 Plot，也可能为空。

因此，该问题是否已经影响实际推进内容，不能只看当前持久化字段，需要结合发生异常期间是否有重载行为，以及推进调用前 `getPlotFromHistory_ACU()` 实际返回了哪个消息索引。

## 8. 建议的复现与取证方法

建议在聊天副本中测试，避免影响原聊天。

### 8.1 最小复现步骤

1. 开启 Plot 调试日志。
2. 在容易复现的长聊天中发送用户消息 X。
3. 等待推进任务和正文生成全部结束。
4. 同时记录：
   - `getContext().chat[X].qrf_plot` 是否存在；
   - 持久化聊天文件中的 X 是否有 `qrf_plot`；
   - 本轮所有聊天保存请求的开始时间、快照时间和完成时间。
5. 不刷新页面，发送下一用户消息 X+2，观察 X 是否在此时首次落盘。
6. 另做一组对照：在 X 的 Plot 写入内存后手动调用一次 `await SillyTavern.getContext().saveChat()`，然后重载聊天，确认 X 是否保留。
7. 再做一组对照：X+2 生成后、发送 X+4 前刷新页面，检查 X+4 的 `$6` 实际来自哪个用户消息索引。

### 8.2 建议增加的临时日志

每条日志最好同时包含聊天标识、运行 ID、目标消息索引、输入哈希和毫秒时间戳：

- `tempPlotToSave_ACU` 设置时间；
- `savePlotToLatestMessage_ACU()` 被调用时间；
- 第一个定时器实际执行时间；
- 每次轮询的聊天长度和当前聊天标识；
- 命中目标的方式：对象哈希标记、文本哈希或回退逻辑；
- Plot 字段写入完成时间；
- 清空 pending 的时间；
- 宿主保存调用前后时间；
- 保存调用是否等待、超时或发生异常；
- `getPlotFromHistory_ACU()` 返回的 `latestPlotIndex` 和 `upperBound`；
- 实际替换进推进提示词的 `$6` 长度及来源索引。

### 8.3 判断候选时序是否成立的关键证据

如果同时满足以下条件，能够较强地支持“内存写入未及时提交”的方向：

1. 内存中的 X 有 Plot；
2. 持久化文件中的 X 没有 Plot；
3. X+2 发送前没有成功包含 X Plot 的聊天保存；
4. X+2 发送触发的保存请求首次包含 X Plot；
5. 手动调用一次宿主保存后，刷新仍能保留 X Plot。

如果不满足，应根据保存请求体和聊天对象变化继续排查覆盖、错层或聊天切换问题。

## 9. 维护者可评估的修改方向

以下是候选方向，不代表必须全部采用。

### 9.1 在字段写入后明确保存

在 `qrf_plot`、`qrf_plot_preset` 和 `qrf_plot_tasks` 全部写完后，显式等待宿主聊天保存，再清空 pending。

需要确认：

- 单人聊天与群聊是否都支持同一保存入口；
- `getContext().saveChat()` 是否能提供足够的成功或失败语义；
- 保存失败时是否保留 pending 并允许重试；
- 是否会与 SillyTavern 本轮自动保存形成高频重复请求。

### 9.2 让当前的 `await` 等待真实完成

可以评估将定时轮询包装成真正完成后才 resolve 的 Promise，或者改为可等待的异步循环。这样 `await savePlotToLatestMessage_ACU(true)` 的语义可变成“已经写入并完成所需保存”，而不是“已经安排一个将来的回调”。

### 9.3 固定本轮 pending 快照

延迟回调应考虑捕获本轮 pending 对象，而不是在回调中继续读取可能已被下一轮替换的全局 `tempPlotToSave_ACU`。清空时也可比较当前 pending 是否仍是本轮对象，避免旧回调清空新一轮数据。

### 9.4 使用更稳定的目标消息身份

当前逻辑优先使用哈希标记和文本哈希，失败后会回退到“最近一个没有 Plot 的用户消息”。维护者可以评估是否能从 `GENERATION_AFTER_COMMANDS` 或 `MESSAGE_SENT` 获得明确消息 ID，并将它传入保存流程，以减少回退逻辑误选其他用户楼层的可能。

### 9.5 对保存结果进行可验证处理

`saveChatToHostStrict_ACU()` 当前主要强化“保存函数必须存在”的检查。由于 SillyTavern 的 `saveChatConditional()` 可能在内部处理超时或异常，调用未抛错是否足以代表文件已经提交，需要结合宿主版本进一步确认。

## 10. 建议补充的测试

1. 精确哈希命中目标用户消息后，Plot 字段完整写入。
2. 成功写入后确实调用宿主保存。
3. 宿主保存完成前不清空本轮 pending。
4. 宿主保存失败或不可用时，pending 的处理符合设计预期。
5. 目标消息延迟进入聊天数组时，调用方的 Promise 在最终写入前不会提前完成。
6. 两轮 pending 重叠时，旧回调不会读取或清空新一轮 pending。
7. 哈希匹配失败时，不会静默把 Plot 写入无关用户楼层。
8. 长聊天及保存耗时超过常规阈值时，不出现稳定的一轮延迟。
9. 页面刷新前后，下一轮 `$6` 来源一致。
10. 单人聊天与群聊路径分别验证。

## 11. 希望维护者确认的问题

1. 当前设计是否有意依赖 SillyTavern 在正文生成结束后顺带保存 Plot？
2. Plot 字段是否要求在本轮推进完成后立即持久化，还是允许延迟到下一次聊天保存？
3. 在已支持的 SillyTavern 版本中，正文生成结束保存是否有可能发生在延迟 Plot 写入之前，或因并发保存而跳过？
4. `savePlotToLatestMessage_ACU()` 的 `await` 是否原本期望等待实际写入完成？
5. 哈希匹配失败后的最近无 Plot 用户消息回退是否是必要兼容行为？
6. 是否存在群聊、循环模式、Quick Reply、TavernHelper.generate 或自动触发路径使用不同的保存时序？
7. 对 `$6` 的正确性要求是否包括刷新、重启和跨会话恢复场景？

## 12. 可用于提交 Issue 的简短描述

> 部分长聊天中，推进任务已返回结果，但当前用户消息的 `qrf_plot` 未立即进入持久化聊天数据；发送下一用户消息后，上一用户消息的 Plot 才出现，而新用户消息的 Plot 仍缺失。运行时读取与持久化读取可能出现差异。代码中 `savePlotToLatestMessage_ACU()` 通过定时器异步写入消息对象，调用方的 `await` 不等待实际写入完成，并且成功写入分支未明显等待宿主聊天保存。希望确认是否存在写入与 SillyTavern 自动保存之间的时序或快照竞态。本文附带相关代码路径、复现取证方法、对 `$6` 的潜在影响及若干候选修复方向，但不预设唯一根因。

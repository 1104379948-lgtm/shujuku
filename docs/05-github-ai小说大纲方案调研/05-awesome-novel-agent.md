# awesome-novel-agent：文件协议驱动的卷章规划流水线

- 仓库：[modoojunko/awesome-novel-agent](https://github.com/modoojunko/awesome-novel-agent)
- 本次源码证据：`novel-dispatch.md`、`volume-planner.md`、`chapter-planner.md`、`chapter-outline.md`、`prompt-crafting.md`、`memory-recording.md`。
- 证据等级：源码级 Markdown Agent/Skill 协议；未在任何宿主实际运行。

## 调度与恢复契约

主 `novel-agent` 只读取 `status.md`、写 `.agent/task/*-order.md`、检查 order 是否 `DONE`。阶段顺序是 setup → volume-planning → chapter-planning → prompt-crafting → writing → anti-ai → review → archive；每个 order 仅含输入路径、输出路径、`status: pending`，具体方法留在相应 Skill。

恢复并不靠每次扫描全项目：`status.md` 是断点源；阶段等值表示尚未完成，严格大于才可跳过；归档 `.done` 文件实现幂等；writer 中断通过 `partial_path` 续写。超过两次重试后要求作者手动介入，而不是无限重试。

源码：[`novel-dispatch.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/novel-dispatch.md)。

## 卷纲与章纲输入输出

`volume-planner` 的输入是 order、`story.md`、世界观、题材、全局伏笔和相关角色状态，输出 `volumes/volume-{N}.md`，随后覆写 order 为 `DONE`。卷级规划要求核心冲突、情绪走向、冲突阶梯、信息差、章节方向与主导驱动力；作者确认是其 DoD 的一部分。

`chapter-planner` 读取目标卷、角色状态、前 3 章和全局钩子，输出 `chapters/vol-{N}-ch-{M}.md`。`chapter-outline.md` 将章纲拆为：

- `mood_progression`：从卷情绪弧继承，再形成章内微弧；
- 冲突阶梯：章内障碍必须逐步升高，禁止同一障碍换皮重复；
- 信息差：开场→中段→结尾要发生动态变化；
- 场景卡：行动、阻碍、悬念三要素；
- Memo：当前任务、读者期待、兑现、关键选择、知识状态、章尾改变与场景卡；
- `payoff_plan`：钩子的埋设、推进和收束；可选设定变更通知。

规划完成后才写入章纲并标记 `outline`。这套字段把“章节摘要”提升为可供 Prompt 组装和状态更新消费的中间表示。

## Prompt 汇编与质量门禁

`prompt-crafter` 读取十类资产：文风卡、上一章的情绪落点/改变、当前章纲、角色、题材示例、有限反 AI 规则、短期/永久记忆、场景风格卡与 Prompt 记忆。它明确禁止读取上一章正文全文和 `archives/`，以控制上下文膨胀。

Prompt 固定由角色、任务、背景、案例、输入、输出六部分组成；规则冲突有优先级：红线 > 字数 > T1 词 > 认知动词 > 感官 > 普通规范。完成前做结构、占位符、红线、上下文衔接、场景权重、技法稀疏度和无 meta 泄漏检查。该检查是 Prompt 自检协议，不是独立运行时验证，不能过度宣称。

### 新增 Skill 证据：主线收敛与章纲验收

`volume-arc.md` 先按作者信息完整度区分类型 A/B：类型 A 可由既有设定收敛总主线；类型 B 只确定第一卷，其余卷必须标为“待定”。其总主线句式是“谁 + 追求什么 + 对抗什么”，产物写入 `story.md`，并要求“总主线→逐卷”“卷序列→完整路径”“卷→反向推断总主线”三向核对。这里的“待定”不是缺陷，而是在事实不足时禁止伪造远期承诺。

`chapter-verify.md` 又把章纲落盘前的验收从单个 Agent 的自检提升为显式门禁：作者须确认结构化反馈，24 项清单、快速嗅探与 AI 味扫描全部通过，才可写 `chapters/vol-{N}-ch-{M}.md` 并把状态置为 `outline`。但清单执行仍依赖宿主 Agent，因此它是协议门禁，不是已实测的强制执行器。

| Skill | 输入/产物 | 硬约束 |
|---|---|---|
| `volume-arc.md` | 作者素材 → `story.md` 总主线和卷路径 | 信息不足仅定第一卷；三向一致性核对 |
| `chapter-verify.md` | 章纲候选与作者反馈 → 落盘章节文件 | 作者确认 + 24 项检查 + 嗅探/AI 味扫描全部通过后才更新状态 |

源码：[`volume-arc.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/volume-arc.md)、[`chapter-verify.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/chapter-verify.md)。

## 记忆与风险

记忆只捕捉作者明确否定、长期规则、修正或正例；入库前检查四字段、指令注入和重复；单文件超过 50 条由 updater 压缩；`use_count >= 4` 才可晋升永久记忆。此设计值得借鉴“可操作反馈 + 有限容量 + 显式晋升”，但仍依赖 Agent 按协议执行。

主要风险是宿主依赖：所有状态、权限与 `DONE` 语义都在 Markdown/工具调用约定中，而不是此仓库可独立证明的事务数据库。仓库 `LICENSE` 已复读为 GPL-3.0；README 中的额外商业授权声明仍须单独核验，不得把它和 GPL 条款混同。
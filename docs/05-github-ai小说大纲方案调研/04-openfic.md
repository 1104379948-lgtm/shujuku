# OpenFic：可配置 Agent 工作台与会话计划账本

- 仓库：[syrizelink/OpenFic](https://github.com/syrizelink/OpenFic)
- GitHub 快照：857 Stars、Apache-2.0；API 查询时间为 2026-08-25。
- 本次源码证据：内置 `plan`、`composer`、`reviewer` Prompt，Prompt loader 与会话计划持久化服务。

## 机制定位

OpenFic 并未把“分卷纲→章纲”固化为唯一内置小说算法。它将规划职责交给名为 `Plan` 的 Agent：先路由用户意图、探索项目状态、渐进澄清需求，再写计划、审查、等待用户确认并委派执行。`Composer` 则把当前任务提示中的设定和剧情材料组织为“剧情单元 + 节拍”，并写入笔记。

因此它的直接价值是**人机协作的规划控制面**，不是现成的中文长篇模板。把它描述成“内置固定大纲流水线”是错误的，源码并不支持这种夸张结论。

源码：[`plan.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/plan.yaml)、[`composer.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/composer.yaml)。

## Agent 职责与产物边界

| Agent | 责任 | 产物/限制 |
|---|---|---|
| Plan | 意图路由、需求澄清、计划、执行前审查与委派 | 明确要求计划获用户批准；自身只规划，不直接写章节或设定 |
| Composer | 把剧情组织为围绕单一戏剧问题的剧情单元和节拍 | 计划写入 `/剧情大纲`；禁止把章节数、字数作为规划约束 |
| Auditor | 执行前审查计划的完整性、逻辑、可行性、一致性 | 只报告问题，不改写内容 |
| Reviewer | 对已完成章节审查需求、计划、上下文、逻辑和格式 | 只根据当前任务材料作通过/打回判断 |

`Composer` 的两级结构比较可复用：剧情单元围绕一个戏剧问题；场景事件型单元用过程节拍，发展阶段型单元用里程碑节拍；戏剧问题改变、大跨度时间跳跃或切换并行线时必须切分。它还要求节拍避免藏进完整子事件，这对防止“看似有纲、实际无法写”很有效。

### Prompt 边界补证：Explore

新增读取的 `explore.yaml` 说明该仓库的 Agent 约束并非只靠角色名称：`Explore` 只能探索、不能写入；先区分字面需求、实际目标和可执行成果；结论只能基于当前 Prompt 已提供的信息。前提缺失时必须标注边界，不能自行补成事实。

| Agent/资产 | 输入 | 输出与禁止项 | 作用 |
|---|---|---|---|
| `explore.yaml` | 当前任务材料和已有上下文 | 证据化的探索结论；禁止写入、禁止编造未提供事实 | 在计划/写作前隔离事实收集与变更 |
| `plan.yaml` | 用户目标、探索结果 | 待确认计划与委派边界；禁止直接写章节 | 把审批置于执行前 |
| `composer.yaml` | 已确认设定与剧情材料 | 剧情单元和节拍笔记 | 将已批准目标转为可执行剧情结构 |

这证明的是可配置 Agent 控制面和认识论边界，不是固定的“分卷纲→章纲”算法。源码：[`explore.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/explore.yaml)。

## 计划持久化和提示词装配

`agent_runtime/plan/service.py` 以 `session_id` 为键写 `PlanRecord` 与 `PlanTodoRecord`。Todo 必须有非空内容，状态仅允许 `pending/in_progress/completed`，优先级仅允许 `low/medium/high`；写入会整体替换该 session 的 todo 列表并更新时间。

这一点有双刃剑：字段校验清晰、会话隔离明确；但 `replace_plan_todos` 表示调用方必须提交完整计划快照。若产品要支持多端并发或局部更新，需要在写入边界补 revision/compare-and-swap，否则会发生最后写入者覆盖。

内置 Prompt loader 将 8 个 Agent YAML 注册为固定 Prompt ID，同时可从 `custom-agents/` 加载自定义 Agent。它证明 Prompt 可配置，但不证明每个自定义 Prompt 都具备安全性或质量门禁。

## 可复用与风险

推荐借鉴：规划与执行分工、用户确认边界、剧情单元/节拍定义、会话级计划账本和只读审查角色。需要补强：计划写入的并发控制、具体小说资产 schema、Agent 工具权限与运行时行为；本轮未运行 OpenFic，未确认其 Prompt 在真实工具链中是否被严格执行。

许可证已由仓库 API 核验为 Apache-2.0；仍不应把第三方 Prompt 文本整段复制进产品资产。
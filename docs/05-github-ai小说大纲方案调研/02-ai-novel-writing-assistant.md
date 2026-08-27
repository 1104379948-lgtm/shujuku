# AI-Novel-Writing-Assistant：API 化规划与生产编排

- 仓库：[ExplosiveCoderflome/AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant)
- 本次源码证据：规划路由、HTTP Schema、应用服务、Agent planner 编译器、`PlannerService`、规划 PromptAsset 与重规划决策 Prompt。
- 证据等级：源码级路由、服务、PromptAsset 与持久化调用链（未运行）。

## 已证实的调用链

客户端规划 API 对应后端 `server/src/modules/novel/planning/http/novelPlanningRoutes.ts`：

`POST /:id/plans/book/generate` → `generateBookPlan`；
`POST /:id/plans/arcs/:arcId/generate` → `generateArcPlan`；
`POST /:id/chapters/:chapterId/plan/generate` → `generateChapterPlan`；另有 state、snapshot、payoff ledger、rebuild、replan 路由。

应用层中，章纲生成不直接调用 core：`DefaultNovelApplicationServices.generateChapterPlan` 进入 `novelProductionOrchestrator.runStage`，阶段名为 `chapter_preparation`；重规划进入 `quality_repair`。这说明“规划/修复”至少被纳入统一 stage 编排，而不是一个散落的 HTTP handler。

源码：[`novelPlanningRoutes.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/modules/novel/planning/http/novelPlanningRoutes.ts)、[`NovelApplicationServices.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/services/novel/application/NovelApplicationServices.ts)。

## 可见数据契约与约束

`novelHttpSchemas.ts` 将卷规划划分为 strategy、critique、skeleton、beat_sheet、chapter_list、chapter_detail、rebalance 等 scope。卷字段包括 `mainPromise`、`primaryPressureSource`、`coreSellingPoint`、`escalationMode`、`midVolumeRisk`、`climax`、`payoffType`、`openPayoffs`；章节字段包括 `summary`、`purpose`、`conflictLevel`、`revealLevel`、`mustAvoid`、`taskSheet`、`sceneCards`、`payoffRefs`。

校验不是纯展示：`volumeGenerateSchema` 会对按卷、单节拍、章节细化的 target 参数做 `superRefine`；管线范围要求起点不大于终点，`maxRetries` 上限为 5。它还显式建模 `strategyPlan`、`critiqueReport`、`beatSheets` 与 `rebalanceDecisions`，支持草稿、激活、冻结、差异和影响分析接口。

## 状态、版本与风险控制

应用服务在结构化大纲前创建小说快照，在管线前创建 `before_pipeline` 快照；恢复时先创建 `before-restore-*` 快照，再恢复 outline、章节与卷工作区。卷工作区还暴露 draft/activate/freeze/diff/impact 操作。Agent planner 对高风险工具 `apply_chapter_patch`、`queue_pipeline_run`、`run_director_*` 标记 `requiresApproval`，并为动作生成幂等键。

## PromptAsset、真实调用链与后处理

此前“未定位书级 Prompt”的缺口已闭合。路由经 `NovelCoreService`、`NovelCoreReviewService` 转发到 `PlannerService.generateBookPlan/generateArcPlan/generateChapterPlan`；三者分别组装上下文块，调用 `invokePlannerLLM`，后者使用 `plannerBookPlanPrompt`、`plannerArcPlanPrompt` 或 `plannerChapterPlanPrompt`，最后通过 `persistStoryPlan` 写入计划。这是源码可达链，不是模型调用成功的运行时证明。

`plannerPlan.prompts.ts` 的三份 `PromptAsset` 由同一构造器生成，输出 Schema 及 `postValidate` 共同约束字段。受限短摘录：输出必须“严格符合 JSON Schema”，而非自由文本。

| 层级 | 主要输入上下文 | 输出字段/限制 | 后处理 |
|---|---|---|---|
| 书 | 简介、受众、卖点、前 30 章承诺、圣经、章节草案、节拍、故事模式、风格引擎 | `title`、`objective`、参与者、揭示、风险、钩子及元数据 | 规范化元数据后持久化为 `book` 计划 |
| 弧 | 书级信息、章节列表、圣经、故事模式、风格引擎 | 同书级结构，绑定 `arcId` | 规范化后持久化为 `arc` 计划 |
| 章 | 书/弧计划、卷窗口、角色、摘要、状态快照、审计问题、伏笔账本、重规划理由 | 另要求非空 `scenes`；场景含 `title/objective/conflict/reveal/emotionBeat`；`planRole` 仅可为 `setup/progress/pressure/turn/payoff/cooldown` | `postValidate` 拒绝缺标题、目标、阶段、`mustAdvance`、`mustPreserve`、非法角色或残缺场景；参与角色还会解析并与状态目标合并 |

重规划的 `replanWindowDecisionPrompt` 接收 canonical state、审计报告、兑现账本和可选章节序号；`affectedChapterOrders` 只能来自 `availableChapterOrders`。其默认窗口为连续 1–5 章，优先 `patch_repair`、`state_realign`、`payoff_rebalance`，只有结构性缺章或计划不可用时才使用 `chapter_rewrite`。这将“重写更多内容”变成受约束的例外，而非模型随意扩大影响面。

源码：[`PlannerService.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/services/planner/PlannerService.ts)、[`plannerPlan.prompts.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/prompting/prompts/planner/plannerPlan.prompts.ts)、[`replanWindowDecision.prompts.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/prompting/prompts/planner/replanWindowDecision.prompts.ts)。正文写作的 `officialTemplates.ts` 是另一条模板链，不应误称为书/弧规划 Prompt。

这些是生产化痕迹，但不等于实际质量保证：也未运行数据库迁移、模型调用或恢复用例。因此不能确认模型输出质量、状态回灌的实际效果或所有失败分支。

## 可复用与合规

推荐借鉴“规划对象版本化 + 差异/影响分析 + 人工审批高风险动作 + 快照恢复”的产品边界。警惕：接口很宽、系统复杂，直接复制会把未验证的编排债务一起引入。

仓库 API 许可证字段为 `NOASSERTION`；这不是许可。不得据此复制代码、Prompt 或用于商用/再分发，须另行核验权利链。
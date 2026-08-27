# GitHub AI 小说大纲/长篇创作方案调研报告

> 调研口径：GitHub 元数据快照与公开 README/Prompt/源码。本文为可独立阅读的完整汇总；同名目录保留拆分版便于导航。所有“已证实”均限于静态源码审查，未运行外部项目。

## 一、结论

五个候选的价值不在于“谁能一次写完小说”，而在于如何把规划、状态和修复变成可审计的生产链。推荐组合是：借鉴 **NovelForge** 的结构化规划契约、**oh-story** 的追踪事务与停靠门禁、**AI-Novel-Writing-Assistant** 的版本/快照/影响分析；以 **OpenFic** 的人机确认边界和 **awesome-novel-agent** 的卷章字段作为方法论补充。

不要直接引入任一仓库。许可证、宿主运行时、持久化方式和模型成本各不相同；把它们拼在一起只会制造一套无法复盘的怪物。

## 二、候选快照与详细分报告

| 项目 | Stars 快照 | 已核验定位 | 许可证状态 | 详细报告 |
|---|---:|---|---|---|
| [oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) | 6022 | 文件化长篇 Skill、分层大纲、事务追踪 | MIT（已复读 LICENSE） | [01](05-github-ai小说大纲方案调研/01-oh-story-claudecode.md) |
| [AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant) | 2608 | 书/弧/章 API、生产阶段编排、快照 | `NOASSERTION` | [02](05-github-ai小说大纲方案调研/02-ai-novel-writing-assistant.md) |
| [NovelForge](https://github.com/RhythmicWave/NovelForge) | 1134 | Schema 卡片树、指令流、上下文 DSL | AGPL-3.0 | [03](05-github-ai小说大纲方案调研/03-novelforge.md) |
| [OpenFic](https://github.com/syrizelink/OpenFic) | 857 | 可配置 Agent 工作台、会话计划账本 | Apache-2.0 | [04](05-github-ai小说大纲方案调研/04-openfic.md) |
| [awesome-novel-agent](https://github.com/modoojunko/awesome-novel-agent) | 655 | 文件协议、多 Agent 卷章规划 | GPL-3.0（已复读 LICENSE）；README 额外商业声明仍待单独核验 | [05](05-github-ai小说大纲方案调研/05-awesome-novel-agent.md) |

Star 是查询时点的热度，不是可靠性证明，也不是“GitHub 全站绝对前五”的数学证明。

## 三、横向工作流与数据契约

| 维度 | oh-story | AI-Novel-Writing-Assistant | NovelForge | OpenFic | awesome-novel-agent |
|---|---|---|---|---|---|
| 规划层级 | 选题→设定→全书/卷/章 | 书→弧→章 | 标签→蓝图→卷→阶段→章 | 计划→剧情单元→节拍 | 卷→章→场景/Memo |
| 大纲输出 | Markdown 文件树 | API/卷工作区对象 | Pydantic/JSON Schema 卡片 | 笔记 | Markdown 章卷文件 |
| 上下文选择 | 对标权威文件 + 按需读取 | 分层上下文块 + 规划 PromptAsset | `@type/@parent/@self` DSL | Agent 当前任务材料 | 前章、角色、记忆、场景卡 |
| 关键硬约束 | 首批十章停靠；七检；未来/事实分离 | Zod target/range 校验；高风险审批 | 连续章节覆盖；实体白名单；二次模型校验 | 单一戏剧问题与节拍切分规则 | order 状态、情绪/冲突/信息差字段 |
| 状态回灌 | 单一 JSON 权威 + 派生视图 | state/snapshot/payoff/replan API | 卡片/实体/工作流资产 | session Plan/Todo | `status.md`、order、记忆文件 |
| 恢复策略 | revision + 原子 state 提交 | 计划/管线前快照，恢复前再快照 | 运行时可继续生成；恢复未实测 | 会话计划持久化 | `.done`、阶段状态、partial 文件 |

这里的字段不是可直接拼接的统一 API。它们是设计模式：统一数据模型必须由本项目自己定义并建立版本/迁移规则。

## 四、提示词与 Agent 的实际职责

1. **oh-story** 把 Prompt 约束拆到工作流和参考文件：对标情绪/节奏文件是权威输入；读者契约、主角代理权、冲突递进和首批十章停靠构成行为门禁。
2. **AI-Novel-Writing-Assistant** 已定位书、弧、章 `PromptAsset`，并通过 `PlannerService → invokePlannerLLM → persistStoryPlan` 建立静态调用链；输出由 schema、`postValidate` 与元数据规范化约束。
3. **NovelForge** 将卡片 Prompt、JSON Schema 和指令流协议拼入 system prompt；模型只能用局部 `set/append/done` 构建字段，最后再由 Pydantic 验证。
4. **OpenFic** 的 Plan Agent 管需求、计划和审批，Composer 管剧情单元/节拍，Explore 只读收集证据，Auditor/Reviewer 分别前置和后置审查。它是控制面，不是预制大纲模板。
5. **awesome-novel-agent** 的卷纲围绕情绪、冲突、信息差；章纲落为 Memo、场景卡和 `payoff_plan`；`volume-arc` 与 `chapter-verify` 进一步规定事实不足时的停靠及作者确认门禁。

## 五、应提取的生产级最小闭环

### 1. 规划对象必须结构化且分层

- 书级：题材、读者承诺、核心冲突、世界边界、终局方向；
- 卷级：目标、承诺、冲突阶梯、信息释放、开放伏笔；
- 章级：目标、关键选择、参与实体、场景序列、禁止项、下一章钩子；
- 状态级：角色当前快照、已发生事实、读者已知、活跃伏笔和质量问题。

### 2. 生成必须经过候选边界

模型输出进入候选对象，依次验证：必填字段、编号连续性、实体引用、状态迁移、未来事实泄漏、输出长度和版本基线。只有持久化成功后才替换正式状态；失败必须保留可诊断原因，禁止静默丢字段或自动改语义重试。

### 3. 一个权威状态，多个可读视图

oh-story 的方向正确：Markdown 是面向作者/模型的投影，不应反向成为程序事实源。应让结构化状态成为权威，并通过 revision/乐观并发控制阻止旧上下文覆盖新状态。

### 4. 把自动化留在数据契约之后

在数据模型、候选校验、用户确认、状态提交和恢复测试未建立前，不要引入多 Agent、RAG 或自动导演。复杂编排不能补救错误状态，只会让错误更快扩散。

## 六、验证与合规边界

- 本轮未部署、未安装依赖、未调用模型、未使用 API Key；因此生成质量、成本、延迟、恢复成功率和宿主兼容性均未做实测。
- `NOASSERTION` 不代表可复用；AGPL/GPL 与 README 的额外商业声明也不能混为一谈。采用前需按代码、Prompt、部署和分发方式单独审查。
- 如需 A/B，只隔离部署一个候选到 `.tmp-research/`，先更新忽略规则，再固定 commit SHA、模型配置、输入样本、输出和恢复步骤；不要同时拉起五个项目污染工作区。

## 七、阅读与证据边界

以下“项目级详细静态审查”已物理纳入本文；同名目录的五份拆分报告仅为导航副本。README 宣称或静态代码可达分支均不冒充运行时验收。

已按仅限本地个人研究的明确授权，将本次已定位的完整第三方 Prompt、Skill 和运行时装配文件归档到 [`原始提示词归档/README.md`](05-github-ai小说大纲方案调研/原始提示词归档/README.md)。归档锁定五个上游 commit，覆盖 34 个上游资产；其“完整”仅指逐文件保存了清单中的完整上游文本，不代表穷尽各仓库全部 Prompt。该目录不是本项目生产 Prompt 来源，也不能把个人研究目的误读成额外的复制、发布或商用授权。

## 八、项目级详细静态审查
### 8.1 oh-story-claudecode：文件化大纲与事务追踪

- 仓库：[zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)
- 本次源码证据：`skills/story-long-write/SKILL.md`、`references/workflow-setup.md`、`references/artifact-protocols.md`、`references/tracking-transaction.md`、`scripts/tracking_commit.py`。
- 证据等级：源码级（未本地运行）。

#### 可核验工作流

入口 Skill 将“开书”明确路由为 Phase 1→2→3，并在首批 10 章细纲后默认停止；未明确要求不得进入正文。Phase 1 确认选题并处理对标；Phase 2 落地核心设定、关系与题材卡；Phase 3 先建全书阶段总览，再建卷纲、剧情单元与逐章细纲。该停靠点是防止模型在用户只要大纲时自行生成正文的行为门禁。

源码：[`SKILL.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/SKILL.md)、[`workflow-setup.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/workflow-setup.md)。

#### 大纲输入与产物契约

输入资产包括：`选题决策.md`、对标书的`剧情/情绪模块.md`与`剧情/节奏.md`、设定和已有进度。若两份对标主产物任一缺失，流程要求设置 `missing_primary_contract: true` 并停止，而不是以章节摘要补造结论。

产物分层为：

| 层级 | 产物 | 关键约束 |
|---|---|---|
| 全书 | `大纲/大纲.md` | 体量、阶段、情绪曲线、节点与钩子链 |
| 卷 | `卷纲_第X卷.md` | 卷契约、终局储备、剧情单元、人物/情绪弧、伏笔与反转 |
| 章 | `细纲_第XXX章.md` | 目标/关键选择、单元ID、禁止提前释放、五段概括、信息差、钩子、情节点字数预算 |
| 追踪 | `_tracking-state.json` | 当前角色、伏笔、时间线、上下文与修订号的唯一权威 |

细纲要求“单元ID/位置”“主角目标/关键选择”“行动成本（可无）/收益归属”。批次须进行大纲安全七检，覆盖读者契约、代理权、终局底牌与升级台阶，风险只能是“契约安全 / 需补强 / 契约破坏”。

#### Prompt/Skill 规则协议（受限摘录）

新增读取的 `outline-methods.md`、`reader-contract-and-progression.md` 与 `outline-conflict.md` 不是一个可独立调用的单一 Prompt，而是被 `story-long-write` Skill 按任务引入的方法与验收规则库。它们把大纲创建拆成五步，并以八节点结构组织关键转折；章级必须落出钩子、冲突和“爽点”检查。

| 规则来源 | 输入上下文 | 要求的规划结果 | 硬约束/后处理 |
|---|---|---|---|
| `outline-methods.md` | 选题、设定、目标篇幅和已有大纲 | 全书/卷/章的节点、冲突与章末钩子 | 五步创建法、八节点结构、章级钩子/冲突/收益检查 |
| `reader-contract-and-progression.md` | 主角行动、读者预期、阶段目标 | 读者承诺、升级台阶、终局储备 | 保护主角代理权、期待所有权和风险分级；不能把关键兑现提前消耗 |
| `outline-conflict.md` | 高潮目标、主支线、当前冲突 | 逆推高潮后的主支线推进与冲突阶梯 | 检查冲突递进、支线服务主线及阶段质量 |

受限短摘录可概括为“先逆推高潮，再安排冲突递进”；这只是规则意图，不是可直接复制的完整提示模板。生成结果随后仍须落到前述文件契约，并通过安全七检与 `tracking_commit.py check`。源码：[`outline-methods.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/outline-methods.md)、[`reader-contract-and-progression.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/reader-contract-and-progression.md)、[`outline-conflict.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/outline-conflict.md)。

#### 状态、恢复与质量门禁

`tracking_commit.py` 明确将 `_tracking-state.json` 定义为唯一结构化权威；`上下文.md`、角色快照、伏笔和两份时间线均为确定性派生物，禁止手改。`commit` 在内存合并和校验后写派生视图，最后原子替换 state 作为提交点；`expected_state_revision` 拒绝基于陈旧状态的顺序事务。`check` 校验 schema、固定七栏、体积、派生视图一致性。

这不是“保存几个摘要”的泛泛说法，而是有事务输入、修订号和派生一致性检查的状态协议。限制也很明确：同一本书不支持并发提交；未进行端到端运行，原子性与恢复体验尚未实测。

#### 可复用与风险

优先借鉴：大纲停靠点、规划层级、未来计划与既成事实分离、唯一权威状态加派生视图、显式 fail-fast。不要照搬宿主 Agent/Hook 适配逻辑；Skill 自身声明在 custom agent 不可用时会退化为 solo/direct 执行，因此多 Agent 行为不是跨宿主不变量。

许可证已复读为 MIT；采用前仍应锁定 commit SHA，并对脚本与 Prompt 资产的实际复用范围单独评估。未运行 Skill、宿主 Agent 或恢复流程，以上仅是静态源码证据。

### 8.2 AI-Novel-Writing-Assistant：API 化规划与生产编排

- 仓库：[ExplosiveCoderflome/AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant)
- 本次源码证据：规划路由、HTTP Schema、应用服务、Agent planner 编译器、`PlannerService`、规划 PromptAsset 与重规划决策 Prompt。
- 证据等级：源码级路由、服务、PromptAsset 与持久化调用链（未运行）。

#### 已证实的调用链

客户端规划 API 对应后端 `server/src/modules/novel/planning/http/novelPlanningRoutes.ts`：

`POST /:id/plans/book/generate` → `generateBookPlan`；
`POST /:id/plans/arcs/:arcId/generate` → `generateArcPlan`；
`POST /:id/chapters/:chapterId/plan/generate` → `generateChapterPlan`；另有 state、snapshot、payoff ledger、rebuild、replan 路由。

应用层中，章纲生成不直接调用 core：`DefaultNovelApplicationServices.generateChapterPlan` 进入 `novelProductionOrchestrator.runStage`，阶段名为 `chapter_preparation`；重规划进入 `quality_repair`。这说明“规划/修复”至少被纳入统一 stage 编排，而不是一个散落的 HTTP handler。

源码：[`novelPlanningRoutes.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/modules/novel/planning/http/novelPlanningRoutes.ts)、[`NovelApplicationServices.ts`](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant/blob/main/server/src/services/novel/application/NovelApplicationServices.ts)。

#### 可见数据契约与约束

`novelHttpSchemas.ts` 将卷规划划分为 strategy、critique、skeleton、beat_sheet、chapter_list、chapter_detail、rebalance 等 scope。卷字段包括 `mainPromise`、`primaryPressureSource`、`coreSellingPoint`、`escalationMode`、`midVolumeRisk`、`climax`、`payoffType`、`openPayoffs`；章节字段包括 `summary`、`purpose`、`conflictLevel`、`revealLevel`、`mustAvoid`、`taskSheet`、`sceneCards`、`payoffRefs`。

校验不是纯展示：`volumeGenerateSchema` 会对按卷、单节拍、章节细化的 target 参数做 `superRefine`；管线范围要求起点不大于终点，`maxRetries` 上限为 5。它还显式建模 `strategyPlan`、`critiqueReport`、`beatSheets` 与 `rebalanceDecisions`，支持草稿、激活、冻结、差异和影响分析接口。

#### 状态、版本与风险控制

应用服务在结构化大纲前创建小说快照，在管线前创建 `before_pipeline` 快照；恢复时先创建 `before-restore-*` 快照，再恢复 outline、章节与卷工作区。卷工作区还暴露 draft/activate/freeze/diff/impact 操作。Agent planner 对高风险工具 `apply_chapter_patch`、`queue_pipeline_run`、`run_director_*` 标记 `requiresApproval`，并为动作生成幂等键。

#### PromptAsset、真实调用链与后处理

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

#### 可复用与合规

推荐借鉴“规划对象版本化 + 差异/影响分析 + 人工审批高风险动作 + 快照恢复”的产品边界。警惕：接口很宽、系统复杂，直接复制会把未验证的编排债务一起引入。

仓库 API 许可证字段为 `NOASSERTION`；这不是许可。不得据此复制代码、Prompt 或用于商用/再分发，须另行核验权利链。

### 8.3 NovelForge：Schema-first 卡片树与指令流生成

- 仓库：[RhythmicWave/NovelForge](https://github.com/RhythmicWave/NovelForge)
- GitHub 快照：1134 Stars、AGPL-3.0；API 返回时间为 2026-08-25。
- 本次源码证据：内置 Prompt、`wizard.py`、卡片种子、生成运行时与 API。

#### 规划树与上下文组装

初始化的卡片类型把规划组织成：作品标签 → 金手指 → 一句话梗概 → 故事大纲 → 世界观设定 → 核心蓝图 → 分卷大纲 → 阶段大纲 → 章节大纲 → 正文。

`card_types.py` 不是只登记名称：每种卡保存 JSON Schema、AI 参数和 `default_ai_context_template`。例如分卷纲读取总卷数、故事大纲、标签、世界观、组织、角色、场景和上一卷；阶段纲读取分卷主/辅线、上一阶段、上一章、卷末实体快照；章纲读取当前阶段、前章与卷目标。上下文由 `@type`、`@parent`、`@self` 等 DSL 定点引用，而不是全文塞入。

源码：[`card_types.py`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/card_types.py)。

#### 输出模型与硬校验

`wizard.py` 定义了规划的 Pydantic 输出模型：

- `Blueprint`：`volume_count`、核心角色卡、场景卡；
- `VolumeOutline`：主线 `main_target`、1–3 条辅线、阶段数、角色行动、卷末 `entity_snapshot`；
- `StageLine`：`reference_chapter`、`overview`、阶段末快照和 `chapter_outline_list`；
- `ChapterOutline`：卷/阶段/章号、标题、摘要和 `entity_list`。

关键门禁是 `StageLine.validate_chapter_outline_coverage`：当章节列表非空时，列表章号必须连续并完整覆盖 `reference_chapter`。`ChapterOutline.entity_list` 明确要求仅能从上下文提供的实体中选择。换言之，至少“漏章”和“凭空列实体”被纳入模型契约，而不是留给模型自觉。

#### Prompt/运行时机制

内置 Prompt 文件定义每一层的职责；本轮已读取的一句话、核心蓝图、分卷、阶段和章节 Prompt 与上述模型对齐。运行时把“卡片任务 Prompt + 指令流规范 + JSON Schema”拼成 system prompt，模型逐条输出 JSON Pointer `set/append/done` 指令。`structured_runtime.py` 对每条指令先 `validate_instruction`，再应用到内存数据；结束后用 `output_type.model_validate` 再校验。无可用结果时默认抛错；`fail_soft` 才允许返回部分结果。

此外运行时做配额预检并记录输入/输出 token。HTTP `/generate` 也会动态构造响应模型，调用结构化生成，失败映射为 400。这里的可靠性来自 schema、局部指令和二次模型校验的组合，不是单靠“要求模型输出 JSON”。

##### Prompt 职责与特定约束（受限摘录）

六份内置模板共享协议：参照提供的 JSON Schema；信息不足时可在约束内推断而非反复追问；只输出指令流，并以 `{"op":"done"}` 结束。它们不是要求模型直接返回最终 JSON，因此调用方必须保留指令级与模型级两道校验。

| Prompt 资产 | 主要职责/输入 | 特有约束 |
|---|---|---|
| `一段话大纲.txt`、`核心蓝图.txt`、`世界观设定.txt` | 从标签、金手指、故事设想与实体卡生成上游规划对象 | 遵守各卡片 Schema，形成后续卷/阶段可引用的结构化资产 |
| `分卷大纲.txt` | 总卷数、故事大纲、世界观、角色/组织/场景、上一卷 | 生成卷主线、辅线、阶段与卷末实体快照，承接前卷而不重置事实 |
| `阶段大纲.txt` | 当前卷主辅线、上阶段/上章及卷末实体快照 | 参与实体只能来自输入卡；分摊 `StageCount`；不得前半卷完成主线；`chapter_outline_list` 连续、完整覆盖 `reference_chapter` |
| `章节大纲.txt` | 当前阶段、前章、卷目标和实体上下文 | 输出章级标题、摘要与实体引用，并受章号和实体白名单模型约束 |

受限短摘录“参与实体只能选自输入卡”对应代码的实体约束，不能被理解为模型真的不会幻觉；真正的阻断来自 `validate_instruction` 和 Pydantic 二次验证。源码：[`分卷大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E5%88%86%E5%8D%B7%E5%A4%A7%E7%BA%B2.txt)、[`阶段大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E9%98%B6%E6%AE%B5%E5%A4%A7%E7%BA%B2.txt)、[`章节大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E7%AB%A0%E8%8A%82%E5%A4%A7%E7%BA%B2.txt)。

#### 可复用与风险

最值得提取：卡片类型定义同时承载 schema、上下文选择和模型参数；阶段输出用连续编号/实体白名单约束；生成前后的验证分离。不要直接复制 DSL 或把 `fail_soft` 设为默认，否则会把部分不合法数据伪装成成功。

AGPL-3.0 是已由仓库 API 核验的许可证；网络服务、修改分发和代码复用前应作专项合规评估。未部署、未调用模型，恢复流程、DSL 解析和流式 UI 只做源码审查。

### 8.4 OpenFic：可配置 Agent 工作台与会话计划账本

- 仓库：[syrizelink/OpenFic](https://github.com/syrizelink/OpenFic)
- GitHub 快照：857 Stars、Apache-2.0；API 查询时间为 2026-08-25。
- 本次源码证据：内置 `plan`、`composer`、`reviewer` Prompt，Prompt loader 与会话计划持久化服务。

#### 机制定位

OpenFic 并未把“分卷纲→章纲”固化为唯一内置小说算法。它将规划职责交给名为 `Plan` 的 Agent：先路由用户意图、探索项目状态、渐进澄清需求，再写计划、审查、等待用户确认并委派执行。`Composer` 则把当前任务提示中的设定和剧情材料组织为“剧情单元 + 节拍”，并写入笔记。

因此它的直接价值是**人机协作的规划控制面**，不是现成的中文长篇模板。把它描述成“内置固定大纲流水线”是错误的，源码并不支持这种夸张结论。

源码：[`plan.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/plan.yaml)、[`composer.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/composer.yaml)。

#### Agent 职责与产物边界

| Agent | 责任 | 产物/限制 |
|---|---|---|
| Plan | 意图路由、需求澄清、计划、执行前审查与委派 | 明确要求计划获用户批准；自身只规划，不直接写章节或设定 |
| Composer | 把剧情组织为围绕单一戏剧问题的剧情单元和节拍 | 计划写入 `/剧情大纲`；禁止把章节数、字数作为规划约束 |
| Auditor | 执行前审查计划的完整性、逻辑、可行性、一致性 | 只报告问题，不改写内容 |
| Reviewer | 对已完成章节审查需求、计划、上下文、逻辑和格式 | 只根据当前任务材料作通过/打回判断 |

`Composer` 的两级结构比较可复用：剧情单元围绕一个戏剧问题；场景事件型单元用过程节拍，发展阶段型单元用里程碑节拍；戏剧问题改变、大跨度时间跳跃或切换并行线时必须切分。它还要求节拍避免藏进完整子事件，这对防止“看似有纲、实际无法写”很有效。

##### Prompt 边界补证：Explore

新增读取的 `explore.yaml` 说明该仓库的 Agent 约束并非只靠角色名称：`Explore` 只能探索、不能写入；先区分字面需求、实际目标和可执行成果；结论只能基于当前 Prompt 已提供的信息。前提缺失时必须标注边界，不能自行补成事实。

| Agent/资产 | 输入 | 输出与禁止项 | 作用 |
|---|---|---|---|
| `explore.yaml` | 当前任务材料和已有上下文 | 证据化的探索结论；禁止写入、禁止编造未提供事实 | 在计划/写作前隔离事实收集与变更 |
| `plan.yaml` | 用户目标、探索结果 | 待确认计划与委派边界；禁止直接写章节 | 把审批置于执行前 |
| `composer.yaml` | 已确认设定与剧情材料 | 剧情单元和节拍笔记 | 将已批准目标转为可执行剧情结构 |

这证明的是可配置 Agent 控制面和认识论边界，不是固定的“分卷纲→章纲”算法。源码：[`explore.yaml`](https://github.com/syrizelink/OpenFic/blob/main/backend/app/prompts/builtin-agents/explore.yaml)。

#### 计划持久化和提示词装配

`agent_runtime/plan/service.py` 以 `session_id` 为键写 `PlanRecord` 与 `PlanTodoRecord`。Todo 必须有非空内容，状态仅允许 `pending/in_progress/completed`，优先级仅允许 `low/medium/high`；写入会整体替换该 session 的 todo 列表并更新时间。

这一点有双刃剑：字段校验清晰、会话隔离明确；但 `replace_plan_todos` 表示调用方必须提交完整计划快照。若产品要支持多端并发或局部更新，需要在写入边界补 revision/compare-and-swap，否则会发生最后写入者覆盖。

内置 Prompt loader 将 8 个 Agent YAML 注册为固定 Prompt ID，同时可从 `custom-agents/` 加载自定义 Agent。它证明 Prompt 可配置，但不证明每个自定义 Prompt 都具备安全性或质量门禁。

#### 可复用与风险

推荐借鉴：规划与执行分工、用户确认边界、剧情单元/节拍定义、会话级计划账本和只读审查角色。需要补强：计划写入的并发控制、具体小说资产 schema、Agent 工具权限与运行时行为；本轮未运行 OpenFic，未确认其 Prompt 在真实工具链中是否被严格执行。

许可证已由仓库 API 核验为 Apache-2.0；仍不应把第三方 Prompt 文本整段复制进产品资产。

### 8.5 awesome-novel-agent：文件协议驱动的卷章规划流水线

- 仓库：[modoojunko/awesome-novel-agent](https://github.com/modoojunko/awesome-novel-agent)
- 本次源码证据：`novel-dispatch.md`、`volume-planner.md`、`chapter-planner.md`、`chapter-outline.md`、`prompt-crafting.md`、`memory-recording.md`。
- 证据等级：源码级 Markdown Agent/Skill 协议；未在任何宿主实际运行。

#### 调度与恢复契约

主 `novel-agent` 只读取 `status.md`、写 `.agent/task/*-order.md`、检查 order 是否 `DONE`。阶段顺序是 setup → volume-planning → chapter-planning → prompt-crafting → writing → anti-ai → review → archive；每个 order 仅含输入路径、输出路径、`status: pending`，具体方法留在相应 Skill。

恢复并不靠每次扫描全项目：`status.md` 是断点源；阶段等值表示尚未完成，严格大于才可跳过；归档 `.done` 文件实现幂等；writer 中断通过 `partial_path` 续写。超过两次重试后要求作者手动介入，而不是无限重试。

源码：[`novel-dispatch.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/novel-dispatch.md)。

#### 卷纲与章纲输入输出

`volume-planner` 的输入是 order、`story.md`、世界观、题材、全局伏笔和相关角色状态，输出 `volumes/volume-{N}.md`，随后覆写 order 为 `DONE`。卷级规划要求核心冲突、情绪走向、冲突阶梯、信息差、章节方向与主导驱动力；作者确认是其 DoD 的一部分。

`chapter-planner` 读取目标卷、角色状态、前 3 章和全局钩子，输出 `chapters/vol-{N}-ch-{M}.md`。`chapter-outline.md` 将章纲拆为：

- `mood_progression`：从卷情绪弧继承，再形成章内微弧；
- 冲突阶梯：章内障碍必须逐步升高，禁止同一障碍换皮重复；
- 信息差：开场→中段→结尾要发生动态变化；
- 场景卡：行动、阻碍、悬念三要素；
- Memo：当前任务、读者期待、兑现、关键选择、知识状态、章尾改变与场景卡；
- `payoff_plan`：钩子的埋设、推进和收束；可选设定变更通知。

规划完成后才写入章纲并标记 `outline`。这套字段把“章节摘要”提升为可供 Prompt 组装和状态更新消费的中间表示。

#### Prompt 汇编与质量门禁

`prompt-crafter` 读取十类资产：文风卡、上一章的情绪落点/改变、当前章纲、角色、题材示例、有限反 AI 规则、短期/永久记忆、场景风格卡与 Prompt 记忆。它明确禁止读取上一章正文全文和 `archives/`，以控制上下文膨胀。

Prompt 固定由角色、任务、背景、案例、输入、输出六部分组成；规则冲突有优先级：红线 > 字数 > T1 词 > 认知动词 > 感官 > 普通规范。完成前做结构、占位符、红线、上下文衔接、场景权重、技法稀疏度和无 meta 泄漏检查。该检查是 Prompt 自检协议，不是独立运行时验证，不能过度宣称。

##### 新增 Skill 证据：主线收敛与章纲验收

`volume-arc.md` 先按作者信息完整度区分类型 A/B：类型 A 可由既有设定收敛总主线；类型 B 只确定第一卷，其余卷必须标为“待定”。其总主线句式是“谁 + 追求什么 + 对抗什么”，产物写入 `story.md`，并要求“总主线→逐卷”“卷序列→完整路径”“卷→反向推断总主线”三向核对。这里的“待定”不是缺陷，而是在事实不足时禁止伪造远期承诺。

`chapter-verify.md` 又把章纲落盘前的验收从单个 Agent 的自检提升为显式门禁：作者须确认结构化反馈，24 项清单、快速嗅探与 AI 味扫描全部通过，才可写 `chapters/vol-{N}-ch-{M}.md` 并把状态置为 `outline`。但清单执行仍依赖宿主 Agent，因此它是协议门禁，不是已实测的强制执行器。

| Skill | 输入/产物 | 硬约束 |
|---|---|---|
| `volume-arc.md` | 作者素材 → `story.md` 总主线和卷路径 | 信息不足仅定第一卷；三向一致性核对 |
| `chapter-verify.md` | 章纲候选与作者反馈 → 落盘章节文件 | 作者确认 + 24 项检查 + 嗅探/AI 味扫描全部通过后才更新状态 |

源码：[`volume-arc.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/volume-arc.md)、[`chapter-verify.md`](https://github.com/modoojunko/awesome-novel-agent/blob/main/skills/chapter-verify.md)。

#### 记忆与风险

记忆只捕捉作者明确否定、长期规则、修正或正例；入库前检查四字段、指令注入和重复；单文件超过 50 条由 updater 压缩；`use_count >= 4` 才可晋升永久记忆。此设计值得借鉴“可操作反馈 + 有限容量 + 显式晋升”，但仍依赖 Agent 按协议执行。

主要风险是宿主依赖：所有状态、权限与 `DONE` 语义都在 Markdown/工具调用约定中，而不是此仓库可独立证明的事务数据库。仓库 `LICENSE` 已复读为 GPL-3.0；README 中的额外商业授权声明仍须单独核验，不得把它和 GPL 条款混同。


## 九、完整原文归档后的工程性总结

完整原文比字段表更能暴露真实设计：可靠性不来自“写了一段很长的提示词”，而来自**提示词、上下文选择、结构化输出、后处理和状态提交**是否同属一条可诊断链。只摘一段 system prompt 去复刻行为，通常会丢掉最重要的部分。

| 项目 | 原文中确认的关键机制 | 不可孤立复制的部分 |
|---|---|---|
| oh-story | `SKILL.md` 负责意图路由与停靠点，按阶段延迟加载权威参考文件；主产物缺失时 fail-fast，并将状态写入交给事务工具 | 单个大纲方法文件不等于完整工作流；缺少文件协议、追踪事务和宿主工具时，规则无法自动执行 |
| AI-Novel-Writing-Assistant | `plannerPlan.prompts.ts` 以 system + user 消息构建书/弧/章规划；书/弧预算为 1800，章级为 2400；`postValidate` 拒绝关键字段和场景缺失；重规划限制连续小窗口 | 还依赖 context policy、输出 Schema、规范化、`PlannerService` 上下文块和 `persistStoryPlan`；仅复制文本会丢掉契约 |
| NovelForge | 模板直接规定阶段职责、实体白名单、章节连续覆盖和 `done` 指令；模型可在未知细节处推断 | 模板不是持久化协议；真正门禁是 JSON Pointer 指令校验和 Pydantic 二次验证 |
| OpenFic | `plan.yaml` 是有序的多段 system 条目：路由、澄清、计划、审查、用户确认、委派和交付检查共同形成控制流 | “只规划、不执行”依赖宿主 Agent、工具权限和计划账本；复制 YAML 不会产生审批或隔离能力 |
| awesome-novel-agent | `prompt-crafting.md` 将十类输入压缩为六段 Prompt，并以红线→字数→词/认知动词→感官→普通规范裁定冲突 | 它依赖文件、记忆和后续 Agent；缺少输入选择、稀疏技法转换和验收门禁，长 Prompt 只会变成上下文垃圾桶 |

### 归档使用边界

1. 从 [`原始提示词归档/README.md`](05-github-ai小说大纲方案调研/原始提示词归档/README.md) 的固定 commit 开始；不得用会漂移的 `main` 混入当前证据。
2. 借鉴时提炼可验证的产品契约：输入对象、必填输出、拒绝条件、版本基线、提交点和恢复路径；不要移植原句后期待模型自动遵守。
3. 当前没有运行任一上游项目。因此归档证明的是“上游某固定版本存在这些文本和静态装配链”，不证明提示词效果、模型遵循率、成本或宿主运行时行为。

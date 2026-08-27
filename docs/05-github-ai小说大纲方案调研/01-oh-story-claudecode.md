# oh-story-claudecode：文件化大纲与事务追踪

- 仓库：[zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)
- 本次源码证据：`skills/story-long-write/SKILL.md`、`references/workflow-setup.md`、`references/artifact-protocols.md`、`references/tracking-transaction.md`、`scripts/tracking_commit.py`。
- 证据等级：源码级（未本地运行）。

## 可核验工作流

入口 Skill 将“开书”明确路由为 Phase 1→2→3，并在首批 10 章细纲后默认停止；未明确要求不得进入正文。Phase 1 确认选题并处理对标；Phase 2 落地核心设定、关系与题材卡；Phase 3 先建全书阶段总览，再建卷纲、剧情单元与逐章细纲。该停靠点是防止模型在用户只要大纲时自行生成正文的行为门禁。

源码：[`SKILL.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/SKILL.md)、[`workflow-setup.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/workflow-setup.md)。

## 大纲输入与产物契约

输入资产包括：`选题决策.md`、对标书的`剧情/情绪模块.md`与`剧情/节奏.md`、设定和已有进度。若两份对标主产物任一缺失，流程要求设置 `missing_primary_contract: true` 并停止，而不是以章节摘要补造结论。

产物分层为：

| 层级 | 产物 | 关键约束 |
|---|---|---|
| 全书 | `大纲/大纲.md` | 体量、阶段、情绪曲线、节点与钩子链 |
| 卷 | `卷纲_第X卷.md` | 卷契约、终局储备、剧情单元、人物/情绪弧、伏笔与反转 |
| 章 | `细纲_第XXX章.md` | 目标/关键选择、单元ID、禁止提前释放、五段概括、信息差、钩子、情节点字数预算 |
| 追踪 | `_tracking-state.json` | 当前角色、伏笔、时间线、上下文与修订号的唯一权威 |

细纲要求“单元ID/位置”“主角目标/关键选择”“行动成本（可无）/收益归属”。批次须进行大纲安全七检，覆盖读者契约、代理权、终局底牌与升级台阶，风险只能是“契约安全 / 需补强 / 契约破坏”。

## Prompt/Skill 规则协议（受限摘录）

新增读取的 `outline-methods.md`、`reader-contract-and-progression.md` 与 `outline-conflict.md` 不是一个可独立调用的单一 Prompt，而是被 `story-long-write` Skill 按任务引入的方法与验收规则库。它们把大纲创建拆成五步，并以八节点结构组织关键转折；章级必须落出钩子、冲突和“爽点”检查。

| 规则来源 | 输入上下文 | 要求的规划结果 | 硬约束/后处理 |
|---|---|---|---|
| `outline-methods.md` | 选题、设定、目标篇幅和已有大纲 | 全书/卷/章的节点、冲突与章末钩子 | 五步创建法、八节点结构、章级钩子/冲突/收益检查 |
| `reader-contract-and-progression.md` | 主角行动、读者预期、阶段目标 | 读者承诺、升级台阶、终局储备 | 保护主角代理权、期待所有权和风险分级；不能把关键兑现提前消耗 |
| `outline-conflict.md` | 高潮目标、主支线、当前冲突 | 逆推高潮后的主支线推进与冲突阶梯 | 检查冲突递进、支线服务主线及阶段质量 |

受限短摘录可概括为“先逆推高潮，再安排冲突递进”；这只是规则意图，不是可直接复制的完整提示模板。生成结果随后仍须落到前述文件契约，并通过安全七检与 `tracking_commit.py check`。源码：[`outline-methods.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/outline-methods.md)、[`reader-contract-and-progression.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/reader-contract-and-progression.md)、[`outline-conflict.md`](https://github.com/zenstory-ai/oh-story-claudecode/blob/main/skills/story-long-write/references/outline-conflict.md)。

## 状态、恢复与质量门禁

`tracking_commit.py` 明确将 `_tracking-state.json` 定义为唯一结构化权威；`上下文.md`、角色快照、伏笔和两份时间线均为确定性派生物，禁止手改。`commit` 在内存合并和校验后写派生视图，最后原子替换 state 作为提交点；`expected_state_revision` 拒绝基于陈旧状态的顺序事务。`check` 校验 schema、固定七栏、体积、派生视图一致性。

这不是“保存几个摘要”的泛泛说法，而是有事务输入、修订号和派生一致性检查的状态协议。限制也很明确：同一本书不支持并发提交；未进行端到端运行，原子性与恢复体验尚未实测。

## 可复用与风险

优先借鉴：大纲停靠点、规划层级、未来计划与既成事实分离、唯一权威状态加派生视图、显式 fail-fast。不要照搬宿主 Agent/Hook 适配逻辑；Skill 自身声明在 custom agent 不可用时会退化为 solo/direct 执行，因此多 Agent 行为不是跨宿主不变量。

许可证已复读为 MIT；采用前仍应锁定 commit SHA，并对脚本与 Prompt 资产的实际复用范围单独评估。未运行 Skill、宿主 Agent 或恢复流程，以上仅是静态源码证据。
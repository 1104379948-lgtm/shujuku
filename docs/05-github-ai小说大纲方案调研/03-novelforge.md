# NovelForge：Schema-first 卡片树与指令流生成

- 仓库：[RhythmicWave/NovelForge](https://github.com/RhythmicWave/NovelForge)
- GitHub 快照：1134 Stars、AGPL-3.0；API 返回时间为 2026-08-25。
- 本次源码证据：内置 Prompt、`wizard.py`、卡片种子、生成运行时与 API。

## 规划树与上下文组装

初始化的卡片类型把规划组织成：作品标签 → 金手指 → 一句话梗概 → 故事大纲 → 世界观设定 → 核心蓝图 → 分卷大纲 → 阶段大纲 → 章节大纲 → 正文。

`card_types.py` 不是只登记名称：每种卡保存 JSON Schema、AI 参数和 `default_ai_context_template`。例如分卷纲读取总卷数、故事大纲、标签、世界观、组织、角色、场景和上一卷；阶段纲读取分卷主/辅线、上一阶段、上一章、卷末实体快照；章纲读取当前阶段、前章与卷目标。上下文由 `@type`、`@parent`、`@self` 等 DSL 定点引用，而不是全文塞入。

源码：[`card_types.py`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/card_types.py)。

## 输出模型与硬校验

`wizard.py` 定义了规划的 Pydantic 输出模型：

- `Blueprint`：`volume_count`、核心角色卡、场景卡；
- `VolumeOutline`：主线 `main_target`、1–3 条辅线、阶段数、角色行动、卷末 `entity_snapshot`；
- `StageLine`：`reference_chapter`、`overview`、阶段末快照和 `chapter_outline_list`；
- `ChapterOutline`：卷/阶段/章号、标题、摘要和 `entity_list`。

关键门禁是 `StageLine.validate_chapter_outline_coverage`：当章节列表非空时，列表章号必须连续并完整覆盖 `reference_chapter`。`ChapterOutline.entity_list` 明确要求仅能从上下文提供的实体中选择。换言之，至少“漏章”和“凭空列实体”被纳入模型契约，而不是留给模型自觉。

## Prompt/运行时机制

内置 Prompt 文件定义每一层的职责；本轮已读取的一句话、核心蓝图、分卷、阶段和章节 Prompt 与上述模型对齐。运行时把“卡片任务 Prompt + 指令流规范 + JSON Schema”拼成 system prompt，模型逐条输出 JSON Pointer `set/append/done` 指令。`structured_runtime.py` 对每条指令先 `validate_instruction`，再应用到内存数据；结束后用 `output_type.model_validate` 再校验。无可用结果时默认抛错；`fail_soft` 才允许返回部分结果。

此外运行时做配额预检并记录输入/输出 token。HTTP `/generate` 也会动态构造响应模型，调用结构化生成，失败映射为 400。这里的可靠性来自 schema、局部指令和二次模型校验的组合，不是单靠“要求模型输出 JSON”。

### Prompt 职责与特定约束（受限摘录）

六份内置模板共享协议：参照提供的 JSON Schema；信息不足时可在约束内推断而非反复追问；只输出指令流，并以 `{"op":"done"}` 结束。它们不是要求模型直接返回最终 JSON，因此调用方必须保留指令级与模型级两道校验。

| Prompt 资产 | 主要职责/输入 | 特有约束 |
|---|---|---|
| `一段话大纲.txt`、`核心蓝图.txt`、`世界观设定.txt` | 从标签、金手指、故事设想与实体卡生成上游规划对象 | 遵守各卡片 Schema，形成后续卷/阶段可引用的结构化资产 |
| `分卷大纲.txt` | 总卷数、故事大纲、世界观、角色/组织/场景、上一卷 | 生成卷主线、辅线、阶段与卷末实体快照，承接前卷而不重置事实 |
| `阶段大纲.txt` | 当前卷主辅线、上阶段/上章及卷末实体快照 | 参与实体只能来自输入卡；分摊 `StageCount`；不得前半卷完成主线；`chapter_outline_list` 连续、完整覆盖 `reference_chapter` |
| `章节大纲.txt` | 当前阶段、前章、卷目标和实体上下文 | 输出章级标题、摘要与实体引用，并受章号和实体白名单模型约束 |

受限短摘录“参与实体只能选自输入卡”对应代码的实体约束，不能被理解为模型真的不会幻觉；真正的阻断来自 `validate_instruction` 和 Pydantic 二次验证。源码：[`分卷大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E5%88%86%E5%8D%B7%E5%A4%A7%E7%BA%B2.txt)、[`阶段大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E9%98%B6%E6%AE%B5%E5%A4%A7%E7%BA%B2.txt)、[`章节大纲.txt`](https://github.com/RhythmicWave/NovelForge/blob/main/backend/app/bootstrap/prompts/%E7%AB%A0%E8%8A%82%E5%A4%A7%E7%BA%B2.txt)。

## 可复用与风险

最值得提取：卡片类型定义同时承载 schema、上下文选择和模型参数；阶段输出用连续编号/实体白名单约束；生成前后的验证分离。不要直接复制 DSL 或把 `fail_soft` 设为默认，否则会把部分不合法数据伪装成成功。

AGPL-3.0 是已由仓库 API 核验的许可证；网络服务、修改分发和代码复用前应作专项合规评估。未部署、未调用模型，恢复流程、DSL 解析和流式 UI 只做源码审查。
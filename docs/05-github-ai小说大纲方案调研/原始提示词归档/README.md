# 原始 Prompt / Skill 本地归档索引

> 用途：仅供本地个人研究与本次调研复核。文件按 GitHub 固定 commit 下载，保留所列上游文件的完整文本；不是本仓库生产资产、不是可直接复制的模板，也不表示取得额外授权。不得将该目录作为本项目的 Prompt 来源、发布物或再分发内容。

## 范围与完整性

- 本索引覆盖本次五项目调研中已定位、且直接参与大纲规划、Agent 控制或 Prompt 装配的 34 个文件。
- **“完整”仅指每一个下列已列资产以完整上游文件保存，非只截取段落。** 它不声称穷尽各上游仓库的全部 Prompt、参考资料、运行时模板或历史版本。
- 对未归档的上游资产，仍以对应 commit 的 GitHub 源码为准；报告中的机制结论仅限已读取源码和本目录内容。

## 固定来源

| 目录 | 上游仓库与固定 commit | 许可证/权利状态 | 文件 |
|---|---|---|---|
| `01-oh-story-claudecode` | `zenstory-ai/oh-story-claudecode` @ `a78f75a234f084c6b5469b301eecbea103c1ecae` | MIT（LICENSE 已复读） | `SKILL.md`、`workflow-setup.md`、`artifact-protocols.md`、`tracking-transaction.md`、`outline-methods.md`、`reader-contract-and-progression.md`、`outline-conflict.md` |
| `02-ai-novel-writing-assistant` | `ExplosiveCoderflome/AI-Novel-Writing-Assistant` @ `308ca1b396cda240ebe59bf3a512baf9069cb403` | 仓库 API：`NOASSERTION`；不得据此推断可复用 | `plannerPlan.prompts.ts`、`replanWindowDecision.prompts.ts`、`officialTemplates.ts`、`PlannerService.ts`、`plannerLlm.ts` |
| `03-novelforge` | `RhythmicWave/NovelForge` @ `61722a77e33106859de317a99f5fa6e7b7d37962` | AGPL-3.0 | `一段话大纲.txt`、`核心蓝图.txt`、`世界观设定.txt`、`分卷大纲.txt`、`阶段大纲.txt`、`章节大纲.txt` |
| `04-openfic` | `syrizelink/OpenFic` @ `ea2b76dc2fc60ef70722c711f1da45788e8b6803` | Apache-2.0 | `plan.yaml`、`composer.yaml`、`build.yaml`、`reviewer.yaml`、`actor.yaml`、`auditor.yaml`、`explore.yaml`、`loader.py` |
| `05-awesome-novel-agent` | `modoojunko/awesome-novel-agent` @ `0481ed0a5f2b389c55795d86ece959eb25087562` | GPL-3.0；README 额外商业声明未在本归档中裁定 | `novel-dispatch.md`、`volume-planner.md`、`chapter-planner.md`、`chapter-outline.md`、`prompt-crafting.md`、`memory-recording.md`、`chapter-verify.md`、`volume-arc.md` |

## 使用方式

1. 先从报告的静态调用链确认资产是否真的进入某个流程；不要只因文件名像 Prompt 就将其当作运行时实际输入。
2. 对 AI-Novel-Writing-Assistant，规划文本必须与 `PlannerService.ts`、`plannerLlm.ts` 和输出校验一起看；孤立复制 system prompt 会丢失上下文块、Schema、后处理与持久化边界。
3. 对 NovelForge，模板不是最终请求的全部：运行时还会附加 JSON Schema 与指令流协议；对 oh-story、OpenFic、awesome-novel-agent，Markdown/YAML 本身就是多文件 Agent/Skill 协议的一部分。
4. 需要追溯原始地址时，使用 `https://github.com/{owner}/{repo}/blob/{commit}/{path}`；请固定本表 SHA，禁止用随时间漂移的 `main` 替代证据版本。

# R3 — 科研能力接入与产品化实施方案

**状态：2026-11-28，使用者已批准规划，待实施。**

**上级唯一索引：** [V2/V3 主路线 §17.3](2026-11-25-research-workspace-v2.md#173-phased-v3-roadmap-r1r4-and-continuous-real-project-acceptance)。
本文件是 R3 的详细实施清单，不是独立路线、第二份架构或其他仓库的开发计划。R3 的阶段状态只在上级索引汇总；具体 R3.1–R3.5 进度只在本文更新。完成后保留为该阶段的可追溯记录。

## 1. 目标与冻结基线

将 BioHarness 已有科研能力真正接入 Web 产品，让科研人员能够创建和进入科研项目、输入问题及研究资料、选择真实支持的模型/策略、调用记忆和专业模块，并查看实际科研过程及来源。

- R2 源码及独立验收基线：Web `6de1b1506896665c79d317b26ca3a9d65ccaa614`；私有 R2 发布已切换到该版本。保留现有部署与历史数据，R3 部署另行批准。
- 本次规划核对的源码 HEAD：Core `69f2fbf`、Modules `3acc891`。这是源码观察基线，不等同于实际安装版本或授权能力；R3.1 必须重新核实精确 SHA、安装及公开调用。
- 保留 §17.1 的科研模型与 §17.4–17.5 已冻结布局、选型和来源标记：LibreChat 完整前端、dsh-context 视图组织、rc-tree、React Flow/Dagre、AG Grid Community、PDF.js、Monaco；继续使用现有 FastAPI 后端、直接模型 API、技术 SQLite 账本、React Query 与 SSE。
- 2026-11-28 私有生产 Chromium 视觉验收（36 张截图，UX-01–UX-14）证明用户操作入口及产品本地化仍有缺口。原始截图/日志留在私有验收目录，不进入公开源码。R2 技术验收仍有效，不将其等同于 R3 用户任务验收。

## 2. 不可变边界

1. Core 是唯一科研权威，保持五个公开 science_* 调用和已有 Scope、Request、计划、用户确认及交付语义。Web 不写 Core 私有记录、不复制状态机、不新增 Agent-facing 工具；Governance 只读投影。真实接口缺口记录后向使用者申请对应仓库的最小改动，不能静默扩展。
2. Modules 拥有 Memory、知识、科学审查、统计和专业方法；只调用已公开且获授权的资源、MCP、CLI、API。不新增 Registry、记忆数据库、科研流程引擎或第二个工作台。Eval 独立。
3. Web 只负责真实的产品交互、输入/会话与文件传输、模型/工具宿主、技术恢复和来源投影；复用现有基础设施及成熟 UI，不重做布局、重开选型或移植 donor 后端。
4. 版本差异、分歧、未评审或不利审查意见是提示；重要科学选择询问使用者，其余授权工作继续。不得自动暂停全任务、强制重规划、取消或新增科研审批门槛。保留原有访问隔离、证据完整性及 UNKNOWN 结果核对等技术安全约束。
5. 区分已声明、已安装、可调用、实际调用/消费和科学有效；不能用假按钮、空成功返回、模拟结果或猜测的来源补足产品。未公开或未授权能力如实显示，并报告责任方。
6. R4 的全量成果中心、跨路线比较、研究级 provenance 图、外部计算恢复、多机并发、Desktop 和独立科学收益评测保持 R4。R3 仅完成自身需要的输入、模块结果与现有证据的连接。
7. 正式源码在 fwq10 的原 Web 仓库；测试、构建在获授权 Linux 隔离副本。不得在 Mac/Windows 执行项目测试，不碰当前生产服务、运行任务、凭据、原始数据或他人目录。涉及 Modules 工程测试遵守该仓自己的授权 Linux 规则。测试原始输出与私有配置保留在仓库外。

## 3. 实施顺序（本文件唯一详细 TODO）

### R3.1 — 能力核查与最小产品规划（已完成，2026-11-28）

- [x] 读取 Web AGENTS、README、architecture、上级路线及冻结设计；核对 Core 与 Modules 的规则、现行公共合同、当前分支/安装/配置。检查实际公开工具 schema、资源声明、可用性和必要的只读响应，而非从 README 推断生产可用。
- [x] 建立精简能力对照表（随本节更新）：用户动作 | 权威仓库与精确接口/版本 | 当前是否可用 | 复用的 Web 入口 | 最小缺口 | 验证证据。涵盖项目/子项目、资料、模型、研究策略、Memory/Curator、Resources/Skills/Documents、Literature、Statistics、Review 和现有领域模块。
- [x] 复用已借鉴的 hello-ui、diagram-design（上级 §17.4 已记录来源与冻结原则）及实际可用的产品规划/浏览器验收 Skills。先读现有参考和相关 Skill 的真实说明；缺少 Skill 不作为开发阻断，不下载未知组件、不另建 Skill 或参考仓库。只补入口、状态、可读性及任务闭环。
- [x] 对照 UX-01–UX-14，确认关键用户路径、错误/空/加载/部分/不可用状态、中文术语及验收样例；在本文记录尚需使用者决定的真实接口缺口。不另建设计方案或重复选型。核查结束后直接进入 R3.2 的可实施部分。

#### R3.1 核实基线与精简能力对照表（2026-11-28 实测）

- **仓库与安装核实**：Web `feat/v3-r3-product-integration`（基于 `0bf9382` / R2 基线 `6de1b15`）；Core 源码 `main` `69f2fbf`，已安装 `bioharness-host` 为 `fc093d7`（`fc093d7..69f2fbf` 仅 `docs/architecture/module-plugin-contract.md` 变更，运行合同一致）；Modules 当前检出 `3acc891`（`feat/statistics-full-report-binding-20261123`）、`main` 为 `43706d9`；隔离构建/测试工具为 `node:24.22.3-slim`、`.venv` Python 3.12 与 `firecrawl-playwright-service:latest`（Playwright Chromium）。
- **设计参考与技能核实**：复用冻结的 `research-workspace-ui-design.html`（`diagram-design` `795eec4` 删除优先/单焦点/低密度 + `hello-ui` 单任务与完整状态覆盖）及现有浏览器验收脚本 `tests/browser/ui_step{3,4,5}_run.sh`；不新增设计体系或外部 UI 依赖。

| 用户动作 | 权威仓库与精确接口/版本 | 当前是否可用 | 复用的 Web 入口 | 最小缺口 | 验证证据 |
|---|---|---|---|---|---|
| 创建/进入科研项目与任意层级子项目（UX-01/02） | Core `69f2fbf` / 已装 `fc093d7`：`science_begin(question, scope={id,create,parent_id,related_request_ids})`；Governance `0.1.2` (`ed82a7b6`)：`tree`/`context`/`routes` | **可用**（必须随真实首条科学问题声明，不含独立标题字段） | `BioHarnessSidebarSection` (`rc-tree`)、`BioHarnessChatRoute`、`/c/new` | 侧栏当前把 Core 数据源下拉放主位且缺“新建项目/子项目”向导；树节点以原始 ID 为主 | 实读 `scope.py`/`view.py`；隔离 `bioharness-governance tree` 返回 `ok:true` |
| 上传小型研究资料/引用服务器授权数据（UX-03/10/13） | Core `evidence_roots` 约束 + Governance `evidence` SHA-256 锚点校验；Web `settings.py` `Workspace.evidence_roots` | **部分可用**（已有只读证据预览；缺受限上传/输入引用接口） | `BioHarnessComposer`（LibreChat 附件交互）、`BioHarnessEvidenceRoute` | Web 需最小受限输入上传/列表接口（显式 `upload_root`、大小/类型/SHA-256/禁覆盖/禁软链逃逸），无授权目录时明示只读 | 实读 `settings.py`/`api.py`/`BioHarnessComposer.tsx` |
| 日常任务模型选择（UX-07） | Web `model_config.py`（`GET/PUT /api/model-config`）+ `provider.py` `ModelClient.snapshot()` | **部分可用**（仅全局槽位配置，无按次/快捷模型选择） | `BioHarnessRequestHeader`、`BioHarnessComposer`、Settings `models` | 头部模型按钮直通管理员 Provider 表单；需分离快捷模型切换与 Provider 密钥管理，并在 Run 记录实际模型 | 实读 `model_config.py`/`provider.py`/`runtime.py` |
| 快速/深度研究策略（UX-04） | Core 5 调用主线不变（`EXPLAIN`/`EVALUATE`/`ANALYZE` 由 Core 判定）；Web `runtime.py` `max_model_turns_per_run`/`model_context_chars` | **需明确边界**（宿主预算策略可在 Web 真实生效；`reasoning_effort` 因第三方网关兼容性差异未默认启用） | `BioHarnessComposer`（与模型切换并列，和 Memory 检索深度严格分离） | 仅提供真实生效的宿主执行预算策略（默认标准 vs 紧凑快速/深度轮次），不改变五调用或证据标准；透传 `reasoning_effort` 待使用者确认 | 实读 `provider.py`/`runtime.py`/`settings.py` |
| 记忆检索（T1/T2/T3 与 FAST/STANDARD/DEEP）（UX-05） | Modules `bioharness-module-memory` `ed82a7b6` (`bioharness-memory-mcp`)：`memory_recall(mode=FAST|STANDARD)`、`memory_expand(detail=T1|T2|T3)`、`memory_report_use`、`memory_status`、`memory_diagnose` | **部分可用**（FAST/STANDARD 与 T1/T2/T3 已公开；**DEEP 抛出 `RECALL_MODE_NOT_IMPLEMENTED`**） | 新增侧栏二级入口与 Settings `memory` 标签 + 通用 MCP 宿主转发 | Web 需只读/受控 BFF 路由转发配置好的 Memory MCP，独立暴露信息层（T1/T2/T3）与检索层（FAST/STANDARD，显式标注 DEEP 不可用） | 实读已装 `mcp_server.py`/`task_recall.py`（L257） |
| Memory Curator 审核发布与来源登记（UX-05） | Modules `bioharness-module-memory`：`curator-releases/18a47a87` `inbox_curator.py`（运维 CLI）；`curation.py`（Python 库）；`source_registration.py`（明确禁 MCP 的运维 CLI） | **存在外部接口缺口**（MCP 仅暴露 `capture_candidate`/`propose_scientific`/`propose_theme`/`diagnose`，无公开 inspect/publish/register 接口） | Memory 工作台候选与诊断区 | Web 可支持候选提案、健康诊断与只读收件箱清单（若显式配置只读命令）；**互动审批发布与 T3 来源登记需 `bioharness-module-memory` 暴露受控公开接口** | 实读 `mcp_server.py`/`inbox_curator.py`/`source_registration.py` |
| Skills / Resources / Project Documents（UX-05） | Core `bioharness-host doctor` / `science_now` `[[resources]]`；Governance `context(documents={contract,guide,status,findings_index})`；workspace `SKILL.md`；Web MCP 发现与 SQLite 账本 | **可用**（四态数据源全部真实存在） | 侧栏“能力与记忆”二级入口、Settings `skills`/`modules`/`diagnostics` | Web 需聚合 Declared/Installed/Callable/Actually Used 四态只读投影与项目文档查看器，不另建 Registry | 隔离实测 `bioharness-host doctor` 与 `governance context` |
| Literature 文献检索与获取（R3.4） | Modules `bioharness-module-literature` `ed82a7b6`：`bioharness-literature search|fetch`；`paperqa2` `0.2.0`（未生产启用） | **部分可用**（CLI 已装，但默认 PATH 无 `paperseek`/`scansci-pdf`；`paperseek` 位于独立 venv，本机无 `scansci-pdf`） | `BioHarnessExecutionsRoute` 通用 Module Inspector + 文献领域渲染器 | 需在 Web 暴露真实模块发现/调用观测及文献记录/分页/截断/来源渲染，如实标注未启用 provider | 实测 `bioharness-literature --help` 与本机 PATH 检查 |
| Statistics 统计语义与报告绑定（R3.4） | Modules `bioharness-module-statistics` `3acc891` / 已装 `31f30d15`：`bioharness-statistics-report-binding render|verify` + `STATISTICS_AGENT_GUIDE.md` | **部分可用**（`report_binding` CLI 可调用；旧临床审查组件 `PRODUCTION_NOT_ENABLED`） | Module Inspector + 统计报告绑定渲染器 | Web 渲染实验单位/分组/分母/检验/效应量/校正与 `report_binding verify` 结果，不在前端重算 | 实测 `bioharness-statistics-report-binding --help` |
| Scientific Review 科学审查（R3.4） | Modules `bioharness-module-scientific-review`：已装 `current=ed82a7b6 (0.6.7)`，另装 `356a5c6 (0.7.1 / Rev 11)`（直消费 `AdviceRequest`，仍通过 `CodeArtsIntakeReviewer`） | **部分可用（存在直连 API 缺口）**（Core 已记录审查意见与 `未评审`；但 0.7.1 仍依赖外部 `codearts` 命令而非直连模型 API） | Workflow/Request/Executions 审查意见卡片 | Web 完整呈现 Core 记录的审查 verdict/issues/basis/版本/分歧/修订记录（永不阻断）；直连模型 API 适配归 `BioHarness-Modules` | 实读 `356a5c6` `core_advisor.py` 与 `README.md` |
| 领域分析/Workflow 模块（R3.4） | Modules `protein-methods` `0.2.0` (`6e2ad135`, CLI 已装 6 子命令)；`dapseq`/`genome-web-tf`/`sequence`（参考/归档，不可运行） | **部分可用**（仅 `protein-methods` 可调用；其余为 `REFERENCE/NOT_RUNNABLE`） | 通用 Module Inspector | 只接入已公开可调用能力，参考模块诚实标为不可运行，不复现生物信息学算法 | 实测 `bioharness-protein-methods --version` (`0.2.0`) |

#### UX-01–UX-14 关键路径、状态与中文术语约束

- **术语统一（简体中文优先，保留英文完整支持）**：科研项目（Project/根 Scope）、子项目（Sub-scope）、科研问题/请求（Request）、运行环境/数据来源（Core Workspace，降为次级数据源切换）、输入资料（Input Files，与“Core 已核验科研证据”严格区分）、执行预算策略（默认标准/紧凑快速/深度轮次，与 Memory `FAST/STANDARD/DEEP` 严格分离）、已声明/已安装/可调用/实际已用（Declared/Installed/Callable/Actually Used）。保留通用缩写：`CSV/TSV/FASTA/PDF/SHA-256/DOI/MCP/CLI/SSE/T1/T2/T3/FAST/STANDARD/DEEP`。
- **关键状态覆盖**：每个新增入口均区分 `空状态`（引导真实下一步动作）、`加载中`、`部分/截断`、`陈旧（503 保留上次确认时间与刷新）`、`错误` 与 `未配置/不可用（明确责任方与原因）`。
- **待使用者决策的真实外部接口缺口（不阻断 R3.2–R3.5 其余授权开发）**：
  1. **Memory Curator 公开接口（归属 `BioHarness-Modules`）**：当前 `bioharness-memory-mcp` 仅支持提案与诊断，不含受控 `inspect`/`publish` 与 `source_registration` 公开工具；R3.3 将先对接已公开的 8 个 MCP 工具及可选只读清单，是否批准后续在 `BioHarness-Modules` 增补受控 Curator 公开接口？
  2. **Memory `DEEP` 检索模式（归属 `BioHarness-Modules`）**：当前 `TaskMemoryRecall.recall` 仅开放 `FAST`/`STANDARD`，`DEEP` 抛出 `RECALL_MODE_NOT_IMPLEMENTED`；R3.3 将如实标注 `DEEP` 不可用，是否计划在 Modules 侧公开 `DEEP`？
  3. **Scientific Review 直连模型 API 适配（归属 `BioHarness-Modules`）**：已安装的 0.7.1 (`356a5c6`) 仍经 `CodeArtsIntakeReviewer` 调用外部 CLI；R3.4 将在 Web 完整展示 Core 审查记录且不阻断任务，是否批准在 Modules 侧补充直连模型 API 适配器？
  4. **研究策略是否透传 `reasoning_effort`（Web 配置项）**：R3.2 先落地真实生效的宿主轮次/上下文预算策略（兼容全部 OpenAI 兼容网关）；若需针对特定模型透传 `reasoning_effort`，建议作为 Provider 模型级显式可选配置，避免不支持该字段的网关报 400。

**明确的现状约束：** Core 当前的 scope 声明以首条真实科学请求为起点，支持稳定 parent_id 和多层级路径；不能脱离首个请求创建假项目。Core 三种任务类型 EXPLAIN/EVALUATE/ANALYZE 与 Memory 三档检索 FAST/STANDARD/DEEP 是不同维度。源码中已有 Memory DEEP 实现并不证明当前 Web 工具接口已公开。此阶段要核实“快速/深度研究模式”的真正产品语义，不自行定义第二种科研主线。

### R3.2 — 基础科研交互补齐（UX-01–04、06–13）

- [ ] **项目和子项目（UX-01/02）：** 将科研项目作为主要导航对象，现有 Core 运行工作区选择仅在切换数据来源时出现并说明含义。提供清晰的“新建项目”“新建子项目”和继续已有项目入口，显示人可读名称、归属路径、科学目标及历史请求。复用现有 `science_begin` 的 scope 声明（id/create/parent_id）和 Governance 树；新建时引导填写真实首条科学问题，不发合成占位请求，不允许静默绑定或拖拽改写历史父级。未绑定请求保留独立分组。
- [ ] **资料输入（UX-03/10/13）：** 复用 LibreChat Composer 的附件交互，提供上传小型 CSV/TSV、FASTA、PDF 和引用已有授权数据的真实入口。核实文件传输公共接口；若现有接口不足，只设计 Web 必需的最小受限上传/引用传输，使用明确授权的可写研究输入根、服务端文件身份、大小/数量边界、路径与软链检查、上传完整性校验、禁止覆盖现有文件、明确失败/重试。附件与当前 workspace/scope/request 绑定，保留来源、版本和实际大小/摘要。浏览器路径不是服务器路径。大数据使用已有服务器引用及有界摘录，不默认整文件发送模型。上传完成不代表证据已核验；沿用 R2 精确 evidence anchor 与版本校验，不新增科学资产数据库。无授权存储时明示不可上传，继续其他任务。
- [ ] **模型与研究策略（UX-04/07）：** 日常模型选择使用可信配置及真实可用模型，和 Provider URL/API Key 管理分开；实际 Run 记录所用模型。快速/深度研究模式只有在已核实的真实模型参数或 Host 上下文/执行策略下才提供，清楚说明效果，保持五调用主线及科学要求不变，不降低证据标准，不虚构速度/质量，不把 Memory FAST/DEEP 当成研究模式。缺真实策略则报告可选方案，由使用者决定后补充；不放无作用的开关。
- [ ] **可读导航与会话（UX-08/09/11）：** 在现有独立 Conversation / Workflow / Evidence 页面与执行记录中提供标题、项目位置、当前状态、下一步、历史请求、来源入口；技术 ID/JSON 折叠。保留显式 request_id/conversation/run/operation 绑定、真实 A# 确认、WAIT_FOR_USER、状态恢复和历史计划版本。聚合活动/待处理提示只能是现有状态的只读投影；打开其他视图不影响后台执行。
- [ ] **中文和响应式（UX-06/12/13）：** 复用 donor i18n、主题、菜单和组件。中英文均保持完整；简体中文覆盖关键导航、项目/上传/模型/模式、状态、错误、空状态、设置与帮助。必要专业缩写保留。默认隐藏未接通的 donor 设置。实际检查 1440/1024/390/320px、浅/深色、触摸目标、键盘、菜单/对话框和重载，避免新增界面拥堵。
- [ ] 本阶段通过一次隔离端到端用户任务：创建带真实问题的根项目 → 创建子项目 → 关联资料 → 选择实际支持的模型/策略 → 进入对话 → 在现有流程/证据页找到同一请求。确认无伪造 Scope、意外绑定或数据覆盖；不可用功能明确记录，未验证不勾选。

### R3.3 — Memory、Skills、Resources、Documents（UX-05）

- [ ] **记忆入口及检索：** 连接 Memory 的公开查询接口，提供真实检索、T1 主题/T2 具体经验/T3 原始来源的展开；信息层与 FAST/STANDARD/DEEP 检索层独立。显示实际检索后端、返回范围、适用条件、冲突/反例、来源和版本。不复制 Memory 记录，不把候选/召回冒充实际消费。DEEP/TaskMemoryGraph 仅在公开且可用时呈现真实返回；未暴露能力标记不可用。
- [ ] **Curator 与来源核验：** 复用 Memory 自有 CuratorProposal/Decision、inspect/publish、source_registration、来源 SHA-256 与修订 CAS 语义，实际调用以 R3.1 核实的公开接口为准。提供候选查看、来源核验、差异、审核反馈和明确发布动作；不得绕过受控来源登记的 Memory operator 边界，不在 Web 重做 curation。发现未暴露的必要公开接口由 Memory 所有者处理，需单独批准的改动不阻断其他 Web 工作。
- [ ] **Skills/Resources/Documents：** 在已有产品导航/设置中增加可发现的科研能力与记忆入口，组织 Core resources（memory/knowledge/data/workflow/compute/service）、实际 workspace Skills、Governance 项目文档及 Literature 输出。展示 Declared / Installed / Callable / Actually Used 的有据状态，直接阅读已有公开资料和执行宿主观察到的实际调用。复用现有 Composer 触发/附件入口及公共调用，不另造资源 Registry 或 Skill runtime。
- [ ] **设置与诊断：** 复用现有设置框架，按 General/Models/Skills/Memory/Modules 与 Compute/Diagnostics 的已支持能力组织；不存在的 R4 远程计算能力不提前实现。明确只读/配置锁、失败原因、上次确认时间；诊断仅限必要脱敏信息。
- [ ] 通过真实模块隔离验收：召回 → 候选形成 → T3 核验 → 经授权 Curator 发布 → 再召回；核对条件、冲突、来源、实际消费反馈。验证 Skills/Resources 的四种状态和作用域；完整链路存在接口缺口时不得伪报通过。

### R3.4 — 专业科研模块接入

- [ ] 在现有通用 Module inspector 和工具路由上增加真实模块发现、调用可用性、观测记录、版本、参数、输出和证据链接。先复用通用视图；只有真实模块结果需要时增加小型领域渲染器。
- [ ] **Literature：** 对接已授权公开接口，展示实际检索结果、论文身份、来源链接/可用原文片段、分页/截断状态和实际引用；不伪造全文或引文，不宣称未启用 provider 可用。
- [ ] **Statistics：** 显示实际实验单位、数据粒度、分组/组合、分子分母、背景、方法/检验/模型、效应量、多重校正及结果；复用模块拥有的确定性报告渲染与 report_binding 验证。当前设计指导、已实现组件和生产可调用状态分开；Web 不重算或自行推断统计结论。
- [ ] **Scientific Review：** 显示审查意见、依据、版本、分歧和一次修订后的实际记录。核实当前模块版本及直接模型 API 接缝；任何必要适配留在 Scientific Review 所有仓库，不引入外部 Agent 运行依赖或新的审查门禁。缺失、失败、延迟及不利意见均不自动阻断任务。
- [ ] **领域分析/Workflow：** 只接入当前公开、可调用的能力，展示真实方法、参数、状态与返回的产物。未实现或仅参考的模块保留诚实说明及通用 inspector，不复现 DAP-seq/TF/序列算法。orrery 仅在现有来源核查确有需要时评估，不提前开发 R4 provenance 图。
- [ ] 使用已有真实小规模科研场景验证已启用的各专业模块，核对模块公开响应与用户可见内容、原始来源及实际调用。隔离测试通过不等于科学方法正确或生产已启用；无法授权的模块须列明具体阻塞与所属仓库，其他独立任务继续。

### R3.5 — 产品级联合验收与收尾

- [ ] 保留 R2 原生对话、A1/HITL、SSE 重连、深链、Request/Scope 证据历史、版本/字节校验、UNKNOWN 核对和后台运行行为，针对变化影响链执行 Python、TypeScript、Jest、生产构建及现有四套 Chromium 回归。记录实际退出码、失败、跳过及测试源身份；不以用例总数替代产品验收。
- [ ] 在真实 Chromium 以科研用户视角完整操作：创建项目/子项目 → 添加小型真实格式资料 → 选择实际支持的模型与策略 → 找到 Memory/Skills/Modules → 真实调用 → 回答用户确认 → 查看计划/证据/模块输出 → 关闭或重载后继续。不允许用截图、静态 fixture 或按钮点击代替实际可用性；分别记录 fixture、真实公开 CLI/模块、经授权 live Provider 以及真实科研结果验证范围。不得向生产研究目录写入测试数据。
- [ ] 逐项复核 UX-01–UX-14，尤其项目概念、缺入口、模式真假、中文、历史任务定位、空状态、模型高级设置、移动端与误导性 donor 设置；桌面及 390px 主任务闭环，另做 320px/1024px、主题、键盘、加载/错误/不可用视觉检查。私有验收保留截图及操作证据，公开仓库只记脱敏摘要。
- [ ] 真实模块及 live 科研任务的测试仅使用已授权模型、工具和隔离研究数据，验证实际结果、来源与技术状态的差异；Memory ON/OFF 独立科研收益、跨路线结果比较与真实外部长作业验收仍在 R4/Eval，不能用本轮工程 PASS 替代。
- [ ] 对照全部变更核实架构边界、数据访问与凭据、无重复科学状态、无新门禁、无并行 TODO、保留现有固定依赖及许可证；明确任何未实现、未验证、用户决策或外部模块缺口。
- [ ] 在本文记录阶段完成证据/精确提交，更新上级 §17.3 R3 汇总；R4 保持未开始。独立提交，工作树干净。未完整验收的范围不能勾选完成。私有生产切换另行获得授权，保留旧发布与回滚能力。

## 4. 验收记录规则

R3 开发检查点、缺口与验证结果只更新本文件相应小节（短摘要 + Git SHA/测试证据身份），上级只更新阶段状态。必要且实质的长期架构改变需使用者批准后更新现有架构文档；不新增平行计划。测试证据、截图、真实输入与凭据保持在授权的私有 CI/科研目录。

每一阶段执行 check → apply → verify。仅在实际依赖未满足时标记受影响的子项；科学审查与版本分歧不成为全局任务停止条件。所有实现状态、技术验收与科研有效性分别报告。

# BioHarness Research Workspace

**状态：W1 读侧与 W2 原生运行时已实现，并在合成夹具上通过后端、契约、组件和真实浏览器测试；真实模型已在 Linux 隔离环境完成一个合成 EXPLAIN 闭环，实际调用 Core 和 Project Governance，并在两次提供商响应失败后显式恢复到交付；真实科研项目与三类任务完整验收仍开放；W3 的通用调用检查器、分页时间线和 Module 发现状态已与最新后端集成，并通过 Linux 合成工作区联合测试；真实专业 Module 与科研项目验收仍开放。** Web 已作为独立常驻组件接入正式安装的 Core/Governance 公开 CLI，并完成私有 Linux 的读侧与重启冒烟；这不是完整科研或公开服务验收。部署与回退见[部署说明](docs/deployment.md)。本仓库提供 BioHarness 的第一方 Web 科研工作台，原 Observatory 已退役为历史资料。产品目的、规则和唯一实施路线见本 README、[AGENTS.md](AGENTS.md)、[架构](docs/architecture.md)及[V2 计划](docs/plans/2026-11-25-research-workspace-v2.md)。

## 产品目的

BioHarness Research Workspace 为科研人员提供一个能够理解、组织、推进、检查和持续开展科研工作的统一环境。

它需要让研究人员直接看到：
- 长期科研项目、科学目标、研究分支和历史路线；
- Core 当前持有的科研问题、Requirements、动态计划和下一步工作；
- 每个科研步骤使用的方法、数据、参数和专业 Modules；
- Modules 实际提供的结果、工具调用、来源和证据；
- 结果、反证、未解决问题、科学评审和结论之间的关系；
- Memory 如何被检索、展开、采用，以及后续任务是否真正受益。

**核心界面是科研过程和证据，而不是聊天记录或日志控制台。**

## 固定产品方向

1. **先 Web，后 Desktop。** Desktop 后续使用同一套前端和应用接口，默认是连接远端 BioHarness 服务的 Tauri 薄封装；本地 Sidecar 仅在真实需求证明后评估。
2. **原生 Model API。** Web 后端直接调用模型提供商 API，自身承担模型与工具调用循环，不依赖 Claude Code、Codex、CodeArts 或其他外部 Agent。
3. **Core 是唯一科研主线。** Web 使用 Core 当前公开接口，遵循 Core 返回的下一步安排，不另建科研状态机。
4. **Modules 保持独立。** Memory、文献、统计、评审和领域计算仍归 BioHarness-Modules；Web 负责呈现与调用公开能力；Modules 中原预留 Research Workspace 不再独立开发，唯一产品入口归本仓。
5. **科研可视化优先。** 科研树、科研流程、证据溯源和执行轨迹是不同视图，不能混成一个泛化流程图。
6. **V1 不构成兼容约束。** 原有只读 PostgreSQL 模型、页面、API 和部署方案均可按 V2 需要重构或删除。保留 Git 历史及明确归档的设计记录即可。

## 项目职责

| 项目 | 权威职责 |
|---|---|
| [BioHarness Core](https://github.com/mumu-140/BioHarness) | 唯一科研主线、原始问题、目标、Requirements、计划、评审、提交和交付 |
| [BioHarness-Modules](https://github.com/mumu-140/BioHarness-Modules) | Project Governance、Memory、Literature、Scientific Review、Statistics 和领域能力 |
| **BioHarness-Web** | 科研工作台、直接模型 API、工具执行宿主、可视化和交互 |
| [BioHarness-Eval](https://github.com/mumu-140/BioHarness-Eval) | 独立科研过程和结果评价 |

## 阅读顺序

1. [AGENTS.md](AGENTS.md)：开发和集成规则。
2. [docs/architecture.md](docs/architecture.md)：产品架构和职责边界。
3. [docs/plans/2026-11-25-research-workspace-v2.md](docs/plans/2026-11-25-research-workspace-v2.md)：唯一路线、TODO 和验收条件。
4. [docs/deployment.md](docs/deployment.md)：目标部署原则。
5. [docs/audits/w0-integration-review.md](docs/audits/w0-integration-review.md)：W0 实际验证、开源复用决策及尚未完成的 API 接入检查。
6. [docs/history/README.md](docs/history/README.md)：旧 Observatory 文档的历史定位。

## 当前实现状态

W1 读侧已替换旧的 PostgreSQL Observatory：FastAPI 后端只通过公开 CLI 读取 Core `science_now` 和 Project Governance `tree/context/routes/evidence`，不保存科研状态、没有数据库、没有写接口；React 前端提供科研树、科研流程图、检查器和证据预览。接口与快照约定见[架构 10.3 节](docs/architecture.md)，运行方式见[部署说明](docs/deployment.md)。

W2 原生运行时：配置模型端点后，后端直接调用模型 API，由宿主以用户原文调用 `science_begin`，把 Core 的答复交给模型，执行模型提出的 Core 调用和已配置的 MCP 工具，并由 Core 的 hook 决定一轮是否可以结束；对话、执行轨迹与取消见[架构 10.4 节](docs/architecture.md)。

W3 提供已记录调用的分页查询、时间线、通用调用/Module 检查器与工具服务器发现状态，保留 MCP 的有界结构化返回，并明确展示错误与省略标记。它们是 Web 运行观察，不是科研状态或独立验证，接口见[架构 10.5 节](docs/architecture.md)。

真实模型已完成短流式工具往返与一个合成 EXPLAIN 任务：同一请求只开始一次，完成两步有证据的提交后正式交付；期间两次提供商响应失败分别通过显式恢复继续，原题、计划与已有提交未重建。关闭模型通道后的重启读取也已通过。前后端联合后，新增真实模型浏览器合成 EXPLAIN 检查 10/10：运行中刷新后接续同一请求，实际调用 Governance，单次计划/提交/交付完成且本次未观察到提供商失败；离线重启保留交付和未评审披露。联合回归：后端 234、前端 54、标准浏览器 36、W3 6、只读模式 3 项通过。单次无故障不代表持续可靠性、真实科研质量、全上下文容量或生产部署验收。尚未实现：Scientific Review 的直连适配（归该模块）、长时外部作业、真实专业 Module 的完整结果适配和 Desktop。尚未验证：真实科研项目上的验收、较大规模图的渲染、Chromium 以外的浏览器。

以下命令仅在获授权 Linux 的仓库外隔离验证副本中执行，不在开发工作树或 Mac/Windows 上直接运行测试；公开 Core/Governance CLI 应预先安装。

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e '.[dev]'
.venv/bin/python -m pytest          # 契约测试需要已安装 bioharness-host 与 bioharness-governance，否则跳过
cd frontend && npm ci && npx vitest run && npm run build && cd ..
tests/browser/run.sh <带 Node 与 Playwright Chromium 的容器镜像>   # 真实浏览器检查，需要 docker
```
# BioHarness Research Workspace

**状态：PLANNING / W0。** 本仓库正在从原有只读 Observatory 重构为 BioHarness 的第一方 Web 科研工作台。产品目的、规则和唯一实施路线见本 README、[AGENTS.md](AGENTS.md)、[架构](docs/architecture.md)及[V2 计划](docs/plans/2026-11-25-research-workspace-v2.md)。

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

1. **先 Web，后 Desktop。** Desktop 后续使用同一套前端和应用接口，优先评估 Tauri 薄封装。
2. **原生 Model API。** Web 后端直接调用模型提供商 API，自身承担模型与工具调用循环，不依赖 Claude Code、Codex、CodeArts 或其他外部 Agent。
3. **Core 是唯一科研主线。** Web 使用 Core 当前公开接口，遵循 Core 返回的下一步安排，不另建科研状态机。
4. **Modules 保持独立。** Memory、文献、统计、评审和领域计算仍归 BioHarness-Modules；Web 负责呈现与调用公开能力。
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
5. [docs/history/README.md](docs/history/README.md)：旧 Observatory 文档的历史定位。

## 当前实现状态

现有仓库包含 React、TypeScript、Vite、React Flow 和 FastAPI，当前实现仍是面向旧 managed-record/PostgreSQL 模型的只读 Observatory。它尚未接入现行 Core 五接口，也没有原生模型 API 执行循环或当前 Modules 的完整集成。

已有代码仅是候选复用资产，不构成兼容约束。任何组件都应先按 V2 需求评估，再决定保留、改造、替换或删除。

**本规划不宣称 V2 runtime、模型 API、科研树接入或 Desktop 已经实现。**
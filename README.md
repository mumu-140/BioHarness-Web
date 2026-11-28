# BioHarness Research Workspace

BioHarness 的第一方科研工作台。组织研究项目、推进科学问题、查看方法、执行记录、证据与结果。Web 后端直接调用模型 API，不依赖外部 Agent 产品。

**当前状态：R2 源码与集成验收完成，R3 为下一开发阶段（2026-11-28）。** 唯一前端为 `ui/`，基于 LibreChat 完整应用底座和 dsh-context 科研视图组织。旧自研前端已退役。现有私有部署仍使用此前发布版本，新版本切换须另行批准。

## 系统职责

| 项目 | 权威职责 |
|---|---|
| [BioHarness Core](https://github.com/mumu-140/BioHarness) | 唯一科研主线：原始问题、目标、Requirements、计划、下一步、审查、提交和交付 |
| [BioHarness-Modules](https://github.com/mumu-140/BioHarness-Modules) | Project Governance、Memory、Literature、Scientific Review、Statistics、领域计算 |
| **BioHarness-Web** | 原生模型与工具执行宿主、会话、技术恢复、科研交互和证据投影 |
| [BioHarness-Eval](https://github.com/mumu-140/BioHarness-Eval) | 独立评价，不参与生产运行 |

Core 决定科学进程，Modules 提供专业能力，Web 的技术账本只记录会话、运行、操作和观测事件。版本差异、分歧和审查意见作为提示；涉及实质性科学决策时询问使用者，不增加自动暂停门槛。

## 当前能力

- 独立对话、科研流程、证据页面及执行记录；支持多项目、多层科研树、历史请求、原生用户确认、后台运行。
- Python/FastAPI 后端直接调用配置的模型 API、Core 公开 CLI 和配置的 MCP 工具；服务端模型设置、实际模型归属、SSE 重连及未知结果恢复。
- React Flow/Dagre 科研计划、rc-tree 导航，Request 与 Scope 证据历史分离。
- 有界、身份核验的 AG Grid Community 表格、自托管 PDF.js、Monaco、图片及静态 HTML 预览；区分历史、未验证、截断和不可用内容。
- R3 接入 Memory Curator、Skills/Resources 和专业模块；R4 完成结果比较、远程计算恢复及 Desktop 准备。未完成能力不作已实现声明。

## 仓库入口

| 位置 | 用途 |
|---|---|
| `backend/bioharness_web/` | 唯一 Web 后端 |
| `ui/` | 固定上游应用前端、必要 UI packages、BioHarness host 适配和依赖锁 |
| `tests/` | 后端、公共契约和浏览器回归 |
| [AGENTS.md](AGENTS.md) | 开发、职责及安全规则 |
| [架构](docs/architecture.md) | 当前架构、接口与交互边界 |
| [唯一路线与 TODO](docs/plans/2026-11-25-research-workspace-v2.md) | R3/R4、固定复用选择、验收与历史索引 |
| [部署说明](docs/deployment.md) | 配置、部署、回退及运行约束 |
| [ui/README.md](ui/README.md) | 上游来源、修改边界、构建入口 |
| [W0 审核](docs/audits/w0-integration-review.md)、[历史资料](docs/history/README.md) | 既有证据，不是并行计划 |

## 验证与运行

在获授权 Linux 的仓库外隔离副本中验证；预装公开 Core/Governance CLI。前端使用 Node 24.22.3、npm 11.13.0 及现有锁文件。

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[dev]'
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY .venv/bin/python -m pytest
(cd ui && npm ci --ignore-scripts && npm run build)
(cd ui/client && npx tsc --noEmit -p tsconfig.json && npx jest --watchAll=false)
# 已授权的 Node / Playwright Chromium 镜像，以实际镜像名替换 IMAGE：
tests/browser/ui_run.sh IMAGE
tests/browser/ui_step3_run.sh IMAGE
tests/browser/ui_step4_run.sh IMAGE
tests/browser/ui_step5_run.sh IMAGE
```

后端提供 `ui/client/dist`，按部署说明配置后用 `python -m bioharness_web` 启动。私有工作区、凭据、运行账本、测试原始产物和发布目录独立管理，不提交到仓库。

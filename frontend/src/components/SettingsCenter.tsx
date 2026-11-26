import {
  Brain,
  CheckCircle2,
  Cpu,
  Layers,
  Lock,
  Server,
  ShieldCheck,
  Sliders,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import type { Meta } from "../api/types";
import { cn } from "../lib/utils";

type SettingsTab =
  | "general"
  | "models"
  | "skills"
  | "memory"
  | "modules"
  | "compute"
  | "diagnostics";

const TABS: { id: SettingsTab; label: string; icon: typeof Sliders }[] = [
  { id: "general", label: "通用", icon: Sliders },
  { id: "models", label: "模型", icon: Sparkles },
  { id: "skills", label: "Skills 与资源", icon: Layers },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "modules", label: "模块", icon: Server },
  { id: "compute", label: "计算", icon: Cpu },
  { id: "diagnostics", label: "诊断与安全", icon: ShieldCheck },
];

interface SettingsCenterProps {
  meta: Meta;
  initialTab?: SettingsTab;
  compactDensity: boolean;
  onCompactDensityChange: (next: boolean) => void;
}

export default function SettingsCenter({
  meta,
  initialTab = "general",
  compactDensity,
  onCompactDensityChange,
}: SettingsCenterProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  function toggleDensity(next: boolean) {
    onCompactDensityChange(next);
    setActionStatus(next ? "已切换为高密度科研视图（仅保存在当前浏览器）" : "已切换为标准间距视图（仅保存在当前浏览器）");
  }

  return (
    <section
      className="flex h-full flex-col overflow-hidden bg-white"
      aria-label="设置与能力中心"
    >
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">设置与能力中心（R1 骨架）</h2>
        <p className="text-xs text-slate-500">
          服务端受托配置（工作区路径、模型密钥、工具白名单）严格只读展示；尚未接入的 R3/R4 能力明确标为不可用。
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="设置分页">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.id);
                  setActionStatus(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-teal-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 text-xs text-slate-700">
        {tab === "general" && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-900">工作台信息密度</div>
                  <p className="mt-0.5 text-slate-500">
                    控制侧边栏、检查器与列表的紧凑度；仅影响本机浏览器展示，不改动服务端状态。
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    aria-pressed={!compactDensity}
                    onClick={() => toggleDensity(false)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium",
                      !compactDensity ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600",
                    )}
                  >
                    标准
                  </button>
                  <button
                    type="button"
                    aria-pressed={compactDensity}
                    onClick={() => toggleDensity(true)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium",
                      compactDensity ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600",
                    )}
                  >
                    高密度
                  </button>
                </div>
              </div>
              {actionStatus && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-2.5 inline-flex items-center gap-1 text-teal-800"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {actionStatus}
                </p>
              )}
            </div>
          </div>
        )}

        {tab === "models" && (
          <div className="max-w-2xl space-y-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">原生运行时模型配置</span>
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  由服务端受托配置锁定
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <dt className="text-slate-500">运行模式</dt>
                <dd className="font-mono text-slate-900">
                  {meta.runtime?.enabled ? "已启用原生运行时" : "只读模式（未配置模型）"}
                </dd>
                <dt className="text-slate-500">当前模型</dt>
                <dd className="font-mono text-slate-900">{meta.runtime?.model ?? "未配置"}</dd>
                <dt className="text-slate-500">密钥来源</dt>
                <dd className="text-slate-700">仅保存在服务端环境变量，永不下发浏览器</dd>
              </dl>
            </div>
          </div>
        )}

        {tab === "skills" && (
          <div className="max-w-2xl space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-amber-950">
              <div className="font-semibold">四态 Skills 与 [[resources]] 中心（R3 接入）</div>
              <p className="mt-1">
                当前 R1 仅展示服务端 <code>/api/meta</code> 暴露的基础工具与 MCP 列表；完整六类{" "}
                <code>[[resources]]</code>、工作区 <code>SKILL.md</code> 与四态（已声明 / 已安装 / 可调用 / 实际使用）检测将在 R3 接入后启用。
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 font-semibold text-slate-900">服务端已配置 MCP 工具服务</div>
              {meta.runtime?.module_tool_servers?.length ? (
                <ul className="space-y-1 font-mono text-slate-800">
                  {meta.runtime.module_tool_servers.map((srv) => (
                    <li key={srv} className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5">
                      <span>{srv}</span>
                      <span className="font-sans text-[11px] text-slate-500">
                        已声明（实际连通性以运行观测为准）
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">未配置额外 MCP 工具服务。</p>
              )}
            </div>
          </div>
        )}

        {tab === "memory" && (
          <div className="max-w-2xl space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-amber-950">
              <div className="font-semibold">科研记忆浏览与受控 Curator 审核台（R3 接入）</div>
              <p className="mt-1">
                Memory 权威存储在 <code>bioharness-module-memory</code> 单份 SQLite 中。信息深度（T1/T2/T3）与检索深度（FAST/STANDARD/DEEP）独立呈现；其中{" "}
                <strong>DEEP 检索</strong>与<strong>受控 Curator 公开接口</strong>尚未对 Web 暴露，当前显式标为不可用。
                <code>source_registration</code> 目前仍属受信任操作员 CLI，不从浏览器绕过。
              </p>
            </div>
          </div>
        )}

        {tab === "modules" && (
          <div className="max-w-2xl space-y-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 font-semibold text-slate-900">核心 CLI 探测状态</div>
              <ul className="space-y-1.5">
                {Object.entries(meta.tools).map(([name, info]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded bg-slate-50 px-3 py-2"
                  >
                    <span className="font-mono font-medium text-slate-900">
                      {name} ({info.command})
                    </span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-medium",
                        info.found
                          ? "bg-teal-50 text-teal-800"
                          : "bg-amber-100 text-amber-900",
                      )}
                    >
                      {info.found ? "PATH 已发现（以实际调用为准）" : "未找到可执行文件"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === "compute" && (
          <div className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-amber-950">
            <div className="font-semibold">远程科研计算与长作业恢复（R4 规划）</div>
            <p className="mt-1">
              当前工具调用在后端 Run 内以受限超时执行；外部执行器句柄、远程长作业恢复与精确重试将在 R4 对接已配置执行器后启用。
            </p>
          </div>
        )}

        {tab === "diagnostics" && (
          <div className="max-w-2xl space-y-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 font-semibold text-slate-900">被动安全姿态（只读）</div>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">服务标识</dt>
                <dd className="font-mono text-slate-900">{meta.service}</dd>
                <dt className="text-slate-500">受托工作区</dt>
                <dd className="font-mono text-slate-900">{meta.workspaces.join(", ")}</dd>
                <dt className="text-slate-500">轮询间隔</dt>
                <dd className="font-mono text-slate-900">{meta.poll_interval_seconds} s</dd>
                <dt className="text-slate-500">路径与密钥保护</dt>
                <dd className="text-slate-700">服务端脱敏，浏览器不可传入绝对路径</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

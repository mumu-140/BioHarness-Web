import { AtSign, Command, FileText, Server, X } from "lucide-react";
import { useState } from "react";

export interface ComposerEvidenceOption {
  id: string;
  label: string;
  detail?: string;
}

interface ComposerQuickBarProps {
  evidenceOptions: ComposerEvidenceOption[];
  moduleToolServers: string[];
  disabled?: boolean;
  onInsert: (snippet: string) => void;
}

const PROMPT_TEMPLATES: { command: string; label: string; snippet: string }[] = [
  {
    command: "/复核方法",
    label: "复核方法、参数与统计口径",
    snippet: "请基于已记录证据复核当前步骤的方法、参数与统计口径：",
  },
  {
    command: "/对照路线",
    label: "与同方向历史路线做对照",
    snippet: "请将当前路线与同方向历史路线做对照分析，列出关键差异与反证：",
  },
  {
    command: "/局限与下一步",
    label: "汇总局限性与待验证假设",
    snippet: "请汇总当前结论的主要局限性、待验证假设与下一步建议：",
  },
];

/**
 * Lightweight `@evidence` and `/` quick-insert bar above the Composer.
 * Only inserts plain text into the user's draft; never sends messages or mutates Core state.
 */
export default function ComposerQuickBar({
  evidenceOptions,
  moduleToolServers,
  disabled,
  onInsert,
}: ComposerQuickBarProps) {
  const [openMenu, setOpenMenu] = useState<"evidence" | "slash" | null>(null);

  function handlePick(snippet: string) {
    onInsert(snippet);
    setOpenMenu(null);
  }

  return (
    <div className="composer-quick-bar relative mb-1.5" aria-label="快捷引用与命令">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={openMenu === "evidence"}
          onClick={() => setOpenMenu((m) => (m === "evidence" ? null : "evidence"))}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50"
        >
          <AtSign className="h-3 w-3 text-teal-700" aria-hidden="true" />
          引用证据
          {evidenceOptions.length > 0 && (
            <span className="rounded bg-teal-100 px-1 text-[10px] text-teal-800">
              {evidenceOptions.length}
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          aria-expanded={openMenu === "slash"}
          onClick={() => setOpenMenu((m) => (m === "slash" ? null : "slash"))}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50"
        >
          <Command className="h-3 w-3 text-teal-700" aria-hidden="true" />
          / 快捷指令与模块
        </button>
      </div>

      {openMenu === "evidence" && (
        <div
          role="region"
          aria-label="可引用证据列表"
          className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
        >
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
            <span>选择已登记证据（插入工作区相对引用）</span>
            <button
              type="button"
              aria-label="关闭证据菜单"
              onClick={() => setOpenMenu(null)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          {evidenceOptions.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              当前上下文暂无已登记证据；步骤提交证据后将自动出现在此处。
            </p>
          ) : (
            <ul className="space-y-1">
              {evidenceOptions.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(`@evidence(${ev.id})`)}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-teal-50"
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-slate-800">
                      <FileText className="h-3 w-3 shrink-0 text-teal-700" aria-hidden="true" />
                      <span className="truncate">{ev.label}</span>
                    </span>
                    {ev.detail && (
                      <span className="shrink-0 text-[10px] text-slate-500">{ev.detail}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openMenu === "slash" && (
        <div
          role="region"
          aria-label="快捷指令与已配置模块"
          className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
        >
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
            <span>插入科研模板或指向已配置 Module（仅插入草稿文本）</span>
            <button
              type="button"
              aria-label="关闭快捷指令菜单"
              onClick={() => setOpenMenu(null)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <ul className="space-y-1">
            {PROMPT_TEMPLATES.map((tpl) => (
              <li key={tpl.command}>
                <button
                  type="button"
                  onClick={() => handlePick(tpl.snippet)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-teal-50"
                >
                  <code className="font-mono text-[11px] font-semibold text-teal-800">
                    {tpl.command}
                  </code>
                  <span className="text-[11px] text-slate-600">{tpl.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-slate-100 pt-1.5">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Server className="h-3 w-3" aria-hidden="true" />
              已配置 Module 工具服务器
            </div>
            {moduleToolServers.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                当前未配置外部 Module 工具服务器（仅 Core 可用）。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {moduleToolServers.map((srv) => (
                  <button
                    key={srv}
                    type="button"
                    onClick={() => handlePick(`（请结合模块 ${srv} 核验）`)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"
                  >
                    /{srv}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

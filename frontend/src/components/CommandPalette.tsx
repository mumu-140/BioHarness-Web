import { Command } from "cmdk";
import { useEffect } from "react";

import type { OpenRequest, ScopeNode } from "../api/types";
import type { WorkbenchArea } from "./ActivityRail";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: string[];
  scopes: ScopeNode[];
  openRequests: OpenRequest[];
  projectId: string | null;
  onSelectWorkspace: (id: string) => void;
  onSelectScope: (id: string) => void;
  onSelectRequest: (id: string, scope: string | null, project: string | null) => void;
  onSelectArea: (area: WorkbenchArea) => void;
}

export default function CommandPalette({
  open,
  onOpenChange,
  workspaces,
  scopes,
  openRequests,
  projectId,
  onSelectWorkspace,
  onSelectScope,
  onSelectRequest,
  onSelectArea,
}: CommandPaletteProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-[14vh] backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="快捷跳转命令面板"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="快捷跳转">
          <div className="border-b border-slate-200 px-3 py-2.5">
            <Command.Input
              autoFocus
              placeholder="搜索工作区、研究范围、开放请求或功能页…"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2 text-sm">
            <Command.Empty className="px-3 py-6 text-center text-xs text-slate-500">
              未找到匹配项
            </Command.Empty>

            <Command.Group heading="功能区" className="mb-2">
              {(
                [
                  ["research", "研究工作台（科研树 · 双轨流程 · 对话）"],
                  ["artifacts", "科研成果与证据工作区（Data / Methods / Results / Evidence / Comparison / Findings）"],
                  ["memory", "记忆中心（T1/T2/T3 与检索维度）"],
                  ["resources", "资源与 Skills 中心（[[resources]] 四态）"],
                  ["settings", "设置与能力中心"],
                ] as [WorkbenchArea, string][]
              ).map(([id, label]) => (
                <Command.Item
                  key={id}
                  onSelect={() => {
                    onSelectArea(id);
                    onOpenChange(false);
                  }}
                  className="cursor-pointer rounded-md px-2.5 py-1.5 text-slate-800 aria-selected:bg-teal-50 aria-selected:text-teal-900"
                >
                  {label}
                </Command.Item>
              ))}
            </Command.Group>

            {openRequests.length > 0 && (
              <Command.Group heading="开放请求" className="mb-2">
                {openRequests.map((req) => (
                  <Command.Item
                    key={req.request_id}
                    value={`${req.request_id} ${req.question ?? ""}`}
                    onSelect={() => {
                      onSelectRequest(
                        req.request_id,
                        req.scope_id ?? null,
                        req.project_id ?? projectId,
                      );
                      onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-slate-800 aria-selected:bg-teal-50 aria-selected:text-teal-900"
                  >
                    <span className="font-mono text-xs font-medium">{req.request_id}</span>
                    <span className="truncate text-xs text-slate-500">
                      {req.question ?? "未提供问题摘要"}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {scopes.length > 0 && (
              <Command.Group heading="研究范围 (Scope)" className="mb-2">
                {scopes.map((node) => (
                  <Command.Item
                    key={node.scope_id}
                    value={`${node.scope_id} ${node.objective}`}
                    onSelect={() => {
                      onSelectArea("research");
                      onSelectScope(node.scope_id);
                      onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-slate-800 aria-selected:bg-teal-50 aria-selected:text-teal-900"
                  >
                    <span className="font-mono text-xs font-medium">{node.scope_id}</span>
                    <span className="truncate text-xs text-slate-500">{node.objective}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {workspaces.length > 1 && (
              <Command.Group heading="工作区">
                {workspaces.map((ws) => (
                  <Command.Item
                    key={ws}
                    onSelect={() => {
                      onSelectWorkspace(ws);
                      onOpenChange(false);
                    }}
                    className="cursor-pointer rounded-md px-2.5 py-1.5 font-mono text-xs text-slate-800 aria-selected:bg-teal-50 aria-selected:text-teal-900"
                  >
                    {ws}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

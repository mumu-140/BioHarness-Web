import {
  Brain,
  Command,
  FolderKanban,
  Layers,
  Microscope,
  Settings,
} from "lucide-react";

import { cn } from "../lib/utils";

export type WorkbenchArea = "research" | "artifacts" | "memory" | "resources" | "settings";

interface ActivityRailProps {
  area: WorkbenchArea;
  onSelectArea: (area: WorkbenchArea) => void;
  onOpenCommand: () => void;
  attentionCount: number;
}

const ITEMS: { id: WorkbenchArea; label: string; icon: typeof Microscope }[] = [
  { id: "research", label: "研究", icon: Microscope },
  { id: "artifacts", label: "成果", icon: FolderKanban },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "resources", label: "资源", icon: Layers },
  { id: "settings", label: "设置", icon: Settings },
];

export default function ActivityRail({
  area,
  onSelectArea,
  onOpenCommand,
  attentionCount,
}: ActivityRailProps) {
  return (
    <nav
      className="activity-rail flex flex-col items-center justify-between border-r border-slate-800/80 bg-slate-900 py-3 select-none"
      aria-label="主功能区"
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-xs font-bold tracking-tight text-white shadow-md shadow-teal-950/40"
          title="BioHarness Research Workspace V3"
        >
          BH
        </div>
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = area === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              title={item.label}
              onClick={() => onSelectArea(item.id)}
              className={cn(
                "group relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-all",
                active
                  ? "bg-teal-500/20 text-teal-200 ring-1 ring-teal-400/40"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
              )}
            >
              {active && (
                <span
                  className="absolute top-2 bottom-2 -left-1.5 w-1 rounded-r-full bg-teal-400"
                  aria-hidden="true"
                />
              )}
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
              {item.id === "research" && attentionCount > 0 && (
                <span
                  className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950 shadow-xs"
                  aria-label={`待关注事项 ${attentionCount} 项`}
                >
                  {attentionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenCommand}
        title="快捷跳转 (⌘K / Ctrl+K)"
        aria-label="打开快捷命令面板"
        className="flex h-10 w-10 flex-col items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/80 text-slate-300 transition hover:border-teal-500/60 hover:bg-slate-800 hover:text-white"
      >
        <Command className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-[9px] leading-none">⌘K</span>
      </button>
    </nav>
  );
}

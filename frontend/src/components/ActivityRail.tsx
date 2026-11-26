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
      className="activity-rail flex flex-col items-center justify-between border-r border-slate-200 bg-slate-50/90 py-2.5 select-none"
      aria-label="主功能区"
    >
      <div className="flex flex-col items-center gap-1.5">
        <div
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold tracking-tight text-white shadow-xs"
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
                "relative flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium transition-colors",
                active
                  ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200"
                  : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
              {item.id === "research" && attentionCount > 0 && (
                <span
                  className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-600 px-1 text-[9px] font-semibold text-white"
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
        className="flex h-9 w-9 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <Command className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-[9px] leading-none">⌘K</span>
      </button>
    </nav>
  );
}

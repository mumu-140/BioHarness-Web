import { useMemo, useState } from "react";

import type { TaskStatus, TaskSummary } from "../api/types";
import { stageLabel, statusLabel } from "../presentation";

interface TaskSidebarProps {
  tasks: TaskSummary[];
  selectedTaskId: string | null;
  onSelectTask(taskId: string): void;
}

const ALL = "ALL";

export default function TaskSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
}: TaskSidebarProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaskStatus | typeof ALL>(ALL);

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesText =
        !normalized ||
        task.title.toLowerCase().includes(normalized) ||
        task.analysis_class.toLowerCase().includes(normalized);
      const matchesStatus = status === ALL || task.status === status;
      return matchesText && matchesStatus;
    });
  }, [query, status, tasks]);

  return (
    <aside className="task-sidebar" aria-label="任务">
      <div className="sidebar-heading">
        <div>
          <p className="eyebrow">BioHarness</p>
          <h1>任务观察台</h1>
        </div>
        <span className="task-count" title="任务数量">{tasks.length}</span>
      </div>

      <div className="task-filters">
        <input
          aria-label="搜索任务"
          type="search"
          placeholder="搜索任务或分析类型"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="按状态筛选"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as TaskStatus | typeof ALL)
          }
        >
          <option value={ALL}>全部状态</option>
          <option value="ATTENTION">需处理</option>
          <option value="RUNNING">运行中</option>
          <option value="WAITING">等待中</option>
          <option value="FAILED">失败</option>
          <option value="FINISHED">已完成</option>
        </select>
      </div>

      <nav className="task-list" aria-label="任务列表">
        {visibleTasks.length === 0 ? (
          <div className="empty-sidebar">没有符合条件的任务</div>
        ) : (
          visibleTasks.map((task) => (
            <button
              type="button"
              key={task.id}
              className={
                "task-item " + (selectedTaskId === task.id ? "is-selected" : "")
              }
              aria-current={selectedTaskId === task.id ? "true" : undefined}
              onClick={() => onSelectTask(task.id)}
            >
              <span className={"task-state state-" + task.status.toLowerCase()}>
                {statusLabel(task.status)}
              </span>
              <strong>{task.title}</strong>
              <span className="task-meta">
                当前阶段：{stageLabel(task.stage)}
              </span>
            </button>
          ))
        )}
      </nav>
    </aside>
  );
}

import { useMemo, useState } from "react";

import type { TaskStatus, TaskSummary } from "../api/types";

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
    <aside className="task-sidebar" aria-label="Tasks">
      <div className="sidebar-heading">
        <div>
          <p className="eyebrow">BioHarness</p>
          <h1>Observatory</h1>
        </div>
        <span className="task-count">{tasks.length}</span>
      </div>

      <div className="task-filters">
        <input
          aria-label="Filter tasks"
          type="search"
          placeholder="Filter tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as TaskStatus | typeof ALL)
          }
        >
          <option value={ALL}>All states</option>
          <option value="ATTENTION">Attention</option>
          <option value="RUNNING">Running</option>
          <option value="WAITING">Waiting</option>
          <option value="FAILED">Failed</option>
          <option value="FINISHED">Finished</option>
        </select>
      </div>

      <nav className="task-list" aria-label="Task list">
        {visibleTasks.length === 0 ? (
          <div className="empty-sidebar">No matching tasks</div>
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
                {task.status}
              </span>
              <strong>{task.title}</strong>
              <span className="task-meta">
                {task.stage.replaceAll("_", " ")}
              </span>
            </button>
          ))
        )}
      </nav>
    </aside>
  );
}

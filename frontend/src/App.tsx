import { useEffect, useMemo, useState } from "react";

import type { ObservatoryApi } from "./api/client";
import { api as defaultApi } from "./api/client";
import type { TaskGraphModel, TaskSummary } from "./api/types";
import ConnectionBadge from "./components/ConnectionBadge";
import TaskGraph from "./components/TaskGraph";
import TaskSidebar from "./components/TaskSidebar";

interface AppProps {
  api?: ObservatoryApi;
}

export default function App({ api = defaultApi }: AppProps) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [graph, setGraph] = useState<TaskGraphModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listTasks()
      .then((values) => {
        if (cancelled) return;
        setTasks(values);
        setSelectedTaskId((current) => current ?? values[0]?.id ?? null);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!selectedTaskId) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    setGraph(null);
    api
      .getTaskGraph(selectedTaskId)
      .then((value) => {
        if (!cancelled) {
          setGraph(value);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  return (
    <div className="app">
      <TaskSidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
      />

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Selected task</p>
            <h2>{selectedTask?.title ?? "No task selected"}</h2>
            {selectedTask && (
              <p className="workspace-subtitle">
                {selectedTask.analysis_class} · {selectedTask.status}
              </p>
            )}
          </div>
          <ConnectionBadge />
        </header>

        <section className="graph-shell">
          {error ? (
            <div className="error-state" role="alert">{error}</div>
          ) : graph ? (
            <TaskGraph graph={graph} onSelectNode={() => {}} />
          ) : selectedTaskId ? (
            <div className="loading-state">Loading task route…</div>
          ) : (
            <div className="empty-state">No BioHarness tasks found.</div>
          )}
        </section>
      </main>
    </div>
  );
}

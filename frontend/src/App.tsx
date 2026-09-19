import { useCallback, useEffect, useMemo, useState } from "react";

import type { ObservatoryApi } from "./api/client";
import { api as defaultApi } from "./api/client";
import type {
  NodeDetail,
  TaskGraphModel,
  TaskSummary,
} from "./api/types";
import ConnectionBadge from "./components/ConnectionBadge";
import NodeDetailDrawer from "./components/NodeDetailDrawer";
import TaskGraph from "./components/TaskGraph";
import TaskSidebar from "./components/TaskSidebar";
import useTaskStream, {
  type EventSourceFactory,
} from "./hooks/useTaskStream";
import { stageLabel, statusLabel } from "./presentation";

interface AppProps {
  api?: ObservatoryApi;
  eventSourceFactory?: EventSourceFactory;
}

export default function App({
  api = defaultApi,
  eventSourceFactory,
}: AppProps) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [graph, setGraph] = useState<TaskGraphModel | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    const values = await api.listTasks();
    setTasks(values);
    setSelectedTaskId((current) => {
      if (current && values.some((task) => task.id === current)) {
        return current;
      }
      return values[0]?.id ?? null;
    });
    return values;
  }, [api]);

  const loadGraph = useCallback(
    async (taskId: string) => {
      const value = await api.getTaskGraph(taskId);
      setGraph(value);
      setError(null);
      return value;
    },
    [api],
  );

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
    setDetail(null);
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

  const handleNodeSelect = useCallback(
    async (nodeId: string) => {
      if (!selectedTaskId) return;
      try {
        const value = await api.getNodeDetail(selectedTaskId, nodeId);
        setDetail(value);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "无法加载节点详情",
        );
      }
    },
    [api, selectedTaskId],
  );

  const handleTaskUpdated = useCallback(
    (taskId: string) => {
      void loadTasks().catch((reason: Error) => {
        setError(reason.message);
      });
      if (taskId === selectedTaskId) {
        void loadGraph(taskId).catch((reason: Error) => {
          setError(reason.message);
        });

        if (detail) {
          const nodeId = detail.node.id;
          void api
            .getNodeDetail(taskId, nodeId)
            .then((value) => {
              setDetail((current) =>
                current?.node.id === nodeId ? value : current,
              );
            })
            .catch((reason: Error) => {
              setError(reason.message);
            });
        }
      }
    },
    [api, detail, loadGraph, loadTasks, selectedTaskId],
  );

  useTaskStream({
    factory: eventSourceFactory,
    onOpen: () => {
      setConnected(true);
      setStale(false);
    },
    onError: () => {
      setConnected(false);
      setStale(true);
    },
    onTaskUpdated: handleTaskUpdated,
    onStale: () => {
      setStale(true);
    },
    onRecovered: () => {
      setConnected(true);
      setStale(false);
    },
  });

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
            <p className="eyebrow">当前任务</p>
            <h2>{selectedTask?.title ?? "未选择任务"}</h2>
            {selectedTask && (
              <p className="workspace-subtitle">
                <span>分析类型：</span>
                <code>{selectedTask.analysis_class}</code>
                <span> · 当前阶段：{stageLabel(selectedTask.stage)}</span>
                <span> · 状态：{statusLabel(selectedTask.status)}</span>
              </p>
            )}
          </div>
          <ConnectionBadge connected={connected} stale={stale} />
        </header>

        <section className="graph-shell">
          {error ? (
            <div className="error-state" role="alert">
              加载失败：{error}
            </div>
          ) : graph ? (
            <TaskGraph graph={graph} onSelectNode={handleNodeSelect} />
          ) : selectedTaskId ? (
            <div className="loading-state">正在加载任务流程…</div>
          ) : (
            <div className="empty-state">暂无 BioHarness 任务。</div>
          )}

          {detail && (
            <NodeDetailDrawer
              detail={detail}
              loadEvidencePreview={api.getEvidencePreview}
              onClose={() => setDetail(null)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

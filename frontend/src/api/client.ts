import type {
  EvidencePreview,
  NodeDetail,
  TaskGraphModel,
  TaskSummary,
} from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Request failed: " + response.status + " " + path);
  }
  return response.json() as Promise<T>;
}

export interface ObservatoryApi {
  listTasks(): Promise<TaskSummary[]>;
  getTaskGraph(taskId: string): Promise<TaskGraphModel>;
  getNodeDetail(taskId: string, nodeId: string): Promise<NodeDetail | null>;
  getEvidencePreview(previewRef: string): Promise<EvidencePreview>;
}

export const api: ObservatoryApi = {
  listTasks: () => fetchJson<TaskSummary[]>("/api/tasks"),
  getTaskGraph: (taskId) =>
    fetchJson<TaskGraphModel>("/api/tasks/" + taskId + "/graph"),
  getNodeDetail: (taskId, nodeId) =>
    fetchJson<NodeDetail>(
      "/api/tasks/" + taskId + "/nodes/" + encodeURIComponent(nodeId),
    ),
  getEvidencePreview: (previewRef) =>
    fetchJson<EvidencePreview>(previewRef),
};

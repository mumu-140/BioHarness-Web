import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { type ApiError, getJson } from "./api/client";
import type {
  InvocationItem,
  Meta,
  ModuleServerObservation,
  NowData,
  OpenData,
  TreeData,
} from "./api/types";
import ActivityRail, { type WorkbenchArea } from "./components/ActivityRail";
import ArtifactsWorkbench from "./components/ArtifactsWorkbench";
import AttentionStream, {
  buildAttentionItems,
  type AttentionItem,
} from "./components/AttentionStream";
import CommandPalette from "./components/CommandPalette";
import ConnectionBadge from "./components/ConnectionBadge";
import ConversationPanel from "./components/ConversationPanel";
import DualTrackPanel from "./components/DualTrackPanel";
import Inspector, { type InspectedTarget } from "./components/Inspector";
import Navigator from "./components/Navigator";
import NowPanel from "./components/NowPanel";
import ResearchTreeGraph from "./components/ResearchTreeGraph";
import SettingsCenter from "./components/SettingsCenter";
import SignIn from "./components/SignIn";
import SnapshotNotice from "./components/SnapshotNotice";
import WorkflowGraph from "./components/WorkflowGraph";
import useSnapshot from "./hooks/useSnapshot";
import useVersionStream, { type EventSourceFactory } from "./hooks/useVersionStream";
import { formatTime } from "./labels";

type Tab = "tree" | "workflow";

function readCompactPref(): boolean {
  try {
    return window.localStorage.getItem("bioharness.ui.compact") === "1";
  } catch {
    return false;
  }
}

function readWidthPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(window.localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min && raw <= max) return raw;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export default function App({ eventSourceFactory }: { eventSourceFactory?: EventSourceFactory }) {
  const { mutate } = useSWRConfig();
  const meta = useSWR<Meta, ApiError>("/api/meta", getJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const [area, setArea] = useState<WorkbenchArea>("research");
  const [commandOpen, setCommandOpen] = useState(false);
  const [compactDensity, setCompactDensity] = useState<boolean>(readCompactPref);
  const [navWidth, setNavWidth] = useState<number>(() =>
    readWidthPref("bioharness.ui.navWidth", 290, 220, 480),
  );
  const [inspectorWidth, setInspectorWidth] = useState<number>(() =>
    readWidthPref("bioharness.ui.inspectorWidth", 400, 300, 640),
  );

  function startResize(which: "nav" | "inspector", startX: number) {
    const initial = which === "nav" ? navWidth : inspectorWidth;
    const min = which === "nav" ? 220 : 300;
    const max = which === "nav" ? 480 : 640;
    const key = which === "nav" ? "bioharness.ui.navWidth" : "bioharness.ui.inspectorWidth";

    function onMove(ev: MouseEvent) {
      const delta = which === "nav" ? ev.clientX - startX : startX - ev.clientX;
      const next = Math.min(max, Math.max(min, Math.round(initial + delta)));
      if (which === "nav") setNavWidth(next);
      else setInspectorWidth(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // ignore storage errors
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const [workspace, setWorkspace] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tree");
  const [navOpen, setNavOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [inspectedTarget, setInspectedTarget] = useState<InspectedTarget | null>(null);
  const [observedInvocations, setObservedInvocations] = useState<InvocationItem[]>([]);

  function updateCompactDensity(next: boolean) {
    setCompactDensity(next);
    try {
      window.localStorage.setItem("bioharness.ui.compact", next ? "1" : "0");
    } catch {
      // ignore storage errors in restricted environments
    }
  }

  // A service configured with a single workspace has nothing to choose between.
  const workspaces = meta.data?.workspaces;
  useEffect(() => {
    if (!workspace && workspaces?.length === 1) setWorkspace(workspaces[0]);
  }, [workspace, workspaces]);

  const overview = useSnapshot<TreeData>(workspace, "tree", {});
  const tree = useSnapshot<TreeData>(workspace, "tree", { project_id: projectId ?? undefined });
  const open = useSnapshot<OpenData>(workspace, "open", {});
  const now = useSnapshot<NowData>(workspace, "now", requestId ? { request_id: requestId } : null);
  const stream = useVersionStream(workspace, projectId, requestId, eventSourceFactory);

  const treeData = tree.data?.ok ? tree.data.data : null;
  const nowData = now.data?.ok ? now.data.data : null;
  const openData = open.data?.ok ? open.data.data : null;

  const attentionItems = useMemo(
    () => buildAttentionItems(nowData, treeData, openData, requestId),
    [nowData, treeData, openData, requestId],
  );

  // The session can also end after the page has loaded (token rotated, service restarted).
  const signedOut = [meta.error, overview.error, tree.error, open.error, now.error].some(
    (error) => error?.status === 401,
  );
  if (signedOut) {
    return <SignIn onSignedIn={() => void mutate(() => true)} />;
  }
  if (meta.error) {
    return (
      <p className="notice is-warning" role="alert">
        无法连接工作台服务({meta.error.code}):{meta.error.message}
      </p>
    );
  }
  if (!meta.data) return <p className="notice">正在连接工作台服务…</p>;

  // The scope a request belongs to is what Core recorded, not what is selected on screen.
  const requestScope =
    typeof nowData?.scope_context?.scope_id === "string" ? nowData.scope_context.scope_id : null;
  const runtimeEnabled = Boolean(meta.data.runtime?.enabled);

  function selectWorkspace(id: string) {
    setWorkspace(id);
    setProjectId(null);
    setScopeId(null);
    setRequestId(null);
    setStepId(null);
    setInspectedTarget(null);
    setObservedInvocations([]);
    setTab("tree");
  }

  function selectProject(id: string | null) {
    setProjectId(id);
    setScopeId(null);
    setRequestId(null);
    setStepId(null);
    setTab("tree");
  }

  function selectScope(id: string) {
    setScopeId(id);
    setStepId(null);
    setInspectedTarget(null);
  }

  function selectRequest(id: string, scope: string | null, project: string | null) {
    setArea("research");
    setRequestId(id);
    setStepId(null);
    setInspectedTarget(null);
    setTab("workflow");
    setScopeId(scope); // null for an unscoped request: no scope stays highlighted
    if (project) setProjectId(project);
  }

  function handleAttentionNavigate(item: AttentionItem) {
    setArea("research");
    if (item.requestId) {
      selectRequest(item.requestId, item.scopeId ?? null, item.projectId ?? null);
      if (item.kind === "amendment" || item.kind === "wait_for_user") {
        setDockOpen(true);
      } else if (item.kind === "evidence_changed") {
        setInspectorOpen(true);
      }
    } else if (item.scopeId) {
      setTab("tree");
      selectScope(item.scopeId);
    } else {
      setNavOpen(true);
    }
  }

  function handleInspectInvocation(item: InvocationItem, contextRequestId: string | null) {
    setInspectedTarget({ kind: "invocation", item, contextRequestId });
    setInspectorOpen(true);
  }

  function handleInspectModule(server: ModuleServerObservation) {
    setInspectedTarget({ kind: "module", server });
    setInspectorOpen(true);
  }

  function refreshSnapshots() {
    if (!workspace) return;
    const prefix = `/api/workspaces/${encodeURIComponent(workspace)}/views/`;
    void mutate((key) => typeof key === "string" && key.startsWith(prefix));
  }

  const missingTools = Object.entries(meta.data.tools).filter(([, tool]) => !tool.found);
  const showInspector = area === "research" && Boolean(workspace) && inspectorOpen;
  const appClasses = [
    "app has-rail",
    !navOpen ? "is-nav-collapsed" : "",
    !showInspector ? "is-inspector-collapsed" : "",
    compactDensity ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={appClasses}
      style={
        {
          "--nav-w": `${navWidth}px`,
          "--insp-w": `${inspectorWidth}px`,
        } as React.CSSProperties
      }
    >
      <ActivityRail
        area={area}
        onSelectArea={setArea}
        onOpenCommand={() => setCommandOpen(true)}
        attentionCount={attentionItems.length}
      />

      {navOpen && (
        <div className="pane-wrap is-nav">
          <Navigator
            workspaces={meta.data.workspaces}
            workspace={workspace}
            onSelectWorkspace={selectWorkspace}
            tree={tree.data}
            projects={overview.data?.data?.projects ?? []}
            open={open.data}
            projectId={projectId ?? treeData?.project_id ?? null}
            onSelectProject={selectProject}
            scopeId={scopeId}
            onSelectScope={(id) => {
              setArea("research");
              selectScope(id);
            }}
            requestId={requestId}
            onSelectRequest={selectRequest}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整左侧导航宽度"
            className="resize-handle is-right"
            title="拖拽调整导航宽度（双击重置）"
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("nav", e.clientX);
            }}
            onDoubleClick={() => setNavWidth(290)}
          />
        </div>
      )}

      <main className="workspace">
        <header className="context-bar">
          <dl>
            <div>
              <dt>服务</dt>
              <dd>{meta.data.service}</dd>
            </div>
            <div>
              <dt>工作区</dt>
              <dd>{workspace ?? "未选择"}</dd>
            </div>
            <div>
              <dt>项目</dt>
              <dd>{projectId ?? treeData?.project_id ?? "未选择"}</dd>
            </div>
            <div>
              <dt>请求</dt>
              <dd>{requestId ?? "未选择"}</dd>
            </div>
            {requestId && nowData && (
              <div>
                <dt>请求所属范围</dt>
                <dd>{requestScope ?? "未归属"}</dd>
              </div>
            )}
            <div>
              <dt>原生运行时</dt>
              <dd>
                {runtimeEnabled
                  ? `已启用 · 模型 ${meta.data.runtime?.model ?? "未提供"}`
                  : "未配置（只读模式）"}
              </dd>
            </div>
          </dl>
          <div className="context-actions">
            <button
              type="button"
              className="ghost-btn"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
            >
              {navOpen ? "收起导航" : "展开导航"}
            </button>
            {workspace && area === "research" && (
              <button
                type="button"
                className="ghost-btn"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((v) => !v)}
              >
                {inspectorOpen ? "收起检查器" : "展开检查器"}
              </button>
            )}
            <ConnectionBadge connected={stream.connected} staleViews={stream.staleViews} />
          </div>
        </header>

        <AttentionStream items={attentionItems} onNavigate={handleAttentionNavigate} />

        {missingTools.map(([name, tool]) => (
          <p className="notice is-warning" role="alert" key={name}>
            服务端未找到 {name} 的命令 {tool.command},相关视图不可用。
          </p>
        ))}

        {area === "artifacts" ? (
          <div className="flex-1 overflow-hidden">
            <ArtifactsWorkbench
              workspace={workspace}
              scopeId={scopeId}
              requestId={requestId}
              now={nowData}
              tree={treeData}
            />
          </div>
        ) : area === "memory" ? (
          <div className="flex-1 overflow-hidden">
            <SettingsCenter
              key="memory"
              meta={meta.data}
              initialTab="memory"
              compactDensity={compactDensity}
              onCompactDensityChange={updateCompactDensity}
            />
          </div>
        ) : area === "resources" ? (
          <div className="flex-1 overflow-hidden">
            <SettingsCenter
              key="skills"
              meta={meta.data}
              initialTab="skills"
              compactDensity={compactDensity}
              onCompactDensityChange={updateCompactDensity}
            />
          </div>
        ) : area === "settings" ? (
          <div className="flex-1 overflow-hidden">
            <SettingsCenter
              key="general"
              meta={meta.data}
              initialTab="general"
              compactDensity={compactDensity}
              onCompactDensityChange={updateCompactDensity}
            />
          </div>
        ) : (
          <>
            <nav className="tabs" aria-label="视图">
              <button type="button" aria-pressed={tab === "tree"} onClick={() => setTab("tree")}>
                科研树
              </button>
              <button
                type="button"
                aria-pressed={tab === "workflow"}
                onClick={() => setTab("workflow")}
              >
                科研流程
              </button>
              {workspace && (
                <button type="button" className="ghost-btn" onClick={refreshSnapshots}>
                  刷新视图
                </button>
              )}
              <span className="tabs-observed">
                {tab === "tree" && tree.data && "Project Governance 快照 " + formatTime(tree.data.observed_at)}
                {tab === "workflow" && now.data && "Core 快照 " + formatTime(now.data.observed_at)}
              </span>
            </nav>

            <section className="canvas">
              {!workspace ? (
                <p className="empty-state">请选择工作区。</p>
              ) : tab === "tree" ? (
                <>
                  <SnapshotNotice
                    name="科研树"
                    snapshot={tree.data}
                    error={tree.error}
                    loading={tree.isLoading}
                  />
                  {treeData && treeData.nodes.length > 0 ? (
                    <ResearchTreeGraph
                      tree={treeData}
                      selectedScopeId={scopeId}
                      onSelectScope={selectScope}
                    />
                  ) : (
                    treeData && (
                      <p className="empty-state">
                        {treeData.projects?.length
                          ? "此工作区有多个项目,请在左侧明确选择一个。"
                          : "此工作区没有已声明的研究范围。"}
                      </p>
                    )
                  )}
                </>
              ) : !requestId ? (
                <p className="empty-state">请在左侧明确选择一个请求;工作台不会代为选定。</p>
              ) : (
                <>
                  <SnapshotNotice
                    name="请求状态"
                    snapshot={now.data}
                    error={now.error}
                    loading={now.isLoading}
                  />
                  {nowData && (
                    <>
                      <NowPanel now={nowData} onSelectStep={(id) => setStepId(id)} />
                      <WorkflowGraph now={nowData} selectedStepId={stepId} onSelectStep={setStepId} />
                      <DualTrackPanel
                        now={nowData}
                        selectedStepId={stepId}
                        invocations={observedInvocations}
                        onInspectInvocation={handleInspectInvocation}
                      />
                    </>
                  )}
                </>
              )}
            </section>

            {workspace &&
              (runtimeEnabled ? (
                <div className={"dock " + (dockOpen ? "is-open" : "")}>
                  <button
                    type="button"
                    className="dock-toggle"
                    aria-expanded={dockOpen}
                    onClick={() => setDockOpen(!dockOpen)}
                  >
                    {dockOpen ? "收起对话与执行轨迹" : "展开对话与执行轨迹"}
                  </button>
                  {dockOpen && (
                    <ConversationPanel
                      workspace={workspace}
                      model={meta.data.runtime?.model ?? null}
                      moduleToolServers={meta.data.runtime?.module_tool_servers ?? []}
                      requestId={requestId}
                      scopeId={scopeId}
                      delivered={nowData?.phase === "DELIVERED"}
                      onRequestKnown={(id, scope, project) => {
                        if (id !== requestId) selectRequest(id, scope, project);
                      }}
                      onNewQuestion={() => {
                        setRequestId(null);
                        setStepId(null);
                        setInspectedTarget(null);
                        setTab("tree");
                      }}
                      onInspectInvocation={handleInspectInvocation}
                      onInspectModule={handleInspectModule}
                      onInvocationsChange={setObservedInvocations}
                      eventSourceFactory={eventSourceFactory}
                    />
                  )}
                </div>
              ) : (
                <div className="dock is-disabled">
                  <p className="notice runtime-disabled-notice">
                    原生运行时未配置（当前为只读模式：可浏览科研树、当前计划与证据预览，不提供对话、运行与调用/Module 历史）。
                  </p>
                </div>
              ))}
          </>
        )}
      </main>

      {showInspector && workspace && (
        <div className="pane-wrap is-inspector">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整右侧检查器宽度"
            className="resize-handle is-left"
            title="拖拽调整检查器宽度（双击重置）"
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("inspector", e.clientX);
            }}
            onDoubleClick={() => setInspectorWidth(400)}
          />
          <Inspector
            workspace={workspace}
            tree={treeData}
            now={tab === "workflow" ? nowData : null}
            scopeId={tab === "workflow" && nowData ? requestScope : scopeId}
            requestId={requestId}
            stepId={tab === "workflow" ? stepId : null}
            runtimeEnabled={runtimeEnabled}
            inspectedTarget={inspectedTarget}
            invocations={observedInvocations}
            onSelectScope={(id) => {
              setTab("tree");
              selectScope(id);
            }}
            onSelectRequest={selectRequest}
            onSelectStep={(id) => {
              setTab("workflow");
              setStepId(id);
            }}
            onInspectInvocation={handleInspectInvocation}
            onClearInspected={() => setInspectedTarget(null)}
          />
        </div>
      )}

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspaces={meta.data.workspaces}
        scopes={treeData?.nodes ?? []}
        openRequests={openData?.open_requests ?? []}
        projectId={projectId ?? treeData?.project_id ?? null}
        onSelectWorkspace={selectWorkspace}
        onSelectScope={selectScope}
        onSelectRequest={selectRequest}
        onSelectArea={setArea}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Group, Panel, Separator } from "react-resizable-panels";

import { type ApiError, conversationsUrl, getJson, invocationsUrl } from "./api/client";
import type {
  Conversation,
  InvocationItem,
  InvocationsResponse,
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
import BackgroundRunIndicator, { type ActiveRunSummary } from "./components/BackgroundRunIndicator";
import CommandPalette from "./components/CommandPalette";
import type { ComposerEvidenceOption } from "./components/ComposerQuickBar";
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

function saveWidthPref(key: string, pixels: number, min: number, max: number) {
  if (!Number.isFinite(pixels) || pixels < min || pixels > max) return;
  try {
    window.localStorage.setItem(key, String(Math.round(pixels)));
  } catch {
    // Layout is usable even if preferences cannot be saved.
  }
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
  const [activeRun, setActiveRun] = useState<ActiveRunSummary | null>(null);
  const [branchSource, setBranchSource] = useState<{
    requestId: string;
    scopeId: string | null;
  } | null>(null);

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
  const nowData = now.data?.ok && now.data.data?.request_id === requestId ? now.data.data : null;
  // Read the selected request's own conversation, independent of the mounted chat dock.
  // The chat may deliberately remain on another active run. Reuse its existing SWR keys;
  // polling keeps this bounded observation page current when no chat stream is mounted.
  const runtimeEnabled = Boolean(meta.data?.runtime?.enabled);
  const observationInterval = Math.max(1000, (meta.data?.poll_interval_seconds ?? 5) * 1000);
  const conversations = useSWR<Conversation[], ApiError>(
    runtimeEnabled && workspace && requestId ? conversationsUrl(workspace) : null,
    getJson, { refreshInterval: observationInterval, shouldRetryOnError: false,
      onError: (err) => { if (err.status === 401) void mutate("/api/meta"); } },
  );
  const matches = conversations.data?.filter(
    (c) => c.workspace === workspace && c.request_id === requestId,
  ) ?? [];
  const observationConversation = matches.length === 1 ? matches[0] : null;
  const observations = useSWR<InvocationsResponse, ApiError>(
    workspace && observationConversation ? invocationsUrl(workspace, observationConversation.id, { limit: 50 }) : null,
    getJson, { refreshInterval: observationInterval, shouldRetryOnError: false,
      onError: (err) => { if (err.status === 401) void mutate("/api/meta"); } },
  );
  const observed = observations.data?.service === meta.data?.service &&
    observations.data?.workspace === workspace &&
    observations.data?.conversation_id === observationConversation?.id &&
    observations.data?.request_id === requestId && observationConversation
    ? observations.data : undefined;
  const observedInvocations = observed?.items ?? [];
  const observationUnavailable = Boolean(conversations.error || observations.error ||
    matches.length > 1 || (observationConversation && observations.data && !observed));
  const observationLoading = Boolean(runtimeEnabled && requestId &&
    (conversations.isLoading || (observationConversation && observations.isLoading)));
  const openData = open.data?.ok ? open.data.data : null;

  const attentionItems = useMemo(
    () => buildAttentionItems(nowData, treeData, openData, requestId),
    [nowData, treeData, openData, requestId],
  );

  const composerEvidenceOptions = useMemo<ComposerEvidenceOption[]>(() => {
    const seen = new Set<string>();
    const list: ComposerEvidenceOption[] = [];
    for (const id of nowData?.evidence_changed_since_submission ?? []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({ id, label: id, detail: "提交后变更" });
    }
    for (const group of treeData?.shared_evidence ?? []) {
      for (const ref of group.references ?? []) {
        if (requestId && ref.request_id !== requestId) continue;
        if (!ref.evidence_id || seen.has(ref.evidence_id)) continue;
        seen.add(ref.evidence_id);
        list.push({
          id: ref.evidence_id,
          label: ref.evidence_id,
          detail: ref.sha256 ? `sha256:${ref.sha256.slice(0, 8)}` : undefined,
        });
      }
    }
    return list;
  }, [nowData, treeData, requestId]);

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

  function selectWorkspace(id: string) {
    setWorkspace(id);
    setProjectId(null);
    setScopeId(null);
    setRequestId(null);
    setStepId(null);
    setInspectedTarget(null);
    setActiveRun(null);
    setBranchSource(null);
    setTab("tree");
  }

  function selectProject(id: string | null) {
    setProjectId(id);
    setScopeId(null);
    setRequestId(null);
    setStepId(null);
    setInspectedTarget(null);
    setTab("tree");
  }

  function selectScope(id: string) {
    setScopeId(id);
    setTab("tree");
    setStepId(null);
    setInspectedTarget(null);
  }

  function selectRequest(id: string, scope: string | null, project: string | null) {
    setArea("research");
    setRequestId(id);
    setStepId(null);
    setInspectedTarget(null);
    setBranchSource(null);
    setTab("workflow");
    setScopeId(scope); // null for an unscoped request: no scope stays highlighted
    setProjectId(project);
  }

  function handleBranchFromRequest(fromRequestId: string, fromScopeId: string | null) {
    setArea("research");
    setRequestId(null);
    setStepId(null);
    setInspectedTarget(null);
    if (fromScopeId) setScopeId(fromScopeId);
    setTab("tree");
    setDockOpen(true);
    setBranchSource({ requestId: fromRequestId, scopeId: fromScopeId });
  }

  function handleJumpToActiveRun(run: ActiveRunSummary) {
    setArea("research");
    setDockOpen(true);
    if (run.requestId) {
      const openMatch = openData?.open_requests.find((r) => r.request_id === run.requestId);
      selectRequest(
        run.requestId,
        openMatch?.scope_id ?? scopeId ?? null,
        openMatch?.project_id ?? projectId ?? null,
      );
    }
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

  function handleInspectModule(server: ModuleServerObservation, contextRequestId: string | null) {
    setInspectedTarget({ kind: "module", server, contextRequestId });
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
    >
      <ActivityRail
        area={area}
        onSelectArea={setArea}
        onOpenCommand={() => setCommandOpen(true)}
        attentionCount={attentionItems.length}
      />

      <Group orientation="horizontal" className="workbench-panels">
      {navOpen && (
        <Panel id="navigation" className="pane-wrap is-nav"
          defaultSize={readWidthPref("bioharness.ui.navWidth", 290, 220, 480)}
          minSize={220} maxSize={480} groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => saveWidthPref("bioharness.ui.navWidth", size.inPixels, 220, 480)}>
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
        </Panel>
      )}
      {navOpen && <Separator id="navigation-resize" className="resize-handle"
        aria-label="调整左侧导航宽度" title="拖拽或方向键调整导航宽度" />}

      <Panel id="research-workspace" className="workspace-panel" minSize={220}>
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
            <BackgroundRunIndicator
              activeRun={activeRun}
              currentRequestId={requestId}
              onJumpToRun={handleJumpToActiveRun}
            />
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
              key={JSON.stringify([workspace, scopeId, requestId])}
              workspace={workspace}
              scopeId={scopeId}
              requestId={requestId}
              now={nowData}
              nowSnapshot={now.data}
              nowError={now.error}
              nowLoading={now.isLoading}
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
                        unavailable={observationUnavailable}
                        loading={observationLoading}
                        enabled={runtimeEnabled}
                        hasMore={observed?.next_before != null}
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
                      key={workspace}
                      workspace={workspace}
                      model={meta.data.runtime?.model ?? null}
                      moduleToolServers={meta.data.runtime?.module_tool_servers ?? []}
                      requestId={requestId}
                      scopeId={scopeId}
                      delivered={nowData?.phase === "DELIVERED"}
                      now={nowData}
                      evidenceOptions={composerEvidenceOptions}
                      branchSource={branchSource}
                      onClearBranchSource={() => setBranchSource(null)}
                      onBranchFromRequest={handleBranchFromRequest}
                      onActiveRunChange={setActiveRun}
                      onRequestKnown={(id, scope, project) => {
                        if (!requestId) selectRequest(id, scope, project);
                      }}
                      onNewQuestion={() => {
                        setRequestId(null);
                        setStepId(null);
                        setInspectedTarget(null);
                        setBranchSource(null);
                        setTab("tree");
                      }}
                      onInspectInvocation={handleInspectInvocation}
                      onInspectModule={handleInspectModule}
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
      </Panel>

      {showInspector && <Separator id="inspector-resize" className="resize-handle"
        aria-label="调整右侧检查器宽度" title="拖拽或方向键调整检查器宽度" />}
      {showInspector && workspace && (
        <Panel id="inspector" className="pane-wrap is-inspector"
          defaultSize={readWidthPref("bioharness.ui.inspectorWidth", 400, 300, 640)}
          minSize={300} maxSize={640} groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => saveWidthPref("bioharness.ui.inspectorWidth", size.inPixels, 300, 640)}>
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
            invocationsAvailable={Boolean(observed) && !observationUnavailable}
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
        </Panel>
      )}
      </Group>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspaces={meta.data.workspaces}
        scopes={treeData?.nodes ?? []}
        openRequests={openData?.open_requests ?? []}
        onSelectWorkspace={selectWorkspace}
        onSelectScope={selectScope}
        onSelectRequest={selectRequest}
        onSelectArea={setArea}
      />
    </div>
  );
}

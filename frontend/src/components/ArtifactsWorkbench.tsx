import {
  AlertTriangle,
  Database,
  FileCheck2,
  FlaskConical,
  GitCompare,
  LineChart,
  Lightbulb,
} from "lucide-react";
import { useState } from "react";

import type { EvidenceRef, NowData, RoutesData, TreeData } from "../api/types";
import useSnapshot from "../hooks/useSnapshot";
import { formatTime, statusLabel } from "../labels";
import { cn } from "../lib/utils";
import EvidenceList from "./EvidenceList";
import SnapshotNotice from "./SnapshotNotice";

type Dimension = "data" | "methods" | "results" | "evidence" | "comparison" | "findings";

const TABS: { id: Dimension; label: string; icon: typeof Database }[] = [
  { id: "data", label: "Data 数据", icon: Database },
  { id: "methods", label: "Methods 方法", icon: FlaskConical },
  { id: "results", label: "Results 结果", icon: LineChart },
  { id: "evidence", label: "Evidence 证据", icon: FileCheck2 },
  { id: "comparison", label: "Comparison 对比", icon: GitCompare },
  { id: "findings", label: "Findings 结论", icon: Lightbulb },
];

interface ArtifactsWorkbenchProps {
  workspace: string | null;
  scopeId: string | null;
  requestId: string | null;
  now: NowData | null;
  tree: TreeData | null;
}

export default function ArtifactsWorkbench({
  workspace,
  scopeId,
  requestId,
  now,
  tree,
}: ArtifactsWorkbenchProps) {
  const [dim, setDim] = useState<Dimension>("evidence");
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);

  const activeScope =
    scopeId ??
    (typeof now?.scope_context?.scope_id === "string" ? now.scope_context.scope_id : null);

  const routes = useSnapshot<RoutesData>(
    workspace,
    "routes",
    activeScope ? { scope_id: activeScope, limit: 100 } : null,
  );
  const attempts = routes.data?.ok ? (routes.data.data?.attempts ?? []) : [];
  const allEvidence: EvidenceRef[] = attempts.flatMap((a) => a.evidence ?? []);

  return (
    <section
      className="flex h-full flex-col overflow-hidden bg-white"
      aria-label="科研成果与证据工作区"
    >
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              科研成果与证据工作区（只读投影）
            </h2>
            <p className="text-xs text-slate-500">
              直接投影自 Core 与 Project Governance 记录；预览时读取源文件现行内容并核对记录 SHA-256，历史快照不可得时会明确提示。
            </p>
          </div>
          <div className="text-xs text-slate-500">
            范围：<span className="font-mono text-slate-800">{activeScope ?? "未选定"}</span> ·
            请求：<span className="font-mono text-slate-800">{requestId ?? "未选定"}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="成果维度">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = dim === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDim(t.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-teal-700 text-white shadow-2xs"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!workspace ? (
          <p className="text-sm text-slate-500">请先选择一个工作区。</p>
        ) : (
          <>
            {activeScope && (
              <SnapshotNotice
                name="同域路线与提交记录"
                snapshot={routes.data}
                error={routes.error}
                loading={routes.isLoading}
              />
            )}

            {dim === "data" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  展示当前范围下已提交记录中声明的文件类证据与数据来源（不含未提交的临时文件）。
                </p>
                {allEvidence.filter((e) => e.kind !== "text").length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                    当前范围暂无已记录的文件类数据证据。
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-medium">证据 ID</th>
                          <th className="px-3 py-2 font-medium">来源</th>
                          <th className="px-3 py-2 font-medium">记录 SHA-256</th>
                          <th className="px-3 py-2 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allEvidence
                          .filter((e) => e.kind !== "text")
                          .map((ev) => (
                            <tr key={`${ev.request_id}-${ev.submission_index}-${ev.evidence_id}`}>
                              <td className="px-3 py-2 font-mono text-slate-900">
                                {ev.evidence_id}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{ev.source ?? "未提供"}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">
                                {ev.sha256.slice(0, 12)}…
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedEvidence(ev)}
                                  className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
                                >
                                  核验预览
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {dim === "methods" && (
              <div className="space-y-3">
                {attempts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                    当前范围暂无已记录的方法与参数提交。
                  </p>
                ) : (
                  attempts.map((a) => (
                    <div
                      key={`${a.request_id}-${a.submission_index}`}
                      className="rounded-lg border border-slate-200 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900">
                          {a.request_id} · #{a.submission_index} · {a.step_id}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                          {statusLabel(a.submission_status)}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-700">
                        <strong>方法：</strong>
                        {a.method_used || "未声明"}
                      </p>
                      <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                        {JSON.stringify(a.parameters_used ?? {}, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            )}

            {dim === "results" && (
              <div className="space-y-3 text-xs">
                {now?.answer ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        当前交付结果（{now.delivery_kind ?? now.phase}）
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        execution_verified: {String(Boolean(now.execution_verified))}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap text-slate-800">{now.answer}</pre>
                    {now.disclosure && (
                      <p className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-amber-900">
                        {now.disclosure}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-200 p-4 text-slate-500">
                    当前请求尚未产生最终交付结果；可先在 Evidence 或 Methods 标签查看过程提交。
                  </p>
                )}
              </div>
            )}

            {dim === "evidence" && (
              <div className="space-y-3">
                {allEvidence.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                    当前范围暂无已提交证据；请在左侧选择包含提交记录的研究范围。
                  </p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {allEvidence.map((ev) => (
                      <button
                        key={`${ev.request_id}-${ev.submission_index}-${ev.evidence_id}`}
                        type="button"
                        onClick={() => setSelectedEvidence(ev)}
                        className={cn(
                          "rounded-lg border p-2.5 text-left text-xs transition-colors",
                          selectedEvidence?.evidence_id === ev.evidence_id &&
                            selectedEvidence?.sha256 === ev.sha256
                            ? "border-teal-600 bg-teal-50/60"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {ev.evidence_id}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            {ev.kind ?? "unknown"}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-slate-700">{ev.source ?? "无路径"}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {ev.request_id} #{ev.submission_index} · {ev.sha256.slice(0, 12)}…
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {selectedEvidence && workspace && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <EvidenceList workspace={workspace} evidence={[selectedEvidence]} />
                  </div>
                )}
              </div>
            )}

            {dim === "comparison" && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-600">
                  并列展示当前范围内历史提交的状态、方法、参数与条件缺口（技术失败、部分结果与成功提交分开保留，不覆盖历史）。
                </p>
                {attempts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-4 text-slate-500">
                    暂无可对比的历史路线记录。
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2">请求 / 提交</th>
                          <th className="px-3 py-2">步骤</th>
                          <th className="px-3 py-2">状态</th>
                          <th className="px-3 py-2">方法</th>
                          <th className="px-3 py-2">条件缺口</th>
                          <th className="px-3 py-2">时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {attempts.map((a) => (
                          <tr key={`${a.request_id}-${a.submission_index}`}>
                            <td className="px-3 py-2 font-mono">
                              {a.request_id} #{a.submission_index}
                            </td>
                            <td className="px-3 py-2 font-mono">{a.step_id}</td>
                            <td className="px-3 py-2">{statusLabel(a.submission_status)}</td>
                            <td className="px-3 py-2">{a.method_used || "未声明"}</td>
                            <td className="px-3 py-2 text-amber-800">
                              {a.condition_gaps?.length ? a.condition_gaps.join("；") : "无记录"}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {a.at ? formatTime(a.at) : "未知"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {dim === "findings" && (
              <div className="space-y-3 text-xs">
                {now?.limitations?.length ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                    <div className="mb-1 flex items-center gap-1 font-semibold text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      已记录局限性
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-amber-950">
                      {now.limitations.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {now?.open_concerns?.length ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 font-semibold text-slate-900">未关闭评审关切</div>
                    <ul className="list-disc space-y-1 pl-4 text-slate-700">
                      {now.open_concerns.map((c, idx) => (
                        <li key={idx}>
                          <span className="font-mono">{c.about}</span>：{c.concern}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {now?.unresolved_steps?.length ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 font-semibold text-slate-900">未完成 / 失败步骤</div>
                    <ul className="list-disc space-y-1 pl-4 text-slate-700">
                      {now.unresolved_steps.map((s) => (
                        <li key={s.id}>
                          <span className="font-mono">{s.id}</span> ({statusLabel(s.status)})：
                          {s.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!now?.limitations?.length &&
                  !now?.open_concerns?.length &&
                  !now?.unresolved_steps?.length && (
                    <p className="rounded-lg border border-dashed border-slate-200 p-4 text-slate-500">
                      当前请求暂无已记录的结论局限、未关闭关切或未解决步骤。项目级共享文档索引（Findings Index）将在后续接入 Governance documents 路由后一并呈现。
                    </p>
                  )}

                {tree?.shared_evidence?.length ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 font-semibold text-slate-900">
                      跨请求共享证据哈希 ({tree.shared_evidence.length})
                    </div>
                    <p className="text-slate-500">
                      共享哈希仅表示文件字节复用，不自动等价于独立科学重复验证。
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

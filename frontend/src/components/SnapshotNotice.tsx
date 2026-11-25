import type { ApiError } from "../api/client";
import type { Snapshot } from "../api/types";
import { formatTime } from "../labels";

const ORIGIN: Record<string, string> = {
  core: "Core",
  "project-governance": "Project Governance",
  web: "工作台",
};

interface SnapshotNoticeProps {
  name: string;
  snapshot: Snapshot<unknown> | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/** Loading, refusal, read failure, shortening and warnings of one snapshot. */
export default function SnapshotNotice({ name, snapshot, error, loading }: SnapshotNoticeProps) {
  if (!snapshot && loading) return <p className="notice">正在读取{name}…</p>;
  return (
    <>
      {error && (
        <p className="notice is-warning" role="alert">
          {name}读取失败({error.code}):{error.message}
          {snapshot && " · 以下为 " + formatTime(snapshot.observed_at) + " 的快照,可能已过期"}
        </p>
      )}
      {snapshot && !snapshot.ok && snapshot.error && (
        <p className="notice is-warning" role="alert">
          {ORIGIN[snapshot.error.origin] ?? snapshot.error.origin} 未返回{name}
          {snapshot.error.code ? "(" + snapshot.error.code + ")" : ""}:{snapshot.error.message}
        </p>
      )}
      {snapshot?.shortened && (
        <p className="notice">
          Core 为控制返回长度省略了部分内容
          {snapshot.shortened.fields?.length ? "(" + snapshot.shortened.fields.join("、") + ")" : ""}
          ;完整记录未通过公开接口提供,省略处不是空值。
        </p>
      )}
      {snapshot?.warnings.map((warning) => (
        <p className="notice is-warning" key={warning}>
          {warning}
        </p>
      ))}
    </>
  );
}

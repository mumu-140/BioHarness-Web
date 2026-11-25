import useSWR from "swr";

import { type ApiError, getJson, viewUrl } from "../api/client";
import type { Selector, Snapshot, ViewName } from "../api/types";

// One cached snapshot per (workspace, view, selector). After a failed refresh
// SWR keeps the last successful snapshot and reports the error beside it.
export default function useSnapshot<T>(
  workspace: string | null,
  view: ViewName,
  selector: Selector | null,
) {
  const key = workspace && selector ? viewUrl(workspace, view, selector) : null;
  return useSWR<Snapshot<T>, ApiError>(key, getJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}

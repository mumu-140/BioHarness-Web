# BioHarness Web Observatory V1.6 — Read-only Evidence Preview

Status: pre-merge validation evidence for task-scoped evidence-file previews.

## Goal

V1.6 makes persisted execution evidence inspectable from the execution-attempt drill-down without exposing an arbitrary server-side file browser.

The primary target is the evidence already emitted by the audited Genome-web TF executor:

- wrapper stdout / stderr;
- provider invocation JSON;
- resolved input manifest;
- Nextflow execution log;
- execution trace;
- candidate manifest;
- registered text artifacts such as audit tables, alignments, and trees.

## Source and safety model

The browser never sends a filesystem path to the preview endpoint.

The backend derives previewable evidence from two BioHarness-persisted sources only:

1. `RunEvent.payload.executor_evidence.evidence`;
2. registered artifacts with `file://` URIs.

Each persisted `(role, path)` pair receives a deterministic task-scoped evidence ID.

The preview endpoint is:

`GET /api/tasks/{task_id}/evidence/{evidence_id}`

For a request to succeed, all of the following must be true:

- the task exists;
- the evidence ID resolves to a persisted evidence entry for that task;
- the role is in the supported textual-evidence allowlist;
- the persisted host path is absolute and contains no `..` component;
- the path is under `BIOHARNESS_WEB_EVIDENCE_HOST_ROOT`;
- the translated path resolves inside `BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT`;
- the target is an existing regular file.

The container mount is read-only. Symlink/path escape is rejected after path resolution.

Unknown or guessed evidence IDs return 404.

## Preview behavior

The API response contains:

- evidence ID;
- role;
- basename only;
- detected display format;
- original file size;
- truncation flag;
- textual content.

The preview response does not return the server-side source path.

JSON evidence is pretty-printed when the full file fits within the preview limit.

Large files are represented as bounded head + tail text with a visible middle-omission marker. Default preview budget:

`131072 bytes`

The browser therefore cannot request unbounded log-file reads.

## UI

Inside an expanded execution Attempt, V1.6 adds a `证据文件` section.

Known roles are localized, including:

- `execution_log` -> `执行日志`;
- `execution_trace` -> `执行跟踪`;
- `wrapper_stderr` -> `包装器错误输出`;
- `candidate_manifest` -> `候选结果清单`.

Evidence content is fetched only after the user clicks `预览`.

The readable view shows role + basename rather than the absolute server path. Raw persisted event payload remains available under the existing collapsed `原始 payload` section for audit purposes.

## TDD

RED was verified remotely before implementation:

- the frontend had no `预览执行日志` control and did not render evidence roles;
- backend tests failed because `bioharness_web.evidence` did not exist.

After implementation:

Frontend:

- 4 test files passed;
- 15 tests passed;
- TypeScript build passed;
- Vite production build passed;
- 197 modules transformed.

Backend:

- 31 tests passed;
- 1 environment-dependent database test skipped.

## Live pre-merge smoke

Target host: `fwq10ys`.

Pre-merge image:

`bioharness-web:observatory-v1.6-premerge`

Image digest:

`sha256:e7f1ebabe4f6e6f02d78ea0926a043784f2f1d1b1327875ad5fd7cf8eb318014`

Smoke container:

- bound to `127.0.0.1:18081`;
- root filesystem read-only;
- evidence root mounted read-only:
  - host: `/home/yangs/software/BioHarness-P0-Acceptance`
  - container: `/evidence/BioHarness-P0-Acceptance`

Live persisted roles discovered included:

`alignment, audit_table, candidate_manifest, execution_log, execution_trace, process_record, provider_invocation, resolved_manifest, tree, wrapper_stderr, wrapper_stdout`

Required previews were successfully fetched from the real acceptance task:

- `candidate_manifest / manifest.json / json / 516 B`;
- `execution_log / nextflow.log / text / 16006 B`;
- `execution_trace / trace.tsv / table / 1462 B`;
- `wrapper_stderr / stderr.log / text / 406 B`.

A non-registered evidence ID returned HTTP 404.

The production frontend bundle contained the new Chinese UI markers:

- `证据文件`;
- `证据预览`;
- `执行日志`;
- `候选结果清单`.

## Deployment contract

Evidence preview is optional.

When enabled, both variables must be set:

- `BIOHARNESS_WEB_EVIDENCE_HOST_ROOT`;
- `BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT`.

Both roots must be absolute.

The matching provider-output root must be mounted read-only into the container. The deployment guide explicitly warns against mounting the whole home directory or the whole `/home/yangs/software` tree.

## Boundary

V1.6 remains an observability-only feature.

It adds no:

- file mutation;
- file upload;
- arbitrary filesystem browsing;
- task mutation;
- provider execution;
- reconciliation action;
- policy mutation;
- memory mutation;
- database write.

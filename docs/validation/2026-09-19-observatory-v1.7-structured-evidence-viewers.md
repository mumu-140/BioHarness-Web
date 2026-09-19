# BioHarness Web Observatory V1.7 — Structured Evidence Viewers

Status: pre-merge validation evidence for format-aware scientific evidence previews.

## Goal

V1.7 upgrades the V1.6 read-only evidence panel from a plain text viewer into
format-aware scientific views while preserving the raw persisted evidence as the
audit source.

No backend contract or filesystem permission is expanded in this release.

## Supported structured views

The existing V1.6 backend already classifies evidence as:

- `json`;
- `table`;
- `fasta`;
- `newick`;
- `text`.

V1.7 consumes those existing format labels in the browser.

### JSON

JSON evidence is rendered as a nested expandable structure.

- object/array item counts are shown;
- the first two levels are expanded by default;
- deeper levels remain collapsible;
- the original JSON text stays available behind `查看原始文本`.

### TSV / CSV

Table evidence is parsed in-browser.

- delimiter is detected as tab or comma;
- quoted CSV fields and escaped quotes are supported;
- the header remains sticky during vertical scrolling;
- horizontal scrolling is available for wide tables;
- the UI reports row and column counts;
- the structured preview is capped at 200 rows and 30 columns;
- original text remains available for audit.

### FASTA

FASTA evidence is rendered as sequence records.

For each displayed record the UI shows:

- FASTA header;
- sequence length;
- wrapped monospace sequence.

The structured preview displays up to 40 records and reports the total record
count. The original FASTA stays available behind `查看原始文本`.

### Newick / treefile

Newick evidence is parsed in-browser into a compact rectangular topology SVG.

- leaf names are shown;
- the UI reports the number of leaves;
- up to 80 leaves are rendered as the compact topology view;
- branch lengths remain present in the original Newick text;
- the UI explicitly states that the small tree is for topology inspection.

No new visualization dependency was introduced.

## Safe fallbacks

Structured rendering is deliberately conservative.

If a JSON, table, FASTA, or Newick payload cannot be parsed reliably, the UI
shows a parse warning and falls back to the original text.

If a structured evidence file was truncated by the V1.6 bounded preview layer,
V1.7 does not attempt to parse the head-and-tail excerpt as a complete object,
table, sequence set, or tree. It displays:

`文件过大，当前为截断文本预览`

and shows the bounded raw excerpt instead.

This avoids presenting an incomplete structured object as if it were complete.

## TDD

RED was verified remotely before implementation.

The new test suite initially failed because
`EvidencePreviewViewer.tsx` did not exist.

After implementation:

Frontend:

- 5 test files passed;
- 20 tests passed;
- TypeScript build passed;
- Vite production build passed;
- 198 modules transformed.

Backend regression suite:

- 33 tests passed;
- 1 environment-dependent database test skipped.

The structured viewer tests cover:

- TSV table rendering;
- nested JSON rendering;
- multiline FASTA records and sequence lengths;
- Newick topology rendering;
- raw text fallback;
- truncated structured evidence fallback.

## Live pre-merge smoke

Target host: `fwq10ys`.

Pre-merge image:

`bioharness-web:observatory-v1.7-premerge`

Image digest:

`sha256:ccf72fc7032ce7d7f4d861332c9715b5d6c33eec133b652706c52a8f4d81c705`

The V1.7 image reuses the already validated V1.6 runtime and replaces only the
frontend static bundle. The overlay image was built with `--network none`.

Smoke container:

- bound to `127.0.0.1:18081`;
- root filesystem read-only;
- evidence mount read-only.

The live acceptance task exposed real evidence for all four structured formats:

- `fasta / alignment / FamilyA_aln.fa / 1926 B`;
- `json / process_record / process.json / 736 B`;
- `newick / tree / FamilyA_tree.treefile / 216 B`;
- `table / resolved_manifest / genomes.resolved.tsv / 1178 B`.

All four were non-truncated.

The deployed frontend bundle contained the V1.7 Chinese UI markers:

- `表格视图`;
- `JSON 结构`;
- `序列视图`;
- `树拓扑`;
- `查看原始文本`;
- `文件过大，当前为截断文本预览`.

## Boundary

V1.7 is a frontend interpretation layer over the same V1.6 read-only evidence
API.

It adds no:

- backend filesystem endpoint;
- new server-side file access;
- database write;
- task mutation;
- provider execution;
- artifact mutation;
- evidence upload;
- external frontend dependency.

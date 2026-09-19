import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EvidencePreview } from "../api/types";
import EvidencePreviewViewer from "./EvidencePreviewViewer";


function preview(
  format: string,
  content: string,
  overrides: Partial<EvidencePreview> = {},
): EvidencePreview {
  return {
    id: "evidence-1",
    role: "execution_log",
    name: "evidence.txt",
    format,
    size_bytes: content.length,
    truncated: false,
    content,
    ...overrides,
  };
}


describe("EvidencePreviewViewer", () => {
  it("renders TSV/CSV evidence as a scrollable table", () => {
    render(
      <EvidencePreviewViewer
        preview={preview(
          "table",
          "gene\tstatus\tscore\nA\tPASS\t0.97\nB\tWARN\t0.42\n",
          { role: "audit_table", name: "audit.tsv" },
        )}
      />,
    );

    const table = screen.getByRole("table", { name: "结构化表格预览" });
    expect(table.textContent).toContain("gene");
    expect(table.textContent).toContain("status");
    expect(table.textContent).toContain("A");
    expect(table.textContent).toContain("PASS");
    expect(screen.getByText("2 行 · 3 列")).toBeTruthy();
  });

  it("parses quoted CSV fields without splitting embedded commas", () => {
    render(
      <EvidencePreviewViewer
        preview={preview(
          "table",
          'gene,note,status\nA,"alpha, beta",PASS\n',
          { role: "audit_table", name: "audit.csv" },
        )}
      />,
    );

    const table = screen.getByRole("table", { name: "结构化表格预览" });
    expect(table.textContent).toContain("alpha, beta");
    expect(screen.getByText("1 行 · 3 列")).toBeTruthy();
  });

  it("renders JSON evidence as a nested readable structure", () => {
    render(
      <EvidencePreviewViewer
        preview={preview(
          "json",
          JSON.stringify({
            candidate: {
              family: "FamilyA",
              accepted: true,
              counts: [2, 4],
            },
          }),
          { role: "candidate_manifest", name: "manifest.json" },
        )}
      />,
    );

    const region = screen.getByLabelText("JSON 结构预览");
    expect(region.textContent).toContain("candidate");
    expect(region.textContent).toContain("FamilyA");
    expect(region.textContent).toContain("accepted");
    expect(region.textContent).toContain("true");
  });

  it("renders FASTA evidence as sequence records with lengths", () => {
    render(
      <EvidencePreviewViewer
        preview={preview(
          "fasta",
          ">seqA example\nMSTNPKPQRK\n>seqB\nACGTACGT\n",
          { role: "alignment", name: "FamilyA_aln.fa" },
        )}
      />,
    );

    const region = screen.getByLabelText("FASTA 序列预览");
    expect(region.textContent).toContain("2 条序列");
    expect(region.textContent).toContain("seqA example");
    expect(region.textContent).toContain("10 aa");
    expect(region.textContent).toContain("ACGTACGT");
  });

  it("renders Newick evidence as a compact topology SVG", () => {
    render(
      <EvidencePreviewViewer
        preview={preview(
          "newick",
          "((Alpha:0.1,Beta:0.2):0.3,Gamma:0.4);",
          { role: "tree", name: "FamilyA_tree.treefile" },
        )}
      />,
    );

    const tree = screen.getByRole("img", { name: "系统发育树预览" });
    expect(tree.textContent).toContain("Alpha");
    expect(tree.textContent).toContain("Beta");
    expect(tree.textContent).toContain("Gamma");
    expect(screen.getByText("3 个叶节点")).toBeTruthy();
  });

  it("falls back to raw text for plain text and truncated structured evidence", () => {
    const { rerender } = render(
      <EvidencePreviewViewer
        preview={preview("text", "executor line 1\nexecutor line 2\n")}
      />,
    );
    expect(screen.getByLabelText("文本证据预览").textContent).toContain(
      "executor line 2",
    );

    rerender(
      <EvidencePreviewViewer
        preview={preview(
          "table",
          "a\tb\n1\t2\n…… 中间内容已省略 ……\n9\t10\n",
          { truncated: true, role: "execution_trace", name: "trace.tsv" },
        )}
      />,
    );

    expect(screen.getByText("文件过大，当前为截断文本预览")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByLabelText("文本证据预览").textContent).toContain(
      "中间内容已省略",
    );
  });
});

import type { ReactNode } from "react";

import type { EvidencePreview } from "../api/types";


interface EvidencePreviewViewerProps {
  preview: EvidencePreview;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface TreeNode {
  name: string;
  length: number | null;
  children: TreeNode[];
}

interface PositionedTreeNode extends TreeNode {
  x: number;
  y: number;
  children: PositionedTreeNode[];
}


function RawText({ content }: { content: string }) {
  return (
    <pre className="evidence-raw-text" aria-label="文本证据预览">
      {content}
    </pre>
  );
}


function RawDisclosure({ content }: { content: string }) {
  return (
    <details className="evidence-raw-disclosure">
      <summary>查看原始文本</summary>
      <RawText content={content} />
    </details>
  );
}


function detectDelimiter(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs >= commas ? "\t" : ",";
}


function parseDelimited(content: string): string[][] {
  const delimiter = detectDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}


function TablePreview({ content }: { content: string }) {
  const rows = parseDelimited(content);
  if (rows.length < 2 || rows[0].length === 0) {
    return (
      <>
        <p className="evidence-parse-warning">
          无法稳定解析为表格，已回退到原始文本。
        </p>
        <RawText content={content} />
      </>
    );
  }

  const headers = rows[0];
  const data = rows.slice(1);
  const displayedHeaders = headers.slice(0, 30);
  const displayedRows = data.slice(0, 200);

  return (
    <div className="structured-preview">
      <div className="structured-preview-summary">
        <strong>表格视图</strong>
        <span>{data.length} 行 · {headers.length} 列</span>
      </div>
      <div className="evidence-table-scroll">
        <table aria-label="结构化表格预览">
          <thead>
            <tr>
              {displayedHeaders.map((header, index) => (
                <th key={index}>{header || `列 ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((values, rowIndex) => (
              <tr key={rowIndex}>
                {displayedHeaders.map((_, columnIndex) => (
                  <td key={columnIndex}>{values[columnIndex] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data.length > displayedRows.length ||
        headers.length > displayedHeaders.length) && (
        <p className="structured-preview-note">
          预览已限制为前 {displayedRows.length} 行、前 {displayedHeaders.length} 列。
        </p>
      )}
      <RawDisclosure content={content} />
    </div>
  );
}


function JsonPrimitive({ value }: { value: JsonValue }) {
  if (value === null) {
    return <span className="json-null">null</span>;
  }
  if (typeof value === "string") {
    return <span className="json-string">“{value}”</span>;
  }
  return <span className="json-primitive">{String(value)}</span>;
}


function JsonBranch({
  label,
  value,
  depth = 0,
}: {
  label?: string;
  value: JsonValue;
  depth?: number;
}) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="json-leaf">
        {label !== undefined && <strong>{label}</strong>}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const kind = Array.isArray(value) ? "数组" : "对象";

  return (
    <details className="json-branch" open={depth < 2}>
      <summary>
        {label !== undefined && <strong>{label}</strong>}
        <span>{kind} · {entries.length} 项</span>
      </summary>
      <div className="json-children">
        {entries.map(([key, item]) => (
          <JsonBranch
            key={key}
            label={Array.isArray(value) ? `[${key}]` : key}
            value={item}
            depth={depth + 1}
          />
        ))}
      </div>
    </details>
  );
}


function JsonPreview({ content }: { content: string }) {
  let value: JsonValue;
  try {
    value = JSON.parse(content) as JsonValue;
  } catch {
    return (
      <>
        <p className="evidence-parse-warning">
          JSON 解析失败，已回退到原始文本。
        </p>
        <RawText content={content} />
      </>
    );
  }

  return (
    <div className="structured-preview">
      <div className="structured-preview-summary">
        <strong>JSON 结构</strong>
        <span>可展开层级</span>
      </div>
      <div className="json-viewer" aria-label="JSON 结构预览">
        <JsonBranch value={value} />
      </div>
      <RawDisclosure content={content} />
    </div>
  );
}


function parseFasta(content: string): Array<{ header: string; sequence: string }> {
  const records: Array<{ header: string; sequence: string }> = [];
  let current: { header: string; sequence: string } | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      current = { header: line.slice(1).trim(), sequence: "" };
      continue;
    }
    if (!current) return [];
    current.sequence += line.replace(/\s+/g, "");
  }

  if (current) records.push(current);
  return records;
}


function FastaPreview({ content }: { content: string }) {
  const records = parseFasta(content);
  if (records.length === 0) {
    return (
      <>
        <p className="evidence-parse-warning">
          FASTA 解析失败，已回退到原始文本。
        </p>
        <RawText content={content} />
      </>
    );
  }

  const displayed = records.slice(0, 40);
  return (
    <div className="structured-preview" aria-label="FASTA 序列预览">
      <div className="structured-preview-summary">
        <strong>序列视图</strong>
        <span>{records.length} 条序列</span>
      </div>
      <div className="fasta-records">
        {displayed.map((record, index) => (
          <article className="fasta-record" key={index}>
            <header>
              <strong>{record.header || `序列 ${index + 1}`}</strong>
              <span>{record.sequence.length} aa/nt</span>
            </header>
            <pre>{record.sequence}</pre>
          </article>
        ))}
      </div>
      {records.length > displayed.length && (
        <p className="structured-preview-note">
          当前显示前 {displayed.length} 条序列，共 {records.length} 条。
        </p>
      )}
      <RawDisclosure content={content} />
    </div>
  );
}


class NewickParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): TreeNode {
    const node = this.parseNode();
    this.skipWhitespace();
    if (this.peek() === ";") this.index += 1;
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new Error("unexpected trailing content");
    }
    return node;
  }

  private parseNode(): TreeNode {
    this.skipWhitespace();
    const children: TreeNode[] = [];

    if (this.peek() === "(") {
      this.index += 1;
      while (true) {
        children.push(this.parseNode());
        this.skipWhitespace();
        if (this.peek() === ",") {
          this.index += 1;
          continue;
        }
        if (this.peek() !== ")") throw new Error("missing closing parenthesis");
        this.index += 1;
        break;
      }
    }

    const name = this.parseLabel();
    const length = this.parseLength();

    if (children.length === 0 && !name) {
      throw new Error("leaf without name");
    }

    return { name, length, children };
  }

  private parseLabel(): string {
    this.skipWhitespace();
    if (this.peek() === "'") {
      this.index += 1;
      let value = "";
      while (this.index < this.text.length) {
        const char = this.text[this.index];
        if (char === "'") {
          if (this.text[this.index + 1] === "'") {
            value += "'";
            this.index += 2;
            continue;
          }
          this.index += 1;
          return value;
        }
        value += char;
        this.index += 1;
      }
      throw new Error("unterminated quoted label");
    }

    const start = this.index;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if ("(),:;".includes(char)) break;
      this.index += 1;
    }
    return this.text.slice(start, this.index).trim();
  }

  private parseLength(): number | null {
    this.skipWhitespace();
    if (this.peek() !== ":") return null;
    this.index += 1;
    this.skipWhitespace();
    const start = this.index;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if ("(),;".includes(char) || /\s/.test(char)) break;
      this.index += 1;
    }
    const value = Number(this.text.slice(start, this.index));
    return Number.isFinite(value) ? value : null;
  }

  private skipWhitespace() {
    while (/\s/.test(this.peek())) this.index += 1;
  }

  private peek(): string {
    return this.text[this.index] ?? "";
  }
}


function treeLeaves(node: TreeNode): TreeNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(treeLeaves);
}


function treeDepth(node: TreeNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}


function positionTree(root: TreeNode): {
  root: PositionedTreeNode;
  leaves: number;
  depth: number;
} {
  const leaves = treeLeaves(root);
  const depth = treeDepth(root);
  const leafIndex = new Map<TreeNode, number>();
  leaves.forEach((leaf, index) => leafIndex.set(leaf, index));

  const visit = (node: TreeNode, level: number): PositionedTreeNode => {
    const children = node.children.map((child) => visit(child, level + 1));
    const y = children.length === 0
      ? (leafIndex.get(node) ?? 0)
      : children.reduce((sum, child) => sum + child.y, 0) / children.length;
    return {
      ...node,
      children,
      x: level,
      y,
    };
  };

  return { root: visit(root, 0), leaves: leaves.length, depth };
}


function flattenTree(node: PositionedTreeNode): PositionedTreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}


function NewickPreview({ content }: { content: string }) {
  let parsed: ReturnType<typeof positionTree>;
  try {
    parsed = positionTree(new NewickParser(content).parse());
  } catch {
    return (
      <>
        <p className="evidence-parse-warning">
          Newick 解析失败，已回退到原始文本。
        </p>
        <RawText content={content} />
      </>
    );
  }

  if (parsed.leaves > 80) {
    return (
      <>
        <p className="evidence-parse-warning">
          树包含 {parsed.leaves} 个叶节点，超过小型拓扑预览上限（80）。
        </p>
        <RawText content={content} />
      </>
    );
  }

  const width = 620;
  const height = Math.max(130, parsed.leaves * 24 + 34);
  const left = 18;
  const top = 18;
  const right = 180;
  const usableWidth = width - left - right;
  const usableHeight = Math.max(1, height - top * 2);
  const depthScale = parsed.depth === 0 ? 0 : usableWidth / parsed.depth;
  const leafScale = parsed.leaves <= 1 ? 0 : usableHeight / (parsed.leaves - 1);
  const nodes = flattenTree(parsed.root);
  const xOf = (node: PositionedTreeNode) => left + node.x * depthScale;
  const yOf = (node: PositionedTreeNode) => top + node.y * leafScale;
  const graphics: ReactNode[] = [];

  for (const node of nodes) {
    if (node.children.length > 0) {
      const ys = node.children.map(yOf);
      graphics.push(
        <line
          key={`v-${node.x}-${node.y}`}
          x1={xOf(node)}
          x2={xOf(node)}
          y1={Math.min(...ys)}
          y2={Math.max(...ys)}
        />,
      );
      for (const child of node.children) {
        graphics.push(
          <line
            key={`h-${child.x}-${child.y}`}
            x1={xOf(node)}
            x2={xOf(child)}
            y1={yOf(child)}
            y2={yOf(child)}
          />,
        );
      }
    }
  }

  return (
    <div className="structured-preview">
      <div className="structured-preview-summary">
        <strong>树拓扑</strong>
        <span>{parsed.leaves} 个叶节点</span>
      </div>
      <div className="newick-tree-scroll">
        <svg
          className="newick-tree"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="系统发育树预览"
        >
          <g className="newick-branches">{graphics}</g>
          <g className="newick-labels">
            {nodes
              .filter((node) => node.children.length === 0)
              .map((leaf, index) => (
                <text
                  key={index}
                  x={xOf(leaf) + 7}
                  y={yOf(leaf) + 4}
                >
                  {leaf.name || `leaf-${index + 1}`}
                </text>
              ))}
          </g>
        </svg>
      </div>
      <p className="structured-preview-note">
        小型拓扑图用于快速检查分支关系；分支长度仍保留在原始 Newick 文本中。
      </p>
      <RawDisclosure content={content} />
    </div>
  );
}


export default function EvidencePreviewViewer({
  preview,
}: EvidencePreviewViewerProps) {
  if (preview.truncated && preview.format !== "text") {
    return (
      <div className="structured-preview">
        <p className="evidence-truncated-warning">
          文件过大，当前为截断文本预览
        </p>
        <RawText content={preview.content} />
      </div>
    );
  }

  switch (preview.format) {
    case "table":
      return <TablePreview content={preview.content} />;
    case "json":
      return <JsonPreview content={preview.content} />;
    case "fasta":
      return <FastaPreview content={preview.content} />;
    case "newick":
      return <NewickPreview content={preview.content} />;
    default:
      return <RawText content={preview.content} />;
  }
}

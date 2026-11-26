import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? "").replace(/\n$/, "");
  const match = /language-([\w-]+)/.exec(className ?? "");
  const lang = match?.[1] ?? "";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable in non-HTTPS or headless contexts
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700/80 bg-slate-800/80 px-3 py-1 text-[11px] text-slate-300">
        <span className="font-mono">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-teal-400" aria-hidden="true" />
              已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              复制
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-slate-100">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

/**
 * Safe scientific Markdown renderer (GFM tables, fenced code blocks, KaTeX math).
 * Never enables raw HTML parsing so untrusted scientific outputs cannot inject markup.
 */
export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-body space-y-2 text-[13px] leading-relaxed text-slate-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const safe =
              typeof href === "string" &&
              (href.startsWith("https://") || href.startsWith("http://"));
            if (!safe) return <span>{children}</span>;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900"
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              {children}
            </thead>
          ),
          th: ({ children }) => <th className="px-2.5 py-1.5 font-semibold">{children}</th>,
          td: ({ children }) => (
            <td className="border-t border-slate-100 px-2.5 py-1.5 align-top">{children}</td>
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = Boolean(className) || String(children ?? "").includes("\n");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return (
              <code
                {...rest}
                className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-teal-900"
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-teal-600 bg-slate-50/70 py-1 pl-3 text-slate-700">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

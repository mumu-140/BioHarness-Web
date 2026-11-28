/**
 * Self-hosted read-only code/text evidence viewer using locally bundled Monaco
 * (zero CDN requests, zero data: worker URIs, no save/execute/AI-edit actions)
 * (not upstream LibreChat code).
 */
import React, { memo } from 'react';
import { isDark, useTheme } from '@librechat/client';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

/* Route Monaco workers strictly to Vite-bundled same-origin worker assets (zero CDN, zero data: URI). */
if (typeof self !== 'undefined') {
  (
    self as unknown as {
      MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
    }
  ).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === 'json') {
        return new JsonWorker();
      }
      return new EditorWorker();
    },
  };
}

/* Configure @monaco-editor/react to use the local bundled monaco-editor package exclusively. */
loader.config({ monaco });

function detectLanguage(filename: string, format?: string): string {
  if (format === 'json') return 'json';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.xml') || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.sh')) return 'shell';
  if (lower.endsWith('.r')) return 'r';
  if (lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.css')) return 'css';
  return 'plaintext';
}

export interface BioHarnessEvidenceCodeViewerProps {
  filename: string;
  format?: string;
  content: string;
}

const BioHarnessEvidenceCodeViewer = memo(function BioHarnessEvidenceCodeViewer({
  filename,
  format,
  content,
}: BioHarnessEvidenceCodeViewerProps) {
  const { theme } = useTheme();
  const dark = isDark(theme);
  const language = detectLanguage(filename, format);
  return (
    <div
      data-testid="bh-code-viewer"
      data-theme-mode={dark ? 'dark' : 'light'}
      className="border-border-light overflow-hidden rounded-xl border"
    >
      <Editor
        height="520px"
        language={language}
        theme={dark ? 'vs-dark' : 'vs'}
        value={content}
        loading={
          <pre className="bg-surface-secondary max-h-[520px] overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
            {content}
          </pre>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          fontSize: 13,
          contextmenu: false,
        }}
      />
    </div>
  );
});

export default BioHarnessEvidenceCodeViewer;

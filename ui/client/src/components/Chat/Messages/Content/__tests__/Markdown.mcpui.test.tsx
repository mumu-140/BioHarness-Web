/* BioHarness: changed from LibreChat v0.8.9. Executable MCP UI `\ui{...}` directives are intentionally
 * disabled in `markdownConfig.ts` per roadmap §17.5 while preserving GFM table horizontal wrapping. */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import { MCPAppsPolicyProvider } from '~/Providers/MCPAppsPolicyContext';
import { UI_RESOURCE_MARKER } from '~/components/MCPUIResource/plugin';
import MarkdownLite from '../MarkdownLite';
import Markdown from '../Markdown';

jest.mock('@mcp-ui/client', () => ({
  UIResourceRenderer: ({ resource }: any) => (
    <span data-testid="ui-resource-renderer" data-resource-uri={resource?.uri} />
  ),
}));

const renderMarkdown = (content: string, legacyHtmlEnabled = true) =>
  render(
    <RecoilRoot>
      <MCPAppsPolicyProvider
        startupConfig={{ mcpApps: { enabled: false, legacyHtmlEnabled } } as TStartupConfig}
        ready
      >
        <Markdown content={content} isLatestMessage={false} />
      </MCPAppsPolicyProvider>
    </RecoilRoot>,
  );

describe('Markdown with MCP UI markers (BioHarness disabled executable directives)', () => {
  it('leaves MCP UI markers as inert text and never mounts UIResourceRenderer', () => {
    const content = `Inspect results ${UI_RESOURCE_MARKER}{abc123} ${UI_RESOURCE_MARKER}{def456}`;
    renderMarkdown(content, true);
    expect(screen.queryByTestId('ui-resource-renderer')).not.toBeInTheDocument();
    expect(document.querySelector('iframe[data-sandbox-url]')).not.toBeInTheDocument();
    expect(screen.getByText(/Inspect results/)).toBeInTheDocument();
  });
});

describe('Markdown table rendering', () => {
  const tableMarkdown = [
    '| Alpha | Bravo | Charlie | Delta | Echo | Foxtrot | Golf | Hotel |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| one | two | three | four | five | six | seven | eight |',
  ].join('\n');

  it('wraps GFM tables in a horizontally scrollable container', () => {
    render(
      <RecoilRoot>
        <Markdown content={tableMarkdown} isLatestMessage={false} />
      </RecoilRoot>,
    );
    expect(screen.getByRole('table').parentElement).toHaveClass(
      'markdown-table-wrapper',
      'w-full',
      'max-w-full',
    );
  });

  it('wraps lightweight Markdown tables in a horizontally scrollable container', () => {
    render(<MarkdownLite content={tableMarkdown} />);
    expect(screen.getByRole('table').parentElement).toHaveClass(
      'markdown-table-wrapper',
      'w-full',
      'max-w-full',
    );
  });
});

/* BioHarness: changed from LibreChat v0.8.9. Executable `:::artifact` directives are intentionally
 * disabled in `markdownConfig.ts` per roadmap §17.5 while retaining safe GFM, KaTeX, and code blocks. */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { MessageContext } from '~/Providers';
import { loadRehypeModules } from '../rehype';
import Markdown from '../Markdown';

beforeAll(() => loadRehypeModules());

jest.mock('~/components/Artifacts/ArtifactButton', () => ({
  __esModule: true,
  default: () => <div data-testid="art" />,
}));

const renderMarkdown = (content: string) =>
  render(
    <MemoryRouter>
      <RecoilRoot>
        <MessageContext.Provider value={{ messageId: 'm1', isExpanded: true }}>
          <Markdown content={content} isLatestMessage={false} />
        </MessageContext.Provider>
      </RecoilRoot>
    </MemoryRouter>,
  );

describe('MarkdownBlocks (BioHarness disabled executable artifacts)', () => {
  it('does not mount executable ArtifactButton components for :::artifact directives', () => {
    const content = [
      'Before text.',
      '',
      ':::artifact{identifier="a1" type="text/html" title="Executable"}',
      '<script>alert(1)</script>',
      ':::',
      '',
      'After text.',
    ].join('\n');

    renderMarkdown(content);
    expect(screen.queryByTestId('art')).not.toBeInTheDocument();
    expect(screen.getByText(/Before text/)).toBeInTheDocument();
    expect(screen.getByText(/After text/)).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('retains fenced code blocks and GFM tables safely', () => {
    const content = [
      '| Gene | FoldChange |',
      '| --- | --- |',
      '| TF1 | 2.4 |',
      '',
      '```python',
      'print("hello")',
      '```',
    ].join('\n');

    renderMarkdown(content);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('TF1')).toBeInTheDocument();
    expect(screen.getByText(/print/)).toBeInTheDocument();
  });
});

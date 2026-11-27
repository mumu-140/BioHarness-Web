/* BioHarness: changed from LibreChat v0.8.9. ConversationsSection now seats BioHarnessSidebarSection. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecoilRoot } from 'recoil';
import ConversationsSection from '../ConversationsSection';
import { BioHarnessWorkspaceProvider } from '~/host/workspace';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true, user: { id: 'service:test' }, token: 'marker' }),
}));

jest.mock('~/hooks/Nav/useDrawerViewport', () => ({
  __esModule: true,
  default: () => false,
}));

jest.mock('~/hooks/Nav/useSidebarToggle', () => ({
  __esModule: true,
  default: () => ({ setSidebarOpen: jest.fn() }),
}));

jest.mock('~/host/bioharness', () => {
  const actual = jest.requireActual('~/host/bioharness');
  return {
    ...actual,
    fetchMeta: jest.fn().mockResolvedValue({
      service: 'test-svc',
      workspaces: ['ws-alpha', 'ws-beta'],
      poll_interval_seconds: 2,
      tools: {},
      runtime: { enabled: true, model: 'test-model', module_tool_servers: [] },
    }),
    fetchConversations: jest.fn().mockResolvedValue([
      { id: 'conv-1', workspace: 'ws-alpha', request_id: 'req-1', created_at: '2026-11-28T00:00:00Z' },
    ]),
    fetchView: jest.fn().mockResolvedValue({
      service: 'test-svc',
      workspace: 'ws-alpha',
      view: 'open',
      selector: {},
      source: { owner: 'core', interface: 'cli' },
      observed_at: '2026-11-28T00:00:00Z',
      ok: true,
      data: { requests: [{ request_id: 'req-open-2', question: 'Open question?' }] },
      error: null,
      source_version: null,
      content_sha256: 'abc',
      warnings: [],
    }),
  };
});

describe('ConversationsSection (BioHarness vertical slice)', () => {
  it('renders workspace selector, conversations, open requests, and no donor project folders', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RecoilRoot>
          <MemoryRouter initialEntries={['/c/new?ws=ws-alpha']}>
            <BioHarnessWorkspaceProvider onOpenSettings={jest.fn()}>
              <ConversationsSection />
            </BioHarnessWorkspaceProvider>
          </MemoryRouter>
        </RecoilRoot>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('bh-workspace-select')).toHaveValue('ws-alpha');
    expect(await screen.findByTestId('bh-convo-item-conv-1')).toBeInTheDocument();
    expect(await screen.findByTestId('bh-open-req-req-open-2')).toBeInTheDocument();
    expect(screen.queryByText('New project')).not.toBeInTheDocument();
  });
});

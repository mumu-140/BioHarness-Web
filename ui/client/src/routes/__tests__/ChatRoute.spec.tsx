/* BioHarness: changed from LibreChat v0.8.9. ChatRoute delegates directly to BioHarnessChatRoute
 * without invoking removed LibreChat donor `/api/endpoints` or `/api/config` startup hooks. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ChatRoute from '../ChatRoute';

jest.mock('~/host/BioHarnessChatRoute', () => ({
  __esModule: true,
  default: () => <div data-testid="bh-chat-route-stub">BioHarnessChatRoute</div>,
}));

describe('ChatRoute (BioHarness host adapter)', () => {
  it('renders BioHarnessChatRoute directly without donor endpoint fetches', () => {
    render(<ChatRoute />);
    expect(screen.getByTestId('bh-chat-route-stub')).toBeInTheDocument();
  });
});

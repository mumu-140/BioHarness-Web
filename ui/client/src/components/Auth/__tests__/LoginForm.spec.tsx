import userEvent from '@testing-library/user-event';
import type { TStartupConfig } from 'librechat-data-provider';
import * as endpointQueries from '~/data-provider/Endpoints/queries';
import * as miscDataProvider from '~/data-provider/Misc/queries';
import * as authMutations from '~/data-provider/Auth/mutations';
import { render, getByTestId } from 'test/layout-test-utils';
import * as authQueries from '~/data-provider/Auth/queries';
import Login from '../LoginForm';

jest.mock('librechat-data-provider/react-query');

const mockLogin = jest.fn();

const mockStartupConfig: TStartupConfig = {
  socialLogins: ['google', 'facebook', 'openid', 'github', 'discord', 'saml'],
  discordLoginEnabled: true,
  facebookLoginEnabled: true,
  githubLoginEnabled: true,
  googleLoginEnabled: true,
  openidLoginEnabled: true,
  passkeyLoginEnabled: false,
  appleLoginEnabled: false,
  openidLabel: 'Test OpenID',
  openidImageUrl: 'http://test-server.com',
  openidAutoRedirect: false,
  samlLoginEnabled: true,
  samlLabel: 'Test SAML',
  samlImageUrl: 'http://test-server.com',
  registrationEnabled: true,
  emailLoginEnabled: true,
  socialLoginEnabled: true,
  passwordResetEnabled: true,
  serverDomain: 'mock-server',
  appTitle: '',
  ldap: {
    enabled: false,
  },
  emailEnabled: false,
  showBirthdayIcon: false,
  helpAndFaqURL: '',
  sharedLinksEnabled: true,
  publicSharedLinksEnabled: true,
  allowAccountDeletion: true,
  allowEmailChange: true,
};

const setup = ({
  useGetUserQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
  useLoginUserReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {},
    isSuccess: false,
  },
  useRefreshTokenMutationReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {
      token: 'mock-token',
      user: {},
    },
  },
  useGetStartupConfigReturnValue = {
    isLoading: false,
    isError: false,
    data: mockStartupConfig,
  },
  useGetBannerQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
} = {}) => {
  const mockUseLoginUser = jest
    .spyOn(authMutations, 'useLoginUserMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useLoginUserReturnValue);
  const mockUseGetUserQuery = jest
    .spyOn(authQueries, 'useGetUserQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetUserQueryReturnValue);
  const mockUseGetStartupConfig = jest
    .spyOn(endpointQueries, 'useGetStartupConfig')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetStartupConfigReturnValue);
  const mockUseRefreshTokenMutation = jest
    .spyOn(authMutations, 'useRefreshTokenMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useRefreshTokenMutationReturnValue);
  const mockUseGetBannerQuery = jest
    .spyOn(miscDataProvider, 'useGetBannerQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetBannerQueryReturnValue);
  return {
    mockUseLoginUser,
    mockUseGetUserQuery,
    mockUseGetStartupConfig,
    mockUseRefreshTokenMutation,
    mockUseGetBannerQuery,
  };
};

beforeEach(() => {
  setup();
});

/* BioHarness: changed from LibreChat v0.8.9 for the service-access-token sign-in. */
test('renders the access token field without an account field', () => {
  const { getByLabelText, queryByLabelText } = render(
    <Login
      onSubmit={mockLogin}
      startupConfig={mockStartupConfig}
      error={undefined}
      setError={jest.fn()}
    />,
  );
  expect(getByLabelText(/service access token/i)).toBeInTheDocument();
  expect(queryByLabelText(/email/i)).not.toBeInTheDocument();
});

test('submits the access token as the only credential', async () => {
  const { getByLabelText } = render(
    <Login
      onSubmit={mockLogin}
      startupConfig={mockStartupConfig}
      error={undefined}
      setError={jest.fn()}
    />,
  );
  await userEvent.type(getByLabelText(/service access token/i), 'tok');
  await userEvent.click(getByTestId(document.body, 'login-button'));

  expect(mockLogin).toHaveBeenCalledWith({ password: 'tok' });
});

test('requires the access token', async () => {
  const { getByText } = render(
    <Login
      onSubmit={mockLogin}
      startupConfig={mockStartupConfig}
      error={undefined}
      setError={jest.fn()}
    />,
  );
  await userEvent.click(getByTestId(document.body, 'login-button'));

  expect(getByText(/Enter the service access token/i)).toBeInTheDocument();
  expect(mockLogin).not.toHaveBeenCalled();
});

test('does not offer email verification resend on a 422 error when email is disabled', () => {
  const { queryByText } = render(
    <Login
      onSubmit={mockLogin}
      startupConfig={{ ...mockStartupConfig, emailEnabled: false }}
      error="Request failed with status code 422"
      setError={jest.fn()}
    />,
  );
  expect(queryByText(/resend/i)).not.toBeInTheDocument();
});

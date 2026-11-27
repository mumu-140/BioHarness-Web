/* BioHarness: changed from LibreChat v0.8.9. Only sign-in and the chat route are mounted. Registration, password
 * reset, OAuth, two-factor, shared links, channels, the dashboard, code setup, prompts, skills,
 * insights, donor projects, search and the agent marketplace all need LibreChat services that
 * this host does not run; their routes are removed rather than left to fail. The donor's
 * real-user-monitoring wrapper is not mounted either. */
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AuthContextProvider } from '~/hooks/AuthContext';
import RouteErrorBoundary from './RouteErrorBoundary';
import LoginLayout from './Layouts/Login';
import { Login } from '~/components/Auth';
import ChatRoute from './ChatRoute';
import Root from './Root';

const AuthLayout = () => (
  <AuthContextProvider>
    <Outlet />
  </AuthContextProvider>
);

const baseEl = document.querySelector('base');
const baseHref = baseEl?.getAttribute('href') || '/';

export const router = createBrowserRouter(
  [
    {
      element: <AuthLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          errorElement: <RouteErrorBoundary />,
          children: [
            {
              path: '/',
              element: <LoginLayout />,
              children: [{ path: 'login', element: <Login /> }],
            },
            {
              path: '/',
              element: <Root />,
              children: [
                { index: true, element: <Navigate to="/c/new" replace={true} /> },
                { path: 'c/:conversationId?', element: <ChatRoute /> },
              ],
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref },
);

/* BioHarness: changed from LibreChat v0.8.9. Only sign-in, conversation, and BioHarness Step 4
 * scientific workspace routes (workflow, evidence, executions) are mounted. Registration, password
 * reset, OAuth, two-factor, shared links, channels, the dashboard, code setup, prompts, skills,
 * insights, donor projects, search and the agent marketplace all need LibreChat services that
 * this host does not run; their routes are removed rather than left to fail. The donor's
 * real-user-monitoring wrapper is not mounted either. */
import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Spinner } from '@librechat/client';
import { AuthContextProvider } from '~/hooks/AuthContext';
import RouteErrorBoundary from './RouteErrorBoundary';
import LoginLayout from './Layouts/Login';
import { Login } from '~/components/Auth';
import ChatRoute from './ChatRoute';
import Root from './Root';

const BioHarnessWorkflowRoute = lazy(() => import('~/host/BioHarnessWorkflowRoute'));
const BioHarnessEvidenceRoute = lazy(() => import('~/host/BioHarnessEvidenceRoute'));
const BioHarnessExecutionsRoute = lazy(() => import('~/host/BioHarnessExecutionsRoute'));
const BioHarnessCapabilitiesRoute = lazy(() => import('~/host/BioHarnessCapabilitiesRoute'));

const RouteSuspense = ({ children }: { children: React.ReactNode }) => (
  <Suspense
    fallback={
      <div className="bg-surface-canvas flex h-full w-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    }
  >
    {children}
  </Suspense>
);

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
                {
                  path: 'w/workflow',
                  element: (
                    <RouteSuspense>
                      <BioHarnessWorkflowRoute />
                    </RouteSuspense>
                  ),
                },
                {
                  path: 'w/evidence',
                  element: (
                    <RouteSuspense>
                      <BioHarnessEvidenceRoute />
                    </RouteSuspense>
                  ),
                },
                {
                  path: 'w/executions',
                  element: (
                    <RouteSuspense>
                      <BioHarnessExecutionsRoute />
                    </RouteSuspense>
                  ),
                },
                {
                  path: 'w/capabilities',
                  element: (
                    <RouteSuspense>
                      <BioHarnessCapabilitiesRoute />
                    </RouteSuspense>
                  ),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref },
);

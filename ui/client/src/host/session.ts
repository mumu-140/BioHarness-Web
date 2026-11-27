/**
 * Maps the donor's sign-in state onto BioHarness service authentication (not upstream code).
 *
 * BioHarness authenticates with one service access token exchanged for an HttpOnly session
 * cookie. The browser never keeps the access token; the value handed to the donor's auth
 * state is a fixed marker that only says "a cookie session was confirmed".
 */
import type { TUser } from 'librechat-data-provider';
import { HostHttpError, hostFetch } from './gate';

export const SESSION_MARKER = 'bioharness-cookie-session';

export type ServiceMeta = {
  service: string;
  workspaces: string[];
  runtime: { enabled: boolean; model: string | null; module_tool_servers: string[] };
};

/** Reads the service identity; succeeds only with a valid session. */
export async function readMeta(): Promise<ServiceMeta> {
  const response = await hostFetch('/api/meta');
  if (!response.ok) {
    throw new HostHttpError(response.status, await response.json().catch(() => null));
  }
  return (await response.json()) as ServiceMeta;
}

/** The donor needs an account object; BioHarness has one operator per service token. */
const toUser = (meta: ServiceMeta): TUser => ({
  id: `service:${meta.service}`,
  username: meta.service,
  email: '',
  name: meta.service,
  avatar: '',
  role: 'USER',
  provider: 'bioharness',
  createdAt: '',
  updatedAt: '',
});

export async function currentUser(): Promise<TUser> {
  return toUser(await readMeta());
}

export async function signIn(accessToken: string) {
  const response = await hostFetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: accessToken }),
  });
  if (!response.ok) {
    throw new HostHttpError(response.status, await response.json().catch(() => null));
  }
  return { token: SESSION_MARKER, user: await currentUser() };
}

/** Answers the donor's silent refresh: a session exists exactly when the service says so. */
export async function resumeSession() {
  try {
    return { token: SESSION_MARKER, user: await currentUser() };
  } catch (error) {
    if (error instanceof HostHttpError && error.status === 401) {
      return {};
    }
    throw error;
  }
}

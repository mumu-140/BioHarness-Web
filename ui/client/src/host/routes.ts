/**
 * Donor data-layer calls that BioHarness answers (not upstream code).
 *
 * Step 2 of the roadmap maps only start-up and sign-in. Everything not listed here is refused
 * by `gate.ts` as not provided, so no donor feature appears to work without a real backend.
 */
import type { TStartupConfig } from 'librechat-data-provider';
import type { HostRoute } from './gate';
import { HostHttpError, hostFetch } from './gate';
import { currentUser, resumeSession, signIn } from './session';

/** Static start-up facts of this host: no accounts, social sign-in, analytics or donor services. */
const startupConfig: TStartupConfig = {
  appTitle: 'BioHarness',
  serverDomain: window.location.origin,
  emailLoginEnabled: true,
  registrationEnabled: false,
  socialLoginEnabled: false,
  passwordResetEnabled: false,
  passkeyLoginEnabled: false,
  discordLoginEnabled: false,
  facebookLoginEnabled: false,
  githubLoginEnabled: false,
  googleLoginEnabled: false,
  openidLoginEnabled: false,
  appleLoginEnabled: false,
  samlLoginEnabled: false,
  openidLabel: '',
  openidImageUrl: '',
  openidAutoRedirect: false,
  samlLabel: '',
  samlImageUrl: '',
  emailEnabled: false,
  allowEmailChange: false,
  allowAccountDeletion: false,
  showBirthdayIcon: false,
  helpAndFaqURL: '/',
  sharedLinksEnabled: false,
  publicSharedLinksEnabled: false,
  customFooter:
    'BioHarness Research Workspace | Interface adapted from [LibreChat v0.8.9](https://github.com/LibreChat-AI/LibreChat) (MIT)',
  /** Donor features that need LibreChat services stay switched off by the donor's own flags. */
  interface: {
    analyticsConsent: false,
    temporaryChat: false,
    parameters: false,
    presets: false,
    bookmarks: false,
    multiConvo: false,
    prompts: false,
    agents: false,
    memories: false,
    runCode: false,
    webSearch: false,
    fileSearch: false,
    fileCitations: false,
    skills: false,
    marketplace: { use: false },
    feedback: false,
    buildInfo: false,
    mascot: false,
  } as TStartupConfig['interface'],
};

const password = (body: unknown): string => {
  const value = (body as { password?: unknown } | null)?.password;
  return typeof value === 'string' ? value : '';
};

export const hostRoutes: HostRoute[] = [
  { method: 'GET', path: /^\/api\/config$/, handle: async () => startupConfig },
  { method: 'POST', path: /^\/api\/auth\/login$/, handle: ({ body }) => signIn(password(body)) },
  { method: 'POST', path: /^\/api\/auth\/refresh$/, handle: () => resumeSession() },
  { method: 'GET', path: /^\/api\/user$/, handle: () => currentUser() },
  {
    method: 'GET',
    path: /^\/health$/,
    handle: async () => {
      const response = await hostFetch('/api/health');
      if (!response.ok) {
        throw new HostHttpError(response.status, null);
      }
      return 'OK';
    },
  },
];

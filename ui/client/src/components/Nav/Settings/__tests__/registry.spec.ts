import { isValidElementType } from 'react-is';
import { SettingsTabValues, isTwoFactorPolicyProvider } from 'librechat-data-provider';
import type { SettingsContextValue } from '../types';
import en from '~/locales/en/translation.json';
import { registry, HOST_UNAVAILABLE_SETTING_IDS } from '../registry';
import { TABS, HOST_UNAVAILABLE_TABS } from '../types';

const validTabSections = new Map(TABS.map((t) => [t.id, new Set(t.sections.map((s) => s.id))]));

const settingsContext: SettingsContextValue = {
  balanceEnabled: false,
  hasAnyPersonalizationFeature: false,
  hasMemoryOptOut: false,
  hasStatefulCodeSessions: false,
  hasRemoteAgents: false,
  hasUserProvidedEndpoints: false,
  hasMultiConvo: false,
  hasPrompts: false,
  isLocalProvider: true,
  emailEnabled: true,
  allowEmailChange: true,
  passkeyLoginEnabled: false,
  hasPullRequestConnect: false,
  isTwoFactorPolicyProvider: true,
  twoFactorEnabled: false,
  allowAccountDeletion: true,
  aboutEnabled: false,
  mascotAllowed: true,
  engineTTS: 'browser',
  langfuseConnectionAccess: false,
  adminPanelURL: '',
  replyTabBadgeAllowed: true,
  replyNotificationsAllowed: true,
  replyNotificationSoundAllowed: true,
  analyticsConfigured: false,
};

const policyProviders = ['local', 'ldap', null, undefined];
const federatedProviders = ['openid', 'google', 'saml'];

const contextForProvider = (provider: string | null | undefined): SettingsContextValue => ({
  ...settingsContext,
  isTwoFactorPolicyProvider: isTwoFactorPolicyProvider(provider),
});

describe('settings registry', () => {
  it('has unique ids', () => {
    const ids = registry.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references a valid tab and section for every entry', () => {
    for (const entry of registry) {
      const sections = validTabSections.get(entry.tab);
      expect(sections).toBeDefined();
      expect(sections!.has(entry.section)).toBe(true);
    }
  });

  it('uses label keys that exist in the English locale', () => {
    for (const entry of registry) {
      expect(en).toHaveProperty(entry.labelKey);
    }
  });

  it('has a renderable Component for every entry', () => {
    for (const entry of registry) {
      expect(isValidElementType(entry.Component)).toBe(true);
    }
  });

  describe('Langfuse connection visibility', () => {
    const langfuseEntry = registry.find((entry) => entry.id === 'langfuseConnection');

    it('places the connection in the Langfuse tab', () => {
      expect(langfuseEntry).toMatchObject({
        tab: SettingsTabValues.LANGFUSE,
        section: 'langfuse',
      });
    });

    it('shows the connection when the user can manage it', () => {
      expect(
        langfuseEntry?.show?.({
          ...settingsContext,
          langfuseConnectionAccess: true,
        }),
      ).toBe(true);
    });

    it('shows prompt settings without connection access', () => {
      expect(
        langfuseEntry?.show?.({
          ...settingsContext,
          langfuseConnectionAccess: false,
          langfusePromptSyncAccess: true,
        }),
      ).toBe(true);
    });

    it('hides the connection without Langfuse config access', () => {
      expect(
        langfuseEntry?.show?.({
          ...settingsContext,
          langfuseConnectionAccess: false,
        }),
      ).toBe(false);
    });

    it('shows the connection in single-tenant mode without fanout', () => {
      expect(
        langfuseEntry?.show?.({
          ...settingsContext,
          langfuseConnectionAccess: true,
        }),
      ).toBe(true);
    });
  });

  /* BioHarness: changed from LibreChat v0.8.9. The upstream cases for Account, Data and Speech
   * entries are replaced by this one: those tabs are not offered on this host. */
  it('offers no entry from a tab or control this host does not provide', () => {
    expect(registry.length).toBeGreaterThan(0);
    expect(registry.filter((entry) => HOST_UNAVAILABLE_TABS.has(entry.tab))).toEqual([]);
    expect(registry.filter((entry) => HOST_UNAVAILABLE_SETTING_IDS.has(entry.id))).toEqual([]);
    expect(TABS.filter((tab) => HOST_UNAVAILABLE_TABS.has(tab.id))).toEqual([]);
  });

  it('registers BioHarness R3.3 Skills, Memory, Modules and Diagnostics tabs', () => {
    const ids = new Set(registry.map((e) => e.id));
    expect(ids.has('bioharness-skills')).toBe(true);
    expect(ids.has('bioharness-memory')).toBe(true);
    expect(ids.has('bioharness-modules')).toBe(true);
    expect(ids.has('bioharness-diagnostics')).toBe(true);
  });
});

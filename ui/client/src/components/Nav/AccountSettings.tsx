import { memo, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { useSetRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { GearIcon, Avatar } from '@librechat/client';
import {
  ChevronRight,
  CircleHelp,
  Keyboard,
  LifeBuoy,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import useDirection, { inlineSide } from '~/hooks/Nav/useDirection';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { openInNewTab, policyUrls } from '~/utils';
import { settingsOpenAtom } from './Settings';
import { useLocalize } from '~/hooks';
import store from '~/store';

function HelpSubmenu({
  helpAndFaqURL,
  termsOfServiceURL,
  privacyPolicyURL,
  onShowShortcuts,
}: {
  helpAndFaqURL?: string;
  termsOfServiceURL?: string;
  privacyPolicyURL?: string;
  onShowShortcuts: () => void;
}) {
  const localize = useLocalize();
  const hasHelpFaq = !!helpAndFaqURL && helpAndFaqURL !== '/';
  const hasTos = !!termsOfServiceURL;
  const hasPrivacy = !!privacyPolicyURL;
  const showLegalDivider = (hasHelpFaq || true) && (hasTos || hasPrivacy);
  const submenuSide = inlineSide(useDirection(), 'end');

  return (
    <Menu.MenuProvider placement={`${submenuSide}-start`}>
      <Menu.MenuItem
        hideOnClick={false}
        render={
          <Menu.MenuButton className="select-item flex w-full cursor-pointer items-center gap-2 text-sm" />
        }
      >
        <CircleHelp className="icon-md" aria-hidden="true" />
        <span className="flex-1 text-start">{localize('com_nav_help')}</span>
        <ChevronRight className="text-text-secondary h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
      </Menu.MenuItem>
      <Menu.Menu
        portal
        gutter={12}
        className="popover-ui popover-from-left z-[126] w-[min(15.25rem,90vw)]"
      >
        {hasHelpFaq && (
          <Menu.MenuItem
            onClick={() => openInNewTab(helpAndFaqURL)}
            className="select-item text-sm"
          >
            <LifeBuoy className="icon-md" aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem onClick={onShowShortcuts} className="select-item text-sm">
          <Keyboard className="icon-md" aria-hidden="true" />
          {localize('com_shortcut_keyboard_shortcuts')}
        </Menu.MenuItem>
        {showLegalDivider && (hasTos || hasPrivacy) && (
          <Menu.MenuSeparator className="bg-surface-hover -mx-1 my-1 h-px border-0" />
        )}
        {hasTos && (
          <Menu.MenuItem
            onClick={() => openInNewTab(termsOfServiceURL)}
            className="select-item text-sm"
          >
            <Scale className="icon-md" aria-hidden="true" />
            {localize('com_ui_terms_of_service')}
          </Menu.MenuItem>
        )}
        {hasPrivacy && (
          <Menu.MenuItem
            onClick={() => openInNewTab(privacyPolicyURL)}
            className="select-item text-sm"
          >
            <ShieldCheck className="icon-md" aria-hidden="true" />
            {localize('com_ui_privacy_policy')}
          </Menu.MenuItem>
        )}
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { privacyPolicyUrl, termsOfServiceUrl } = policyUrls(startupConfig);
  const setShowSettings = useSetAtom(settingsOpenAtom);
  const setShowShortcutsDialog = useSetRecoilState(store.showShortcutsDialog);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);
  /** The collapsed rail opens the menu beside it, toward the content. */
  const railSide = inlineSide(useDirection(), 'end');

  return (
    <Menu.MenuProvider placement={collapsed ? `${railSide}-end` : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={
          collapsed
            ? 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-9 w-9 items-center justify-center rounded-lg transition-colors'
            : 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out'
        }
      >
        <div className={collapsed ? 'size-7 shrink-0' : 'h-8 w-8 shrink-0'}>
          <div className="relative flex">
            <Avatar user={user} size={collapsed ? 28 : 32} />
          </div>
        </div>
        {!collapsed && (
          <div className="text-text-primary grow overflow-hidden text-start text-ellipsis whitespace-nowrap">
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="popover-ui z-[125] w-[min(19.0625rem,90vw)] md:w-[min(15.25rem,90vw)]"
        style={{
          transformOrigin: collapsed
            ? `${railSide === 'right' ? 'left' : 'right'} bottom`
            : 'bottom',
          translate: collapsed ? `${railSide === 'right' ? 4 : -4}px 0` : '0 -4px',
        }}
      >
        <div className="text-text-secondary ms-3 me-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <Menu.MenuSeparator className="bg-surface-hover -mx-1 my-1 h-px border-0" />
        <HelpSubmenu
          helpAndFaqURL={startupConfig?.helpAndFaqURL}
          termsOfServiceURL={termsOfServiceUrl}
          privacyPolicyURL={privacyPolicyUrl}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
        />
        {/* BioHarness: changed from LibreChat v0.8.9. Archived chats and My files are stored by
            LibreChat's server and are not offered. Log out is not offered either: the session is
            an HttpOnly cookie that only the service can end, and it has no sign-out route yet. */}
        <Menu.MenuItem
          onClick={() => setShowSettings(true)}
          className="select-item text-sm"
          data-testid="nav-settings"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);

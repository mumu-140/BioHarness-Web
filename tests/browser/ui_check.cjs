// Drives the adopted frontend (ui/client/dist) served by the BioHarness backend (read-only mode,
// no model runtime configured) in headless Chromium. Verifies C1 (CSP + gate), C2 (SPA deep-link
// reload returns 200), C3 (zero Service Workers), C4 (clean exit + server access log), and honest
// read-only workspace/models UI without any donor backend.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE, TOKEN = process.env.TOKEN;
const APPROVED = [
  ['GET', /^\/api\/meta$/],
  ['GET', /^\/api\/health$/],
  ['POST', /^\/api\/session$/],
  ['GET', /^\/api\/settings\/models$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/views\/(open|now|tree)$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/stream$/],
];
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const reqs = [], pageErrors = [], cspErrors = [];
  ctx.on('request', r => reqs.push({ m: r.method(), u: r.url(), t: r.resourceType() }));
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 300)));
  page.on('console', m => {
    const txt = m.text();
    if (/Content Security Policy/i.test(txt)) cspErrors.push(txt.slice(0, 300));
  });
  const shot = name => page.screenshot({ path: `/qa/out/${name}.png` });
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  try {
    // ---- signed out + C1 CSP header ----
    const rootRes = await page.goto(BASE + '/', { waitUntil: 'load' });
    const cspHeader = (rootRes && rootRes.headers()['content-security-policy']) || '';
    check('C1 response carries strict same-origin CSP header',
      cspHeader.includes("default-src 'self'") && cspHeader.includes("connect-src 'self'") && cspHeader.includes("frame-ancestors 'self'"),
      cspHeader.slice(0, 200));

    const field = page.locator('#password');
    await field.waitFor({ timeout: 20000 });
    check('signed-out visit lands on the sign-in page', new URL(page.url()).pathname === '/login', page.url());
    check('sign-in asks for the service access token only',
      await page.locator('#email').count() === 0 && await page.getByLabel('Service access token').count() > 0);
    check('no registration, password-reset or social sign-in is offered',
      await page.locator('a[href*="register"], a[href*="forgot-password"], a[href*="oauth"]').count() === 0);
    await shot('ui-1-sign-in');

    await field.fill('wrong-token-000000000');
    await page.getByTestId('login-button').click();
    await page.getByRole('alert').first().waitFor({ timeout: 10000 });
    check('a wrong token is refused and stays on sign-in', new URL(page.url()).pathname === '/login');
    check('no session cookie after a refused token', (await ctx.cookies()).length === 0);

    // ---- signed in ----
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.waitForURL('**/c/new*', { timeout: 20000 });
    await page.getByTestId('app-pane').waitFor({ timeout: 20000 });
    await page.getByTestId('bh-workspace-select').waitFor({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot('ui-2-app');
    check('the donor application shell and BioHarness sidebar render after sign-in',
      await page.getByTestId('app-pane').count() === 1 && await page.getByTestId('nav-user').isVisible() && await page.getByTestId('bh-open-requests-list').count() === 1);
    check('donor chat-project folders are not shown', await page.getByText('New project').count() === 0);
    const cookies = await ctx.cookies();
    check('the session is one HttpOnly SameSite=Strict cookie without the token',
      cookies.length === 1 && cookies[0].httpOnly && cookies[0].sameSite === 'Strict' && !cookies[0].value.includes(TOKEN),
      JSON.stringify(cookies.map(c => [c.name, c.httpOnly, c.sameSite])));
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie);
    check('the access token is not in browser storage or script-readable cookies', !stored.includes(TOKEN));

    // ---- C3: no donor service worker registered ----
    const swCount = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 0;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length;
    });
    check('C3 no donor service worker is registered', swCount === 0, `registrations=${swCount}`);

    // ---- read-only mode honestly reports disabled runtime & disables composer ----
    check('read-only service honestly reports runtime disabled and disables composer',
      await page.getByTestId('bh-runtime-unavailable').count() === 1 &&
      await page.getByTestId('bh-composer-input').isDisabled());
    check('no microphone or speech control is offered',
      await page.locator('#audio-recorder, [data-testid="audio-recorder"], button[aria-label*="microphone" i]').count() === 0);

    // ---- the gate, exercised from inside the page ----
    const gate = await page.evaluate(async () => {
      const attempt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return 'REFUSED'; } };
      return {
        apiRoot: await attempt(() => fetch('/api')),
        donor: await attempt(() => fetch('/api/convos')),
        donorAgents: await attempt(() => fetch('/api/agents/chat/active')),
        external: await attempt(() => fetch('https://example.com/collect')),
        xhr: await attempt(() => { const x = new XMLHttpRequest(); x.open('GET', '/api/user'); x.send(); }),
        xhrExternal: await attempt(() => { const x = new XMLHttpRequest(); x.open('POST', 'https://example.com/x'); }),
        sse: await attempt(() => { new EventSource('/api/agents/chat/stream/abc'); }),
        wsExternal: await attempt(() => { new WebSocket('wss://example.com/ws'); }),
        beacon: navigator.sendBeacon('https://example.com/b', 'x') ? 'ALLOWED' : 'REFUSED',
        approved: await attempt(async () => { const r = await fetch('/api/health'); if (!r.ok) throw new Error(); }),
      };
    });
    check('unmapped, donor and external requests are refused in the page; an approved one passes',
      Object.entries(gate).every(([k, v]) => v === (k === 'approved' ? 'ALLOWED' : 'REFUSED')), JSON.stringify(gate));

    const refusals = await page.evaluate(() => window.__bioharnessHostRefusals || []);
    fs.writeFileSync('/qa/out/refusals.json', JSON.stringify(refusals, null, 1));

    // ---- settings: donor dialog works with Models, General and Chat tabs ----
    await page.getByTestId('nav-user').click().catch(() => {});
    const menuItems = (await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim());
    check('the account menu offers no donor archive, files or sign-out action',
      menuItems.length > 0 && !menuItems.some(t => /archiv|files|log ?out/i.test(t)), menuItems.join('|'));
    const settingsItem = page.getByTestId('nav-settings');
    if (await settingsItem.count()) {
      await settingsItem.click();
      const settingsDialog = page.getByRole('dialog').last();
      await settingsDialog.getByRole('tab').first().waitFor({ timeout: 8000 });
      const tabs = (await settingsDialog.getByRole('tab').allInnerTexts()).map(t => t.trim());
      check('settings open with Models, General and Chat tabs',
        tabs.includes('Models') && tabs.includes('General') && tabs.includes('Chat'), tabs.join('|'));
      check('Speech, Data controls and Account settings are not offered',
        !tabs.some(t => /speech|data|account/i.test(t)), tabs.join('|'));
      await page.getByRole('tab', { name: 'Models' }).click();
      await page.getByTestId('bh-models-settings').waitFor({ timeout: 8000 });
      check('Models settings tab renders BioHarness model configuration',
        await page.getByTestId('bh-models-active-chat').count() === 1);
      await shot('ui-4-settings');
      await page.keyboard.press('Escape');
    } else {
      check('settings dialog can be opened from the account menu', false, 'account menu entry not found');
    }

    // ---- removed donor routes are not mounted ----
    for (const path of ['/register', '/agents', '/share/abc', '/d/prompts', '/skills']) {
      await page.evaluate(p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
      await page.waitForTimeout(500);
      const text = await bodyText();
      check(`donor route ${path} is not mounted`, /404|not found/i.test(text), text.slice(0, 120));
    }

    // ---- C2: direct visit / reload to /c/new returns 200 and resumes cookie session ----
    const deep = await page.goto(BASE + '/c/new?ws=fixture', { waitUntil: 'load' });
    await page.getByTestId('app-pane').waitFor({ timeout: 20000 });
    await page.getByTestId('bh-workspace-select').waitFor({ timeout: 15000 });
    fs.writeFileSync('/qa/out/deep-link.json', JSON.stringify({ path: '/c/new?ws=fixture', status: deep.status() }));
    check('C2 deep-link reload to /c/new?ws=fixture returns 200 and resumes session',
      deep.status() === 200 && await page.locator('#password').count() === 0 && await page.getByTestId('bh-workspace-select').count() === 1,
      `status=${deep.status()}`);

    // ---- narrow screen: donor drawer navigation ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    check('narrow screen switches the donor sidebar to drawer mode',
      await page.evaluate(() => document.documentElement.hasAttribute('data-drawer-nav')));
    check('no horizontal overflow at 390 px',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot('ui-5-narrow');
  } catch (e) {
    check('browser script completed', false, e.message.slice(0, 500));
    await shot('ui-failure').catch(() => {});
  }

  // ---- every request the browser context made ----
  const origin = new URL(BASE).origin;
  const external = reqs.filter(r => !/^(data|blob):/.test(r.u) && new URL(r.u).origin !== origin);
  check('no request left the BioHarness origin', external.length === 0, [...new Set(external.map(r => r.u))].join(' '));
  const api = reqs.filter(r => new URL(r.u).origin === origin && new URL(r.u).pathname.startsWith('/api'));
  const unapproved = api.filter(r => !APPROVED.some(([m, p]) => m === r.m && p.test(new URL(r.u).pathname)));
  check('only approved BioHarness API paths were requested', unapproved.length === 0,
    [...new Set(unapproved.map(r => r.m + ' ' + new URL(r.u).pathname))].join(', '));
  const stray = reqs.filter(r => new URL(r.u).origin === origin && !new URL(r.u).pathname.startsWith('/api') && r.m !== 'GET');
  check('static files were only read', stray.length === 0, JSON.stringify(stray.slice(0, 5)));
  check('no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
  check('C1 no Content Security Policy console violations', cspErrors.length === 0, cspErrors.join(' | '));
  fs.writeFileSync('/qa/out/network.json', JSON.stringify({
    total: reqs.length,
    api: [...new Set(api.map(r => r.m + ' ' + new URL(r.u).pathname))],
    documents: [...new Set(reqs.filter(r => r.t === 'document').map(r => new URL(r.u).pathname))],
  }, null, 1));
  fs.writeFileSync('/qa/out/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();

// Drives the adopted frontend (ui/client/dist) served by the unchanged BioHarness backend in
// headless Chromium. Run through tests/browser/ui_run.sh. Roadmap §17.4 step 2: the donor
// application starts, signs in and stays inside the approved BioHarness API without a donor
// backend. It does not test research conversations; those arrive with step 3.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE, TOKEN = process.env.TOKEN;
const APPROVED = [['GET', /^\/api\/meta$/], ['GET', /^\/api\/health$/], ['POST', /^\/api\/session$/]];
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const reqs = [], pageErrors = [];
  ctx.on('request', r => reqs.push({ m: r.method(), u: r.url(), t: r.resourceType() }));
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 300)));
  const shot = name => page.screenshot({ path: `/qa/out/${name}.png` });
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  try {
    // ---- signed out ----
    await page.goto(BASE + '/', { waitUntil: 'load' });
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
    await page.waitForURL('**/c/new', { timeout: 20000 });
    await page.getByTestId('app-pane').waitFor({ timeout: 20000 });
    await page.waitForTimeout(6000); // let every start-up query of the donor settle
    await shot('ui-2-app');
    check('the donor application shell renders after sign-in',
      await page.getByTestId('app-pane').count() === 1 && await page.getByTestId('nav-user').isVisible());
    check('donor chat-project folders are not shown', await page.getByText('New project').count() === 0);
    const cookies = await ctx.cookies();
    check('the session is one HttpOnly SameSite=Strict cookie without the token',
      cookies.length === 1 && cookies[0].httpOnly && cookies[0].sameSite === 'Strict' && !cookies[0].value.includes(TOKEN),
      JSON.stringify(cookies.map(c => [c.name, c.httpOnly, c.sameSite])));
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie);
    check('the access token is not in browser storage or script-readable cookies', !stored.includes(TOKEN));

    // ---- donor calls the host declined ----
    const refusals = await page.evaluate(() => window.__bioharnessHostRefusals || []);
    check('donor start-up calls without a BioHarness mapping were refused locally', refusals.length > 0, refusals.join(', '));
    fs.writeFileSync('/qa/out/refusals.json', JSON.stringify(refusals, null, 1));
    check('the conversation list reports a load failure instead of an empty list',
      await page.getByTestId('convo-list-error').count() === 1);
    check('no microphone or speech control is offered',
      await page.locator('#audio-recorder, [data-testid="audio-recorder"], button[aria-label*="microphone" i]').count() === 0);

    // ---- the gate, exercised from inside the page ----
    const gate = await page.evaluate(async () => {
      const attempt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return 'REFUSED'; } };
      return {
        runs: await attempt(() => fetch('/api/workspaces/fixture/conversations', { method: 'POST', body: '{}' })),
        apiRoot: await attempt(() => fetch('/api')),
        donor: await attempt(() => fetch('/api/convos')),
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

    // ---- composer: unavailable until the runtime is connected, and says so ----
    const text = await bodyText();
    check('the composer states that no model is available instead of accepting input',
      /Unable to load this chat/i.test(text) && await page.locator('form textarea:not([disabled])').count() === 0, text.slice(0, 200));

    // ---- settings: donor dialog works, unavailable tabs are absent ----
    await page.getByTestId('nav-user').click().catch(() => {});
    const menuItems = (await page.getByRole('menuitem').allInnerTexts()).map(t => t.trim());
    check('the account menu offers no donor archive, files or sign-out action',
      menuItems.length > 0 && !menuItems.some(t => /archiv|files|log ?out/i.test(t)), menuItems.join('|'));
    const settingsItem = page.getByTestId('nav-settings');
    if (await settingsItem.count()) {
      await settingsItem.click();
      await page.getByRole('tab').first().waitFor({ timeout: 8000 });
      const tabs = (await page.getByRole('tab').allInnerTexts()).map(t => t.trim());
      check('settings open with donor General and Chat tabs', tabs.includes('General') && tabs.includes('Chat'), tabs.join('|'));
      check('Speech, Data controls and Account settings are not offered',
        !tabs.some(t => /speech|data|account/i.test(t)), tabs.join('|'));
      await shot('ui-4-settings');
      await page.keyboard.press('Escape');
    } else {
      check('settings dialog can be opened from the account menu', false, 'account menu entry not found');
    }

    // ---- removed donor routes are not mounted ----
    for (const path of ['/register', '/agents', '/share/abc', '/d/prompts', '/skills']) {
      await page.evaluate(p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
      await page.waitForTimeout(700);
      const text = await bodyText();
      check(`donor route ${path} is not mounted`, /404|not found/i.test(text), text.slice(0, 120));
    }

    // ---- narrow screen: donor drawer navigation ----
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForURL('**/c/new', { timeout: 20000 });
    check('reopening the service resumes the cookie session without signing in again',
      await page.locator('#password').count() === 0 && await page.getByTestId('app-pane').count() === 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    check('narrow screen switches the donor sidebar to drawer mode',
      await page.evaluate(() => document.documentElement.hasAttribute('data-drawer-nav')));
    check('no horizontal overflow at 390 px',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot('ui-5-narrow');

    // ---- known gap, recorded not asserted: deep links need a backend page fallback ----
    const deep = await page.goto(BASE + '/c/new', { waitUntil: 'load' });
    fs.writeFileSync('/qa/out/deep-link.json', JSON.stringify({ path: '/c/new', status: deep.status() }));
  } catch (e) {
    check('browser script completed', false, e.message.slice(0, 500));
    await shot('ui-failure').catch(() => {});
  }

  // ---- every request the browser context made ----
  const origin = new URL(BASE).origin;
  const external = reqs.filter(r => !/^(data|blob):/.test(r.u) && new URL(r.u).origin !== origin);
  check('no request left the BioHarness origin', external.length === 0, [...new Set(external.map(r => r.u))].join(' '));
  const api = reqs.filter(r => new URL(r.u).origin === origin && new URL(r.u).pathname.startsWith('/api/'));
  const unapproved = api.filter(r => !APPROVED.some(([m, p]) => m === r.m && p.test(new URL(r.u).pathname)));
  check('only approved BioHarness API paths were requested', unapproved.length === 0,
    [...new Set(unapproved.map(r => r.m + ' ' + new URL(r.u).pathname))].join(', '));
  const stray = reqs.filter(r => new URL(r.u).origin === origin && !new URL(r.u).pathname.startsWith('/api/') && r.m !== 'GET');
  check('static files were only read', stray.length === 0, JSON.stringify(stray.slice(0, 5)));
  check('no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
  fs.writeFileSync('/qa/out/network.json', JSON.stringify({
    total: reqs.length,
    api: [...new Set(api.map(r => r.m + ' ' + new URL(r.u).pathname))],
    documents: [...new Set(reqs.filter(r => r.t === 'document').map(r => new URL(r.u).pathname))],
  }, null, 1));
  fs.writeFileSync('/qa/out/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();

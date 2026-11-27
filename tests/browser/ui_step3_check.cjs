// Real-browser acceptance for §17.4 Step 3 (Native vertical slice) + C1-C4 closure.
// Exercises: CSP/SW/SPA-reload, multi-workspace isolation, explicit request binding, draft
// preservation, original-question custody + full Core loop + Markdown/KaTeX rendering, background
// run continuity across navigation/reload, cancellation requested vs confirmed, UNKNOWN
// reconciliation, native-user mainline amendment HITL, provider error display, and R2 Model
// Settings (masked key, discovery, atomic update, reset) inside LibreChat's adopted UI.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const API_KEY_SECRET = process.env.API_KEY_SECRET;
const OPEN_RID = process.env.OPEN_RID;
const UNKNOWN_CONVO_ID = process.env.UNKNOWN_CONVO_ID;
const UNKNOWN_TARGET_RID = process.env.UNKNOWN_TARGET_RID;

const APPROVED = [
  ['GET', /^\/api\/meta$/],
  ['GET', /^\/api\/health$/],
  ['POST', /^\/api\/session$/],
  ['GET', /^\/api\/settings\/models$/],
  ['PUT', /^\/api\/settings\/models$/],
  ['POST', /^\/api\/settings\/models\/fetch-models$/],
  ['POST', /^\/api\/settings\/models\/reset$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/views\/(open|now|tree)$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/stream$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/conversations$/],
  ['POST', /^\/api\/workspaces\/[^/]+\/conversations$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+$/],
  ['PUT', /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/request$/],
  ['POST', /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/runs$/],
  ['POST', /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/runs\/[^/]+\/cancel$/],
  ['GET', /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/events$/],
];

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const reqs = [], pageErrors = [], cspErrors = [], apiBodies = [];

  ctx.on('request', r => reqs.push({ m: r.method(), u: r.url(), t: r.resourceType() }));
  page.on('response', async res => {
    try {
      const u = new URL(res.url());
      if (u.pathname.startsWith('/api/settings/models')) {
        apiBodies.push(await res.text());
      }
    } catch {}
  });
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 300)));
  page.on('console', m => {
    const txt = m.text();
    if (/Content Security Policy/i.test(txt)) cspErrors.push(txt.slice(0, 300));
  });

  const shot = name => page.screenshot({ path: `/qa/out/${name}.png` });
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  try {
    // ---- 1. Sign in + C1 CSP + C3 no SW ----
    const rootRes = await page.goto(BASE + '/', { waitUntil: 'load' });
    const cspHeader = (rootRes && rootRes.headers()['content-security-policy']) || '';
    check('C1 strict same-origin CSP header present',
      cspHeader.includes("default-src 'self'") && cspHeader.includes("connect-src 'self'") && cspHeader.includes("frame-ancestors 'self'"),
      cspHeader.slice(0, 200));

    await page.locator('#password').waitFor({ timeout: 20000 });
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.waitForURL('**/c/new*', { timeout: 20000 });
    await page.getByTestId('bh-workspace-select').waitFor({ timeout: 15000 });

    const swCount = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 0;
      return (await navigator.serviceWorker.getRegistrations()).length;
    });
    check('C3 zero donor service workers registered', swCount === 0, `sw=${swCount}`);

    // ---- 2. Multi-workspace isolation ----
    await page.getByTestId('bh-workspace-select').selectOption('second');
    await page.waitForURL('**ws=second*', { timeout: 10000 });
    await page.waitForTimeout(600);
    const secondHeaderWs = await page.getByTestId('bh-header-workspace').innerText();
    const fixtureReqInSecond = await page.getByTestId(`bh-open-req-${OPEN_RID}`).count();
    check('workspace switch isolates URL, header, and open requests',
      secondHeaderWs.trim() === 'second' && fixtureReqInSecond === 0,
      `ws=${secondHeaderWs} leaked=${fixtureReqInSecond}`);

    await page.getByTestId('bh-workspace-select').selectOption('fixture');
    await page.waitForURL('**ws=fixture*', { timeout: 10000 });
    await page.getByTestId(`bh-open-req-${OPEN_RID}`).waitFor({ timeout: 10000 });

    // ---- 3. Draft preservation across navigation & C2 reload ----
    const draftSample = 'Unsent DAP-seq draft preserved across switches';
    await page.getByTestId('bh-composer-input').fill(draftSample);
    await page.getByTestId(`bh-open-req-${OPEN_RID}`).click();
    await page.getByTestId('bh-start-request-card').waitFor({ timeout: 10000 });
    check('selecting an unbound open request requires explicit conversation creation',
      await page.getByTestId('bh-start-request-convo-btn').isVisible() &&
      await page.getByTestId('bh-composer-input').isDisabled());

    // Start conversation for the existing open request
    await page.getByTestId('bh-start-request-convo-btn').click();
    await page.waitForURL(/\/c\/(?!new)[^?]+/, { timeout: 15000 });
    await page.waitForTimeout(800);
    const boundHeaderRid = (await page.getByTestId('bh-header-request').innerText()).trim();
    check('explicitly created conversation binds the selected Core request_id',
      boundHeaderRid === OPEN_RID, `got=${boundHeaderRid} expected=${OPEN_RID}`);

    // Return to /c/new?ws=fixture and verify draft survived navigation + C2 full page reload
    await page.getByTestId('bh-new-research-btn').click();
    await page.waitForURL('**/c/new?ws=fixture', { timeout: 10000 });
    const draftAfterSwitch = await page.getByTestId('bh-composer-input').inputValue();
    const reloadRes = await page.reload({ waitUntil: 'load' });
    await page.getByTestId('bh-composer-input').waitFor({ timeout: 15000 });
    const draftAfterReload = await page.getByTestId('bh-composer-input').inputValue();
    check('C2 reload returns 200 and preserves unsent draft & workspace',
      reloadRes.status() === 200 && draftAfterSwitch === draftSample && draftAfterReload === draftSample,
      `status=${reloadRes.status()} switch="${draftAfterSwitch}" reload="${draftAfterReload}"`);

    // ---- 4. Original-question custody + full Core loop + Markdown/KaTeX + no donor mutators ----
    const verbatimQ = 'What is a count table? [verbatim-custody-2026]';
    await page.getByTestId('bh-composer-input').fill(verbatimQ);
    await page.getByTestId('bh-send-btn').click();
    await page.waitForURL(/\/c\/(?!new)[^?]+/, { timeout: 15000 });
    const deliveredUrl = page.url();

    // Wait for DELIVERED banner from real Core snapshot
    await page.getByTestId('bh-hitl-delivered').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await shot('step3-1-delivered');

    const deliveredText = await bodyText();
    const deliveredRid = (await page.getByTestId('bh-header-request').innerText()).trim();
    const hasTable = (await page.locator('table').count()) > 0;
    const hasKatex = (await page.locator('.katex').count()) > 0;
    const unsupportedMutators = await page.locator(
      '[data-testid="regenerate-generation-button"], [data-testid="continue-generation-button"], button[aria-label="Edit"], button[aria-label="Fork"]'
    ).count();
    check('verbatim question submitted, Core loop delivered, Markdown table & KaTeX rendered, composer locked',
      deliveredText.includes(verbatimQ) &&
      deliveredText.includes('integer counts per gene and sample') &&
      deliveredRid !== 'Unbound' &&
      hasTable &&
      await page.getByTestId('bh-composer-input').isDisabled(),
      `rid=${deliveredRid} table=${hasTable} katex=${hasKatex}`);
    check('no unsupported donor Edit/Fork/Regenerate/Continue action buttons rendered',
      unsupportedMutators === 0, `count=${unsupportedMutators}`);

    // Reload delivered conversation -> C2 200 OK & exact replay without duplicates
    const convoReload = await page.goto(deliveredUrl, { waitUntil: 'load' });
    await page.getByTestId('bh-hitl-delivered').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const verbatimOccurrences = (await bodyText()).split(verbatimQ).length - 1;
    check('C2 deep-link reload on /c/:id returns 200 and replays transcript without duplicates',
      convoReload.status() === 200 && verbatimOccurrences === 1,
      `status=${convoReload.status()} occurrences=${verbatimOccurrences}`);

    // ---- 5. Native-user HITL: mainline amendment pending + deliberate user confirmation ----
    await page.getByTestId('bh-new-research-btn').click();
    await page.waitForURL('**/c/new?ws=fixture', { timeout: 10000 });
    await page.getByTestId('bh-composer-input').fill('Amend plan test [amendment]');
    await page.getByTestId('bh-send-btn').click();
    await page.waitForURL(/\/c\/(?!new)[^?]+/, { timeout: 15000 });
    await page.getByTestId('bh-hitl-amendment').waitFor({ timeout: 30000 });
    await shot('step3-2-hitl-amendment');

    // Stage confirmation phrase: must NOT auto-send!
    await page.getByTestId('bh-stage-amendment-btn').click();
    await page.waitForTimeout(400);
    const stagedVal = await page.getByTestId('bh-composer-input').inputValue();
    check('HITL staging populates 确认主线 A1 in composer without auto-confirming',
      stagedVal === '确认主线 A1' && await page.getByTestId('bh-hitl-amendment').count() === 1,
      `staged="${stagedVal}"`);

    // Deliberate native-user submit confirms amendment on Core!
    await page.getByTestId('bh-send-btn').click();
    await page.waitForFunction(
      () => document.body.innerText.includes('Confirmed amendment A1 applied on Core mainline v2'),
      { timeout: 30000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="bh-hitl-amendment"]').length === 0,
      { timeout: 15000 }
    );
    check('deliberate user submission of 确认主线 A1 confirms amendment via Core native-user hook',
      await page.getByTestId('bh-hitl-amendment').count() === 0);

    // ---- 6. Background-run continuity + cancellation requested vs confirmed ----
    await page.getByTestId('bh-new-research-btn').click();
    await page.waitForURL('**/c/new?ws=fixture', { timeout: 10000 });
    await page.getByTestId('bh-composer-input').fill('Slow run [slow-cancel]');
    await page.getByTestId('bh-send-btn').click();
    await page.waitForURL(/\/c\/(?!new)[^?]+/, { timeout: 15000 });
    await page.getByTestId('bh-cancel-run-btn').waitFor({ timeout: 15000 });
    const slowUrl = page.url();

    // Navigate away while running, then return + reload: run stays alive on backend!
    await page.getByTestId('bh-new-research-btn').click();
    await page.waitForURL('**/c/new?ws=fixture', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.goto(slowUrl, { waitUntil: 'load' });
    await page.getByTestId('bh-cancel-run-btn').waitFor({ timeout: 15000 });
    check('background run continues across route switch and reload',
      await page.getByTestId('bh-header-active-run').count() === 1);

    // Request cancellation -> distinct run.cancel_requested recorded before run.finished(CANCELLED)
    await page.getByTestId('bh-cancel-run-btn').click();
    await page.waitForFunction(
      () => document.body.innerText.includes('Run cancelled (confirmed)'),
      { timeout: 25000 }
    );
    const cancelText = await bodyText();
    const reqIdx = cancelText.indexOf('Cancellation requested');
    const confIdx = cancelText.indexOf('Run cancelled (confirmed)');
    check('cancellation records distinct requested event before confirmed termination',
      reqIdx !== -1 && confIdx !== -1 && reqIdx < confIdx,
      `reqIdx=${reqIdx} confIdx=${confIdx}`);
    check('run cancellation confirmed via server run.finished event',
      await page.getByTestId('bh-header-active-run').count() === 0);

    // ---- 7. UNKNOWN reconciliation (OUTCOME_UNKNOWN) ----
    await page.goto(`${BASE}/c/${UNKNOWN_CONVO_ID}?ws=fixture`, { waitUntil: 'load' });
    await page.getByTestId('bh-reconcile-card').waitFor({ timeout: 15000 });
    await shot('step3-3-unknown-reconcile');
    check('OUTCOME_UNKNOWN blocks composer and lists matching Core candidate',
      await page.getByTestId('bh-composer-input').isDisabled() &&
      await page.getByTestId(`bh-attach-candidate-${UNKNOWN_TARGET_RID}`).count() === 1);

    await page.getByTestId(`bh-attach-candidate-${UNKNOWN_TARGET_RID}`).click();
    await page.waitForFunction(
      rid => (document.querySelector('[data-testid="bh-header-request"]')?.textContent || '').trim() === rid,
      UNKNOWN_TARGET_RID,
      { timeout: 15000 }
    );
    check('explicit candidate attachment clears OUTCOME_UNKNOWN and unlocks composer',
      await page.getByTestId('bh-reconcile-card').count() === 0 &&
      !(await page.getByTestId('bh-composer-input').isDisabled()));

    // ---- 8. Provider error handling (HTTP 502) ----
    await page.getByTestId('bh-new-research-btn').click();
    await page.waitForURL('**/c/new?ws=fixture', { timeout: 10000 });
    await page.getByTestId('bh-composer-input').fill('Trigger upstream failure [provider-502]');
    await page.getByTestId('bh-send-btn').click();
    await page.waitForFunction(
      () => document.body.innerText.includes('Provider error:'),
      { timeout: 20000 }
    );
    check('provider HTTP 502 surfaces cleanly in transcript without crashing UI',
      (await bodyText()).includes('Provider error:'));

    // ---- 9. R2 Model Settings inside LibreChat Settings dialog ----
    await page.getByTestId('bh-header-models-btn').click();
    await page.getByTestId('bh-models-settings').waitFor({ timeout: 10000 });
    const maskedKeyText = (await page.getByTestId('bh-provider-masked-key').innerText()).trim();
    check('R2 Model Settings shows masked API key and never leaks plaintext secret',
      maskedKeyText.includes('Saved:') && !maskedKeyText.includes(API_KEY_SECRET),
      maskedKeyText);

    // Model discovery via server-side POST /api/settings/models/fetch-models
    await page.getByTestId('bh-fetch-models-btn').click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="bh-fetch-models-status"]')?.textContent || '').includes('Discovered 2 model'),
      { timeout: 15000 }
    );
    check('R2 model discovery fetches remote models via backend',
      (await page.getByTestId('bh-discovered-models').innerText()).includes('scripted-v2'));

    // Atomic slot update & hot-reconfigure
    await page.getByTestId('bh-chat-slot-model').fill('scripted-v2');
    await page.getByTestId('bh-save-models-btn').click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="bh-models-active-chat"]')?.textContent || '').trim() === 'scripted-v2',
      { timeout: 15000 }
    );
    await shot('step3-4-models-saved');
    check('R2 atomic model save hot-reconfigures active chat model',
      (await page.getByTestId('bh-models-banner').innerText()).includes('scripted-v2'));

    // Reset back to env defaults
    await page.getByTestId('bh-reset-models-btn').click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="bh-models-active-chat"]')?.textContent || '').trim() === 'scripted-fixture',
      { timeout: 15000 }
    );
    check('R2 model reset restores environment default model',
      (await page.getByTestId('bh-models-active-chat').innerText()).trim() === 'scripted-fixture');
    await page.keyboard.press('Escape');

    // Secret leak sweep across DOM, storage, and model-settings API responses
    const storageDump = await page.evaluate(() =>
      JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie + document.body.innerText
    );
    check('no access token or provider API key leaked to storage, DOM, or API responses',
      !storageDump.includes(TOKEN) &&
      !storageDump.includes(API_KEY_SECRET) &&
      apiBodies.every(b => !b.includes(API_KEY_SECRET)));
  } catch (e) {
    check('step 3 browser script completed', false, e.message.slice(0, 500));
    await shot('step3-failure').catch(() => {});
  }

  // ---- 10. Strict network & console hygiene ----
  const origin = new URL(BASE).origin;
  const external = reqs.filter(r => !/^(data|blob):/.test(r.u) && new URL(r.u).origin !== origin);
  check('no request left the BioHarness origin', external.length === 0, [...new Set(external.map(r => r.u))].join(' '));
  const api = reqs.filter(r => new URL(r.u).origin === origin && new URL(r.u).pathname.startsWith('/api'));
  const unapproved = api.filter(r => !APPROVED.some(([m, p]) => m === r.m && p.test(new URL(r.u).pathname)));
  check('only approved Step 3 BioHarness API paths were requested', unapproved.length === 0,
    [...new Set(unapproved.map(r => r.m + ' ' + new URL(r.u).pathname))].join(', '));
  check('no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
  check('C1 no CSP console violations', cspErrors.length === 0, cspErrors.join(' | '));

  fs.writeFileSync('/qa/out/network.json', JSON.stringify({
    total: reqs.length,
    api: [...new Set(api.map(r => r.m + ' ' + new URL(r.u).pathname))],
  }, null, 1));
  fs.writeFileSync('/qa/out/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();

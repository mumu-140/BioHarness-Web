// Comprehensive Step 5 real-Chromium behavioral parity, theme, keyboard, narrow-screen,
// long-label, large-data, boundary/failure, SSE external-mutation, and server restart-recovery check.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const PROVIDER_KEY = process.env.PROVIDER_KEY;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR;
const MANIFEST = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, 'utf8'));
const CTRL = '/qa/ctrl';
const OUT = '/qa/out';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  const page = await context.newPage();

  const pageErrors = [];
  const cspViolations = [];
  const externalReqs = [];
  const donorApiReqs = [];
  const origin = new URL(BASE).origin;

  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Content Security Policy') || t.includes('violates the following Content Security Policy')) {
      cspViolations.push(t);
    }
  });
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (!u.startsWith(origin)) {
      externalReqs.push(u);
      return;
    }
    const p = new URL(u).pathname;
    if (p.startsWith('/api/') && !p.startsWith('/api/health') && !p.startsWith('/api/meta') &&
        !p.startsWith('/api/session') && !p.startsWith('/api/workspaces/') && !p.startsWith('/api/settings/models')) {
      donorApiReqs.push(p);
    }
  });

  try {
    // 1. Sign in
    await page.goto(BASE + '/');
    await page.getByLabel(/access token|服务访问令牌/i).fill(TOKEN);
    await page.getByRole('button', { name: /sign in|进入|continue/i }).click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 15000 });

    // 2. End-to-end journey: Chat submit/stream -> Workflow -> Evidence -> Return to same conversation + Back/Forward/Reload
    await page.getByTestId('bh-open-req-req-main').click();
    await page.getByTestId('bh-chat-route').waitFor({ timeout: 10000 });
    const startBtn = page.getByTestId('bh-start-request-convo-btn');
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
    }
    await page.getByTestId('bh-header-convo').waitFor({ timeout: 10000 });
    const journeyUrl = page.url();
    const journeyConvo = (await page.getByTestId('bh-header-convo').innerText()).trim();

    const composer = page.locator('textarea#prompt-textarea');
    await composer.waitFor({ timeout: 10000 });
    await composer.fill('Step 5 journey question: verify convergent BRCA1/TP53 markers');
    await page.getByTestId('send-button').click();
    await page.getByText('Step 5 verified assistant reply for:').first().waitFor({ timeout: 20000 });
    check('End-to-end chat submission & streaming completes', true, journeyConvo);

    // Navigate to Workflow tab -> inspect non-blocking Governance context & advisory review notes
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-workflow-governance-context').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-workflow-advisory-concerns').waitFor({ timeout: 10000 });
    check('Workflow shows non-blocking Governance context & advisory review notes', true);

    // Keyboard navigation on plan node: Enter on S1 -> Step detail -> open exact evidence
    const nodeS1 = page.getByTestId('bh-plan-node-S1');
    await nodeS1.waitFor({ timeout: 10000 });
    await nodeS1.press('Enter');
    await page.getByTestId('bh-step-detail').waitFor({ timeout: 10000 });
    check('Keyboard Enter on plan node opens Step detail', true);

    await page.getByTestId('bh-step-evidence-ev-large').click();
    await page.getByTestId('bh-ag-grid-container').waitFor({ timeout: 15000 });
    const largeDisclosure = await page.getByTestId('bh-table-disclosure').innerText();
    check('Large 2,500-row TSV renders bounded page in AG Grid without full-file dump',
      largeDisclosure.includes('1–100') && largeDisclosure.includes('2,500') && largeDisclosure.includes('loaded_rows_only'),
      largeDisclosure.replace(/\s+/g, ' ').slice(0, 120));

    // Return to exact same conversation via primary tab
    await page.getByTestId('bh-tab-conversation').click();
    await page.getByText('Step 5 verified assistant reply for:').first().waitFor({ timeout: 10000 });
    const returnedConvo = (await page.getByTestId('bh-header-convo').innerText()).trim();
    check('Return from Evidence restores exact same conversation & transcript', returnedConvo === journeyConvo, `${returnedConvo}==${journeyConvo}`);

    // Back / Forward / Reload navigation preserves explicit identity
    await page.goBack();
    await page.getByTestId('bh-ag-grid-container').waitFor({ timeout: 10000 });
    await page.goForward();
    await page.getByText('Step 5 verified assistant reply for:').first().waitFor({ timeout: 10000 });
    await page.reload();
    await page.getByText('Step 5 verified assistant reply for:').first().waitFor({ timeout: 15000 });
    check('Browser Back / Forward / Reload preserve exact workspace/request/conversation identity',
      (await page.getByTestId('bh-header-convo').innerText()).trim() === journeyConvo);

    // 3. Keyboard navigation on primary tablist (ArrowRight -> Workflow, End -> Evidence, Home -> Conversation)
    await page.getByTestId('bh-tab-conversation').press('ArrowRight');
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-tab-workflow').press('End');
    await page.getByTestId('bh-evidence-table-list').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-tab-evidence').press('Home');
    await page.getByTestId('bh-chat-route').waitFor({ timeout: 10000 });
    check('Keyboard ArrowRight/End/Home navigate primary tabs cleanly', true);

    // Fullscreen graph + Escape key exits fullscreen
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-plan-fullscreen-btn').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-plan-fullscreen-btn').click();
    const exitLabel = await page.getByTestId('bh-plan-fullscreen-btn').innerText();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterEscLabel = await page.getByTestId('bh-plan-fullscreen-btn').innerText();
    check('Escape key exits fullscreen workflow graph', /Exit/i.test(exitLabel) && !/Exit/i.test(afterEscLabel), `${exitLabel} -> ${afterEscLabel}`);

    // 4. Light & Dark theme verification across React Flow, AG Grid, and Monaco
    await page.evaluate(() => {
      localStorage.setItem('color-theme', 'dark');
    });
    await page.reload();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 15000 });
    const htmlDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const graphDark = await page.getByTestId('bh-plan-graph-canvas').getAttribute('data-theme-mode');
    await page.getByTestId('bh-tab-evidence').click();
    await page.getByTestId('bh-open-evidence-ev-large').click();
    await page.getByTestId('bh-ag-grid-container').waitFor({ timeout: 15000 });
    const gridDark = await page.getByTestId('bh-ag-grid-container').getAttribute('data-theme-mode');
    await page.getByTestId('bh-back-to-evidence-btn').click();
    await page.getByTestId('bh-open-evidence-ev-json').click();
    await page.getByTestId('bh-code-viewer').waitFor({ timeout: 15000 });
    const codeDark = await page.getByTestId('bh-code-viewer').getAttribute('data-theme-mode');
    check('Dark theme propagates cleanly to root, React Flow, AG Grid, and Monaco',
      htmlDark && graphDark === 'dark' && gridDark === 'dark' && codeDark === 'dark',
      `html=${htmlDark} graph=${graphDark} grid=${gridDark} code=${codeDark}`);

    await page.evaluate(() => { localStorage.setItem('color-theme', 'light'); });
    await page.reload();
    await page.getByTestId('bh-code-viewer').waitFor({ timeout: 15000 });
    const codeLight = await page.getByTestId('bh-code-viewer').getAttribute('data-theme-mode');
    check('Light theme restores cleanly on reload', codeLight === 'light', `code=${codeLight}`);

    // 5. External Core mutation reflected via SSE without manual reload + 503 stale snapshot retention
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 15000 });
    fs.writeFileSync(CTRL + '/mutate_s3', '1');
    await page.waitForFunction(() => {
      const n = document.querySelector('[data-testid="bh-plan-node-S3"]');
      return n && n.textContent && n.textContent.includes('DONE');
    }, { timeout: 15000 });
    check('External Core mutation updates workflow live via SSE without reload', true);

    // Transient Core 502/503 failure injection via real SSE source.stale retains last confirmed snapshot with stale banner + Refresh action, and recovers automatically via SSE!
    fs.writeFileSync(CTRL + '/fail_503', '1');
    await page.getByTestId('bh-workflow-stale-banner').waitFor({ timeout: 15000 });
    const staleRefreshVisible = await page.getByTestId('bh-workflow-stale-refresh-btn').isVisible();
    const apiFailStatus = await page.evaluate(async () => {
      const r = await fetch('/api/workspaces/fixture/views/now?request_id=req-main');
      return r.status;
    });
    const canvasStillVisible = await page.getByTestId('bh-plan-graph-canvas').isVisible();
    fs.unlinkSync(CTRL + '/fail_503');
    await page.getByTestId('bh-workflow-stale-banner').waitFor({ state: 'detached', timeout: 15000 });
    check('Transient Core failure triggers SSE source.stale with Refresh action, retains canvas, and recovers automatically via SSE',
      (apiFailStatus === 502 || apiFailStatus === 503) && canvasStillVisible && staleRefreshVisible,
      `apiStatus=${apiFailStatus} canvasStillVisible=${canvasStillVisible} refreshBtn=${staleRefreshVisible}`);

    // Request vs Scope evidence history distinction
    await page.getByTestId('bh-tab-evidence').click();
    await page.getByTestId('bh-evidence-table-list').waitFor({ timeout: 10000 });
    const siblingHiddenInReqMode = (await page.getByTestId('bh-evidence-row-ev-sibling').count()) === 0;
    await page.getByTestId('bh-evidence-mode-scope').click();
    await page.getByTestId('bh-evidence-row-ev-sibling').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-open-evidence-ev-sibling').click();
    await page.getByTestId('bh-code-viewer').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes('SCOPE_HISTORY_SIBLING_ONLY'), { timeout: 15000 });
    const headerReqUnchanged = (await page.getByTestId('bh-header-request').innerText()).trim() === 'req-main';
    check('Request vs Scope evidence history stays distinct and opens sibling anchor without rebinding selected request',
      siblingHiddenInReqMode && headerReqUnchanged,
      `hiddenInReq=${siblingHiddenInReqMode} headerReqUnchanged=${headerReqUnchanged}`);

    // 6. Failure & boundary states: empty plan, unavailable plan version, unscoped request, 12-step large DAG
    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-empty-plan');
    await page.getByTestId('bh-workflow-empty-plan').waitFor({ timeout: 10000 });
    check('Empty plan renders dedicated empty state distinct from error', true);

    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-no-ver');
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 10000 });
    const noVerText = await page.locator('main').innerText();
    check('Unavailable plan version disclosed explicitly without guessing',
      noVerText.includes('Plan version not exposed by owner'));

    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-unscoped');
    await page.getByTestId('bh-workflow-unscoped-note').waitFor({ timeout: 10000 });
    check('Unscoped request discloses absence of public Governance submission history', true);

    // Missing conversation binding warning keeps plan accessible (non-blocking!)
    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-main&convo=conv-nonexistent-999');
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 10000 });
    const missingBindWarn = await page.locator('main').innerText();
    check('Missing conversation binding warns honestly while keeping plan accessible',
      missingBindWarn.includes('not verified for this workspace/request'));

    // Large 12-step DAG performance & geometry
    const t0 = Date.now();
    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-large-dag');
    await page.getByTestId('bh-plan-node-L12').waitFor({ timeout: 10000 });
    const dagMs = Date.now() - t0;
    const dagNodes = await page.locator('[data-testid^="bh-plan-node-L"]').count();
    check('12-step multi-predecessor large DAG renders cleanly & swiftly', dagNodes === 12 && dagMs < 8000, `nodes=${dagNodes} ms=${dagMs}`);

    // 7. Multi-project Governance workspace: project list -> pick project -> back to All projects
    await page.getByTestId('bh-workspace-select').selectOption('multi');
    await page.getByTestId('bh-project-list').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-project-item-proj-alpha').click();
    await page.getByTestId('bh-tree-scope-alpha-leaf').waitFor({ timeout: 10000 });
    const ctxNote = await page.getByTestId('bh-tree-context-note').isVisible();
    await page.getByTestId('bh-projects-back-btn').click();
    await page.getByTestId('bh-project-list').waitFor({ timeout: 10000 });
    check('Multi-project Governance tree supports project selection, context note, and return to All projects', ctxNote);

    // 8. Cross-workspace isolation with identical evidence_id (ev-json)
    await page.getByTestId('bh-workspace-select').selectOption('second');
    await page.goto(BASE + '/w/evidence?ws=second&req=req-second-1');
    await page.getByTestId('bh-open-evidence-ev-json').click();
    await page.getByTestId('bh-code-viewer').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes('SECOND_WORKSPACE_ONLY'), { timeout: 15000 });
    const secBody = await page.locator('main').innerText();
    check('Cross-workspace isolation prevents fixture ev-json bleed into second workspace',
      secBody.includes('SECOND_WORKSPACE_ONLY') && !secBody.includes('BRCA1'));

    // 9. Binary & table boundary/security HTTP checks (symlink escape, wrong anchor, range 206/416, drift 409)
    const secChecks = await page.evaluate(async (m) => {
      const mkQ = (ev) => new URLSearchParams({
        request_id: 'req-main',
        submission_index: ev.evidence_id === 'ev-pdf' ? '1' : '2',
        evidence_id: ev.evidence_id,
        sha256: ev.sha256,
      }).toString();
      const rEscape = await fetch('/api/workspaces/fixture/evidence-content?' + mkQ(m.fixture['ev-escape']));
      const rWrongAnchor = await fetch('/api/workspaces/fixture/evidence-content?request_id=req-main&submission_index=1&evidence_id=no-such-ev&sha256=' + '0'.repeat(64));
      const rRangeOk = await fetch('/api/workspaces/fixture/evidence-content?' + mkQ(m.fixture['ev-pdf']), { headers: { Range: 'bytes=0-15' } });
      const rRangeBad = await fetch('/api/workspaces/fixture/evidence-content?' + mkQ(m.fixture['ev-pdf']), { headers: { Range: 'bytes=999999-1000005' } });
      const rDrift = await fetch('/api/workspaces/fixture/evidence-content?' + mkQ(m.fixture['ev-drift']));
      return {
        escape: rEscape.status,
        escapeText: (await rEscape.text()).slice(0, 120),
        wrongAnchor: rWrongAnchor.status,
        rangeOk: rRangeOk.status,
        rangeHeader: rRangeOk.headers.get('content-range'),
        rangeBad: rRangeBad.status,
        drift: rDrift.status,
      };
    }, MANIFEST);
    check('Symlink escape outside workspace root is strictly refused (never serves secret)',
      secChecks.escape >= 400 && !secChecks.escapeText.includes('SECRET_OUTSIDE_WORKSPACE'),
      JSON.stringify({ status: secChecks.escape }));
    check('Wrong anchor, valid 206 Range, out-of-bounds 416 Range, and 409 drift behave strictly',
      secChecks.wrongAnchor >= 400 && secChecks.rangeOk === 206 && secChecks.rangeBad === 416 && secChecks.drift === 409,
      JSON.stringify(secChecks));

    // 10. Narrow screen (390x844) + long labels + mobile drawer + list default + zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/w/workflow?ws=fixture&req=req-main');
    await page.getByTestId('bh-plan-list-view').waitFor({ timeout: 10000 });
    const mobileBtn = page.getByTestId('header-open-sidebar-button');
    const mobileBtnVisible = await mobileBtn.isVisible();
    const overflowWf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await mobileBtn.click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 8000 });
    check('Narrow screen (390x844) opens drawer, defaults workflow to dependency list, zero overflow on 180-char label',
      mobileBtnVisible && overflowWf <= 2, `drawerBtn=${mobileBtnVisible} overflow=${overflowWf}px`);

    // 11. REAL SERVER PROCESS RESTART RECOVERY
    await page.setViewportSize({ width: 1440, height: 920 });
    if (fs.existsSync(CTRL + '/restart_done')) fs.unlinkSync(CTRL + '/restart_done');
    fs.writeFileSync(CTRL + '/restart_request', '1');
    const restartStart = Date.now();
    while (!fs.existsSync(CTRL + '/restart_done')) {
      if (Date.now() - restartStart > 30000) throw new Error('Timed out waiting for server restart');
      await page.waitForTimeout(250);
    }

    // Reload our earlier journey conversation after real uvicorn process restart!
    await page.goto(journeyUrl);
    await page.getByText('Step 5 verified assistant reply for:').first().waitFor({ timeout: 15000 });
    const convosAfterRestart = await page.evaluate(async () => {
      const r = await fetch('/api/workspaces/fixture/conversations');
      return r.json();
    });
    const convoArr = Array.isArray(convosAfterRestart) ? convosAfterRestart : (convosAfterRestart.conversations || []);
    const interruptedCount = convoArr.filter((c) => c.last_run_state === 'INTERRUPTED').length;
    const stillRunning = convoArr.filter((c) => c.last_run_state === 'RUNNING').length;
    // Submit a follow-up message after restart to confirm live operation continues seamlessly
    const postComposer = page.locator('textarea#prompt-textarea');
    await postComposer.waitFor({ timeout: 10000 });
    await postComposer.fill('Post-restart continuation check');
    await page.getByTestId('send-button').click();
    await page.getByText('Step 5 verified assistant reply for: Post-restart continuation check').waitFor({ timeout: 20000 });
    check('Real server restart recovers interrupted runs (INTERRUPTED, 0 stuck RUNNING), preserves history, and continues seamlessly',
      interruptedCount >= 2 && stillRunning === 0,
      `interrupted=${interruptedCount} stuckRunning=${stillRunning}`);

    // 12. Security, egress, CSP, SW, secret/path leakage
    const swCount = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0));
    const domHtml = await page.content();
    const leaked = domHtml.includes(TOKEN) || domHtml.includes(PROVIDER_KEY) || domHtml.includes(WORKSPACE_DIR);
    check('Zero external egress requests', externalReqs.length === 0, externalReqs.slice(0, 4).join(', '));
    check('Zero unauthorized donor API requests', donorApiReqs.length === 0, donorApiReqs.slice(0, 4).join(', '));
    check('Zero CSP violations', cspViolations.length === 0, cspViolations.slice(0, 2).join(' | '));
    check('Zero uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    check('Zero donor service workers registered', swCount === 0, `sw=${swCount}`);
    check('Zero token, provider key, or server path leaked to DOM', !leaked);
  } catch (err) {
    check('Step 5 browser suite completed cleanly', false, `${page.url()} :: ${err && err.message ? err.message : String(err)}`);
  } finally {
    fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
    await browser.close();
  }
})();

const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE_URL = process.env.BASE_URL;
const TOKEN = process.env.TOKEN;
const PROVIDER_KEY = process.env.PROVIDER_KEY;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();

  const externalUrls = [];
  const apiHits = new Set();
  const pageErrors = [];
  const cspViolations = [];
  let pdfContentRequests = 0;

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    const txt = msg.text();
    if (/Content Security Policy|Refused to/i.test(txt)) {
      cspViolations.push(txt);
    }
  });
  context.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(BASE_URL) && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('about:')) {
      externalUrls.push(url);
    }
    if (url.startsWith(BASE_URL + '/api/')) {
      const u = new URL(url);
      apiHits.add(`${req.method()} ${u.pathname}`);
      if (u.pathname.endsWith('/evidence-content')) {
        pdfContentRequests += 1;
      }
    }
  });

  try {
    // 1. Sign in via real login form
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="password"], input[name="password"]').first().fill(TOKEN);
    await page.locator('button[type="submit"]').first().click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });

    // 2. Research Tree (@rc-component/tree 1.5.3): arbitrary-depth hierarchy + keyboard nav + selection
    await page.getByTestId('bh-research-tree').waitFor({ timeout: 15000 });
    const hasDepth3 =
      (await page.getByTestId('bh-tree-scope-proj-genomics').isVisible()) &&
      (await page.getByTestId('bh-tree-scope-sub-rnaseq').isVisible()) &&
      (await page.getByTestId('bh-tree-scope-leaf-deg').isVisible()) &&
      (await page.getByTestId('bh-tree-req-req-s4-1').isVisible());
    check('Research tree renders 3-level Governance scope & request hierarchy', hasDepth3);

    const treeDraggableCount = await page.locator('[data-testid="bh-research-tree"] [draggable="true"]').count();
    check('Research tree enforces draggable=false', treeDraggableCount === 0, `draggable=${treeDraggableCount}`);

    // Click req-s4-1 in tree -> opens explicit request start card -> start conversation
    await page.getByTestId('bh-tree-req-req-s4-1').click();
    await page.getByTestId('bh-start-request-convo-btn').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-start-request-convo-btn').click();
    await page.waitForURL(/\/c\/(?!new)/, { timeout: 15000 });
    const convoUrl = new URL(page.url());
    const convoId = convoUrl.pathname.split('/c/')[1];
    check('Tree request click creates bound conversation cleanly', Boolean(convoId && convoId !== 'new'), convoId);

    // Send an initial quick turn so execution records have invocations!
    await page.getByTestId('bh-composer-input').fill('Initial check');
    await page.getByTestId('send-button').click();
    await page.getByText('Initial step4 reply ready.').waitFor({ timeout: 20000 });

    // 3. Switch to Research workflow tab: React Flow + Dagre diamond DAG
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 20000 });
    await page.getByTestId('bh-plan-node-S4').waitFor({ timeout: 15000 });
    const nodeCount = await page.locator('[data-testid^="bh-plan-node-"]').count();
    const edgeCount = await page.locator('.react-flow__edge').count();
    check('React Flow + Dagre renders all 4 steps and 4 multi-predecessor depends_on edges', nodeCount === 4 && edgeCount === 4, `nodes=${nodeCount} edges=${edgeCount}`);

    // Toggle List view & back to Graph
    await page.getByTestId('bh-plan-mode-list').click();
    await page.getByTestId('bh-plan-list-item-S4').waitFor({ timeout: 10000 });
    const listText = await page.getByTestId('bh-plan-list-item-S4').innerText();
    check('Dependency-labelled list view shows multi-predecessor depends_on (S2, S3)', listText.includes('S2') && listText.includes('S3'));

    // Enter Step S4 detail (replaces plan canvas!)
    await page.getByTestId('bh-plan-list-item-S4').click();
    await page.getByTestId('bh-step-detail').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-step-evidence-ev-pdf').waitFor({ timeout: 15000 });
    const canvasGone = (await page.getByTestId('bh-plan-graph-canvas').count()) === 0;
    const detailText = await page.getByTestId('bh-step-detail').innerText();
    check('Step detail replaces plan canvas with full step metadata & submissions', canvasGone && detailText.includes('Confirm overlap across independent analyses') && detailText.includes('ev-pdf'));

    // Deep-link reload on /w/workflow?...&step=S4 returns 200 and restores detail
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-step-detail').waitFor({ timeout: 15000 });
    check('Reload on /w/workflow?...&step=S4 restores exact step detail', true);

    // Back to plan restores plan view
    await page.getByTestId('bh-back-to-plan-btn').click();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 15000 });
    check('Back to plan restores plan view', true);

    // Click S4 -> Discuss this step -> stages visible editable draft in bound conversation WITHOUT auto-sending
    await page.getByTestId('bh-plan-node-S4').click();
    await page.getByTestId('bh-discuss-step-btn').waitFor({ timeout: 15000 });
    let runPostDuringStage = 0;
    const onReq = (r) => {
      if (r.method() === 'POST' && r.url().includes('/runs')) runPostDuringStage += 1;
    };
    page.on('request', onReq);
    await page.getByTestId('bh-discuss-step-btn').click();
    await page.waitForURL(new RegExp(`/c/${convoId}`), { timeout: 15000 });
    await page.getByTestId('bh-composer-input').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    page.off('request', onReq);
    const stagedDraft = await page.getByTestId('bh-composer-input').inputValue();
    check('Discuss this step stages visible editable reference without auto-sending', stagedDraft.includes('S4') && runPostDuringStage === 0, `draft="${stagedDraft}" posts=${runPostDuringStage}`);

    // 4. Start slow background run, switch across Workflow -> Evidence -> Executions -> Conversation
    await page.getByTestId('bh-composer-input').fill('Continue analysis [slow-run]');
    await page.getByTestId('send-button').click();
    await page.getByTestId('stop-generation-button').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-workflow-route').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-tab-evidence').click();
    await page.getByTestId('bh-evidence-route').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-tab-executions').click();
    await page.getByTestId('bh-executions-route').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-tab-conversation').click();
    await page.getByText('Background completed cleanly.').waitFor({ timeout: 20000 });
    check('Background run continues undisturbed across Step 4 view switches', true);

    // 5. Execution records independent of mounted Conversation (direct reload on /w/executions)
    await page.getByTestId('bh-tab-executions').click();
    await page.getByTestId('bh-executions-list').waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-executions-list').waitFor({ timeout: 15000 });
    const execRows = await page.locator('[data-testid^="bh-exec-row-"]').count();
    check('Execution records load independently on direct /w/executions reload', execRows >= 2, `rows=${execRows}`);

    // Filter by kind='model' and inspect single record detail
    await page.getByTestId('bh-exec-kind-model').click();
    const firstExecRow = page.locator('[data-testid^="bh-exec-row-"]').first();
    await firstExecRow.click();
    await page.getByTestId('bh-execution-detail').waitFor({ timeout: 10000 });
    const execDetailText = await page.getByTestId('bh-execution-detail').innerText();
    check('Execution detail view shows single-record inspection cleanly', execDetailText.includes('step4-model'));
    await page.getByTestId('bh-back-to-executions-btn').click();

    // 6. Evidence List (LibreChat Table) -> Full-Content Viewers
    await page.getByTestId('bh-tab-evidence').click();
    await page.getByTestId('bh-evidence-table-list').waitFor({ timeout: 15000 });
    const evRows = await page.locator('[data-testid^="bh-evidence-row-"]').count();
    check('Evidence list displays actual recorded Governance references in LibreChat Table', evRows === 6, `rows=${evRows}`);

    // 6a. Structured CSV/TSV Table via AG Grid Community 36.2.0
    await page.getByTestId('bh-open-evidence-ev-table').click();
    await page.getByTestId('bh-ag-grid-container').waitFor({ timeout: 20000 });
    await page.locator('.ag-header-cell-text', { hasText: 'gene' }).waitFor({ timeout: 15000 });
    await page.locator('.ag-cell', { hasText: 'BRCA1' }).first().waitFor({ timeout: 15000 });
    const tableDisclosure = await page.getByTestId('bh-table-disclosure').innerText();
    check('AG Grid Community renders verified TSV columns/rows & loaded_rows_only disclosure',
      tableDisclosure.includes('1–100 of 120') && tableDisclosure.includes('loaded_rows_only'),
      tableDisclosure.split('\n')[0]);

    // Pagination Next -> rows 101-120
    await page.getByTestId('bh-table-next-btn').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-table-disclosure"]');
      return el && el.textContent && el.textContent.includes('101–120');
    }, { timeout: 15000 });
    check('AG Grid pagination fetches next bounded server page (101–120)', true);
    await page.getByTestId('bh-back-to-evidence-btn').click();

    // 6b. Self-hosted PDF.js v6.5.438 generic viewer
    await page.getByTestId('bh-open-evidence-ev-pdf').click();
    await page.getByTestId('bh-pdfjs-iframe').waitFor({ timeout: 20000 });
    const pdfFrame = page.frameLocator('[data-testid="bh-pdfjs-iframe"]');
    await pdfFrame.locator('#viewer .page[data-page-number="1"] canvas').waitFor({ timeout: 25000 });
    const pdfHandle = await page.getByTestId('bh-pdfjs-iframe').elementHandle();
    const pdfContentFrame = await pdfHandle.contentFrame();
    const scriptingEnabled = await pdfContentFrame.evaluate(() => {
      return window.PDFViewerApplicationOptions ? window.PDFViewerApplicationOptions.get('enableScripting') : 'missing';
    });
    check('Self-hosted PDF.js v6.5.438 renders verified PDF page with scripting disabled',
      scriptingEnabled === false && pdfContentRequests >= 1,
      `enableScripting=${scriptingEnabled} contentReqs=${pdfContentRequests}`);
    await page.getByTestId('bh-back-to-evidence-btn').click();

    // 6c. Read-only self-hosted Monaco code viewer (summary.json, zero CDN)
    await page.getByTestId('bh-open-evidence-ev-json').click();
    await page.getByTestId('bh-code-viewer').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-code-viewer"]');
      return el && el.textContent && el.textContent.includes('pilot-s4');
    }, { timeout: 20000 });
    check('Read-only self-hosted Monaco/code viewer displays verified JSON with zero CDN', true);
    await page.getByTestId('bh-back-to-evidence-btn').click();

    // 6d. DOMPurify + <iframe sandbox=""> static HTML viewer
    await page.getByTestId('bh-open-evidence-ev-html').click();
    await page.getByTestId('bh-html-sandbox-iframe').waitFor({ timeout: 15000 });
    const sandboxAttr = await page.getByTestId('bh-html-sandbox-iframe').getAttribute('sandbox');
    const srcDoc = await page.getByTestId('bh-html-sandbox-iframe').getAttribute('srcdoc');
    const xssGlobal = await page.evaluate(() => Boolean(window.__bhXssExecuted));
    check('Static HTML sanitized via DOMPurify inside sandbox="" iframe (script stripped)',
      sandboxAttr === '' && srcDoc.includes('Safe Report Heading') && !srcDoc.includes('<script') && !xssGlobal);
    await page.getByTestId('bh-back-to-evidence-btn').click();

    // 6e. Hash-drift PDF refused (DIFFERS_FROM_RECORD, never mounts viewer with drifted bytes)
    await page.getByTestId('bh-open-evidence-ev-drift').click();
    await page.getByTestId('bh-pdf-blocked').waitFor({ timeout: 15000 });
    const driftText = await page.getByTestId('bh-pdf-blocked').innerText();
    const iframeCountOnDrift = await page.getByTestId('bh-pdfjs-iframe').count();
    check('Drifted PDF refuses viewer and discloses EVIDENCE_CONTENT_DRIFT / DIFFERS_FROM_RECORD',
      iframeCountOnDrift === 0 && (driftText.includes('EVIDENCE_CONTENT_DRIFT') || driftText.includes('DIFFERS_FROM_RECORD')));
    await page.getByTestId('bh-back-to-evidence-btn').click();

    // 6f. Unsupported binary (.bam) honestly labelled unavailable
    await page.getByTestId('bh-open-evidence-ev-bam').click();
    await page.getByTestId('bh-evidence-unsupported').waitFor({ timeout: 15000 });
    const bamText = await page.getByTestId('bh-evidence-unsupported').innerText();
    check('Unsupported binary (.bam) displays honest unavailable notice', bamText.includes('BINARY_PREVIEW_NOT_SUPPORTED'));

    // 7. Unauthenticated request to evidence-content & evidence-table must return 401
    const unauthContext = await browser.newContext();
    const unauthResp = await unauthContext.request.get(`${BASE_URL}/api/workspaces/fixture/evidence-content?request_id=req-s4-1&submission_index=1&evidence_id=ev-pdf&sha256=${'a'.repeat(64)}`, {
      headers: { Range: 'bytes=0-10' },
    });
    const unauthTable = await unauthContext.request.get(`${BASE_URL}/api/workspaces/fixture/evidence-table?request_id=req-s4-1&submission_index=1&evidence_id=ev-table&sha256=${'a'.repeat(64)}`);
    await unauthContext.close();
    check('Unauthenticated evidence-content & evidence-table return 401', unauthResp.status() === 401 && unauthTable.status() === 401, `content=${unauthResp.status()} table=${unauthTable.status()}`);

    // 8. Global security & hygiene invariants
    const domHtml = await page.content();
    const swCount = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0));
    check('Zero external egress (including zero jsdelivr/CDN requests)', externalUrls.length === 0, externalUrls.join(', '));
    check('Zero CSP violations', cspViolations.length === 0, cspViolations.join(' | '));
    check('Zero uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('Zero donor service workers registered', swCount === 0);
    check('Zero access token or provider key leaked to DOM', !domHtml.includes(TOKEN) && !domHtml.includes(PROVIDER_KEY));
  } catch (err) {
    console.error('CHECK EXCEPTION:', err && err.stack ? err.stack : String(err));
    try {
      console.error('URL:', page.url());
      console.error('PAGE_ERRORS:', JSON.stringify(pageErrors));
      console.error('CSP_VIOLATIONS:', JSON.stringify(cspViolations));
      const bodyTxt = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1200) : '');
      console.error('BODY_TEXT:', bodyTxt);
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }

  fs.writeFileSync('/out/step4_results.json', JSON.stringify({ results, externalUrls, apiHits: [...apiHits], pageErrors, cspViolations }, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`TOTAL ${passed} / ${results.length}`);
  if (passed !== results.length) {
    process.exit(1);
  }
})();

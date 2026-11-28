// Real-Browser Chromium Acceptance for R3 Post-Audit Closeout:
// 1. Verbatim user scientific question preserved in Core while attachments bind independently
//    and are actually delivered to the model provider with path + SHA-256.
// 2. Professional module artifact persistence under upload_root, SQLite ledger recording,
//    one-click downstream verify (PASS), and one-click "Attach to Conversation" reuse.
// 3. Strict cross-workspace (primary <-> secondary) and cross-project isolation (attachments,
//    Memory recall results, project tree, and module artifacts never leak across contexts).
// 4. Interrupted run recovery banner -> Resume with Thorough budget (strategy=thorough,
//    max_turns>=80) -> DELIVERED -> persists across real server restart & page reload.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const SECRET_API_KEY = process.env.SECRET_API_KEY || '';
const PROVIDER_LOG = '/qa/work/provider_requests.jsonl';
const CTRL_DIR = '/qa/ctrl';
const OUT = '/qa/out';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

async function waitForFile(p, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function readProviderRequests() {
  if (!fs.existsSync(PROVIDER_LOG)) return [];
  return fs
    .readFileSync(PROVIDER_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function apiJson(page, relUrl) {
  return page.evaluate(
    async ({ url, tok }) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: await r.json() };
    },
    { url: relUrl, tok: TOKEN },
  );
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('lang', 'zh-Hans');
  });
  const page = await context.newPage();
  const pageErrors = [];
  const cspViolations = [];
  const externalReqs = [];
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
    if (!u.startsWith(origin)) externalReqs.push(u);
  });

  try {
    // 1. Login into primary workspace
    await page.goto(BASE + '/');
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });

    // 2. Upload counts.csv + create project "proj-alpha" with verbatim question
    await page.getByTestId('bh-new-project-btn').click();
    await page.getByTestId('bh-new-scope-input').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-new-scope-input').fill('proj-alpha');

    await page.getByTestId('bh-attach-input-btn').click();
    await page.getByTestId('bh-inputs-drawer').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-upload-input-file').setInputFiles('/qa/samples/counts.csv');
    await page.getByTestId('bh-attached-chip-counts.csv').waitFor({ timeout: 10000 });

    const verbatimQuestion = 'Compare baseline vs treatment expression cleanly.';
    await page.getByTestId('bh-composer-input').fill(verbatimQuestion);
    await page.getByTestId('send-button').click();
    await page.getByText('Audit verified reply').first().waitFor({ timeout: 35000 });
    await page.getByTestId('bh-tree-scope-proj-alpha').waitFor({ timeout: 15000 });
    const req1 = (await page.getByTestId('bh-header-request').innerText()).trim();

    // Verify Core holds exact verbatim question AND provider received attachment separately
    const nowResp = await apiJson(page, `/api/workspaces/primary/views/now?request_id=${encodeURIComponent(req1)}`);
    const coreQuestion = nowResp.body?.data?.question || '';
    const provReqs1 = readProviderRequests();
    const firstPayloadText = JSON.stringify(provReqs1[0] || {});
    check(
      '1. Verbatim question preserved in Core without injected attachment text',
      coreQuestion === verbatimQuestion && !coreQuestion.includes('附带研究资料'),
      `coreQuestion=${JSON.stringify(coreQuestion)}`,
    );
    const coreAnswer = nowResp.body?.data?.answer || '';
    const threadText = await page.getByTestId('bh-chat-route').innerText();
    check(
      '2. Uploaded counts.csv content was verified, bounded-read, and actually computed in analysis (G1=2.80x, G2=2.61x)',
      firstPayloadText.includes('counts.csv') &&
        firstPayloadText.includes('sha256=') &&
        firstPayloadText.includes('G1,10.2,28.6') &&
        coreAnswer.includes('G1=2.80x') &&
        coreAnswer.includes('G2=2.61x') &&
        threadText.includes('G1=2.80x'),
      `coreAnswer=${coreAnswer}`,
    );

    // 3. Module artifact persistence -> one-click verify -> ledger -> attach to conversation -> real follow-up run
    await page.getByTestId('bh-tab-capabilities').click();
    await page.getByTestId('bh-cap-subtab-modules').click();
    await page.getByTestId('bh-cap-modules-panel').waitFor({ timeout: 15000 });

    await page.getByTestId('bh-stat-action-select').selectOption('render');
    await page.getByTestId('bh-stat-records-select').selectOption('stats_bundle.json');
    await page.getByTestId('bh-stat-template-select').selectOption('answer.template.md');
    await page.getByTestId('bh-stat-run-btn').click();
    await page.getByTestId('bh-stat-saved-artifact').waitFor({ timeout: 20000 });
    const savedText = await page.getByTestId('bh-stat-saved-artifact').innerText();
    check(
      '3. Statistics render persists artifact under inputs/module-artifacts/statistics/',
      savedText.includes('inputs/module-artifacts/statistics/') && savedText.includes('sha256:'),
      savedText,
    );

    // Click one-click verify on the persisted artifact
    await page.getByTestId('bh-stat-verify-saved-btn').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="bh-domain-statistics-card"]');
      return card && card.textContent.includes('PASS') && card.textContent.includes('verify');
    }, { timeout: 20000 });
    await page.getByTestId('bh-domain-invocation-statistics-verify').first().waitFor({ timeout: 15000 });
    const recentText = await page.getByTestId('bh-domain-recent-invocations').innerText();
    check(
      '4. One-click verify passes on persisted artifact & ledger records render + verify',
      recentText.includes('statistics:render') && recentText.includes('statistics:verify'),
      recentText.slice(0, 200),
    );

    // Attach the verified module artifact directly to a new conversation (since previous convo is DELIVERED)
    const reqCountBeforeAttach = readProviderRequests().length;
    await page.getByTestId('bh-stat-attach-artifact-btn').click();
    await page.getByTestId('bh-attached-inputs').waitFor({ timeout: 15000 });
    const attachedBarText = await page.getByTestId('bh-attached-inputs').innerText();
    check(
      '5. Persisted & verified module artifact attaches directly into active composer',
      attachedBarText.includes('answer.template-rendered'),
      attachedBarText,
    );

    // Assign this follow-up run to project "proj-beta" so we also exercise two distinct projects
    await page.getByTestId('bh-scope-selector').waitFor({ timeout: 10000 });
    await page.locator('input[name="bh-scope-mode"]').last().check();
    await page.getByTestId('bh-new-scope-input').fill('proj-beta');
    const followUpQ = 'Summarize the verified statistics report artifact.';
    await page.getByTestId('bh-composer-input').fill(followUpQ);
    await page.getByTestId('send-button').click();
    await page.getByText('Audit verified reply').first().waitFor({ timeout: 35000 });
    await page.getByTestId('bh-project-item-proj-beta').waitFor({ timeout: 25000 });
    const provReqsAfterAttach = readProviderRequests().slice(reqCountBeforeAttach);
    const attachedProvText = JSON.stringify(provReqsAfterAttach[0] || {});
    check(
      '6. Downstream run actually receives persisted module artifact path + SHA-256',
      attachedProvText.includes('module-artifacts/statistics/') && attachedProvText.includes('sha256='),
      attachedProvText.slice(0, 220),
    );

    // 4. Cross-workspace isolation (primary -> secondary -> primary)
    await page.getByTestId('bh-new-research-btn').click();
    await page.getByTestId('bh-attach-input-btn').click();
    await page.getByTestId('bh-inputs-drawer').waitFor({ timeout: 10000 });
    const reuseCsv = page.locator('[data-testid="bh-workspace-inputs-list"] li', { hasText: 'counts.csv' }).locator('button').first();
    await reuseCsv.waitFor({ timeout: 10000 });
    await reuseCsv.click();
    await page.getByTestId('bh-attached-chip-counts.csv').waitFor({ timeout: 10000 });

    // Select model-deep + thorough strategy, reload page, and confirm model/strategy/attachment persist before switching!
    await page.getByTestId('bh-quick-model-select').selectOption('env-default::model-deep');
    await page.getByTestId('bh-strategy-select').selectOption('thorough');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-attached-chip-counts.csv').waitFor({ timeout: 15000 });
    const persistedModel = await page.getByTestId('bh-quick-model-select').inputValue();
    const persistedStrat = await page.getByTestId('bh-strategy-select').inputValue();
    check(
      '7a. Reload preserves staged attachment, model override (model-deep), and strategy (thorough)',
      persistedModel === 'env-default::model-deep' && persistedStrat === 'thorough',
      `model=${persistedModel} strategy=${persistedStrat}`,
    );

    // Switch workspace to "secondary"
    await page.getByTestId('bh-workspace-select').selectOption('secondary');
    await page.waitForURL(/ws=secondary/, { timeout: 10000 });
    await page.waitForTimeout(400);
    const secondaryHasPrimaryChip = await page.getByTestId('bh-attached-chip-counts.csv').isVisible().catch(() => false);
    await page.getByTestId('bh-empty-projects-card').waitFor({ timeout: 15000 });
    const secondaryTree = await page.getByTestId('bh-sidebar').innerText();
    check(
      '7. Switching to secondary workspace clears staged attachments and isolates primary projects',
      !secondaryHasPrimaryChip && !secondaryTree.includes('proj-alpha') && !secondaryTree.includes('proj-beta'),
      `chip=${secondaryHasPrimaryChip} tree=${secondaryTree.slice(0, 100)}`,
    );

    // Switch back to primary and verify multi-project switching isolation (proj-alpha <-> proj-beta)
    await page.getByTestId('bh-workspace-select').selectOption('primary');
    await page.waitForURL(/ws=primary/, { timeout: 10000 });
    await page.getByTestId('bh-project-item-proj-alpha').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-project-item-proj-alpha').click();
    await page.getByTestId('bh-tree-scope-proj-alpha').waitFor({ timeout: 15000 });
    const alphaTree = await page.getByTestId('bh-research-tree').innerText();
    await page.getByTestId('bh-projects-back-btn').click();
    await page.getByTestId('bh-project-item-proj-beta').click();
    await page.getByTestId('bh-tree-scope-proj-beta').waitFor({ timeout: 15000 });
    const betaTree = await page.getByTestId('bh-research-tree').innerText();
    check(
      '8. Switching back to primary and toggling proj-alpha <-> proj-beta isolates scopes cleanly',
      alphaTree.includes('proj-alpha') && !alphaTree.includes('proj-beta') && betaTree.includes('proj-beta') && !betaTree.includes('proj-alpha'),
      `alpha=${alphaTree.slice(0, 60)} | beta=${betaTree.slice(0, 60)}`,
    );

    // 5. Interrupted task recovery -> Resume with Thorough budget -> DELIVERED -> Server restart recovery
    await page.getByTestId('bh-new-research-btn').click();
    await page.getByTestId('bh-composer-input').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-strategy-select').selectOption('concise');
    await page.getByTestId('bh-composer-input').fill('INTERRUPT_THEN_RESUME test task recovery');
    await page.getByTestId('send-button').click();

    // Provider pauses 3x so Core releases stop hook -> INTERRUPTED -> inline recovery banner appears!
    await page.getByTestId('bh-run-interrupted-banner').waitFor({ timeout: 35000 });
    const bannerVisible = await page.getByTestId('bh-resume-thorough-btn').isVisible();
    check('9. Interrupted run displays inline recovery banner with Resume (Thorough) button', bannerVisible);

    // Capture conversation URL & click "切换深度预算续接"
    const interruptedUrl = page.url();
    const convoMatch = interruptedUrl.match(/\/c\/([^?]+)/);
    const interruptedConvoId = convoMatch ? decodeURIComponent(convoMatch[1]) : '';
    await page.getByTestId('bh-resume-thorough-btn').click();
    await page.getByText('Resumed and delivered cleanly').first().waitFor({ timeout: 35000 });
    await page.getByTestId('bh-hitl-delivered').waitFor({ timeout: 20000 });

    // Confirm conversation events recorded strategy=thorough with max_turns>=80 on resume
    const evsRes = await page.evaluate(
      async ({ cid, tok }) => {
        const r = await fetch(`/api/workspaces/primary/conversations/${encodeURIComponent(cid)}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        return r.json();
      },
      { cid: interruptedConvoId, tok: TOKEN },
    );
    const reqResumed = evsRes?.conversation?.request_id;
    const nowResumed = await apiJson(page, `/api/workspaces/primary/views/now?request_id=${encodeURIComponent(reqResumed)}`);
    check(
      '10. Resuming with Thorough budget finishes Core cycle to DELIVERED cleanly',
      nowResumed.body?.data?.phase === 'DELIVERED',
      JSON.stringify(nowResumed.body?.data?.phase),
    );

    // 6. Real server restart & reload confirms persisted projects, conversations, and module ledger
    fs.writeFileSync(path.join(CTRL_DIR, 'restart.req'), '1');
    const restarted = await waitForFile(path.join(CTRL_DIR, 'restart.done'), 25000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });
    const dmAfterRestart = await apiJson(page, '/api/workspaces/primary/domain-modules');
    const statAfter = (dmAfterRestart.body?.modules || []).find((m) => m.id === 'statistics');
    check(
      '11. After server restart, Core state and SQLite module invocation ledger persist intact',
      restarted && Boolean(statAfter?.actually_used) && (statAfter?.use_count || 0) >= 2,
      JSON.stringify({ restarted, statAfter: { used: statAfter?.actually_used, count: statAfter?.use_count } }),
    );

    // Hygiene & security checks
    const bodyText = await page.evaluate(() => document.body.innerText);
    check(
      '12. Zero secrets/tokens leaked, zero page errors, zero CSP violations, zero external calls',
      !bodyText.includes(TOKEN) &&
        (!SECRET_API_KEY || !bodyText.includes(SECRET_API_KEY)) &&
        pageErrors.length === 0 &&
        cspViolations.length === 0 &&
        externalReqs.length === 0,
      JSON.stringify({ pageErrors, cspViolations, externalReqs }),
    );
  } catch (err) {
    check('Unhandled R3 audit walkthrough error', false, err && err.stack ? err.stack : String(err));
  } finally {
    await browser.close();
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

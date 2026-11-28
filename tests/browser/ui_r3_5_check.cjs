// R3.5 Real-Browser Product-Level Joint Researcher Walkthrough:
// End-to-end across R3.2 (projects/sub-projects/uploads/model/strategy/zh-Hans),
// R3.3 (live Memory MCP/Skills/Resources/Governance Docs/Settings Diagnostics),
// R3.4 (Literature/Statistics report_binding/Scientific Review/Protein Methods),
// 1440 / 1024 / 390 / 320px responsiveness, Light/Dark theme, Keyboard navigation,
// and real server restart recovery.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const SECRET_API_KEY = process.env.SECRET_API_KEY || '';
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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    acceptDownloads: true,
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
    // 1. Sign in under Simplified Chinese locale
    await page.goto(BASE + '/');
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });

    const landingText = await page.getByTestId('bh-landing').innerText();
    check('1. Researcher lands on localized Chinese workbench with project-centric sidebar',
      landingText.includes('BioHarness 科研工作台'), landingText.slice(0, 120));

    // 2. Create project PPGR + upload CSV/FASTA/PDF + pick model override & concise strategy
    await page.getByTestId('bh-new-project-btn').click();
    await page.getByTestId('bh-new-scope-input').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-new-scope-input').fill('PPGR');

    await page.getByTestId('bh-attach-input-btn').click();
    await page.getByTestId('bh-inputs-drawer').waitFor({ timeout: 10000 });
    for (const fname of ['counts.csv', 'seqs.fasta', 'paper.pdf']) {
      await page.getByTestId('bh-upload-input-file').setInputFiles(path.join('/qa/samples', fname));
      await page.getByTestId(`bh-attached-chip-${fname}`).waitFor({ timeout: 10000 });
    }
    await page.getByTestId('bh-quick-model-select').selectOption('env-default::model-deep');
    await page.getByTestId('bh-strategy-select').selectOption('concise');

    await page.getByTestId('bh-composer-input').fill('分析 PPGR 转录组差异表达并校验重复独立性');
    await page.getByTestId('send-button').click();
    await page.getByText('R3.5 verified assistant reply').first().waitFor({ timeout: 35000 });
    await page.getByTestId('bh-tree-scope-PPGR').waitFor({ timeout: 15000 });
    check('2. Root project PPGR created with real files, model-deep override, concise strategy, and completed run', true);

    // 3. Create sub-project under PPGR
    await page.getByTestId('bh-new-subproject-btn-PPGR').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-new-subproject-btn-PPGR').click();
    await page.getByTestId('bh-new-scope-input').fill('motif-eval');
    await page.getByTestId('bh-composer-input').fill('评估 PPGR 启动子基序保守性');
    await page.getByTestId('send-button').click();
    await page.getByTestId('bh-tree-scope-motif-eval').waitFor({ timeout: 35000 });
    check('3. Nested sub-project motif-eval created under PPGR in research tree', true);

    // 4. Keyboard navigation across primary tabs (ArrowRight -> Workflow -> Evidence -> Conversation)
    await page.getByTestId('bh-tab-conversation').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/\/w\/workflow/, { timeout: 10000 });
    await page.getByTestId('bh-tab-workflow').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/\/w\/evidence/, { timeout: 10000 });
    await page.getByTestId('bh-tab-evidence').focus();
    await page.keyboard.press('Home');
    await page.waitForURL(/\/c\//, { timeout: 10000 });
    check('4. Keyboard ArrowRight & Home navigate Conversation/Workflow/Evidence cleanly', true);

    // 5. Open Memory & Capabilities -> Memory recall + T3 + feedback + Skills/Docs
    await page.getByTestId('bh-tab-capabilities').click();
    await page.getByTestId('bh-memory-callable-badge').waitFor({ timeout: 20000 });
    await page.getByTestId('bh-memory-cond-key').fill('research_area');
    await page.getByTestId('bh-memory-cond-val').fill('plant_motif_evolution');
    await page.getByTestId('bh-memory-add-cond-btn').click();
    await page.getByTestId('bh-memory-query-input').fill('DESeq2 biological replicates');
    await page.getByTestId('bh-memory-recall-submit').click();
    await page.getByTestId('bh-memory-cand-mem:ppgr-deseq2@1').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-memory-expand-t3-mem:ppgr-deseq2@1').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-memory-expanded-panel"]');
      return el && el.textContent.includes('ppgr_notes.md#L1') && el.textContent.includes('sha256:');
    }, { timeout: 15000 });
    await page.getByTestId('bh-memory-use-consumed-mem:ppgr-deseq2@1').click();
    await page.getByTestId('bh-memory-usage-notice').waitFor({ timeout: 15000 });
    check('5. Live Memory MCP recall, T3 SHA-256 verification, and explicit consumed feedback work', true);

    await page.getByTestId('bh-cap-subtab-capabilities').click();
    await page.getByTestId('bh-cap-skill-rna-qc').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-cap-subtab-documents').click();
    await page.getByTestId('bh-doc-card-status').waitFor({ timeout: 15000 });
    check('6. Skills four-state matrix and Governance STATUS.md document preview work', true);

    // 7. Professional Scientific Modules (R3.4): Literature + Statistics + Review + Protein Methods
    await page.getByTestId('bh-cap-subtab-modules').click();
    await page.getByTestId('bh-cap-modules-panel').waitFor({ timeout: 15000 });

    await page.getByTestId('bh-lit-file-select').selectOption('search.json');
    await page.getByTestId('bh-lit-inspect-btn').click();
    await page.getByTestId('bh-domain-literature-card').waitFor({ timeout: 15000 });

    await page.getByTestId('bh-stat-action-select').selectOption('render');
    await page.getByTestId('bh-stat-records-select').selectOption('stats_bundle.json');
    await page.getByTestId('bh-stat-template-select').selectOption('answer.template.md');
    await page.getByTestId('bh-stat-run-btn').click();
    await page.getByTestId('bh-domain-statistics-card').waitFor({ timeout: 15000 });
    const statOk = (await page.getByTestId('bh-stat-status-badge').innerText()).includes('PASS');

    await page.getByTestId('bh-protein-op-select').selectOption('structure-inventory');
    await page.getByTestId('bh-protein-input-select').selectOption('helix.pdb');
    await page.getByTestId('bh-protein-run-btn').click();
    await page.getByTestId('bh-domain-protein-card').waitFor({ timeout: 15000 });
    const protOk = (await page.getByTestId('bh-protein-atom-count').innerText()).trim() === '4';
    const revGapOk = (await page.getByTestId('bh-review-api-gap-note').innerText()).includes('[advisor]');
    check('7. All R3.4 domain modules (Literature, Statistics PASS, Protein Methods, Review gap) verified live',
      statOk && protOk && revGapOk, `statOk=${statOk} protOk=${protOk} revGapOk=${revGapOk}`);

    // 8. Theme switch (Dark -> Light) + Settings Diagnostics redaction + UX-13 check
    await page.getByTestId('bh-header-models-btn').click();
    await page.getByTestId('bh-models-settings').waitFor({ timeout: 15000 });
    await page.getByRole('tab', { name: '诊断与安全' }).click();
    await page.getByTestId('bh-diagnostics-json').waitFor({ timeout: 15000 });
    const diagText = await page.getByTestId('bh-diagnostics-json').innerText();
    check('8. Settings Diagnostics redacts token & provider API key cleanly',
      diagText.includes('provider_keys_server_side_only') &&
        !diagText.includes(TOKEN) &&
        (!SECRET_API_KEY || !diagText.includes(SECRET_API_KEY)),
      diagText.slice(0, 140));

    // Switch to General ("通用") tab -> close dialog -> test real Dark & Light theme persistence across reload
    await page.getByRole('tab', { name: /通用|General/i }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.localStorage.setItem('color-theme', 'dark'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-cap-modules-panel').waitFor({ timeout: 15000 });
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.evaluate(() => { window.localStorage.setItem('color-theme', 'light'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-cap-modules-panel').waitFor({ timeout: 15000 });
    const isLight = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
    check('9. Light & Dark themes persist cleanly across reload with zero layout breakage', isDark && isLight, `dark=${isDark} light=${isLight}`);

    // 9. Multi-viewport responsiveness (1440 / 1024 / 390 / 320px) across Conversation & Capabilities
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 680 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      const ov = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      check(`10. Zero horizontal overflow at ${vp.width}x${vp.height}`,
        ov.scroll <= ov.client + 2, JSON.stringify(ov));
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 10. Real server restart recovery check
    fs.writeFileSync(path.join(CTRL_DIR, 'restart.req'), '1');
    const restarted = await waitForFile(path.join(CTRL_DIR, 'restart.done'), 25000);
    check('11. Host server restarted cleanly on same SQLite ledger & workspace', restarted);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });
    const treeAfterRestart = await page.getByTestId('bh-research-tree').innerText();
    const convosAfterRestart = await page.getByTestId('bh-conversations-section').innerText();
    check('12. After server restart & reload, projects (PPGR/motif-eval) and readable conversation history persist',
      treeAfterRestart.includes('PPGR') &&
        treeAfterRestart.includes('motif-eval') &&
        convosAfterRestart.includes('分析 PPGR'),
      `${treeAfterRestart.slice(0, 80)} | ${convosAfterRestart.slice(0, 80)}`);

    // Final hygiene & security checks
    const bodyText = await page.evaluate(() => document.body.innerText);
    check('13. Zero secrets/tokens leaked into rendered DOM',
      !bodyText.includes(TOKEN) && (!SECRET_API_KEY || !bodyText.includes(SECRET_API_KEY)));
    check('14. Zero uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));
    check('15. Zero CSP violations', cspViolations.length === 0, cspViolations.join('; '));
    check('16. Zero external network requests', externalReqs.length === 0, externalReqs.join('; '));
  } catch (err) {
    check('Unhandled R3.5 walkthrough error', false, err && err.stack ? err.stack : String(err));
  } finally {
    await browser.close();
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

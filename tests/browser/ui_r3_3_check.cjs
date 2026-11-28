// Real-browser Chromium acceptance for R3.3:
// Memory MCP workbench (recall FAST/STANDARD, disabled DEEP, T1/T2/T3 expand, usage feedback,
// pending candidate capture, Curator boundary disclosure), four-state Skills/Resources/MCP/CLI
// capabilities matrix & R4 Compute disclosure, Governance project documents, Settings IA tabs +
// redacted Diagnostics JSON export, and 390/320px responsive layout.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const SECRET_API_KEY = process.env.SECRET_API_KEY || '';
const OUT = '/qa/out';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

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
    // 1. Login and open Memory & Capabilities via sidebar entry
    await page.goto(BASE + '/');
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });

    await page.getByTestId('bh-sidebar-capabilities-btn').click();
    await page.getByTestId('bh-cap-memory-panel').waitFor({ timeout: 15000 });

    // 2. Verify live Memory MCP status, DEEP boundary, and Curator gap disclosure
    await page.getByTestId('bh-memory-callable-badge').waitFor({ timeout: 20000 });
    const activeCount = await page.getByTestId('bh-memory-active-count').innerText();
    const deepBadge = await page.getByTestId('bh-memory-deep-gap-badge').innerText();
    const curatorNote = await page.getByTestId('bh-memory-curator-gap-note').innerText();
    const deepBtnDisabled = await page.getByTestId('bh-memory-mode-deep').isDisabled();

    check('Memory MCP connects and reports seeded active count', activeCount.trim() === '1', activeCount);
    check('DEEP recall mode honestly marked unavailable & disabled',
      deepBtnDisabled && deepBadge.includes('DEEP') && deepBadge.includes('RECALL_MODE_NOT_IMPLEMENTED'),
      deepBadge);
    check('Curator interactive publish gap honestly disclosed',
      curatorNote.includes('BioHarness-Modules') && curatorNote.includes('Curator'),
      curatorNote);

    // 3. Recall (FAST) -> T1 / T2 / T3 expansion -> Usage feedback
    await page.getByTestId('bh-memory-query-input').fill('DESeq2 biological replicates');
    await page.getByTestId('bh-memory-recall-submit').click();
    await page.getByTestId('bh-memory-cand-mem:ppgr-deseq2@1').waitFor({ timeout: 20000 });

    // Expand T1
    await page.getByTestId('bh-memory-expand-t1-t1:rnaseq-de@1').click();
    await page.getByTestId('bh-memory-expanded-panel').waitFor({ timeout: 15000 });
    const t1Text = await page.getByTestId('bh-memory-expanded-panel').innerText();
    check('T1 theme expansion renders theme title and member',
      t1Text.includes('RNA-seq Differential Expression') && t1Text.includes('mem:ppgr-deseq2@1'),
      t1Text.slice(0, 200));

    // Expand T2
    await page.getByTestId('bh-memory-expand-t2-mem:ppgr-deseq2@1').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-memory-expanded-panel"]');
      return el && el.textContent.includes('DESeq2 Wald + BH FDR');
    }, { timeout: 15000 });
    check('T2 detail expansion renders structured scientific parameters', true);

    // Expand T3 (SHA-256 metadata boundary with allow_text=False)
    await page.getByTestId('bh-memory-expand-t3-mem:ppgr-deseq2@1').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-memory-expanded-panel"]');
      return el && el.textContent.includes('ppgr_notes.md#L1') && el.textContent.includes('sha256:');
    }, { timeout: 15000 });
    check('T3 source expansion verifies file anchor + SHA-256 digest cleanly', true);

    // Report use (consumed)
    await page.getByTestId('bh-memory-use-consumed-mem:ppgr-deseq2@1').click();
    await page.getByTestId('bh-memory-usage-notice').waitFor({ timeout: 15000 });
    const usageText = await page.getByTestId('bh-memory-usage-notice').innerText();
    check('Explicit memory_report_use (consumed) succeeds', usageText.includes('consumed'), usageText);

    // 4. Propose candidate -> pending inbox increments
    await page.getByTestId('bh-memory-candidate-summary').fill('Verify GC bias before cross-sample comparison');
    await page.getByTestId('bh-memory-candidate-locator').fill('ppgr_notes.md#L2');
    await page.getByTestId('bh-memory-propose-submit').click();
    await page.getByTestId('bh-memory-propose-feedback').waitFor({ timeout: 15000 });
    const propText = await page.getByTestId('bh-memory-propose-feedback').innerText();
    check('Candidate capture reports UNREVIEWED_PENDING_IMPORT',
      propText.includes('UNREVIEWED_PENDING_IMPORT'), propText);

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bh-memory-pending-count"]');
      return el && el.textContent.trim() === '1';
    }, { timeout: 15000 });
    check('Diagnose pending inbox counter increments to 1', true);

    // 5. Switch to Skills & Capabilities four-state panel
    await page.getByTestId('bh-cap-subtab-capabilities').click();
    await page.getByTestId('bh-cap-skills-panel').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-cap-skill-rna-qc').waitFor({ timeout: 20000 });

    const skText = await page.getByTestId('bh-cap-skill-rna-qc').innerText();
    const resText = await page.getByTestId('bh-cap-resource-echo-mod').innerText();
    const computeText = await page.getByTestId('bh-cap-compute-disclosure').innerText();

    check('Workspace SKILL.md shows Declared/Installed/Callable/Unused four-state badges',
      skText.includes('已声明') && skText.includes('已安装') && skText.includes('可调用') && skText.includes('尚未使用'),
      skText);
    check('Core [[resources]] + Web ledger distinguishes actually_used state for echo-mod',
      resText.includes('已声明') && resText.includes('已实际调用'),
      resText);
    check('Remote compute boundary honestly disclosed as R4_DEFERRED',
      computeText.includes('R4_DEFERRED'),
      computeText);

    // 6. Switch to Governance Project Documents tab & stage into draft
    await page.getByTestId('bh-cap-subtab-documents').click();
    await page.getByTestId('bh-cap-docs-panel').waitFor({ timeout: 15000 });
    await page.getByTestId('bh-doc-card-status').waitFor({ timeout: 20000 });
    const statusDocText = await page.getByTestId('bh-doc-card-status').innerText();
    check('Governance STATUS.md loaded cleanly via context command',
      statusDocText.includes('All PPGR samples QC passed'),
      statusDocText.slice(0, 160));

    await page.getByTestId('bh-doc-stage-status').click();
    await page.getByTestId('bh-composer-input').waitFor({ timeout: 15000 });
    const stagedVal = await page.getByTestId('bh-composer-input').inputValue();
    check('Staging Governance doc populates conversation draft cleanly',
      stagedVal.includes('STATUS.md') && stagedVal.includes('All PPGR samples QC passed'),
      stagedVal.slice(0, 140));

    // 7. Open Settings Dialog & inspect R3.3 Skills / Memory / Modules / Diagnostics tabs + JSON export
    await page.getByTestId('bh-header-models-btn').click();
    await page.getByTestId('bh-models-settings').waitFor({ timeout: 15000 });

    for (const [tabLabel, panelId] of [
      ['技能与资源', 'bh-settings-skills-panel'],
      ['科研记忆', 'bh-settings-memory-panel'],
      ['专业模块', 'bh-settings-modules-panel'],
      ['诊断与安全', 'bh-settings-diagnostics-panel'],
    ]) {
      await page.getByRole('tab', { name: tabLabel }).click();
      await page.getByTestId(panelId).waitFor({ timeout: 20000 });
    }

    await page.getByTestId('bh-diagnostics-json').waitFor({ timeout: 15000 });
    const diagJsonText = await page.getByTestId('bh-diagnostics-json').innerText();
    check('Diagnostics JSON exposes security posture and redacts API key / token',
      diagJsonText.includes('provider_keys_server_side_only') &&
        !diagJsonText.includes(TOKEN) &&
        (!SECRET_API_KEY || !diagJsonText.includes(SECRET_API_KEY)),
      diagJsonText.slice(0, 200));

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByTestId('bh-diagnostics-download-btn').click();
    const download = await downloadPromise;
    check('Diagnostics Export JSON triggers file download',
      download.suggestedFilename().startsWith('bioharness-diagnostics-'),
      download.suggestedFilename());

    await page.keyboard.press('Escape');

    // 8. Responsive check at 390px and 320px on /w/capabilities
    await page.goto(BASE + '/w/capabilities?ws=primary&tab=memory');
    await page.getByTestId('bh-cap-memory-panel').waitFor({ timeout: 15000 });
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      check(`No horizontal overflow at ${vp.width}px viewport`,
        overflow.scroll <= overflow.client + 2,
        JSON.stringify(overflow));
    }

    check('Zero uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));
    check('Zero CSP violations', cspViolations.length === 0, cspViolations.join('; '));
    check('Zero external network requests', externalReqs.length === 0, externalReqs.join('; '));
  } catch (err) {
    check('Unhandled R3.3 browser error', false, err && err.stack ? err.stack : String(err));
  } finally {
    await browser.close();
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

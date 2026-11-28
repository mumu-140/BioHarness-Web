// Real-browser Chromium acceptance for R3.2 (UX-01..UX-04, UX-06..UX-14)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;
const WORK = process.env.WORK_DIR;
const OUT = '/qa/out';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

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
    // 1. Sign in under Simplified Chinese locale
    await page.goto(BASE + '/');
    await page.locator('#password').fill(TOKEN);
    await page.getByTestId('login-button').click();
    await page.getByTestId('bh-sidebar').waitFor({ timeout: 20000 });

    const landingText = await page.getByTestId('bh-landing').innerText();
    check('Simplified Chinese landing & sidebar render cleanly',
      landingText.includes('BioHarness 科研工作台'),
      landingText.slice(0, 120));

    // 2. Empty project state -> click "新建项目" -> create root project "PPGR" with real files + model override + concise strategy
    await page.getByTestId('bh-empty-projects-card').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-new-project-btn').click();
    await page.getByTestId('bh-new-scope-input').waitFor({ timeout: 10000 });
    await page.getByTestId('bh-new-scope-input').fill('PPGR');

    // Attach CSV, FASTA, PDF via restricted upload endpoint
    await page.getByTestId('bh-attach-input-btn').click();
    await page.getByTestId('bh-inputs-drawer').waitFor({ timeout: 10000 });

    const sampleDir = '/qa/samples';
    for (const fname of ['counts.csv', 'seqs.fasta', 'paper.pdf']) {
      await page.getByTestId('bh-upload-input-file').setInputFiles(path.join(sampleDir, fname));
      await page.getByTestId(`bh-attached-chip-${fname}`).waitFor({ timeout: 10000 });
    }
    const chipText = await page.getByTestId('bh-attached-chip-counts.csv').innerText();
    check('Uploaded CSV/FASTA/PDF show as unverified input chips (never verified evidence)',
      chipText.includes('待附带输入'), chipText);

    // Duplicate upload of counts.csv must be rejected (no overwrite!)
    await page.getByTestId('bh-upload-input-file').setInputFiles(path.join(sampleDir, 'counts.csv'));
    await page.getByTestId('bh-upload-error').waitFor({ timeout: 10000 });
    const dupErr = await page.getByTestId('bh-upload-error').innerText();
    check('Duplicate upload refuses overwrite with HTTP 409 error',
      dupErr.includes('INPUT_ALREADY_EXISTS'), dupErr);

    // Select everyday model override (model-deep) and execution budget strategy (concise)
    await page.getByTestId('bh-quick-model-select').selectOption('env-default::model-deep');
    await page.getByTestId('bh-strategy-select').selectOption('concise');

    // Enter first scientific question and send
    const question1 = '分析 PPGR 基因家族转录组表达差异';
    await page.getByTestId('bh-composer-input').fill(question1);
    await page.getByTestId('send-button').click();

    await page.getByText('R3.2 verified assistant reply').first().waitFor({ timeout: 25000 });
    await page.getByTestId('bh-tree-scope-PPGR').waitFor({ timeout: 15000 });
    const req1 = (await page.getByTestId('bh-header-request').innerText()).trim();
    check('Root project PPGR created with real first question and completed Core cycle',
      req1.startsWith('sci-') && await page.getByTestId('bh-tree-scope-PPGR').isVisible(),
      req1);

    // Check human-readable conversation history title in sidebar (UX-08)
    const convoListText = await page.getByTestId('bh-conversations-list').innerText();
    check('Sidebar history shows human-readable question title instead of raw ID only',
      convoListText.includes('分析 PPGR 基因家族转录组表达差异'),
      convoListText.slice(0, 140));

    // 3. Create sub-project "transcriptome" under "PPGR" via "+子项目" button
    await page.getByTestId('bh-new-subproject-btn-PPGR').click();
    await page.getByTestId('bh-parent-scope-select').waitFor({ timeout: 10000 });
    const parentVal = await page.getByTestId('bh-parent-scope-select').inputValue();
    await page.getByTestId('bh-new-scope-input').fill('transcriptome');
    await page.getByTestId('bh-composer-input').fill('核查 PPGR 转录组差异表达样本分组');
    await page.getByTestId('send-button').click();

    await page.getByText('R3.2 verified assistant reply').first().waitFor({ timeout: 25000 });
    await page.getByTestId('bh-tree-scope-transcriptome').waitFor({ timeout: 15000 });
    const subReqId = (await page.getByTestId('bh-header-request').innerText()).trim();
    check('Sub-project transcriptome created under parent PPGR',
      parentVal === 'PPGR' && subReqId.startsWith('sci-') && subReqId !== req1,
      `parent=${parentVal} req=${subReqId}`);

    // 4. Verify same request appears in Workflow and Evidence tabs
    await page.getByTestId('bh-tab-workflow').click();
    await page.getByTestId('bh-plan-graph-canvas').waitFor({ timeout: 15000 });
    const wfReq = (await page.getByTestId('bh-header-request').innerText()).trim();
    await page.getByTestId('bh-tab-evidence').click();
    await page.getByTestId('bh-evidence-route').waitFor({ timeout: 15000 });
    const evReq = (await page.getByTestId('bh-header-request').innerText()).trim();
    check('Created request resolves consistently across Conversation, Workflow, and Evidence views',
      wfReq === subReqId && evReq === subReqId,
      `wf=${wfReq} ev=${evReq}`);

    // 5. Switch to read-only workspace (no upload_root) -> honest upload disabled message
    await page.getByTestId('bh-workspace-select').selectOption('readonly');
    await page.waitForURL('**ws=readonly*', { timeout: 10000 });
    await page.getByTestId('bh-tab-conversation').click();
    await page.getByTestId('bh-attach-input-btn').click();
    await page.getByTestId('bh-upload-disabled-notice').waitFor({ timeout: 10000 });
    const hasUploadTrigger = await page.getByTestId('bh-upload-trigger-btn').count();
    check('Read-only workspace hides upload trigger and discloses upload_root absence honestly',
      hasUploadTrigger === 0,
      `triggers=${hasUploadTrigger}`);

    // 6. Settings consistency (UX-13): check Chat tab hides unbacked donor upload/steer/fork controls
    await page.getByTestId('bh-header-models-btn').click();
    await page.getByTestId('bh-models-settings').waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: /对话|Chat/i }).click();
    const settingsText = await page.locator('[role="dialog"]').innerText();
    const leaksDeadSetting =
      settingsText.includes('Resize images') ||
      settingsText.includes('Paste long text as a file') ||
      settingsText.includes('上传前调整图片') ||
      settingsText.includes('粘贴长文本为文件') ||
      settingsText.includes('分叉设置');
    check('Unbacked donor settings (resize images, paste-as-file, fork) are hidden from Chat settings',
      !leaksDeadSetting, settingsText.slice(0, 200));
    await page.keyboard.press('Escape');

    // 7. Mobile & narrow-screen responsiveness (390px and 320px, UX-12)
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 680 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`Zero horizontal overflow at ${vp.width}x${vp.height}`, !overflow, `vp=${vp.width}`);
    }

    await page.screenshot({ path: path.join(OUT, 'r3_2_mobile.png') }).catch(() => {});
  } catch (err) {
    check('R3.2 browser suite completed cleanly', false, `${page.url()} :: ${err && err.message ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }

  check('Zero uncaught pageerrors', pageErrors.length === 0, pageErrors.join(' | '));
  check('Zero CSP violations', cspViolations.length === 0, cspViolations.join(' | '));
  check('Zero external requests', externalReqs.length === 0, externalReqs.join(' | '));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

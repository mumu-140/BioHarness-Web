// Drives the built service in headless Chromium. Run through tests/browser/run.sh.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE, TOKEN = process.env.TOKEN, RID = process.env.RID;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(BASE + '/');
    await page.getByLabel('服务访问令牌').fill('wrong-token-000000000');
    await page.getByRole('button', { name: '进入' }).click();
    await page.getByText('令牌未被接受').waitFor({ timeout: 8000 });
    check('wrong token is refused', true);
    await page.getByLabel('服务访问令牌').fill(TOKEN);
    await page.getByRole('button', { name: '进入' }).click();
    await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    errors.length = 0; // the 401 answers before signing in are the expected ones

    // ---- research tree ----
    const treeNodes = await page.locator('.react-flow__node').allInnerTexts();
    check('tree canvas renders both scopes', treeNodes.length === 2 && treeNodes.some(t => t.includes('fixture-branch')), JSON.stringify(treeNodes));
    const box = await page.locator('.graph-canvas').boundingBox();
    check('tree canvas has real size', box && box.height > 250 && box.width > 400, JSON.stringify(box));
    const pos = await page.locator('.react-flow__node').evaluateAll(ns => ns.map(n => ({ t: n.innerText.split('\n')[1] || n.innerText, r: n.getBoundingClientRect().toJSON() })));
    const parent = pos.find(p => p.r && p.t && !p.t.includes('branch')), child = pos.find(p => p.t && p.t.includes('branch'));
    const inView = pos.every(p => p.r.top >= box.y - 1 && p.r.bottom <= box.y + box.height + 1 && p.r.left >= box.x - 1 && p.r.right <= box.x + box.width + 1);
    check('tree nodes are inside the visible canvas', inView, JSON.stringify(pos.map(p => [p.t, Math.round(p.r.left), Math.round(p.r.top)])));
    check('parent scope is drawn above its branch', parent && child && parent.r.top < child.r.top);
    const edges = await page.locator('.react-flow__edge').count();
    const dashed = await page.locator('.react-flow__edge.is-contextual').count();
    check('tree has one parent edge and one dashed related link', edges === 2 && dashed === 1, `edges=${edges} dashed=${dashed}`);
    const paths = await page.locator('.react-flow__edge path.react-flow__edge-path').evaluateAll(ps => ps.map(p => p.getAttribute('d')));
    check('related link does not lie on top of the parent edge', new Set(paths).size === paths.length && paths.length === 2, JSON.stringify(paths));
    const mm = await page.locator('.react-flow__minimap-node').evaluateAll(ns => ns.map(n => ({ w: n.getAttribute('width'), h: n.getAttribute('height'), fill: getComputedStyle(n).fill, tag: n.tagName, vis: getComputedStyle(n).visibility, op: getComputedStyle(n).opacity })));
    const svg = await page.locator('.react-flow__minimap svg').evaluate(n => ({ viewBox: n.getAttribute('viewBox'), w: n.getAttribute('width'), h: n.getAttribute('height') })).catch(e => String(e));
    check('minimap draws both scope nodes', mm.length === 2 && mm.every(m => Number(m.w) > 0 && Number(m.h) > 0), JSON.stringify({ mm, svg }));
    const navUnscoped = await page.locator('.navigator section[aria-label="科研树"]').innerText();
    check('unscoped request is not placed under any scope', !navUnscoped.includes('未归属'));
    check('open list marks the unscoped request', (await page.locator('.navigator section[aria-label="开放请求"]').innerText()).includes('未归属研究范围'));
    await page.locator('.react-flow__node', { hasText: 'fixture-project' }).first().click();
    await page.locator('.inspector').getByText('提交 #1').waitFor({ timeout: 10000 });
    check('scope inspector shows recorded submission', true);
    await page.screenshot({ path: '/qa/out/tree.png' });

    // ---- no request chosen by the application ----
    await page.getByRole('button', { name: '科研流程' }).click();
    check('no request is selected automatically', await page.getByText('请在左侧明确选择一个请求').isVisible());

    // ---- workflow ----
    await page.locator('.navigator section[aria-label="开放请求"] .nav-request', { hasText: RID }).click();
    await page.locator('.now-panel').waitFor({ timeout: 15000 });
    await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    const stepNodes = await page.locator('.react-flow__node').evaluateAll(ns => ns.map(n => ({ text: n.innerText, r: n.getBoundingClientRect().toJSON() })));
    const by = id => stepNodes.find(s => s.text.split('\n').includes(id));
    check('workflow renders the three plan steps', stepNodes.length === 3 && by('inputs') && by('compare') && by('report'), stepNodes.map(s => s.text.replace(/\n/g, ' | ')).join(' ## '));
    check('dependency order runs left to right', by('inputs').r.left < by('compare').r.left && by('compare').r.left < by('report').r.left);
    check('Core current step badge is on "compare" only', by('compare').text.includes('Core 当前步骤') && !by('inputs').text.includes('Core 当前步骤') && !by('report').text.includes('Core 当前步骤'));
    check('status text comes from Core progress', by('inputs').text.includes('已完成') && by('compare').text.includes('未提交'));
    check('workflow has exactly the two declared dependency edges', await page.locator('.react-flow__edge').count() === 2, String(await page.locator('.react-flow__edge').count()));
    const wbox = await page.locator('.graph-canvas').boundingBox();
    check('workflow canvas has real size below the Core panel', wbox && wbox.height > 250, JSON.stringify(wbox));
    check('workflow nodes are inside the visible canvas', stepNodes.every(s => s.r.top >= wbox.y - 1 && s.r.bottom <= wbox.y + wbox.height + 1 && s.r.left >= wbox.x - 1 && s.r.right <= wbox.x + wbox.width + 1), JSON.stringify(stepNodes.map(s => [Math.round(s.r.left), Math.round(s.r.top), Math.round(s.r.right), Math.round(s.r.bottom)])));
    const panel = await page.locator('.now-panel').innerText();
    check('Core panel shows original question, mainline and instruction', panel.includes('Fixture question') && panel.includes('R2') && panel.includes('science_submit'));

    await page.locator('.react-flow__node', { hasText: 'inputs' }).first().click();
    await page.locator('.inspector').getByText('The synthetic table has 3 rows').waitFor({ timeout: 10000 });
    const insp = await page.locator('.inspector').innerText();
    check('inspector shows workspace-relative evidence label, no server path', insp.includes('$WORKSPACE/inputs.tsv') && !insp.includes(process.env.WORKSPACE_DIR));
    await page.locator('.inspector').getByRole('button', { name: '预览' }).click();
    await page.locator('.inspector').getByText('当前文件与记录一致').waitFor({ timeout: 10000 });
    check('evidence preview renders recorded file content', (await page.locator('.inspector').innerText()).includes('s2'));
    await page.screenshot({ path: '/qa/out/workflow.png' });
    const body = await page.content();
    check('no server path anywhere in the page', !body.includes(process.env.WORKSPACE_DIR));

    // ---- external writer: Core is changed by another host while the page stays open ----
    fs.writeFileSync('/qa/out/ready', 'ready');
    await page.locator('.react-flow__node', { hasText: 'compare' }).filter({ hasText: '已完成' }).first().waitFor({ timeout: 45000 });
    const after = await page.locator('.react-flow__node').allInnerTexts();
    const report = after.find(t => t.split('\n').includes('report')) || '';
    check('page follows an external Core change without reload', report.includes('Core 当前步骤'), after.map(t => t.replace(/\n/g, ' | ')).join(' ## '));
    check('progress chip updated', (await page.locator('.now-panel').innerText()).includes('步骤 2/3'));
    await page.screenshot({ path: '/qa/out/after-external-change.png' });
  } catch (e) {
    check('script completed', false, e.message.split('\n').slice(0, 6).join(' / '));
    try { await page.screenshot({ path: '/qa/out/failure.png' }); } catch {}
  }
  check('no page or console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  fs.writeFileSync('/qa/out/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();

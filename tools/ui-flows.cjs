/**
 * Interactive UI verification: drives the real user flows in a browser rather
 * than calling the API directly. Covers stream control, filtering, the detail
 * drawer, alert triage, account expansion, auth guards, 404 and mobile layout.
 *
 * Usage: node tools/ui-flows.cjs <appUrl> <apiUrl>
 */
const path = require('path');
const RUNTIME_MODULES =
  'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const playwright = require(path.join(RUNTIME_MODULES, 'playwright'));

const appUrl = process.argv[2] || 'http://127.0.0.1:5173';
const apiUrl = process.argv[3] || 'http://127.0.0.1:8000';

let passed = 0;
let failed = 0;
const consoleErrors = [];

function check(name, ok, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

async function main() {
  // Start from a clean engine state.
  await fetch(`${apiUrl}/api/stream/stop`, { method: 'POST' }).catch(() => {});

  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));

  // ---------------------------------------------------------------- landing
  await page.goto(appUrl + '/', { waitUntil: 'networkidle' });
  check(
    'landing renders its headline',
    (await page.locator('h1').innerText()).includes('50 milliseconds'),
  );
  check(
    'landing shows the risk band table',
    (await page.locator('text=Alert and investigate').count()) > 0,
  );

  await page.locator('a[href="#how-it-works"]').first().click();
  await page.waitForTimeout(600);
  check(
    'in-page anchor navigation works',
    await page.locator('#how-it-works').isVisible(),
  );

  // -------------------------------------------------------------- auth guard
  await page.goto(appUrl + '/app/monitor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check(
    'protected route redirects an anonymous visitor',
    new URL(page.url()).pathname === '/login',
    page.url(),
  );

  // ------------------------------------------------------------------- login
  await page.locator('button', { hasText: 'Continue without Supabase' }).click();
  await page.waitForURL(/\/app/, { timeout: 20000 });
  await page.waitForTimeout(1800);
  // The guard stored the originally requested page, so sign-in should land back
  // on /app/monitor rather than the default /app.
  check(
    'sign-in returns to the originally requested page',
    new URL(page.url()).pathname === '/app/monitor',
    page.url(),
  );

  await page.goto(appUrl + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('overview loads after sign-in', new URL(page.url()).pathname === '/app');

  // ------------------------------------------------- start stream from the UI
  await page.getByRole('button', { name: 'Stream', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stream settings' });
  check('stream settings panel opens', await dialog.isVisible());

  const startPoints = dialog.locator('input[name="stream-skip"]');
  const pointCount = await startPoints.count();
  check('start position presets are offered', pointCount >= 2, `${pointCount} options`);

  if (pointCount >= 2) {
    await startPoints.nth(1).check(); // "At the first labelled fraud"
  }
  await dialog.locator('#stream-limit').fill('400');
  await dialog.locator('input[name="stream-speed"][value="40"]').check();
  await dialog.getByRole('button', { name: /Start stream/ }).click();
  await page.waitForTimeout(3500);

  const stopVisible = await page.getByRole('button', { name: 'Stop stream' }).count();
  check('stream starts from the UI and the button flips to Stop', stopVisible === 1);

  const status = await fetch(`${apiUrl}/api/stream/status`).then((r) => r.json());
  check(
    'engine confirms the UI-started run',
    status.processed > 0 && status.config.skip > 0,
    `processed=${status.processed} skip=${status.config.skip} delay=${status.config.delay_ms}ms`,
  );

  // KPI tiles should be counting up. Read the whole tile, not just the label.
  await page.waitForTimeout(2500);
  const kpiTile = page
    .locator('p:text-is("Total transactions")')
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  const kpiText = (await kpiTile.innerText()).replace('Total transactions', '');
  const kpiValue = Number((kpiText.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
  check(
    'overview KPI reflects the running stream',
    kpiValue > 0,
    `tile reads ${kpiValue} transactions`,
  );

  // ----------------------------------------------------------- live monitor
  await page.goto(appUrl + '/app/monitor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const allRows = await page.locator('tbody tr').count();
  check('monitor lists scored transactions', allRows > 0, `${allRows} rows`);

  // risk band filter
  const lowTab = page.getByRole('tab', { name: /^Low/ });
  if (await lowTab.count()) {
    await lowTab.click();
    await page.waitForTimeout(700);
    const lowRows = await page.locator('tbody tr').count();
    const bands = await page.locator('tbody tr td:nth-child(5)').allInnerTexts();
    check(
      'risk band filter narrows the table',
      lowRows > 0 && bands.every((text) => text.trim().startsWith('Low')),
      `${lowRows} rows, all Low`,
    );
    await page.getByRole('tab', { name: /^All/ }).click();
    await page.waitForTimeout(500);
  }

  // search
  const firstRef = (await page.locator('tbody tr td:first-child').first().innerText()).split('\n')[0];
  await page.locator('#monitor-search').fill(firstRef);
  await page.waitForTimeout(700);
  const searchRows = await page.locator('tbody tr').count();
  check('search filters to a single transaction', searchRows === 1, `"${firstRef}" -> ${searchRows} row`);
  await page.locator('#monitor-search').fill('');
  await page.waitForTimeout(500);

  // pause / resume
  await page.getByRole('button', { name: /Pause feed/ }).click();
  await page.waitForTimeout(600);
  check('pausing the feed shows a notice', (await page.locator('text=Feed paused').count()) > 0);
  await page.getByRole('button', { name: /Resume feed/ }).click();
  await page.waitForTimeout(500);
  check('feed resumes', (await page.locator('text=Feed paused').count()) === 0);

  // detail drawer
  await page.locator('tbody tr').first().click();
  await page.waitForTimeout(800);
  const drawer = page.getByRole('dialog', { name: 'Transaction detail' });
  check('clicking a row opens the detail drawer', await drawer.isVisible());
  check(
    'drawer shows behavioural context',
    (await drawer.locator('text=Behavioural context').count()) > 0,
  );
  check(
    'drawer explains the ground-truth label',
    (await drawer.locator('text=Ground truth').count()) > 0,
  );
  await page.locator('[aria-label="Close detail"]').click();
  await page.waitForTimeout(500);
  check('drawer closes', (await page.getByRole('dialog', { name: 'Transaction detail' }).count()) === 0);

  // ---------------------------------------------------------------- alerts
  await page.goto(appUrl + '/app/alerts', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const alertRows = await page.locator('tbody tr').count();
  check('alerts page lists raised alerts', alertRows > 0, `${alertRows} alerts`);

  if (alertRows > 0) {
    const select = page.locator('select[id^="status-"]').first();
    const alertId = (await select.getAttribute('id')).replace('status-', '');
    await select.selectOption('investigating');
    await page.waitForTimeout(2500);
    const uiValue = await page.locator(`#status-${alertId}`).inputValue();
    const serverAlerts = await fetch(`${apiUrl}/api/alerts?limit=80`).then((r) => r.json());
    const serverAlert = serverAlerts.alerts.find((item) => item.transaction_id === alertId);
    check(
      'alert triage persists to the engine',
      uiValue === 'investigating' && serverAlert && serverAlert.status === 'investigating',
      `ui=${uiValue} engine=${serverAlert ? serverAlert.status : 'missing'}`,
    );

    await page.getByRole('tab', { name: /^Investigating/ }).click();
    await page.waitForTimeout(700);
    check(
      'status filter finds the triaged alert',
      (await page.locator('tbody tr').count()) > 0,
    );
  }

  // -------------------------------------------------------------- accounts
  await page.goto(appUrl + '/app/accounts', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const accountRows = await page.locator('tbody tr').count();
  check('accounts page lists escalated accounts', accountRows > 0, `${accountRows} rows`);

  const expander = page.locator('button[aria-label^="Show signals"]').first();
  if (await expander.count()) {
    await expander.click();
    await page.waitForTimeout(700);
    check(
      'expanding an account reveals the weighted signals',
      (await page.locator('text=Weighted risk signals').count()) > 0,
    );
  } else {
    check('expanding an account reveals the weighted signals', false, 'no expander rendered');
  }

  // -------------------------------------------------------- stop from the UI
  await page.goto(appUrl + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const stopButton = page.getByRole('button', { name: 'Stop stream' });
  if (await stopButton.count()) {
    await stopButton.click();
    await page.waitForTimeout(2500);
    const after = await fetch(`${apiUrl}/api/stream/status`).then((r) => r.json());
    check('stopping from the UI halts the engine', after.is_running === false, after.status);
    check(
      'button returns to Start stream',
      (await page.getByRole('button', { name: 'Start stream' }).count()) === 1,
    );
  } else {
    // The run may have completed on its own before we got here.
    const after = await fetch(`${apiUrl}/api/stream/status`).then((r) => r.json());
    check('stream reached a terminal state', after.is_running === false, after.status);
  }

  // ------------------------------------------------------------------- 404
  await page.goto(appUrl + '/definitely-not-a-page', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check(
    'unknown route renders the 404 page',
    (await page.locator('text=That page does not exist').count()) > 0,
  );

  // -------------------------------------------------------------- sign out
  await page.goto(appUrl + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('[aria-label="Sign out"]').click();
  await page.waitForTimeout(1500);
  await page.goto(appUrl + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check(
    'signing out re-enables the auth guard',
    new URL(page.url()).pathname === '/login',
    page.url(),
  );

  // ---------------------------------------------------------------- mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const small = await mobile.newPage();
  await small.goto(appUrl + '/', { waitUntil: 'networkidle' });
  check('landing renders on a phone viewport', await small.locator('h1').isVisible());
  await small.locator('[aria-controls="mobile-nav"]').click();
  await small.waitForTimeout(500);
  check('mobile navigation opens', await small.locator('#mobile-nav').isVisible());

  await small.goto(appUrl + '/login', { waitUntil: 'networkidle' });
  await small.locator('button', { hasText: 'Continue without Supabase' }).click();
  await small.waitForURL(/\/app/, { timeout: 20000 });
  await small.waitForTimeout(1500);
  check('console loads on a phone viewport', await small.locator('h1').isVisible());
  await small.locator('[aria-label="Open navigation"]').click();
  await small.waitForTimeout(600);
  // Scope to the sidebar: "Live monitor" also appears as a shortcut in the page body.
  check(
    'console sidebar opens on mobile',
    await small
      .getByLabel('Sections')
      .getByRole('link', { name: 'Live monitor' })
      .isVisible(),
  );
  await mobile.close();

  await browser.close();

  console.log('-'.repeat(72));
  console.log(
    consoleErrors.length
      ? 'console errors:\n  ' + consoleErrors.slice(0, 10).join('\n  ')
      : 'console errors: none',
  );
  console.log(`${passed}/${passed + failed} interaction checks passed`);
  return failed === 0 && consoleErrors.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.log('HARNESS FAILURE: ' + error.message);
    process.exit(2);
  });

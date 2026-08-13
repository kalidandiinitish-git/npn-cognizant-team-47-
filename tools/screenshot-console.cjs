/**
 * Signs into the console in demo mode, starts a stream, and screenshots every
 * page so the dashboard can be verified visually.
 *
 * Requires: the FastAPI engine on :8000 and `vite preview` on :4173, plus
 * VITE_DEMO_MODE=true in the build.
 *
 * Usage: node tools/screenshot-console.cjs <appUrl> <apiUrl> <outDir>
 */
const path = require('path');
const fs = require('fs');

const RUNTIME_MODULES =
  'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const playwright = require(path.join(RUNTIME_MODULES, 'playwright'));

const appUrl = process.argv[2] || 'http://localhost:4173';
const apiUrl = process.argv[3] || 'http://localhost:8000';
const outDir = process.argv[4] || path.join(__dirname, '..', 'logs', 'screens');
fs.mkdirSync(outDir, { recursive: true });

async function seedStream() {
  // Any stream left running from an earlier session would block this one, and
  // the engine correctly answers 409 rather than silently doing nothing.
  await fetch(`${apiUrl}/api/stream/stop`, { method: 'POST' }).catch(() => {});

  // Start near labelled fraud so the dashboard has alerts to show.
  const info = await fetch(`${apiUrl}/api/dataset/info`).then((response) => response.json());
  const skip = (info.fraud_index && info.fraud_index.recommended_skip) || 0;
  const response = await fetch(`${apiUrl}/api/stream/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // A small pace spreads the run across several one-second buckets so the
    // timeline charts show a curve rather than a single point.
    body: JSON.stringify({ limit: 260, delay_ms: 12, skip, persist: false, reset: true }),
  });
  console.log('stream start: ' + response.status + ' skip=' + skip);
  if (response.status !== 200) {
    console.log('FAILED to start stream: ' + (await response.text()));
    process.exit(1);
  }
  // Let the run finish so the charts and tables have content.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await fetch(`${apiUrl}/api/stream/status`).then((r) => r.json());
    if (!status.is_running) {
      console.log(`stream finished: processed=${status.processed} status=${status.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log('WARNING: stream did not finish inside the timeout');
}

(async () => {
  await seedStream();

  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1020 } });
  const page = await context.newPage();

  const errors = [];
  const notFound = new Set();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('response', (response) => {
    if (response.status() === 404) notFound.add(response.url());
  });

  await page.goto(`${appUrl}/login`, { waitUntil: 'networkidle' });
  const demoButton = page.locator('button', { hasText: 'Continue without Supabase' });
  if (!(await demoButton.count())) {
    console.log('FAILED: demo button not present - was the build made with VITE_DEMO_MODE=true?');
    await browser.close();
    process.exit(1);
  }
  await demoButton.click();
  await page.waitForURL('**/app', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const pages = [
    { name: 'console-overview', url: '/app' },
    { name: 'console-monitor', url: '/app/monitor' },
    { name: 'console-alerts', url: '/app/alerts' },
    { name: 'console-accounts', url: '/app/accounts' },
    { name: 'console-analytics', url: '/app/analytics' },
    { name: 'console-dataset', url: '/app/dataset' },
  ];

  for (const target of pages) {
    await page.goto(appUrl + target.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    const file = path.join(outDir, target.name + '.png');
    await page.screenshot({ path: file });
    const summary = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const empties = Array.from(document.querySelectorAll('p')).filter((node) =>
        /No transactions yet|No alerts raised|No accounts flagged|waiting for data|No trained model/i.test(
          node.textContent || '',
        ),
      ).length;
      return {
        heading: h1 ? h1.innerText.trim() : null,
        rows: document.querySelectorAll('tbody tr').length,
        empties,
      };
    });
    console.log(
      `${target.name}: h1="${summary.heading}" tableRows=${summary.rows} emptyStates=${summary.empties}`,
    );
  }

  console.log(errors.length ? 'console-errors:\n  ' + errors.slice(0, 10).join('\n  ') : 'console-errors: none');
  console.log(notFound.size ? 'not-found:\n  ' + [...notFound].join('\n  ') : 'not-found: none');
  await browser.close();
})().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});

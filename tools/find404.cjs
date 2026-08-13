/** Lists every URL that 404s during a single page load. */
const path = require('path');
const RUNTIME_MODULES =
  'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const playwright = require(path.join(RUNTIME_MODULES, 'playwright'));

const url = process.argv[2] || 'http://127.0.0.1:5173/login';
const origin = new URL(url).origin;
const needsLogin = new URL(url).pathname.startsWith('/app');

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const misses = [];
  page.on('response', (response) => {
    if (response.status() === 404) misses.push(response.request().resourceType() + ' ' + response.url());
  });

  if (needsLogin) {
    await page.goto(origin + '/login', { waitUntil: 'networkidle' });
    await page.locator('button', { hasText: 'Continue without Supabase' }).click();
    await page.waitForURL('**/app', { timeout: 20000 });
    await page.waitForTimeout(1200);
    misses.length = 0; // only report misses for the page under test
  }

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  console.log(misses.length ? misses.join('\n') : 'no-404s');
  await browser.close();
})().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});

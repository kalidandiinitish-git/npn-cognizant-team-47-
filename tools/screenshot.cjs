/**
 * Renders the built frontend in a headless browser and captures screenshots.
 * Used to verify the UI actually paints, not just that it compiles.
 *
 * Usage: node tools/screenshot.cjs <baseUrl> <outDir>
 */
const path = require('path');
const fs = require('fs');

const RUNTIME_MODULES =
  'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';

let playwright;
try {
  playwright = require(path.join(RUNTIME_MODULES, 'playwright'));
} catch (error) {
  console.log('playwright-unavailable: ' + error.message);
  process.exit(2);
}

const baseUrl = process.argv[2] || 'http://localhost:4173';
const outDir = process.argv[3] || path.join(__dirname, '..', 'logs', 'screens');
fs.mkdirSync(outDir, { recursive: true });

const CHANNELS = ['msedge', 'chrome', undefined];

async function launch() {
  const errors = [];
  for (const channel of CHANNELS) {
    try {
      const browser = await playwright.chromium.launch(
        channel ? { channel, headless: true } : { headless: true },
      );
      console.log('launched: ' + (channel || 'bundled chromium'));
      return browser;
    } catch (error) {
      errors.push((channel || 'bundled') + ': ' + error.message.split('\n')[0]);
    }
  }
  throw new Error('no browser available -> ' + errors.join(' | '));
}

(async () => {
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));

  const shots = [
    { name: 'landing-top', url: '/', fullPage: false },
    { name: 'landing-full', url: '/', fullPage: true },
    { name: 'login', url: '/login', fullPage: false },
  ];

  for (const shot of shots) {
    await page.goto(baseUrl + shot.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(700);
    const file = path.join(outDir, shot.name + '.png');
    await page.screenshot({ path: file, fullPage: shot.fullPage });
    const heading = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.innerText.replace(/\s+/g, ' ').trim() : null;
    });
    const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
    console.log(`${shot.name}: h1="${heading}" nodes=${nodes} -> ${file}`);
  }

  // The protected route should bounce an unauthenticated visitor to /login.
  await page.goto(baseUrl + '/app', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(900);
  console.log('guard: /app landed on ' + new URL(page.url()).pathname);

  if (consoleErrors.length) {
    console.log('console-errors:');
    consoleErrors.slice(0, 12).forEach((line) => console.log('  ' + line));
  } else {
    console.log('console-errors: none');
  }

  await browser.close();
})().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});

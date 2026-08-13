const path = require('path');
const { pathToFileURL } = require('url');

const RUNTIME_MODULES = 'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const { chromium } = require(path.join(RUNTIME_MODULES, 'playwright'));

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'docs', 'FraudStream-AI-Project-Report.html');
const output = path.join(root, 'docs', 'FraudStream-AI-Project-Report.pdf');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  page.on('console', message => {
    if (message.type() === 'error') failures.push(message.text());
  });
  page.on('pageerror', error => failures.push(error.message));

  await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.complete
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', reject, { once: true });
        })));
  });

  const inspection = await page.evaluate(() => ({
    title: document.title,
    sections: document.querySelectorAll('section').length,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tbody tr').length,
    images: Array.from(document.images).map(image => ({
      source: image.getAttribute('src'),
      loaded: image.complete && image.naturalWidth > 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:7px;color:#788398;padding:0 14mm 5mm;display:flex;justify-content:space-between"><span>FraudStream AI · Project Audit &amp; Verification Report</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });

  console.log(JSON.stringify({ source, output, inspection, browserFailures: failures }, null, 2));
  await browser.close();
  if (failures.length || inspection.images.some(image => !image.loaded) || inspection.horizontalOverflow) {
    process.exitCode = 2;
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

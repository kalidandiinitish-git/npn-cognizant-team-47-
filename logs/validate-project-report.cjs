const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const RUNTIME_MODULES = 'C:\\Users\\Nitish\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const { chromium } = require(path.join(RUNTIME_MODULES, 'playwright'));
const root = path.resolve(__dirname, '..');
const pdfPath = path.join(root, 'docs', 'FraudStream-AI-Project-Report.pdf');
const htmlPath = path.join(root, 'docs', 'FraudStream-AI-Project-Report.html');
const viewerShot = path.join(root, 'logs', 'report-pdf-first-page.png');

(async () => {
  const data = fs.readFileSync(pdfPath);
  const latin = data.toString('latin1');
  const pageCount = (latin.match(/\/Type\s*\/Page\b/g) || []).length;
  const mediaBoxes = [...latin.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map(match => match.slice(1).map(Number));
  const distinctMediaBoxes = [...new Set(mediaBoxes.map(box => box.join(',')))];
  const binary = {
    exists: fs.existsSync(pdfPath),
    bytes: data.length,
    mebibytes: Number((data.length / 1024 / 1024).toFixed(2)),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    header: data.subarray(0, 8).toString('ascii'),
    hasPdfHeader: data.subarray(0, 5).toString('ascii') === '%PDF-',
    hasEofMarker: latin.trimEnd().endsWith('%%EOF'),
    pageCount,
    mediaBoxes: distinctMediaBoxes,
    a4MediaBoxPresent: mediaBoxes.some(([, , width, height]) =>
      Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1,
    ),
  };

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const html = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  html.on('pageerror', error => errors.push(error.message));
  html.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await html.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await html.emulateMedia({ media: 'print' });
  const layout = await html.evaluate(() => {
    const root = document.documentElement;
    const bad = [];
    for (const element of document.querySelectorAll('table, img, .card, .callout, .flow, .image-grid')) {
      const box = element.getBoundingClientRect();
      if (box.left < -0.5 || box.right > root.scrollWidth + 0.5) {
        bad.push({ tag: element.tagName, cls: element.className, left: box.left, right: box.right });
      }
    }
    return {
      title: document.title,
      bodyTextCharacters: document.body.innerText.length,
      sections: document.querySelectorAll('section').length,
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tbody tr').length,
      headings: document.querySelectorAll('h1,h2,h3').length,
      images: Array.from(document.images).map(image => ({
        source: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0,
      })),
      horizontalOverflow: root.scrollWidth > root.clientWidth,
      clippedWideElements: bad,
      requiredMarkers: {
        executive: document.body.innerText.includes('Executive assessment'),
        inventory: document.body.innerText.includes('Every project-owned file reviewed'),
        model: document.body.innerText.includes('Measured XGBoost performance'),
        security: document.body.innerText.includes('Sound schema foundation'),
        traceability: document.body.innerText.includes('Functional requirements'),
        recommendations: document.body.innerText.includes('Prioritized remediation plan'),
        limitations: document.body.innerText.includes('Verification boundaries'),
      },
    };
  });

  let viewer = { rendered: false, screenshot: null, title: null, error: null };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(pathToFileURL(pdfPath).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: viewerShot });
    viewer = {
      rendered: fs.existsSync(viewerShot) && fs.statSync(viewerShot).size > 10000,
      screenshot: viewerShot,
      screenshotBytes: fs.existsSync(viewerShot) ? fs.statSync(viewerShot).size : 0,
      title: await page.title(),
      url: page.url(),
      error: null,
    };
  } catch (error) {
    viewer.error = error.message;
  }
  await browser.close();

  const checks = {
    binaryValid: binary.hasPdfHeader && binary.hasEofMarker && binary.bytes > 500000,
    pagesReasonable: binary.pageCount >= 20 && binary.pageCount <= 50,
    a4: binary.a4MediaBoxPresent,
    contentComplete: Object.values(layout.requiredMarkers).every(Boolean),
    imagesValid: layout.images.length === 6 && layout.images.every(image => image.loaded),
    layoutValid: !layout.horizontalOverflow && layout.clippedWideElements.length === 0,
    browserClean: errors.length === 0,
    viewerRendered: viewer.rendered,
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ passed, checks, binary, layout, browserErrors: errors, viewer }, null, 2));
  if (!passed) process.exitCode = 2;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

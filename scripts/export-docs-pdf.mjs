#!/usr/bin/env node
/**
 * Export admin About + Docs pages and static HTML docs to PDF.
 * Output: docs/export/pdf/*.pdf
 *
 * Usage: node scripts/export-docs-pdf.mjs
 */

import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs/export/pdf');
const HTML_DIR = path.join(ROOT, 'docs/export/html');
const ADMIN_DIST = path.join(ROOT, 'admin/dist');
const PREVIEW_PORT = 5198;

const ADMIN_ROUTES = [
  { file: 'admin-about.pdf', path: '/about', expandKeyDecisions: true, waitFor: /key decisions|about/i },
  { file: 'admin-docs-concepts.pdf', path: '/docs/concepts', waitFor: /concepts|value model/i },
  { file: 'admin-docs-payments.pdf', path: '/docs/payments', waitFor: /payment/i },
  { file: 'admin-docs-gas-fees.pdf', path: '/docs/gas-fees', waitFor: /gas/i },
  { file: 'admin-docs-merchant.pdf', path: '/docs/merchant', waitFor: /merchant/i },
  { file: 'admin-docs-contracts.pdf', path: '/docs/contracts', waitFor: /contract/i },
  { file: 'admin-docs-functions.pdf', path: '/docs/functions', waitFor: /function/i },
  { file: 'admin-docs-events.pdf', path: '/docs/events', waitFor: /event/i },
  { file: 'admin-docs-api.pdf', path: '/docs/api', waitFor: /api/i },
];

const STATIC_HTML = [
  { file: 'merchant-about.pdf', html: 'merchant-about.html' },
  { file: 'presentation-slides.pdf', html: 'presentation-slides.html' },
];

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function ensureAdminBuild() {
  if (await exists(path.join(ADMIN_DIST, 'index.html'))) return;
  console.log('Building admin app…');
  await run('npm', ['run', 'build'], path.join(ROOT, 'admin'));
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
      { cwd: path.join(ROOT, 'admin'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let ready = false;
    const onData = (buf) => {
      const s = buf.toString();
      if (!ready && /Local:\s+http/.test(s)) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    setTimeout(() => {
      if (!ready) {
        ready = true;
        resolve(child);
      }
    }, 8000);
  });
}

async function pdfPage(page, outPath, opts = {}) {
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
    ...opts,
  });
  console.log('  ✓', path.basename(outPath));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await ensureAdminBuild();

  const preview = await startPreview();
  const browser = await chromium.launch();

  try {
    const base = `http://127.0.0.1:${PREVIEW_PORT}/`;

    for (const route of ADMIN_ROUTES) {
      const url = base.replace(/\/$/, '') + route.path;
      console.log('Admin:', route.path);
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      if (route.waitFor) {
        await page.getByText(route.waitFor).first().waitFor({ timeout: 15_000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
      if (route.expandKeyDecisions) {
        const btn = page.getByRole('button', { name: /key decisions/i });
        if (await btn.count()) await btn.click();
        await page.waitForTimeout(300);
      }
      await page.addStyleTag({
        content: `
          aside { display: none !important; }
          main { padding: 0 !important; }
          .flex.h-screen > div.flex-1 { width: 100% !important; }
        `,
      });
      await pdfPage(page, path.join(OUT_DIR, route.file));
      await page.close();
    }

    const staticPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    for (const doc of STATIC_HTML) {
      const fileUrl = `file://${path.join(HTML_DIR, doc.html)}`;
      console.log('Static:', doc.html);
      await staticPage.goto(fileUrl, { waitUntil: 'load' });
      await staticPage.waitForTimeout(400);
      const slideOpts = doc.html === 'presentation-slides.html'
        ? { preferCSSPageSize: true }
        : {};
      await pdfPage(staticPage, path.join(OUT_DIR, doc.file), slideOpts);
    }
    await staticPage.close();
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }

  console.log(`\nDone — PDFs written to ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

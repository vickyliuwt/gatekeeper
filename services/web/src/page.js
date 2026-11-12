// Builds the Paste and Scan page once per cold start (Plan B: gk-results serves it at GET /).
// style.css, logic.js and app.js are inlined into index.html, and the Content-Security-Policy
// allows exactly those inline blocks by their SHA-256 hash. One route, no CORS, no web bucket.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

export function renderPage({ template, style, scripts }) {
  const script = scripts.join('\n');
  if (/<\/script/i.test(script) || /<\/style/i.test(style)) {
    throw new Error('Inline page assets must not contain a closing script or style tag');
  }
  if (!template.includes('<!--STYLE-->') || !template.includes('<!--SCRIPT-->')) {
    throw new Error('index.html needs the <!--STYLE--> and <!--SCRIPT--> markers');
  }

  // Replacer functions keep "$" characters in the assets literal.
  const page = template
    .replace('<!--STYLE-->', () => `<style>${style}</style>`)
    .replace('<!--SCRIPT-->', () => `<script>${script}</script>`);

  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256Base64(script)}'`,
    `style-src 'sha256-${sha256Base64(style)}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return { html: page, csp };
}

export function loadPage(dir = PUBLIC_DIR) {
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  return renderPage({
    template: read('index.html'),
    style: read('style.css'),
    scripts: [read('logic.js'), read('app.js')],
  });
}

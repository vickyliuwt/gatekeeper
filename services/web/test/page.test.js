import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPage, renderPage, PUBLIC_DIR } from '../src/page.js';

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
const between = (text, open, close) => text.slice(text.indexOf(open) + open.length, text.indexOf(close));

test('the policy hashes match the inline style and script exactly', () => {
  const { html, csp } = loadPage();
  const script = between(html, '<script>', '</script>');
  const style = between(html, '<style>', '</style>');
  assert.ok(csp.includes(`script-src 'sha256-${hash(script)}'`));
  assert.ok(csp.includes(`style-src 'sha256-${hash(style)}'`));
  assert.ok(csp.includes("connect-src 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});

test('the page has no inline event handlers or style attributes (they would break the policy)', () => {
  const { html } = loadPage();
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
  assert.equal(/\sstyle\s*=/i.test(html), false);
});

test('every element app.js looks up exists in index.html', () => {
  const app = readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf8');
  const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
  const ids = [...app.matchAll(/byId\('([a-z-]+)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 20);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing id="${id}"`);
});

test('assets that close their own tag are refused', () => {
  assert.throws(() => renderPage({ template: '<!--STYLE--><!--SCRIPT-->', style: '', scripts: ['</script><b>x</b>'] }), /closing/);
});

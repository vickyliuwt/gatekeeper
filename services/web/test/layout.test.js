// page layout + scope guards for the console
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../src/page.js';
import '../public/logic.js';

const { GK } = globalThis;
const read = (name) => readFileSync(join(PUBLIC_DIR, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('style.css');

test('AWS path boxes and activity steps match logic.js, in order', () => {
  assert.deepEqual([...html.matchAll(/data-node="([a-z]+)"/g)].map((m) => m[1]), [...GK.PIPELINE]);
  assert.deepEqual([...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]), [...GK.STEPS]);
  assert.deepEqual([...html.matchAll(/data-step-time="([a-z]+)"/g)].map((m) => m[1]), [...GK.STEPS]);
});

test('the AWS path card shows a write path and a separate read path', () => {
  assert.deepEqual([...html.matchAll(/data-path="([a-z]+)"/g)].map((m) => m[1]), ['write', 'read']);
  const write = html.slice(html.indexOf('data-path="write"'), html.indexOf('data-path="read"'));
  const readPart = html.slice(html.indexOf('data-path="read"'), html.indexOf('class="foot"'));
  for (const n of GK.WRITE_PATH) assert.match(write, new RegExp(`data-node="${n}"`));
  for (const n of GK.READ_PATH) assert.match(readPart, new RegExp(`data-node="${n}"`));
  assert.match(write, /POST \/scans/);
  assert.match(readPart, /GET \/scans\/\{id\}/);
  assert.match(readPart, /id="read-polls"/);
});

test('every sidebar link points to a real section', () => {
  const targets = [...html.matchAll(/data-nav="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['overview', 'scan', 'pipeline', 'report', 'checks', 'architecture']);
  for (const id of targets) {
    assert.match(html, new RegExp(`href="#${id}" data-nav="${id}"`));
    assert.match(html, new RegExp(`<(section|div)[^>]*id="${id}"`), `no section #${id}`);
  }
});

test('every id app.js looks up exists in index.html', () => {
  const ids = [...app.matchAll(/byId\('([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 60);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
});

test('every icon app.js or index.html uses has a symbol in the sprite', () => {
  const symbols = new Set([...html.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]));
  const used = [...app.matchAll(/icon\('([a-z-]+)'\)/g), ...html.matchAll(/href="#i-([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const name of used) assert.ok(symbols.has(name), `missing symbol i-${name}`);
});

test('scope guard: no upload, sign-in, fake totals, uptime or progress percent on the page', () => {
  const text = html.replace(/<symbol[\s\S]*?<\/symbol>/g, '').replace(/<svg class="art"[\s\S]*?<\/svg>/, '');
  assert.doesNotMatch(text, /\bupload\b|\.zip\b|sign in|log in|connect github|uptime|success rate|total scans|healthy|operational/i);
  assert.doesNotMatch(text, /\d+\s?%/);
  assert.doesNotMatch(app, /Math\.random/);
});

test('Learner Lab words stay honest: shared LabRole, read only by code', () => {
  assert.match(html, /LabRole/);
  assert.match(html, /CloudFront is blocked/);
  assert.doesNotMatch(html, /cannot write/i);
  assert.match(html, /CS6620 Cloud Computing/);
});

test('safety guard: no outside resources, no HTML writes, same-origin calls only', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(css, /url\(|@import/);
  assert.doesNotMatch(html, /\sstyle="|\son[a-z]+="/i);
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  // fetch: our own path only. getJson gets its path from the callers
  for (const call of app.matchAll(/fetch\(\s*([^,)]+)/g)) assert.match(call[1], /^(?:[`'"]\/|path$)/, `fetch must use our own path: ${call[1]}`);
  for (const call of app.matchAll(/getJson\(\s*([^,)]+)/g)) if (call[1] !== 'path') assert.match(call[1], /^[`'"]\//, `getJson must use our own path: ${call[1]}`);
});

test('every filter and the 3 severity rows exist', () => {
  assert.deepEqual([...html.matchAll(/data-filter="([A-Za-z]+)"/g)].map((m) => m[1]), ['all', 'HIGH', 'MEDIUM', 'LOW']);
  assert.deepEqual([...html.matchAll(/data-sev="([a-z]+)"/g)].map((m) => m[1]), ['high', 'medium', 'low']);
});

test('reduced motion is respected and the page has one h1', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('the access code box is a password field with a show button, and it is never saved', () => {
  assert.match(html, /<input id="access"[^>]*type="password"/);
  assert.match(html, /id="toggle-access"[^>]*aria-pressed="false"/);
  assert.match(app, /function hideAccess\(\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*access/i);
  assert.doesNotMatch(app, /searchParams\.set\([^)]*access/i);
});

test('hero tags sit in the button row, so the first screen stays short', () => {
  const cta = html.slice(html.indexOf('class="hero-cta"'), html.indexOf('class="hero-art"'));
  assert.match(cta, /class="tags"/);
});

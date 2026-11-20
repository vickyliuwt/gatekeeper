// file name box tests
// names like demo risk js got cut at 1440 and 1536 and 1920 px
// now the box keeps room for about 15 letters and the size hint goes to a new line
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('file box wants room for about 15 letters', () => {
  assert.match(css, /\.file-field \{ flex: 1 1 calc\(15ch \+ 32px\); max-width: calc\(19ch \+ 40px\); \}/);
});

test('a long file name ends with dots and never overflows', () => {
  assert.match(css, /\.file-field input \{ width: 100%; min-width: 0; text-overflow: ellipsis; \}/);
});

test('code box has 8 rows so Run still shows on a laptop screen', () => {
  assert.match(html, /<textarea id="code"[^>]* rows="8"/);
  assert.doesNotMatch(html, /<textarea id="code"[^>]* rows="9"/);
});

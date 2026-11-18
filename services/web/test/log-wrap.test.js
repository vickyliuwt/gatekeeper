// scan log lines wrap under the path and the box shows whole lines
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('a long log line wraps under the path, not under GET', () => {
  assert.match(css, /\.log-text \{ display: flex; align-items: baseline;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.log-text > \.verb, \.log-text > \.count \{ flex: none; \}/);
});

test('the log box is 7 whole lines high so no line is cut in half', () => {
  assert.match(css, /\.log-lines \{[^}]*max-height: calc\(7 \* 1\.7em\);[^}]*line-height: 1\.7;/);
  assert.doesNotMatch(css, /\.log-lines \{[^}]*max-height: 150px/);
});

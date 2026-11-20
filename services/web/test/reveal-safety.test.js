// the hero and stats must show even if a script breaks
// so css alone turns hidden reveal cards visible after a short wait
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('hidden reveal cards turn visible by css alone', () => {
  assert.match(css, /\.js \.reveal:not\(\.is-in\)\s*\{[^}]*animation:[^}]*2s forwards/);
  assert.match(css, /@keyframes gk-show\s*\{[^}]*opacity:\s*1/);
});

test('people who ask for less motion still see the cards at once', () => {
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.js \.reveal \{ opacity: 1; transform: none; \}/);
});

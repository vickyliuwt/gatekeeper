// input rules for gk-submit and gk-results
export const MAX_CODE_BYTES = 100 * 1024;
export const MAX_BODY_BYTES = 600 * 1024;
export const DEFAULT_FILENAME = 'snippet.js';

const PR_JOB_ID = /^pr-[1-9][0-9]{0,19}-[0-9a-f]{40}$/;
const PASTE_JOB_ID = /^paste-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FILE_EXTENSION = /\.(?:js|mjs|cjs)$/;

// job ID = pr-<repoId>-<40 hex> or paste-<UUID v4>. anything else: no lookup
export function isJobId(value) {
  return typeof value === 'string' && (PR_JOB_ID.test(value) || PASTE_JOB_ID.test(value));
}

// gives back the file name to save, or null if the name breaks the rule
export function normalizeFilename(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_FILENAME;
  if (typeof value !== 'string') return null;
  return FILE_NAME.test(value) && FILE_EXTENSION.test(value) ? value : null;
}

export function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8');
}

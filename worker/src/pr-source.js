const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

function isSourceFile(entry) {
  if (entry.type !== 'blob') return false;
  if (!['100644', '100755'].includes(entry.mode)) return false;

  const parts = entry.path.split('/');
  const directories = parts.slice(0, -1);

  if (directories.some(name => name === 'node_modules' || name.startsWith('.'))) {
    return false;
  }

  return /\.(js|mjs|cjs|ts)$/i.test(entry.path);
}

export async function fetchPrFiles(job, {
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (job?.source !== 'pr') {
    throw new TypeError('Expected a PR job');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(job.repo ?? '')) {
    throw new TypeError('Invalid repository name');
  }
  if (!SHA_PATTERN.test(job.headSha ?? '')) {
    throw new TypeError('Invalid head SHA');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'gatekeeper-worker',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const baseUrl = `https://api.github.com/repos/${job.repo}`;

  async function getJson(path) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers,
      signal: controller.signal,
      redirect: 'error',
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub source request failed: HTTP ${response.status}`);
    }

    return response.json();
  }

  try {
    const commit = await getJson(`/git/commits/${job.headSha}`);
    if (commit.sha !== job.headSha || !SHA_PATTERN.test(commit.tree?.sha ?? '')) {
      throw new Error('GitHub returned an unexpected commit');
    }

    const tree = await getJson(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) {
      throw new Error('Repository tree is incomplete');
    }

    const entries = tree.tree.filter(isSourceFile);
    if (entries.length > MAX_FILES) {
      throw new Error(`Source file count exceeds ${MAX_FILES}`);
    }

    let expectedBytes = 0;
    for (const entry of entries) {
      if (!SHA_PATTERN.test(entry.sha ?? '')) {
        throw new Error('Invalid source blob SHA');
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error('Invalid source file size');
      }
      if (entry.size > MAX_FILE_BYTES) {
        throw new Error(`Source file exceeds ${MAX_FILE_BYTES} bytes`);
      }
      expectedBytes += entry.size;
    }

    if (expectedBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Source files exceed ${MAX_TOTAL_BYTES} bytes`);
    }

    const files = [];
    for (const entry of entries) {
      const blob = await getJson(`/git/blobs/${entry.sha}`);
      if (
        blob.sha !== entry.sha ||
        blob.encoding !== 'base64' ||
        typeof blob.content !== 'string'
      ) {
        throw new Error('GitHub returned an unexpected source blob');
      }

      const bytes = Buffer.from(blob.content, 'base64');
      if (bytes.length !== entry.size) {
        throw new Error('Source blob size does not match the repository tree');
      }

      files.push({
        filename: entry.path,
        code: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      });
    }

    return files;
  } finally {
    clearTimeout(timer);
  }
}

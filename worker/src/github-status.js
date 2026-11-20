const STATES = new Set(['pending', 'success', 'failure', 'error']);

export async function publishCommitStatus(job, {
  state,
  description,
  token,
  targetUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (job?.source !== 'pr') {
    throw new TypeError('Expected a PR job');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(job.repo ?? '')) {
    throw new TypeError('Invalid repository name');
  }
  if (!/^[0-9a-f]{40}$/.test(job.headSha ?? '')) {
    throw new TypeError('Invalid head SHA');
  }
  if (!STATES.has(state)) {
    throw new TypeError('Invalid commit status state');
  }
  if (
    typeof description !== 'string' ||
    description.trim() === '' ||
    description.length > 140
  ) {
    throw new TypeError('Status description must contain 1 to 140 characters');
  }
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('GitHub token is required for status publishing');
  }
  // optional Details link and it must be a plain https link
  if (
    targetUrl !== undefined &&
    (typeof targetUrl !== 'string' || !/^https:\/\/\S+$/.test(targetUrl) || targetUrl.length > 2048)
  ) {
    throw new TypeError('Invalid status target URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${job.repo}/statuses/${job.headSha}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'gatekeeper-worker',
        },
        body: JSON.stringify({
          state,
          context: 'gatekeeper/sast',
          description,
          ...(targetUrl ? { target_url: targetUrl } : {}),
        }),
      },
    );

    await response.body?.cancel();

    if (response.status !== 201) {
      throw new Error(
        `GitHub status request failed: HTTP ${response.status}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

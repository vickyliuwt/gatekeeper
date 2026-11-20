const RETENTION_SECONDS = 30 * 24 * 60 * 60;

// Call after signature verification and event classification.
export function buildPrJob(payload, traceId, now = new Date()) {
  const repository = payload?.repository;
  const pr = payload?.pull_request;

  if (!Number.isSafeInteger(repository?.id) || repository.id <= 0) {
    throw new TypeError('Invalid repository ID');
  }

  if (
    typeof repository.full_name !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(repository.full_name)
  ) {
    throw new TypeError('Invalid repository name');
  }

  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) {
    throw new TypeError('Invalid pull request number');
  }

  const headSha = pr.head?.sha;

  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new TypeError('Invalid head SHA');
  }

  if (
    typeof traceId !== 'string' ||
    traceId.length > 128 ||
    !/^[A-Za-z0-9-]+$/.test(traceId)
  ) {
    throw new TypeError('Invalid delivery ID');
  }

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid timestamp');
  }

  const timestamp = now.toISOString();

  return {
    jobId: `pr-${repository.id}-${headSha}`,
    source: 'pr',
    repo: repository.full_name,
    prNumber: pr.number,
    headSha,
    phase: 'QUEUED',
    attempt: 0,
    traceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: Math.floor(now.getTime() / 1000) + RETENTION_SECONDS,
  };
}

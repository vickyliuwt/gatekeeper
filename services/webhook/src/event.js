const acceptedActions = new Set([
  'opened',
  'reopened',
  'synchronize',
]);

// Call only after signature verification and JSON parsing.
export function classifyEvent(eventName, payload, allowedRepo) {
  if (
    typeof allowedRepo !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(allowedRepo)
  ) {
    throw new Error('Allowed repository is not configured correctly');
  }

  if (eventName !== 'ping' && eventName !== 'pull_request') {
    return { kind: 'ignored', reason: 'unsupported_event' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { kind: 'invalid', reason: 'invalid_payload' };
  }

  const repo = payload.repository?.full_name;

  if (typeof repo !== 'string') {
    return { kind: 'invalid', reason: 'missing_repository' };
  }

  if (repo.toLowerCase() !== allowedRepo.toLowerCase()) {
    return { kind: 'forbidden', reason: 'repository_not_allowed' };
  }

  if (eventName === 'ping') {
    return { kind: 'ping' };
  }

  if (typeof payload.action !== 'string') {
    return { kind: 'invalid', reason: 'missing_action' };
  }

  if (!acceptedActions.has(payload.action)) {
    return { kind: 'ignored', reason: 'unsupported_action' };
  }

  return { kind: 'pr' };
}

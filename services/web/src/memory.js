// memory versions of DynamoDB, S3 and SQS
// the local server and the tests use them, so no AWS account needed
function conditionFailed() {
  const error = new Error('Job already exists');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

export function createMemoryStore() {
  const items = new Map();
  return {
    items,
    async create(job) {
      if (items.has(job.jobId)) throw conditionFailed();
      items.set(job.jobId, structuredClone(job));
    },
    async get(jobId) {
      return items.has(jobId) ? structuredClone(items.get(jobId)) : null;
    },
    // like Query on the byRepoTime index: only this repo, newest first
    async listRecent(repo, limit) {
      return [...items.values()]
        .filter((job) => job.repo === repo)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map((job) => structuredClone(job));
    },
    // only the local worker + test seeds use these 2. in AWS the worker writes
    async put(job) {
      items.set(job.jobId, structuredClone(job));
    },
    async update(jobId, fields) {
      if (!items.has(jobId)) return null;
      const job = { ...items.get(jobId), ...structuredClone(fields) };
      items.set(jobId, job);
      return structuredClone(job);
    },
  };
}

export function createMemoryBlobs() {
  const objects = new Map();
  return {
    objects,
    async put(key, text, contentType) {
      objects.set(key, { text: String(text), contentType });
    },
    async getText(key) {
      return objects.has(key) ? objects.get(key).text : null;
    },
  };
}

export function createMemoryQueue({ beforeSend } = {}) {
  const messages = [];
  return {
    messages,
    async send(message) {
      if (beforeSend) await beforeSend(message);
      messages.push({ ...message });
    },
    take() {
      return messages.shift() ?? null;
    },
  };
}

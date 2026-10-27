import { createApp } from './app.js';
import { createIntake } from './intake.js';

const jobs = new Map();
const messages = [];

const intake = createIntake({
  secret: process.env.WEBHOOK_SECRET,
  allowedRepo: process.env.ALLOWED_REPO,

  createJobIfAbsent: async (job) => {
    const created = !jobs.has(job.jobId);

    if (created) {
      jobs.set(job.jobId, { ...job });
    }

    console.log(JSON.stringify({
      svc: 'webhook-local',
      stage: 'store',
      jobId: job.jobId,
      traceId: job.traceId,
      created,
      jobCount: jobs.size,
    }));
  },

  enqueue: async (message) => {
    messages.push({ ...message });

    console.log(JSON.stringify({
      svc: 'webhook-local',
      stage: 'enqueue',
      ...message,
      messageCount: messages.length,
    }));
  },
});

const app = createApp({ intake });

app.listen(3001, '127.0.0.1', () => {
  console.log(
    'LOCAL MOCK ONLY: http://127.0.0.1:3001/webhooks/github',
  );
});

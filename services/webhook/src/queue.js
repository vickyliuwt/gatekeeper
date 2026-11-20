import { SendMessageCommand } from '@aws-sdk/client-sqs';

export function createJobQueue({ sqsClient, queueUrl }) {
  if (typeof sqsClient?.send !== 'function') {
    throw new TypeError('SQS client is required');
  }

  if (typeof queueUrl !== 'string' || queueUrl.trim() === '') {
    throw new Error('SQS queue URL is required');
  }

  return {
    async enqueue({ jobId, traceId }) {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ jobId, traceId }),
      }));
    },
  };
}

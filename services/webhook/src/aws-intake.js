import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createIntake } from './intake.js';
import { createJobStore } from './store.js';
import { createJobQueue } from './queue.js';

export function createAwsIntake({ secret, allowedRepo, tableName, queueUrl }) {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const store = createJobStore({ documentClient, tableName });
  const queue = createJobQueue({ sqsClient: new SQSClient({}), queueUrl });

  return createIntake({
    secret,
    allowedRepo,
    createJobIfAbsent: store.createJobIfAbsent,
    enqueue: queue.enqueue,
  });
}

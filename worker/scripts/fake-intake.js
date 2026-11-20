import crypto from 'node:crypto';
import fs from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const REGION = process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sqs = new SQSClient({ region: REGION });

const file = process.argv[2];
if (!file) {
  console.error('usage: node worker/scripts/fake-intake.js <file.js>');
  process.exit(1);
}

const code = fs.readFileSync(file, 'utf-8');
const jobId = `paste-${crypto.randomUUID()}`;
const traceId = crypto.randomUUID();
const codeKey = `pasted/${jobId}.js`;
const now = new Date().toISOString();

await s3.send(new PutObjectCommand({
  Bucket: process.env.REPORTS_BUCKET,
  Key: codeKey,
  ContentType: 'text/javascript',
  Body: code
}));

await ddb.send(new PutCommand({
  TableName: process.env.JOBS_TABLE,
  Item: {
    jobId, traceId, source: 'paste', phase: 'QUEUED', attempt: 0,
    codeKey, filename: file.split('/').pop(),
    createdAt: now, updatedAt: now
  },
  ConditionExpression: 'attribute_not_exists(jobId)'
}));

await sqs.send(new SendMessageCommand({
  QueueUrl: process.env.QUEUE_URL,
  MessageBody: JSON.stringify({ jobId, traceId })
}));

console.log(JSON.stringify({ stage: 'queued', jobId, traceId, bytes: code.length }));
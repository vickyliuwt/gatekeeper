// Lambda entry points of the gatekeeper/web image (one image, two functions).
//   gk-results: handler src/lambda.resultsHandler (GET /, GET /scans, GET /scans/{jobId}, GET /scans/{jobId}/report)
//   gk-submit:  handler src/lambda.submitHandler  (POST /scans)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SSMClient } from '@aws-sdk/client-ssm';
import { createAwsBlobs, createAwsQueue, createAwsStore, createSecretReader } from './aws.js';
import { createGatewayHandler } from './gateway.js';
import { createLogger } from './log.js';
import { loadPage } from './page.js';
import { createResults, resultsRoutes } from './results.js';
import { createSubmit } from './submit.js';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
let submitGateway;
let resultsGateway;

function buildSubmit() {
  const log = createLogger('submit');
  const submit = createSubmit({
    getAccessCode: createSecretReader({ ssmClient: new SSMClient({}), name: requiredEnv('DEMO_CODE_PARAM') }),
    blobs: createAwsBlobs({ s3Client, bucket: requiredEnv('DATA_BUCKET_NAME') }),
    store: createAwsStore({ documentClient, tableName: requiredEnv('JOBS_TABLE_NAME') }),
    queue: createAwsQueue({ sqsClient: new SQSClient({}), queueUrl: requiredEnv('JOBS_QUEUE_URL') }),
    log,
  });
  return createGatewayHandler({ 'POST /scans': submit }, { log });
}

function buildResults() {
  const log = createLogger('results');
  const results = createResults({
    store: createAwsStore({ documentClient, tableName: requiredEnv('JOBS_TABLE_NAME') }),
    blobs: createAwsBlobs({ s3Client, bucket: requiredEnv('DATA_BUCKET_NAME') }),
    allowedRepo: process.env.ALLOWED_REPO ?? '',
    page: loadPage(),
    log,
  });
  return createGatewayHandler(resultsRoutes(results), { log });
}

export async function submitHandler(event) {
  submitGateway ??= buildSubmit();
  return submitGateway(event);
}

export async function resultsHandler(event) {
  resultsGateway ??= buildResults();
  return resultsGateway(event);
}

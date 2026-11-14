// real AWS calls for the 2 web Lambdas (DynamoDB, S3, SQS, SSM)
// handlers only see these small objects, so tests use src/memory.js instead
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetParameterCommand } from '@aws-sdk/client-ssm';

export function createAwsStore({ documentClient, tableName }) {
  if (!tableName) throw new Error('JOBS_TABLE_NAME is required');
  return {
    async create(job) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: job,
        ConditionExpression: 'attribute_not_exists(#jobId)',
        ExpressionAttributeNames: { '#jobId': 'jobId' },
      }));
    },
    async get(jobId) {
      const result = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { jobId },
        ConsistentRead: true,
      }));
      return result.Item ?? null;
    },
    async listRecent(repo, limit) {
      const result = await documentClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'byRepoTime',
        KeyConditionExpression: '#repo = :repo',
        ExpressionAttributeNames: { '#repo': 'repo' },
        ExpressionAttributeValues: { ':repo': repo },
        ScanIndexForward: false,
        Limit: limit,
      }));
      return result.Items ?? [];
    },
  };
}

export function createAwsBlobs({ s3Client, bucket }) {
  if (!bucket) throw new Error('DATA_BUCKET_NAME is required');
  return {
    async put(key, text, contentType) {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: text,
        ContentType: contentType,
      }));
    },
    async getText(key) {
      try {
        const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await result.Body.transformToString('utf-8');
      } catch (error) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
  };
}

export function createAwsQueue({ sqsClient, queueUrl }) {
  if (!queueUrl) throw new Error('JOBS_QUEUE_URL is required');
  return {
    async send({ jobId, traceId }) {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ jobId, traceId }),
      }));
    },
  };
}

// read the access code (SSM SecureString) and keep it 5 min
// so a new code works within 5 min, no redeploy
export function createSecretReader({ ssmClient, name, ttlMs = 5 * 60 * 1000, now = () => Date.now() }) {
  if (!name) throw new Error('DEMO_CODE_PARAM is required');
  let cached = null;
  let loadedAt = 0;
  let pending = null;

  return async function readParameter() {
    if (cached !== null && now() - loadedAt < ttlMs) return cached;
    if (!pending) {
      pending = ssmClient.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
        .then((result) => {
          const value = result.Parameter?.Value;
          if (typeof value !== 'string' || value.length === 0) {
            throw new Error('The access code parameter is empty');
          }
          cached = value;
          loadedAt = now();
          return value;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

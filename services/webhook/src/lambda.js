import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createAwsIntake } from './aws-intake.js';
import { createGatewayHandler } from './gateway.js';

const ssm = new SSMClient({});
let gatewayHandler;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function initialize() {
  const allowedRepo = requiredEnv('ALLOWED_REPO');
  const tableName = requiredEnv('JOBS_TABLE_NAME');
  const queueUrl = requiredEnv('JOBS_QUEUE_URL');
  const parameterName = requiredEnv('WEBHOOK_SECRET_PARAM');

  const result = await ssm.send(new GetParameterCommand({
    Name: parameterName,
    WithDecryption: true,
  }));

  const secret = result.Parameter?.Value;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret parameter is empty');
  }

  return createGatewayHandler(
    createAwsIntake({ secret, allowedRepo, tableName, queueUrl }),
  );
}

export async function handler(event) {
  if (!gatewayHandler) {
    gatewayHandler = await initialize();
  }
  return gatewayHandler(event);
}

import { PutCommand } from '@aws-sdk/lib-dynamodb';

export function createJobStore({ documentClient, tableName }) {
  if (!documentClient || typeof documentClient.send !== 'function') {
    throw new TypeError('DynamoDB document client is required');
  }

  if (typeof tableName !== 'string' || tableName.trim() === '') {
    throw new Error('DynamoDB table name is required');
  }

  return {
    async createJobIfAbsent(job) {
      const command = new PutCommand({
        TableName: tableName,
        Item: job,
        ConditionExpression: 'attribute_not_exists(#jobId)',
        ExpressionAttributeNames: { '#jobId': 'jobId' },
      });

      try {
        await documentClient.send(command);
        return { created: true };
      } catch (error) {
        if (error?.name === 'ConditionalCheckFailedException') {
          return { created: false };
        }
        throw error;
      }
    },
  };
}

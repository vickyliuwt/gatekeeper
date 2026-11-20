import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

export async function getGitHubToken({
  parameterName = process.env.GITHUB_TOKEN_PARAM,
  token = process.env.GITHUB_TOKEN,
  ssmClient = ssm,
} = {}) {
  if (typeof parameterName === 'string' && parameterName.trim() !== '') {
    const result = await ssmClient.send(new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    }));

    const value = result.Parameter?.Value;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('GitHub token parameter is empty');
    }

    return value.trim();
  }

  if (typeof token === 'string' && token.trim() !== '') {
    return token.trim();
  }

  throw new Error('Configure GITHUB_TOKEN_PARAM or GITHUB_TOKEN');
}

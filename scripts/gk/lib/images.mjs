// build and push one service image
// same rules as the webhook image script
// the tag is the full sha of the last commit that touched that service
// so commit first
// the worker tag also counts the course scanner folder
// if ECR already has that tag use it again
// tags can not change
// linux amd64 and no provenance
// lambda rejects attestation manifests
// returns the sha256 digest
// Terraform pins each lambda to it and not to a tag
import { PARTS, aws, info, isCommitSha, isDigest, partPaths, run } from './run.mjs';

export function serviceTag(service, runner = run, watch = [`services/${service}`]) {
  const where = watch.join(' and ');
  const dirty = runner('git', ['status', '--porcelain', '--', ...watch]).stdout;
  if (dirty) throw new Error(`${where} has uncommitted changes. Commit them first: the image tag is the commit SHA.`);
  const tag = runner('git', ['log', '-1', '--format=%H', '--', ...watch]).stdout;
  if (!isCommitSha(tag)) throw new Error(`${where} has no commit yet.`);
  return tag;
}

export function findDigest(ecr, tag, awsCli = aws) {
  const r = awsCli(['ecr', 'describe-images', '--repository-name', ecr, '--image-ids', `imageTag=${tag}`,
    '--query', 'imageDetails[0].imageDigest', '--output', 'text'], { allowFail: true });
  if (r.ok && isDigest(r.stdout)) return r.stdout;
  if (!r.ok && !/ImageNotFoundException/.test(r.stderr)) throw new Error(`ECR lookup failed for ${ecr}: ${r.stderr.split('\n').pop()}`);
  return null;
}

export function ensureImage(name, { awsCli = aws, runner = run } = {}) {
  const { service, ecr } = PARTS[name];
  const { context, dockerfile, watch } = partPaths(name);
  const tag = serviceTag(service, runner, watch);
  const existing = findDigest(ecr, tag, awsCli);
  if (existing) {
    info(`${ecr}: reusing the image for commit ${tag.slice(0, 7)}`);
    return { tag, digest: existing, built: false };
  }
  const url = awsCli(['ecr', 'describe-repositories', '--repository-names', ecr, '--query', 'repositories[0].repositoryUri', '--output', 'text']).stdout;
  const registry = url.split('/')[0];
  info(`${ecr}: building commit ${tag.slice(0, 7)} for linux/amd64 (1 to 4 minutes the first time)`);
  const password = awsCli(['ecr', 'get-login-password']).stdout;
  runner('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: password });
  runner('docker', ['buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false',
    '--file', dockerfile, '--tag', `${url}:${tag}`, '--push', context], { inherit: true });
  const digest = findDigest(ecr, tag, awsCli);
  if (!digest) throw new Error(`ECR did not return a digest for ${ecr}:${tag}`);
  return { tag, digest, built: true };
}

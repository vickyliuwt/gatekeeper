// Build and push one service image, with the same rules as Part A's scripts/ensure-webhook-image.sh:
//   tag = full SHA of the last commit that touched services/NAME (so commit first),
//   reuse the image when ECR already has that tag (tags are IMMUTABLE),
//   build for linux/amd64 without provenance (Lambda rejects attestation manifests),
//   return the sha256 digest; Terraform pins each Lambda to the digest, never to a tag.
import { PARTS, aws, info, isCommitSha, isDigest, run } from './run.mjs';

export function serviceTag(service, runner = run) {
  const dirty = runner('git', ['status', '--porcelain', '--', `services/${service}`]).stdout;
  if (dirty) throw new Error(`services/${service} has uncommitted changes. Commit them first: the image tag is the commit SHA.`);
  const tag = runner('git', ['log', '-1', '--format=%H', '--', `services/${service}`]).stdout;
  if (!isCommitSha(tag)) throw new Error(`services/${service} has no commit yet.`);
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
  const tag = serviceTag(service, runner);
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
    '--tag', `${url}:${tag}`, '--push', `services/${service}`], { inherit: true });
  const digest = findDigest(ecr, tag, awsCli);
  if (!digest) throw new Error(`ECR did not return a digest for ${ecr}:${tag}`);
  return { tag, digest, built: true };
}

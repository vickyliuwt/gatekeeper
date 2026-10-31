#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

region=us-east-1
repository=gatekeeper/webhook
service=services/webhook

if [[ -n $(git status --porcelain -- "$service") ]]; then
  echo "Commit webhook changes before building a release image." >&2
  exit 1
fi

tag=$(git log -1 --format=%H -- "$service")
repo_url=$(aws ecr describe-repositories \
  --region "$region" --repository-names "$repository" \
  --query 'repositories[0].repositoryUri' --output text --no-cli-pager)

lookup_image() {
  aws ecr batch-get-image \
    --region "$region" --repository-name "$repository" \
    --image-ids "imageTag=$tag" \
    --query '{digest:images[0].imageId.imageDigest,failure:failures[0].failureCode}' \
    --output json --no-cli-pager
}

result=$(lookup_image)
digest=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"] or "")' <<< "$result")
failure=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["failure"] or "")' <<< "$result")

if [[ "$failure" == "ImageNotFound" ]]; then
  registry=${repo_url%%/*}
  aws ecr get-login-password --region "$region" |
    docker login --username AWS --password-stdin "$registry" >&2

  docker buildx build \
    --platform linux/amd64 --provenance=false \
    --tag "$repo_url:$tag" --push "$service" >&2

  result=$(lookup_image)
  digest=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"] or "")' <<< "$result")
elif [[ -n "$failure" ]]; then
  printf 'ECR image lookup failed: %s\n' "$failure" >&2
  exit 1
else
  printf 'Reusing ECR image for commit %s\n' "$tag" >&2
fi

if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "ECR did not return a valid image digest." >&2
  exit 1
fi

printf '%s\n' "$digest"

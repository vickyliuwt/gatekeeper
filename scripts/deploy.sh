#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

region=us-east-1
repo=${1:-}
if [[ ! "$repo" =~ ^[[:alnum:]_.-]+/[[:alnum:]_.-]+$ ]]; then
  echo "Usage: scripts/deploy.sh OWNER/REPO" >&2
  exit 2
fi

account=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
bucket="gk-tfstate-$account"
printf 'Deploying webhook and worker for %s in AWS account %s (%s).\n' "$repo" "$account" "$region"

for parameter in /gatekeeper/webhook-secret /gatekeeper/github-token; do
  parameter_type=$(aws ssm get-parameter \
    --region "$region" --name "$parameter" \
    --query 'Parameter.Type' --output text --no-cli-pager)
  if [[ "$parameter_type" != "SecureString" ]]; then
    printf 'Expected %s to be a SecureString.\n' "$parameter" >&2
    exit 1
  fi
done

# Keep a local bootstrap state tied to its original Lab account.
if [[ -s infra/bootstrap/terraform.tfstate ]]; then
  previous_bucket=$(terraform -chdir=infra/bootstrap output -raw state_bucket_name)
  if [[ "$previous_bucket" != "$bucket" ]]; then
    echo "Bootstrap state belongs to another account. Use a separate checkout." >&2
    exit 1
  fi
fi

./infra/bootstrap/ensure-state-bucket.sh
terraform -chdir=infra/bootstrap init -input=false
terraform -chdir=infra/bootstrap apply

terraform -chdir=infra init -input=false -reconfigure \
  -backend-config="bucket=$bucket"

# A fresh deployment needs a repository before an image can be pushed.
state=$(terraform -chdir=infra state pull)
has_ecr=$(python3 -c '
import json, sys
text = sys.stdin.read().strip()
resources = json.loads(text).get("resources", []) if text else []
names = {
    r.get("name") for r in resources
    if r.get("mode") == "managed" and not r.get("module")
    and r.get("type") == "aws_ecr_repository"
}
print({"webhook", "worker"}.issubset(names))
' <<< "$state")
unset state

if [[ "$has_ecr" != "True" ]]; then
  # Both digests are required root inputs. Only ECR is targeted here.
  placeholder=$(printf 'sha256:%064d' 0)
  terraform -chdir=infra apply \
    -target=aws_ecr_repository.webhook \
    -target=aws_ecr_repository.worker \
    -var="allowed_repo=$repo" \
    -var="webhook_image_digest=$placeholder" \
    -var="worker_image_digest=$placeholder"
fi

./scripts/ensure-reports-bucket.sh

digest=$(./scripts/ensure-webhook-image.sh)
worker_digest=$(./scripts/ensure-worker-image.sh)
printf 'Deploying webhook image %s\n' "$digest"
printf 'Deploying worker image %s\n' "$worker_digest"

terraform -chdir=infra apply \
  -var="allowed_repo=$repo" \
  -var="webhook_image_digest=$digest" \
  -var="worker_image_digest=$worker_digest"

terraform -chdir=infra output -raw webhook_url
printf '\n'

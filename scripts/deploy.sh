#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

region=us-east-1
# Both applies pin enable_intake=true, so an infra/gk.auto.tfvars.json written by scripts/gk/deploy.mjs
# in this checkout can never turn Part A off in this account.
repo=${1:-}
if [[ ! "$repo" =~ ^[[:alnum:]_.-]+/[[:alnum:]_.-]+$ ]]; then
  echo "Usage: scripts/deploy.sh OWNER/REPO" >&2
  exit 2
fi

account=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
bucket="gk-tfstate-$account"
printf 'Deploying Part A for %s in AWS account %s (%s).\n' "$repo" "$account" "$region"

parameter_type=$(aws ssm get-parameter \
  --region "$region" --name /gatekeeper/webhook-secret \
  --query 'Parameter.Type' --output text --no-cli-pager)
if [[ "$parameter_type" != "SecureString" ]]; then
  echo "Expected /gatekeeper/webhook-secret to be a SecureString." >&2
  exit 1
fi

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
print(any(r.get("mode") == "managed" and not r.get("module")
          and r.get("type") == "aws_ecr_repository" and r.get("name") == "webhook"
          for r in resources))
' <<< "$state")
unset state

if [[ "$has_ecr" != "True" ]]; then
  # The digest is a required root input. Only ECR is targeted in this step.
  placeholder=$(printf 'sha256:%064d' 0)
  terraform -chdir=infra apply \
    -target=aws_ecr_repository.webhook \
    -var="enable_intake=true" \
    -var="allowed_repo=$repo" \
    -var="webhook_image_digest=$placeholder"
fi

digest=$(./scripts/ensure-webhook-image.sh)
printf 'Deploying webhook image %s\n' "$digest"

terraform -chdir=infra apply \
  -var="enable_intake=true" \
  -var="allowed_repo=$repo" \
  -var="webhook_image_digest=$digest"

terraform -chdir=infra output -raw webhook_url
printf '\n'

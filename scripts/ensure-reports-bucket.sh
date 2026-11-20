#!/usr/bin/env bash
set -euo pipefail

region=us-east-1
account_id=$(aws sts get-caller-identity \
  --query Account --output text --no-cli-pager)
bucket="gk-reports-${account_id}"

if result=$(aws s3api head-bucket \
  --bucket "$bucket" \
  --expected-bucket-owner "$account_id" \
  --region "$region" \
  --no-cli-pager 2>&1); then
  echo "Reports bucket already exists in this account: $bucket"
else
  if [[ "$result" != *"(404)"* ]]; then
    printf '%s\n' "$result" >&2
    exit 1
  fi

  aws s3api create-bucket \
    --bucket "$bucket" \
    --region "$region" \
    --no-cli-pager

  echo "Created reports bucket: $bucket"
fi

aws s3api head-bucket \
  --bucket "$bucket" \
  --expected-bucket-owner "$account_id" \
  --region "$region" \
  --no-cli-pager

echo "PASS: Reports bucket is accessible and owned by the current account."

# Teammate deployment and Part C integration guide

Last reviewed against `part-a-test` commit `619474e` on 2026-11-19.

This guide is for a teammate and their Codex or Claude agent. Commands target Ubuntu Bash, Node.js 22, Terraform, Docker, and AWS CLI v2. Run repository commands from its root. Read the actual files before adapting commands to a newer commit.

## Deployment decision

| Mode | Account and credentials | Work required |
| --- | --- | --- |
| Integrate in the existing team environment | Account `551548984671`, with access explicitly authorized by the account/lab owner and course | Reuse its shared resources and coordinate changes to Terraform state with the owner. |
| Independent teammate environment | Teammate's own active Learner Lab account and temporary credentials | Deploy this branch into that account, create its own SSM parameters and GitHub demo repository/webhook, then integrate Part C there. |

For independent development, use the second mode. A teammate's credentials for their own account do not grant access to the original account. The currently deployed public endpoint accepts signed GitHub webhooks; it does not provide a general browser job-submission or report API. The S3 report bucket is private.

The deployed Lambda functions use the account's `LabRole` through the AWS runtime credential chain. They do not use a developer laptop's AWS CLI credential file. Closing a local VM does not directly stop cloud functions. Learner Lab session restrictions can still affect cloud access and operation, so keep the selected environment's Lab session active during integration and demos.

## Agent scope and completion criteria

- Work in the receiving developer's checkout and authorized branch. Preserve the original `part-b/scanner-fixes` and `part-c-web` branches unless their owners explicitly authorize changes. Do not push to `main` as part of this guide.
- Use an isolated checkout for each AWS account. The root Terraform state is remote, but `infra/bootstrap/terraform.tfstate` is local and account-specific.
- Confirm the intended AWS account with the developer before the first apply. Derive account IDs, endpoints, queue URLs, bucket names, and image digests from that deployment.
- Keep temporary credentials, tokens, decrypted SSM values, local state, plans, and variable files out of commits and chat output. Human-entered tokens can be sent through stdin.
- Inspect plans. Existing resources with the same names require ownership/state reconciliation before proceeding. Avoid blindly importing, deleting, or overwriting them.
- Complete deployment when both Lambdas are active, the event mapping is enabled, a real signed PR delivery returns 202, and the worker publishes the expected commit status and S3 report.
- Complete Part C integration separately by exercising its actual paste API and UI against the shared services. This guide does not claim Part C is already deployed.

## Temporary credentials and session restart

Learner Lab provides temporary session credentials. A named profile fixes where tools look for credentials; it does not extend their lifetime. After credentials expire or are revoked, start/resume the Lab and replace all three values from AWS Details. Follow the current course Lab instructions.

Configure a dedicated profile in `~/.aws/credentials` using a local editor. Preserve any other profiles already in that file.

```ini
[gatekeeper-lab]
aws_access_key_id=VALUE_FROM_CURRENT_LAB_SESSION
aws_secret_access_key=VALUE_FROM_CURRENT_LAB_SESSION
aws_session_token=VALUE_FROM_CURRENT_LAB_SESSION
```

```bash
mkdir -p ~/.aws
chmod 700 ~/.aws
nano ~/.aws/credentials
chmod 600 ~/.aws/credentials

# Remove older environment credentials that would override the profile.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
export AWS_PROFILE=gatekeeper-lab
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
```

Region and profile exports can be retained in the developer's shell setup. Refresh credential values locally when required. Successful STS identity lookup alone does not prove access to every service. An explicit `voc-cancel-cred` denial should prompt checking the Lab session and current credentials, then repeating the actual failed service call.

The next session normally needs Start Lab, current credentials, and verification. Re-deployment is needed for code/config changes or missing resources, rather than every terminal restart. GitHub PAT expiration is independent of AWS credential expiration.

## Prerequisites and fresh checkout

Use an owned GitHub demo repository with an initial commit. It will receive test PRs. Prefer a separate demo repository for each deployment to keep webhooks, secrets, and required checks unambiguous.

Required tools are Git, Node.js 22/npm, Docker Engine with Buildx, AWS CLI v2, Terraform `>= 1.10, < 2.0`, Python 3, and optionally GitHub CLI. Reserve several GB of free disk for image builds. The original 24 GB VM ran out of space during Docker operations.

```bash
git clone --branch part-a-test https://github.com/vickyliuwt/gatekeeper.git gatekeeper-my-lab
cd gatekeeper-my-lab
git status --short --branch
git log -1 --oneline
node --version
terraform version
docker info --format 'Server={{.ServerVersion}}'
docker buildx version
aws --version
python3 --version
df -h /

npm --prefix services/webhook ci
npm --prefix worker ci
npm --prefix services/webhook test
env -u GITHUB_TOKEN_PARAM node --test worker/test/*.test.js
```

At the reviewed commit, expected results are 35 webhook tests and 28 worker tests. Worker tests mock external services. Run them from the repository root because scanner fixtures use root-relative paths.

Choose the receiving developer's demo repository. Replace the example before continuing, and retain this shell variable for subsequent commands.

```bash
demo_repo='YOUR_GITHUB_LOGIN/gatekeeper-demo'
account_id=$(aws sts get-caller-identity --query Account --output text)
printf 'Target account: %s\nDemo repository: %s\n' "$account_id" "$demo_repo"
aws iam get-role --role-name LabRole --query 'Role.Arn' --output text
```

If role inspection is denied, consult the Lab's documented role availability. This configuration expects `arn:aws:iam::<account>:role/LabRole`. IAM and service restrictions can differ between Labs. Existing evidence in the original account does not guarantee permissions in another account.

## Create secrets in the target account

The deployment script requires both parameters, including for a paste-oriented deployment.

Create a fine-grained GitHub PAT for the developer-owned demo repository. Grant Contents read and Commit statuses read/write; Metadata remains read-only. Use an expiration covering the demo. A collaborator token for a repository owned by somebody else may have different limitations; an owned demo repository avoids this dependency.

First inspect parameter metadata. A ParameterNotFound response permits creation. For an existing parameter, coordinate its use with the owner instead of replacing it automatically.

```bash
for parameter in /gatekeeper/webhook-secret /gatekeeper/github-token; do
  aws ssm get-parameter --name "$parameter" --no-with-decryption \
    --region us-east-1 \
    --query 'Parameter.{Name:Name,Type:Type,Version:Version}' --output json
done
```

For a fresh target account, generate the webhook secret locally and write it directly to SSM.

```bash
(
  set -euo pipefail
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" |
    aws ssm put-parameter --region us-east-1 \
      --name /gatekeeper/webhook-secret --type SecureString --tier Standard \
      --value file:///dev/stdin --no-overwrite \
      --query '{Version:Version,Tier:Tier}' --output json
)
```

Enter the PAT at the hidden prompt. Avoid pasting its literal value into a command.

```bash
(
  set +x
  set -euo pipefail
  read -r -s -p 'GitHub token: ' github_token
  printf '\n'
  test -n "$github_token"
  printf '%s' "$github_token" |
    aws ssm put-parameter --region us-east-1 \
      --name /gatekeeper/github-token --type SecureString --tier Standard \
      --value file:///dev/stdin --no-overwrite \
      --query '{Version:Version,Tier:Tier}' --output json
  unset github_token
)
```

Terraform stores the parameter names in Lambda configuration. It does not read the secret values into its state.

## First deployment into a fresh account

Use these explicit bootstrap steps for the first deployment. They establish root state before calling the normal deployment script, whose current implementation uses `terraform state pull` to discover ECR repositories. The no-state case has not been validated in a second account.

The bucket scripts create account-suffixed S3 buckets through AWS CLI. Terraform manages their public-access, encryption, and retention/versioning settings. This is the existing workaround for the original Lab's explicit denial of `s3:GetBucketObjectLockConfiguration` during the provider's bucket refresh.

```bash
./infra/bootstrap/ensure-state-bucket.sh
terraform -chdir=infra/bootstrap init -input=false
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
```

Inspect the plan. In a new account, the bootstrap configuration should add three bucket configuration resources. Apply the saved plan only after confirming its target account and bucket.

```bash
terraform -chdir=infra/bootstrap apply bootstrap.tfplan

account_id=$(aws sts get-caller-identity --query Account --output text)
terraform -chdir=infra init -input=false -reconfigure \
  -backend-config="bucket=gk-tfstate-${account_id}"

placeholder=$(printf 'sha256:%064d' 0)
terraform -chdir=infra plan -out=ecr-bootstrap.tfplan \
  -target=aws_ecr_repository.webhook \
  -target=aws_ecr_repository.worker \
  -var="allowed_repo=$demo_repo" \
  -var="webhook_image_digest=$placeholder" \
  -var="worker_image_digest=$placeholder"
```

Expected targeted plan is two ECR repositories. The zero digests satisfy required root inputs for this targeted step only. Actual Lambda deployment uses digests resolved from built images.

```bash
terraform -chdir=infra apply ecr-bootstrap.tfplan
./scripts/deploy.sh "$demo_repo"
```

Review interactive Terraform plans before confirming. The script ensures the reports bucket exists, builds or reuses both images, then applies the complete configuration. It does not configure a GitHub webhook or branch protection. Optional alarm emails use the `alert_email` Terraform variable; configure the teammate's address through an ignored local auto-tfvars file if desired, and confirm the resulting SNS email subscription.

Resources include two ECR repositories, two Lambdas, DynamoDB, the jobs queue and DLQ, an SQS Lambda mapping, HTTP API integration, access logs, SNS/alarm resources, and S3 configuration resources. Names such as `gk-worker` are fixed within each account/region, so this layout supports one such stack per account in `us-east-1` without renaming.

The reports bucket and state bucket themselves, as well as SSM parameters, are created outside main Terraform resource ownership. Main Terraform destroy does not remove them. Bootstrap state remains local and must be retained for that account.

## Verify AWS and configure GitHub

```bash
terraform -chdir=infra output
aws lambda get-function-configuration --function-name gk-worker \
  --region us-east-1 \
  --query '{Name:FunctionName,State:State,Update:LastUpdateStatus}' --output json
aws lambda list-event-source-mappings --function-name gk-worker \
  --region us-east-1 \
  --query 'EventSourceMappings[].{State:State,Batch:BatchSize,Concurrency:ScalingConfig.MaximumConcurrency}' \
  --output json

webhook_url=$(terraform -chdir=infra output -raw webhook_url)
curl -sS -i --max-time 20 -H 'Content-Type: application/json' \
  --data-binary '{}' "$webhook_url"
printf '\n'
```

Expect Active/Successful Lambda status, Enabled event mapping, batch size 1, concurrency 2, and HTTP 401 for the unsigned request. A Lambda invocation with empty Records proves initialization only.

In the teammate-owned demo repository, create a webhook with the deployment's `webhook_url`, content type `application/json`, the matching SSM webhook secret, Pull requests events, SSL verification enabled, and Active checked. The human should enter the secret locally. In an Ubuntu desktop with `xclip`, this copies it directly to the clipboard without printing it. Clipboard sharing with the host must be configured if the browser is on the host.

```bash
(
  set -o pipefail
  aws ssm get-parameter --name /gatekeeper/webhook-secret --with-decryption \
    --region us-east-1 --query 'Parameter.Value' --output text |
    tr -d '\r\n' | xclip -selection clipboard
)
```

Confirm a ping delivery receives HTTP 200. Create a PR in the demo repository containing `scan-demo.js` with the following code, then check Recent Deliveries for HTTP 202 and a job ID.

```javascript
export function evaluateInput(input) {
  return eval(input);
}
```

Use GitHub CLI authenticated as the demo repository owner. Set the actual PR number locally.

```bash
pr_number=1
head_sha=$(gh api "repos/$demo_repo/pulls/$pr_number" --jq '.head.sha')
gh api "repos/$demo_repo/commits/$head_sha/status" \
  --jq '{state, gatekeeper: [.statuses[] | select(.context == "gatekeeper/sast") | {state, description}]}'

repo_id=$(gh api "repos/$demo_repo" --jq '.id')
job_id="pr-${repo_id}-${head_sha}"
aws dynamodb get-item --table-name gk-jobs --region us-east-1 --consistent-read \
  --key "{\"jobId\":{\"S\":\"$job_id\"}}" \
  --query 'Item.{Phase:phase.S,Verdict:verdict.S,Report:reportKey.S}' --output json
```

Expect failure with a HIGH finding. Replace eval with JSON.parse, commit to the same PR branch, retrieve the new head SHA, and expect success. Empty status lists mean no published status yet. Query Worker logs if the status does not progress.

For merge protection, first inspect existing rules using these read-only requests.

```bash
gh api "repos/$demo_repo/branches/main/protection"
gh api --paginate "repos/$demo_repo/rules/branches/main"
```

Preserve existing rules. On a new unprotected demo repository whose default branch is main, use Settings > Branches to require `gatekeeper/sast`, require up-to-date branches, and enforce against bypass by administrators. Then verify a vulnerable commit is blocked and a fixed commit is clean. Do not apply a replacement protection configuration to the shared team repository without coordinating with its owners.

## Part C contract and integration

The receiving Part C service should run in the same target account as the shared resources. Its server-side role accesses DynamoDB, SQS, and S3. A browser calls that service's API; permanent AWS credentials must not be embedded in frontend code.

Discover target values instead of copying the original account's values.

```bash
export AWS_REGION=us-east-1
export JOBS_TABLE=gk-jobs
export REPORTS_BUCKET=$(terraform -chdir=infra output -raw reports_bucket_name)
export QUEUE_URL=$(aws sqs get-queue-url --queue-name gk-jobs \
  --region us-east-1 --query QueueUrl --output text)
```

For paste intake, store the source object first, conditionally create its job next, and send the queue message last. Retrying intake should preserve a stable job identity. A queue failure after a successful table write must remain recoverable. `worker/scripts/fake-intake.js` is a smoke-test producer and creates a new job ID on every invocation; it is not a complete retry-safe production intake implementation.

Example initial item, with actual IDs and timestamps generated by Part C.

```json
{
  "jobId": "paste-<uuid>",
  "traceId": "<request-uuid>",
  "source": "paste",
  "phase": "QUEUED",
  "attempt": 0,
  "codeKey": "pasted/paste-<uuid>.js",
  "filename": "pasted.js",
  "createdAt": "<UTC ISO timestamp>",
  "updatedAt": "<UTC ISO timestamp>",
  "expiresAt": 0
}
```

Replace expiresAt with Unix seconds for 30 days after creation. The existing fake-intake script omits TTL, so do not copy that omission into the Part C service. SQS body has exactly jobId and traceId.

```json
{"jobId":"paste-<uuid>","traceId":"<request-uuid>"}
```

Worker-managed fields are phase (`RUNNING`, `FAILED`, `DONE` in addition to `QUEUED`), attempt, leaseOwner, leaseUntil, verdict (`success` or `failure`), counts (`HIGH`, `MEDIUM`, `LOW`), reportKey, and updatedAt. FAILED currently means eligible for retry, rather than necessarily terminal. Queue exhaustion goes to the DLQ; automated terminal GitHub error publication remains unfinished.

Report JSON includes jobId, traceId, verdict, counts, scannedFiles, sourceBytes, scanMs, elapsedMs, and findings. Findings include file, line, column, severity, rule id, message and evidence. The private report object is read by the backend or exposed via a short-lived authorized URL. `elapsedMs` is captured before report upload and final status publication; it is not the complete webhook-to-GitHub latency.

The current `byRepoTime` GSI is keyed by repo and createdAt. A paste item without repo will not appear in that sparse index. Agree a paste history lookup design with the team. The GSI projection does not include every job attribute, so full detail/report retrieval should use the primary-key job record when needed.

For a smoke test of the shared worker before wiring the UI, run this with the discovered variables above. It creates a real paste job and report.

```bash
node worker/scripts/fake-intake.js worker/test/fixtures/normal-project.js
```

Use the returned jobId to query DynamoDB and retrieve reportKey. This verifies paste worker consumption, not the Part C HTTP API or browser flow. Route `/webhooks/github` is reserved for signed GitHub events. Part C still needs its own intake, status, report and history routes, validation, and appropriate CORS/access behavior.

Shared resource ownership remains in the main `infra` configuration and remote state. Integrate additional resources with that ownership or consume outputs from a separate Part C stack; do not declare the same table, bucket, queue, API stage or trigger in two states. Coordinate the final integrated deployment in one chosen account.

## Repeat deploy and standalone Terraform commands

After refreshing Lab credentials, the regular entry point is:

```bash
./scripts/deploy.sh "$demo_repo"
```

Commit relevant source changes before release builds. Image helpers derive immutable tags from relevant source commits and reuse images when present. The deploy script passes actual digests on the command line, overriding stale local image tfvars during that invocation.

For standalone plan commands in a fresh checkout, supply the same required values. The script does not persist them for subsequent commands.

```bash
export TF_VAR_allowed_repo="$demo_repo"
export TF_VAR_webhook_image_digest=$(./scripts/ensure-webhook-image.sh)
export TF_VAR_worker_image_digest=$(./scripts/ensure-worker-image.sh)
terraform -chdir=infra plan -detailed-exitcode \
  -var="allowed_repo=$TF_VAR_allowed_repo" \
  -var="webhook_image_digest=$TF_VAR_webhook_image_digest" \
  -var="worker_image_digest=$TF_VAR_worker_image_digest"
```

Exit 0 means no changes, 2 means changes proposed, and 1 means error. Inspect a proposed plan before applying. Preserve any optional alert_email setting used in the existing environment to avoid unintentionally removing its subscription.

## Troubleshooting and limits

| Symptom | Action |
| --- | --- |
| NoCredentials / ExpiredToken / voc-cancel-cred | Check Lab session, profile and stale environment overrides; refresh all three temporary credential values and retry the failed service call. |
| Webhook 500 and no job | Check GitHub delivery, API access logs and webhook Lambda logs; Lab restrictions were a suspected cause in the original environment but the historic 500 was not conclusively diagnosed. |
| Status list empty | Check the exact PR head SHA, webhook 202, job record, event mapping and worker logs in that order. |
| GitHub 401/403 | Check PAT expiration, selected demo repository, Contents read and Commit statuses write permissions, and the target account's SSM parameter. |
| GetBucketObjectLockConfiguration denied | Retain CLI-created bucket ownership with separate Terraform bucket configurations as implemented here. |
| no space left on device | Inspect df and docker system df. Unused build cache can be pruned; preserve unrelated containers, volumes and needed images. |
| mergeable null / unknown | Wait briefly and query again; a success status alone does not describe every branch protection requirement. |
| Resource exists but state does not track it | Establish ownership and compare configuration before any import or change. |

```bash
aws logs tail /aws/lambda/gk-webhook --since 30m --region us-east-1 --format short
aws logs tail /aws/lambda/gk-worker --since 30m --region us-east-1 --format short
aws logs tail /gatekeeper/api/access --since 30m --region us-east-1 --format short
```

Current PR source scope is regular .js/.mjs/.cjs/.ts files, excluding node_modules and hidden directories, with at most 50 files, 256 KiB per file, and 1 MiB total. A truncated tree or exceeded limit fails the task. The scanner has known accuracy limits, including a previously observed lowercase weak-crypto rule gap. Review these before expanding supported workloads.

End Lab is not a guarantee of zero resource charges. Stored data, images, logs and alarms may continue to incur costs. Main Terraform destroy removes deployed services and configured resources, while CLI-created buckets and SSM parameters remain. Coordinate cleanup separately; do not destroy a shared environment during a teammate's integration.

## Validation provenance and AI handoff prompt

Verified in the original account: actual PR failure/success, branch protection blocked/clean, 35 webhook tests, 28 worker tests, and repeat deployment with no changes. Part A alone was previously rebuilt in 20 minutes 52 seconds. Whole-stack fresh deployment in a teammate account, Part C integration, AWS fault recovery and end-to-end scan load testing remain to be verified. This guide was checked against source and shell syntax; it has not been executed in a second AWS account.

Copy this prompt to the receiving agent:

> Read docs/teammate-deployment.md and the actual deployment scripts in this checkout. Help me deploy the integrated webhook and worker into my own AWS Academy Learner Lab in us-east-1, then connect my Part C implementation. First confirm my target account, owned GitHub demo repository, branch and active Lab credentials without exposing secrets. Follow the explicit first-deployment bootstrap steps, inspect plans, and discover all runtime resource values from my account. Preserve existing team branches and shared resource ownership. Validate a real PR, then paste intake and report retrieval, and report observed results separately from remaining tests. Keep changes small and explain any required manual credential or GitHub UI step.

References: [AWS short-term CLI credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-short-term.html), [AWS Academy Learner Lab educator guide](https://d1.awsstatic.com/AWS%20Academy%20Learner%20Lab%20Educator%20Guide.pdf), [GitHub commit statuses](https://docs.github.com/en/rest/commits/statuses).

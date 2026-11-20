# Part A: PR Intake Contract Draft

Status: Draft for team review. Not yet a frozen contract.

## Scope

GitHub webhook -> validate request -> create job in DynamoDB
-> send message to SQS -> return HTTP 202.

The webhook does not run the scanner.

## Accepted events

- GitHub event: pull_request
- Actions: opened, reopened, synchronize
- Only accept the configured demo repository.
- Verify the signature against the original request body before parsing JSON.
- Handle GitHub ping without creating a scan job.

## Job identity

jobId = pr-<repository.id>-<pull_request.head.sha>

Use repository.id from the webhook's base repository.
Use the full head SHA, not a shortened SHA.

## Initial DynamoDB item

- jobId: string
- source: "pr"
- repo: repository.full_name, such as "owner/demo"
- prNumber: pull_request.number
- headSha: pull_request.head.sha
- phase: "QUEUED"
- attempt: 0
- traceId: X-GitHub-Delivery header
- createdAt: UTC ISO 8601 string
- updatedAt: UTC ISO 8601 string
- expiresAt: Unix timestamp in seconds, 30 days after creation

Worker-owned fields such as verdict, counts, reportKey and lease fields
are omitted until the worker sets them.

## SQS message body

JSON object with exactly these fields:

{
  "jobId": "pr-123456-exampleFullHeadSha",
  "traceId": "example-github-delivery-id"
}

## Reliability requirements

- Create a job conditionally; never overwrite an existing job on redelivery.
- Return HTTP 202 only after SQS accepts the message.
- If DynamoDB succeeds but SQS fails, return HTTP 503.
- Redelivery must be able to enqueue that existing job again.
- Duplicate queue messages are possible; the worker must handle them safely.

## Items to confirm with teammates

- Exact field names, types and phase values.
- Repository allowlist configuration.
- Duplicate-event response behavior for completed jobs.
- Ownership of shared Terraform resources and environment variables.
- Trace ID handling when one job has multiple webhook deliveries.

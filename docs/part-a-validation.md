# Part A validation

Measured on October 31, 2026, in AWS Learner Lab (`us-east-1`).

## Webhook response time

Source: CloudWatch log group `/gatekeeper/api/access`, route
`POST /webhooks/github`. Requests were deduplicated by API Gateway request ID.

| Metric | Result | Target |
| --- | ---: | ---: |
| Accepted requests (HTTP 202) | 20 | 20 samples |
| API Gateway p95 latency (nearest rank) | 1,801 ms | < 3,000 ms |
| Maximum API Gateway latency | 1,878 ms | < 10,000 ms |
| Accepted requests taking 10 seconds or longer | 0 | 0 |

The route also logged one HTTP 401 from the unsigned-request test and zero
HTTP 5xx responses. Latency statistics above use the 20 accepted requests.

The sample included repeated deliveries of the same PR update. GitHub
separately reported 0.08 to 1.83 seconds for 18 successful redeliveries.
Concurrent PR throughput and worker completion time require a separate test.

## Job identity and recovery

- Opening demo PR #1 returned HTTP 202 and created a DynamoDB job. Its trace
  ID matched the GitHub delivery ID.
- Redelivering the event returned the same job ID. DynamoDB preserved the
  original creation time and trace ID.
- For that redelivery, Lambda logged `job_ready` with `created: false`,
  followed by `job_enqueued`, under the same job ID and trace ID.
- Pushing a new commit to PR #1 created a second job. A consistent DynamoDB
  read returned both commits under PR #1.

## Monitoring and CI

- An unsigned request returned HTTP 401 and was located in the API Gateway
  access log using its request ID.
- Manually setting `gk-api-5xx` to ALARM delivered an email through SNS.
  This tested notification delivery without inducing a production error.
- GitHub Actions ran the webhook test suite: 35 passed, 0 failed.

## Part A rebuild test

We retained the versioned Terraform state bucket and the SSM webhook secret,
destroyed the 14 resources managed by the main Terraform configuration, and
rebuilt them with `scripts/deploy.sh`. We then updated the demo repository's
webhook URL and redelivered the `pull_request.synchronize` event for PR #1.

Elapsed time from the start of teardown to confirmation of GitHub HTTP 202
was 20 minutes 52 seconds, within the 30-minute target. GitHub reported a
delivery duration of 2.08 seconds. The response contained the expected job ID,
`pr-1441247564-55485306794e441cb3fc3e522598336e8a8be6db`.

## Integrated PR scanning and merge gate validation

Validated the deployed webhook and worker using PR #1 in
`Da-qiong/gatekeeper-demo`.

The deployed flow is GitHub webhook -> API Gateway -> webhook Lambda ->
DynamoDB and SQS -> worker Lambda -> S3 report and GitHub commit status.

- Commit `58ca170c7e1934d76993f1592a3427803c8e116c` contained
  `eval(input)`. The worker scanned two files and reported one HIGH finding.
  The `gatekeeper/sast` status was `failure`, and GitHub reported the PR
  merge state as `blocked`.
- Commit `86349b5492a680141847d10b87737be56cdb1eac` replaced `eval`
  with `JSON.parse`. The worker scanned two files and reported zero findings.
  The status was `success`, and GitHub reported the merge state as `clean`.
- The demo repository's main branch requires `gatekeeper/sast`, requires
  branches to be up to date, and enforces the rule for administrators.
- The PR remains open. Merge eligibility was verified through the API.

The worker reads its GitHub token from SSM SecureString. Its SQS trigger
uses batch size 1 and maximum concurrency 2.

Local validation passed 28 worker tests and 35 webhook tests.
Worker retry behavior was tested with mocks; AWS failure-recovery testing
remains pending.

## Integrated repeat deployment

Ran `./scripts/deploy.sh Da-qiong/gatekeeper-demo` against the existing
webhook and worker deployment. Both ECR images were reused, and both the
bootstrap and main Terraform configurations reported no changes.
The deployment completed with zero resources added, changed, or destroyed.

This verifies repeat deployment of the integrated environment.
The previously recorded 20-minute-52-second teardown and rebuild test
covered Part A only.

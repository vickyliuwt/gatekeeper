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

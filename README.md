# GateKeeper

cloud security gate for GitHub pull requests, on AWS. CS6620 Fall 2026, Prof. Aanchan Mohan.

team:
- Lingsong Qin: PR intake and the PR path of the worker
- Yuyao Xu: scanner fixes and the paste worker
- Weiting Liu: Paste and Scan web, deploy tool and the merge

## Our App
- every pull request in our demo repo gets scanned by the course SAST scanner on AWS
- a HIGH finding gives commit status `failure`, so the merge is blocked
- a scan that could not check everything gives `error`, so it is blocked too (not checked is not safe)
- after 5 failed tries the PR gets `error` with a Details link to our page
- a public Paste and Scan page: paste JavaScript, get the same check, read a masked report

## Paste and Scan page
- Code Scanner: paste code or load an example, type the access code, run the scan
- Your scan, through AWS: 8 boxes (write path and read path) light up from the real job phase (not a health monitor)
- Scan Activity: received, queued, scanning, report, try n of 5, and the calls the page made
- Security Report: PASS, FAIL or INCOMPLETE, HIGH, MEDIUM and LOW, masked findings, share link
- Recent PR Checks: newest 20 PR scans of the demo repo (pastes never show here)
- no fake numbers: every value comes from our API or the job record
- open a .js file from your laptop: read in the browser, sent only when you scan
- every log line shows the real request time from your browser, and a routes table shows the real rate limits

## how one pull request flows
1. GitHub sends a signed webhook to API Gateway, and API Gateway gives it to `gk-webhook`
2. `gk-webhook` checks the HMAC, saves the job in DynamoDB `gk-jobs` and puts `{ jobId, traceId }` on SQS `gk-jobs`
3. the worker Lambda claims the job (90 s lease) and reads every .js .mjs .cjs .ts file at the head commit (up to 50)
4. it runs the scanner, saves the report in S3 `reports/` first, then the verdict in DynamoDB, then posts the commit status on GitHub
5. up to 5 tries, then the dead letter queue, the PR gets `error` and the page shows INCOMPLETE

paste path: `GET /` (the page, from gk-results), then `POST /scans` (gk-submit), then poll `GET /scans/{jobId}`, then `GET /scans/{jobId}/report`

## folders
| folder | what |
| --- | --- |
| `services/webhook` | gk-webhook: HMAC check, job, queue |
| `sast/backend` | course scanner and our fixes |
| `worker` | scan worker: paste jobs and PR jobs, GitHub status |
| `services/web` | the page, gk-submit and gk-results (one image) |
| `infra` | Terraform: core module and one module per part |
| `scripts/gk` | deploy, destroy, smoke and peek-job for every part |
| `docs` | IAM policies for a real AWS account, Part A notes |

## run Locally
```
cd services/web
npm install
npm test
npm run dev
```
then open http://127.0.0.1:9300 (local access code `demo-1234`). a small in-memory worker runs the real course scanner and writes the same shape as the real worker.

## deploy
```
node scripts/gk/deploy.mjs --part web
node scripts/gk/deploy.mjs --part intake --part worker --part web --repo OWNER/DEMO
node scripts/gk/smoke.mjs
node scripts/gk/peek-job.mjs JOB_ID --logs
node scripts/gk/destroy.mjs
```
lab keys go in `~/.aws/credentials`. destroy keeps only the state bucket and the SSM values. then End Lab.
in Learner Lab we send one request at a time. no burst or flood tests there.

## API
| route | function | what |
| --- | --- | --- |
| `POST /webhooks/github` | gk-webhook | GitHub events, HMAC signed |
| `GET /` | gk-results | the page |
| `POST /scans` | gk-submit | paste code (access code in `x-demo-code`), 202 and a jobId |
| `GET /scans` | gk-results | newest 20 PR scans of the demo repo |
| `GET /scans/{jobId}` | gk-results | phase, verdict, counts, try number |
| `GET /scans/{jobId}/report` | gk-results | the masked report |

## results (real runs)
| what | result |
| --- | --- |
| webhook tests | 35 / 35 |
| webhook reply time (20 deliveries) | p95 1.80 s, max 1.88 s |
| Part A rebuild from zero | 20 min 52 s |
| worker tests (with the last try fix) | 34 / 34 |
| Part C tests (page, 2 functions, the real worker fit) | 236 / 236, self-scan HIGH 0 |
| scripts/gk tests | 34 / 34 |
| real PR gate in our demo repo | 1 HIGH found and the merge blocked, the fix commit passed |
| full stack deploy from int/all  | 38 resources, smoke 10 / 10 and 11 / 11 |
| Part C deploy from zero in a new lab account | 29 resources in 2.4 min, smoke 10 / 10 and 11 / 11 |
| paste to result, 10 scans one after another, team worker | p50 0.67 s, p95 1.30 s |
| paste to result, 10 scans one after another, laptop test worker | p50 2.40 s, p95 2.69 s |
| live checks (headers, 404, 401, a real scan) | 14 / 14 |
| scanner false alarms on the course files scanner.js and server.js | 87 to 20, test-vulnerable.js still 36 found |
| forced worker failure | page shows try 1 of 5 failed, then the result |
| cost in Learner Lab | 4.6 of 50 dollars |

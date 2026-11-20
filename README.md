# GateKeeper

cloud security gate for GitHub pull requests, on AWS. CS6620 Fall 2026, Prof. Aanchan Mohan.
team:
- Lingsong Qin: Part A, PR intake and the PR path of the worker
- Yuyao Xu: Part B, scanner fixes and the paste worker
- Weiting Liu: Part C, Paste and Scan web, deploy tool and the merge

## Our App
- every pull request in our demo repo gets scanned by the course SAST scanner on AWS
- a HIGH finding -> commit status `failure` -> the merge is blocked
- a scan that could not check everything -> `error` -> also blocked (not checked is not safe)
- a public Paste and Scan page: paste JavaScript, get the same check, read a masked report

## the Paste and Scan page
- Code Scanner: paste code or load an example, access code, run the scan
- Your scan, through AWS: 8 boxes (write path + read path) light up from the real job phase (not a health monitor)
- Scan Activity: received, queued, scanning, report, try n of 5, and the calls the page made
- Security Report: PASS / FAIL / INCOMPLETE, HIGH / MEDIUM / LOW, masked findings, share link
- Recent PR Checks: newest 20 PR scans of the demo repo (pastes never show here)
- no fake numbers: every value comes from our API or the job record
- open a .js file from your laptop: read in the browser, sent only when you scan
- every log line shows the real request time from your browser, and a routes table shows the real rate limits

## how one pull request flows
1. GitHub sends a signed webhook -> API Gateway -> `gk-webhook`
2. `gk-webhook` checks the HMAC, saves the job in DynamoDB `gk-jobs`, puts `{ jobId, traceId }` on SQS `gk-jobs`
3. the worker Lambda claims the job (90 s lease), reads every .js .mjs .cjs .ts file at the head commit (up to 50), runs the scanner
4. report -> S3 `reports/`, verdict -> DynamoDB, commit status -> GitHub; up to 5 tries, then the dead-letter queue and the page shows INCOMPLETE

paste path: `GET /` (page, from gk-results) -> `POST /scans` (gk-submit) -> poll `GET /scans/{jobId}` -> `GET /scans/{jobId}/report`

## folders
| folder | what |
| --- | --- | --- |
| `services/webhook` | gk-webhook: HMAC check, job, queue | 
| `sast/backend` | course scanner + fixes |
| `worker` | scan worker: paste jobs and PR jobs, GitHub status | 
| `services/web` | the page, gk-submit, gk-results (one image) | 
| `infra` | Terraform: core module + one module per part | 
| `scripts/gk` | deploy, destroy, smoke, peek-job for every part | 

## run
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
node scripts/gk/destroy.mjs
```
lab keys go in `~/.aws/credentials`. destroy keeps only the state bucket and the SSM values. then End Lab.

## API
| route | function | what |
| --- | --- | --- |
| `POST /webhooks/github` | gk-webhook | GitHub events, HMAC signed |
| `GET /` | gk-results | the page |
| `POST /scans` | gk-submit | paste code (access code in `x-demo-code`), 202 + jobId |
| `GET /scans` | gk-results | newest 20 PR scans of the demo repo |
| `GET /scans/{jobId}` | gk-results | phase, verdict, counts, try number |
| `GET /scans/{jobId}/report` | gk-results | the masked report |


## results (real runs)
| what | result | 
| --- | --- | 
| webhook tests | 35 / 35 | 
| webhook reply time (20 deliveries) | p95 1.80 s, max 1.88 s |
| Part A rebuild from zero | 20 min 52 s | 
| Part C tests (page + 2 functions + the real worker fit) | 236 / 236, self-scan HIGH 0 | 
| worker tests | 28 / 28 | 
| real PR gate with the full worker | eval PR failure and blocked, the fix success and clean | 
| Part C live deploy from zero in a new lab account | 29 resources in 2.4 min, smoke 10 / 10 and 11 / 11 with a real scan | 
| paste to result, 10 scans one after another | p50 2.40 s, p95 2.69 s | 
| paste to result, 20 scans one after another (first lab account) | p50 2.32 s, p95 2.41 s | 
| live checks (headers, 404, 401, a real scan) | 14 / 14 |
| scanner false alarms on the course files scanner.js and server.js | 87 to 20, test-vulnerable.js still 36 found | 
| forced worker failure | page shows try 1 of 5 failed, then the result | 

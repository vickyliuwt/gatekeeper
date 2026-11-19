#!/usr/bin/env python3
"""Bounded 20-PR intake test. Run prepare, open, collect, then close.

Uses authenticated gh and aws CLIs. Evidence is stored under .git, outside
tracked source. Test resources are limited to Da-qiong/gatekeeper-demo.
"""
import argparse
import concurrent.futures
import datetime
import json
import math
import pathlib
import subprocess
import time
import uuid

REPO = 'Da-qiong/gatekeeper-demo'
ACCOUNT = '551548984671'
HOOK = 705751236
COUNT = 20


def command(args, payload=None):
    result = subprocess.run(args, input=payload, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def github(path, method='GET', data=None):
    endpoint = f'repos/{REPO}' + (f'/{path}' if path else '')
    args = ['gh', 'api', endpoint, '--method', method]
    if data is not None:
        args += ['--input', '-']
    output = command(args, json.dumps(data) if data is not None else None)
    return json.loads(output) if output.strip() else None


def aws(*args):
    return json.loads(command(['aws', *args, '--region', 'us-east-1',
                               '--output', 'json', '--no-cli-pager']))


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def find_pr(branch):
    owner = REPO.split('/')[0]
    rows = github(f'pulls?state=all&head={owner}:{branch}&per_page=100')
    if len(rows) > 1:
        raise RuntimeError(f'Multiple PRs for {branch}; inspect before continuing.')
    return rows[0] if rows else None


def prepare(path, state):
    if 'tree' not in state:
        base = github('git/ref/heads/main')['object']['sha']
        base_tree = github(f'git/commits/{base}')['tree']['sha']
        tree = github('git/trees', 'POST', {
            'base_tree': base_tree,
            'tree': [{'path': 'burst-clean.js', 'mode': '100644', 'type': 'blob',
                      'content': 'export const burstTestValue = 42;\n'}],
        })
        state.update(base=base, tree=tree['sha'])
        save(path, state)

    for index in range(COUNT):
        if len(state['prs']) <= index:
            state['prs'].append({'branch': f"burst-{state['run']}-{index + 1:02d}"})
            save(path, state)
        row = state['prs'][index]
        if 'sha' not in row:
            commit = github('git/commits', 'POST', {
                'message': f"Intake burst {state['run']} sample {index + 1:02d}",
                'tree': state['tree'], 'parents': [state['base']],
            })
            row['sha'] = commit['sha']
            save(path, state)
            time.sleep(1)
        # List exact matching refs before creating, including after an interrupted run.
        refs = github(f"git/matching-refs/heads/{row['branch']}")
        exact = [r for r in refs if r['ref'] == f"refs/heads/{row['branch']}"]
        if exact:
            if exact[0]['object']['sha'] != row['sha']:
                raise RuntimeError('Existing test branch has an unexpected SHA.')
        else:
            github('git/refs', 'POST', {'ref': f"refs/heads/{row['branch']}",
                                       'sha': row['sha']})
            time.sleep(1)
        print(f"Prepared {index + 1:02d}/20 | {row['branch']} | {row['sha']}", flush=True)
    if len({r['sha'] for r in state['prs']}) != COUNT:
        raise RuntimeError('Expected 20 distinct commit SHAs.')
    state['prepared_at'] = time.time()
    save(path, state)
    print('PASS: 20 branches prepared. No PRs opened by this phase.')


def open_prs(path, state):
    if len(state['prs']) != COUNT or 'prepared_at' not in state:
        raise RuntimeError('Run prepare first.')
    # Separate preparation writes from PR creation to reduce secondary-rate pressure.
    remaining = 65 - (time.time() - state['prepared_at'])
    if remaining > 0:
        raise RuntimeError(f'Wait {math.ceil(remaining)} seconds, then run open again.')
    for row in state['prs']:
        if 'number' not in row:
            existing = find_pr(row['branch'])
            if existing:
                if existing['head']['sha'] != row['sha']:
                    raise RuntimeError('Existing PR head changed; inspect this run.')
                row.update(number=existing['number'], url=existing['html_url'])
                save(path, state)
    state.setdefault('started_at', time.time())
    state.setdefault('windows', [])
    state['windows'].append({'start': time.time()})
    save(path, state)

    def create(row):
        before = time.time()
        result = github('pulls', 'POST', {
            'title': f"Intake burst {state['run']} / {row['branch'].split('-')[-1]}",
            'head': row['branch'], 'base': 'main',
            'body': 'Automated 20-distinct-PR intake validation. Safe test fixture.',
        })
        return result, before, time.time()

    # Process bounded waves; stop scheduling later waves after any error.
    pending = [r for r in state['prs'] if 'number' not in r]
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for offset in range(0, len(pending), 4):
            futures = {pool.submit(create, r): r for r in pending[offset:offset + 4]}
            for future in concurrent.futures.as_completed(futures):
                row = futures[future]
                try:
                    result, before, after = future.result()
                    row.update(number=result['number'], url=result['html_url'],
                               request_start=before, request_end=after)
                    print(f"Created PR #{row['number']} | {row['sha']}", flush=True)
                except Exception as error:
                    errors.append(str(error))
                save(path, state)
            if errors:
                break
    state['windows'][-1]['end'] = time.time()
    save(path, state)
    if errors:
        raise RuntimeError('Creation interrupted; preserve this run and inspect before retrying. '
                           + ' | '.join(errors))
    print(f"PRs recorded: {sum('number' in r for r in state['prs'])}/20")
    print('Keep this run ID. Run collect after deliveries arrive.')


def collect(path, state):
    if 'started_at' not in state:
        raise RuntimeError('Run open first.')
    directory = path.parent
    by_branch = {r['branch']: r for r in state['prs']}
    # One demo run is 20 deliveries. Paginate to retain evidence amid later activity.
    selected = []
    for page in range(1, 11):
        rows = github(f'hooks/{HOOK}/deliveries?per_page=100&page={page}')
        if not rows:
            break
        oldest = time.time()
        for delivery in rows:
            delivered = datetime.datetime.fromisoformat(
                delivery['delivered_at'].replace('Z', '+00:00')).timestamp()
            oldest = min(oldest, delivered)
            if delivered < state['started_at'] - 5:
                continue
            if delivery['event'] != 'pull_request' or delivery.get('action') != 'opened':
                continue
            if delivery.get('redelivery'):
                continue
            detail = github(f"hooks/{HOOK}/deliveries/{delivery['id']}")
            payload = detail['request']['payload']
            if isinstance(payload, str):
                payload = json.loads(payload)
            pr = payload['pull_request']
            expected = by_branch.get(pr['head']['ref'])
            if not expected or pr['head']['sha'] != expected['sha']:
                continue
            if pr['number'] != expected.get('number'):
                continue
            headers = {k.lower(): v for k, v in detail['response'].get('headers', {}).items()}
            response = detail['response'].get('payload')
            if isinstance(response, str):
                try:
                    response = json.loads(response)
                except json.JSONDecodeError:
                    response = {'raw': response}
            selected.append({'pr': pr['number'], 'sha': expected['sha'],
                             'delivery_id': delivery['id'], 'guid': delivery['guid'],
                             'delivered_at': delivered, 'status': detail['status_code'],
                             'duration_seconds': detail['duration'],
                             'request_id': headers.get('apigw-requestid'),
                             'response': response})
        if len(rows) < 100 or oldest < state['started_at'] - 5:
            break
    save(directory / 'deliveries.json', selected)

    repo_id = github('')['id']
    keys = [{'jobId': {'S': f"pr-{repo_id}-{r['sha']}"}} for r in state['prs']]
    jobs = aws('dynamodb', 'batch-get-item', '--request-items',
               json.dumps({'gk-jobs': {'Keys': keys, 'ConsistentRead': True}}))
    save(directory / 'jobs.json', jobs)
    logs = aws('logs', 'filter-log-events', '--log-group-name', '/gatekeeper/api/access',
               '--start-time', str(int((state['started_at'] - 5) * 1000)),
               '--end-time', str(int(time.time() * 1000)),
               '--filter-pattern', '{ $.routeKey = "POST /webhooks/github" }')
    matched = {}
    request_ids = {d['request_id'] for d in selected if d['request_id']}
    for event in logs.get('events', []):
        record = json.loads(event['message'])
        if record.get('requestId') in request_ids:
            matched[record['requestId']] = record
    save(directory / 'api-logs.json', list(matched.values()))
    items = {item['jobId']['S']: item for item in jobs.get('Responses', {}).get('gk-jobs', [])}
    confirmed = 0
    for delivery in selected:
        job_id = f"pr-{repo_id}-{delivery['sha']}"
        item = items.get(job_id, {})
        if (delivery['status'] == 202 and isinstance(delivery['response'], dict)
                and delivery['response'].get('jobId') == job_id
                and item.get('repo', {}).get('S') == REPO
                and item.get('headSha', {}).get('S') == delivery['sha']
                and item.get('prNumber', {}).get('N') == str(delivery['pr'])
                and item.get('traceId', {}).get('S') == delivery['guid']):
            confirmed += 1
    latencies = sorted(int(r['latencyMs']) for r in matched.values())
    delivered_times = [d['delivered_at'] for d in selected]
    summary = {
        'run': state['run'], 'planned_prs': COUNT,
        'recorded_prs': sum('number' in r for r in state['prs']),
        'distinct_shas': len({r['sha'] for r in state['prs']}),
        'original_deliveries': len(selected),
        'distinct_delivered_prs': len({d['pr'] for d in selected}),
        'accepted_and_correlated_jobs': confirmed,
        'matched_api_requests': len(matched),
        'matched_api_status_counts': {status: sum(str(r['status']) == status for r in matched.values())
                                      for status in sorted({str(r['status']) for r in matched.values()})},
        'delivery_window_seconds': round(max(delivered_times) - min(delivered_times), 3) if delivered_times else None,
        'p95_api_latency_ms': latencies[math.ceil(.95 * len(latencies)) - 1] if latencies else None,
        'max_api_latency_ms': max(latencies) if latencies else None,
        'api_requests_at_or_above_10s': sum(ms >= 10000 for ms in latencies),
        'worker_done_jobs': sum(i.get('phase', {}).get('S') == 'DONE' for i in items.values()),
        'unprocessed_dynamodb_keys': bool(jobs.get('UnprocessedKeys')),
        'creation_windows': state['windows'],
    }
    summary['intake_pass'] = (
        summary['recorded_prs'] == summary['distinct_shas'] == COUNT
        and len(selected) == summary['distinct_delivered_prs'] == confirmed == len(matched) == COUNT
        and summary['matched_api_status_counts'] == {'202': COUNT}
        and not summary['unprocessed_dynamodb_keys']
        and summary['api_requests_at_or_above_10s'] == 0)
    save(directory / 'summary.json', summary)
    print(json.dumps(summary, indent=2))
    print('Intake result excludes full scan latency. Report actual arrival window and concurrency 4.')
    if not summary['intake_pass']:
        print('Evidence incomplete or a check failed. Inspect files; rerun collect for delayed evidence.')


def close_prs(path, state):
    for row in state['prs']:
        pr = find_pr(row['branch'])
        if not pr:
            continue
        if pr['head']['sha'] != row['sha'] or pr['number'] == 1:
            raise RuntimeError('Cleanup identity mismatch; inspect manually.')
        if pr['state'] == 'open':
            github(f"pulls/{pr['number']}", 'PATCH', {'state': 'closed'})
            time.sleep(1)
        row['closed'] = True
        save(path, state)
        print(f"Closed test PR #{pr['number']}", flush=True)
    print('Test branches and evidence retained. PR #1 preserved.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'open', 'collect', 'close'])
    parser.add_argument('--run', help='Existing run ID printed by prepare')
    args = parser.parse_args()
    root = pathlib.Path(command(['git', 'rev-parse', '--show-toplevel']).strip())
    git_dir = pathlib.Path(command(['git', '-C', str(root), 'rev-parse', '--absolute-git-dir']).strip())
    if aws('sts', 'get-caller-identity')['Account'] != ACCOUNT:
        raise RuntimeError('Wrong AWS account for this demo test.')
    if args.run:
        if pathlib.Path(args.run).name != args.run or args.run in ('.', '..'):
            raise RuntimeError('Invalid run ID.')
        path = git_dir / 'gatekeeper-burst' / args.run / 'run.json'
        state = json.loads(path.read_text(encoding='utf-8'))
    elif args.action == 'prepare':
        run = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:6]
        path = git_dir / 'gatekeeper-burst' / run / 'run.json'
        path.parent.mkdir(parents=True)
        state = {'run': run, 'repo': REPO, 'prs': []}
        save(path, state)
    else:
        raise RuntimeError('Supply --run from the prepare output.')
    print(f"Run ID: {state['run']}\nEvidence directory: {path.parent}", flush=True)
    {'prepare': prepare, 'open': open_prs, 'collect': collect, 'close': close_prs}[args.action](path, state)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        raise SystemExit(f'ERROR: {error}')

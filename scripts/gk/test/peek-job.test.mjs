// peek job with the team worker shape
// the team worker writes counts in capitals and verdict words like failure
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsLine, explain, leaseMs, pageWord, unmarshalItem } from '../peek-job.mjs';

test('counts from the team worker are in capitals', () => {
  const job = unmarshalItem({ counts: { M: { HIGH: { N: '1' }, MEDIUM: { N: '0' }, LOW: { N: '0' } } } });
  assert.equal(countsLine(job.counts), 'counts: high 1, medium 0, low 0');
});

test('counts from my laptop worker are small letters', () => {
  assert.equal(countsLine({ high: 0, medium: 2, low: 1 }), 'counts: high 0, medium 2, low 1');
});

test('no counts gives no line and a missing count shows a question mark', () => {
  assert.equal(countsLine(undefined), null);
  assert.equal(countsLine([]), null);
  assert.equal(countsLine({ HIGH: 3 }), 'counts: high 3, medium ?, low ?');
});

test('verdict words match the page', () => {
  assert.equal(pageWord('success'), 'PASS');
  assert.equal(pageWord('failure'), 'FAIL');
  assert.equal(pageWord('FAIL'), 'FAIL');
  assert.equal(pageWord('error'), 'INCOMPLETE');
  assert.equal(pageWord('something new'), 'INCOMPLETE');
});

test('the last try says dead letter queue and blocked', () => {
  const text = explain({ phase: 'FAILED', attempt: 5 });
  assert.match(text, /last try \(5 of 5\)/);
  assert.match(text, /dead letter queue/);
  assert.match(text, /look at the log lines/);
});

test('an early failed try still says SQS retries', () => {
  assert.match(explain({ phase: 'FAILED', attempt: 2, lastError: 'BOOM' }), /FAILED on try 2: BOOM\. SQS retries after 360 s/);
});

test('a done job from the team worker names the page word', () => {
  assert.match(explain({ phase: 'DONE', verdict: 'failure' }), /verdict failure \(the page shows FAIL\)/);
  assert.match(explain({ phase: 'DONE', verdict: 'success' }), /the page shows PASS/);
  assert.match(explain({ phase: 'DONE', verdict: 'INCOMPLETE' }), /DONE, INCOMPLETE/);
});

test('the lease works as epoch seconds or an ISO time', () => {
  const past = new Date(Date.now() - 60000).toISOString();
  const future = new Date(Date.now() + 60000).toISOString();
  assert.match(explain({ phase: 'RUNNING', leaseUntil: past }), /old lease/);
  assert.match(explain({ phase: 'RUNNING', leaseUntil: future }), /holds the lease/);
  assert.match(explain({ phase: 'RUNNING', leaseUntil: Math.floor(Date.now() / 1000) - 60 }), /old lease/);
  assert.match(explain({ phase: 'RUNNING' }), /no lease time/);
  assert.equal(leaseMs('not a time'), null);
});

test('the lease check uses the time we pass in', () => {
  const lease = '2026-11-20T05:00:00.000Z';
  assert.match(explain({ phase: 'RUNNING', leaseUntil: lease }, Date.parse('2026-11-20T05:01:00.000Z')), /old lease/);
  assert.match(explain({ phase: 'RUNNING', leaseUntil: lease }, Date.parse('2026-11-20T04:59:00.000Z')), /holds the lease/);
});


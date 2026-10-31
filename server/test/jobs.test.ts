/**
 * Background job tests.
 *
 * These guard the fix for the "app freezes at 2%" report: a scan must always
 * either finish, fail with a reason, time out, or be cancellable — never sit
 * silently in `running` while the UI spins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelJob, getJob, runningJobIdFor, runningJobsFor, startJob } from '../src/jobs.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a job runs, reports progress and completes', async () => {
  const id = startJob<string>('session-a', ['Step one', 'Step two'], async (ctx) => {
    ctx.step('Step one');
    ctx.progress(20);
    await sleep(10);
    ctx.step('Step two');
    return 'done';
  });

  const early = getJob<string>(id, 'session-a');
  assert.equal(early?.status, 'running');
  assert.equal(early?.step, 'Step one');

  await sleep(60);
  const finished = getJob<string>(id, 'session-a');
  assert.equal(finished?.status, 'done');
  assert.equal(finished?.result, 'done');
  assert.equal(finished?.progress, 100);
});

test('a stuck job times out with a reason and a hint instead of hanging', async () => {
  const id = startJob<string>(
    'session-b',
    ['Slow step'],
    async (ctx) => {
      // Never resolves: stands in for a hung network call.
      await new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve(undefined));
      });
      return 'should not matter';
    },
    { timeoutMs: 40, timeoutMessage: 'Stopped after 40ms.', timeoutHint: 'Try a smaller repo.' },
  );

  await sleep(120);
  const job = getJob<string>(id, 'session-b');
  assert.equal(job?.status, 'error');
  assert.equal(job?.error, 'Stopped after 40ms.');
  assert.equal(job?.hint, 'Try a smaller repo.');
});

test('a running job can be cancelled and frees the session', async () => {
  const id = startJob<string>('session-c', ['Waiting'], async (ctx) => {
    await new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => resolve(undefined));
    });
    return 'never';
  });

  assert.equal(runningJobsFor('session-c'), 1);
  assert.equal(runningJobIdFor('session-c'), id);

  assert.equal(cancelJob(id, 'session-c'), true);
  assert.equal(getJob<string>(id, 'session-c')?.status, 'error');
  assert.equal(getJob<string>(id, 'session-c')?.error, 'Cancelled by you.');
  assert.equal(runningJobsFor('session-c'), 0);

  // Cancelling twice is a no-op, not a crash.
  assert.equal(cancelJob(id, 'session-c'), false);
});

test('jobs never leak across sessions', () => {
  const id = startJob<string>('session-owner', ['Only step'], async () => 'secret');
  assert.equal(getJob<string>(id, 'someone-else'), null);
  assert.equal(cancelJob(id, 'someone-else'), false);
});

/**
 * In-memory background jobs.
 *
 * Scans and model calls can take 10-60 seconds, so the API returns a job id
 * immediately and the UI polls for progress. Jobs are deliberately not
 * persisted: a restart should never resurrect a half-finished GitHub write.
 *
 * Every job has a hard deadline (`timeoutMs`). Without one, a slow GitHub or an
 * unresponsive model endpoint left the UI spinning forever — the job stayed
 * "running", progress never moved, and nothing ever told the user why.
 */
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { log } from './logger.js';

export interface JobRecord<T = unknown> {
  id: string;
  sessionId: string;
  status: 'running' | 'done' | 'error';
  step: string;
  steps: string[];
  progress: number;
  result: T | null;
  error: string | null;
  /** Extra guidance shown under the error in the UI. */
  hint: string | null;
  createdAt: number;
  updatedAt: number;
  /** Progress is only ever written forward, so this is the last real movement. */
  lastProgressAt: number;
}

export interface JobContext {
  readonly id: string;
  readonly signal: AbortSignal;
  /** Mark a step as current. `progress` is derived from the step index. */
  step(label?: string): void;
  /** Free-form progress within the current step (0-100). */
  progress(value: number): void;
  /** Throw if the job was cancelled or timed out. Call between phases. */
  checkpoint(): void;
}

export interface JobOptions {
  timeoutMs?: number;
  /** Message used when the deadline passes. */
  timeoutMessage?: string;
  timeoutHint?: string;
}

const MAX_JOBS = 100;
const RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 180_000;

const jobs = new Map<string, JobRecord>();
const controllers = new Map<string, AbortController>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function gc(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - job.updatedAt > RETENTION_MS) {
      jobs.delete(id);
      controllers.delete(id);
    }
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (!oldest) break;
    jobs.delete(oldest);
    controllers.delete(oldest);
  }
}

function finish(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

/** Create a job and run `task` in the background. Returns the job id at once. */
export function startJob<T>(
  sessionId: string,
  steps: string[],
  task: (ctx: JobContext) => Promise<T>,
  options: JobOptions = {},
): string {
  gc();
  const id = crypto.randomBytes(12).toString('base64url');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();

  const record: JobRecord<T> = {
    id,
    sessionId,
    status: 'running',
    step: steps[0] ?? 'Working',
    steps,
    progress: 0,
    result: null,
    error: null,
    hint: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastProgressAt: Date.now(),
  };
  jobs.set(id, record as JobRecord);
  controllers.set(id, controller);

  let stepIndex = 0;
  const ctx: JobContext = {
    id,
    signal: controller.signal,
    step(label) {
      stepIndex += 1;
      record.step = label ?? steps[Math.min(stepIndex, steps.length - 1)] ?? record.step;
      const derived = Math.min(95, Math.round((stepIndex / Math.max(1, steps.length)) * 100));
      record.progress = Math.max(record.progress, derived);
      record.updatedAt = Date.now();
      record.lastProgressAt = Date.now();
    },
    progress(value) {
      const next = Math.max(record.progress, Math.min(99, Math.round(value)));
      if (next > record.progress) record.lastProgressAt = Date.now();
      record.progress = next;
      record.updatedAt = Date.now();
    },
    checkpoint() {
      if (controller.signal.aborted) {
        throw new Error(record.error ?? 'Job cancelled.');
      }
    },
  };

  // Hard deadline: abort the work and tell the user what happened.
  const timer = setTimeout(() => {
    if (record.status !== 'running') return;
    record.status = 'error';
    record.error = options.timeoutMessage ?? `This took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`;
    record.hint =
      options.timeoutHint ??
      'Nothing was written to GitHub. This is usually a slow network or a very large repository — try again, or pick a smaller repo.';
    record.updatedAt = Date.now();
    controller.abort(new Error(record.error));
    finish(id);
    log.warn('Job timed out', { id, step: record.step, timeoutMs });
  }, timeoutMs);
  timer.unref?.();
  timers.set(id, timer);

  task(ctx)
    .then((result) => {
      if (record.status !== 'running') return; // timed out or cancelled already
      record.result = result;
      record.status = 'done';
      record.progress = 100;
      record.step = 'Done';
      record.updatedAt = Date.now();
      finish(id);
    })
    .catch((error: unknown) => {
      if (record.status !== 'running') return; // already reported the timeout
      const message = error instanceof Error ? error.message : String(error);
      record.status = 'error';
      record.error = message;
      // A 403/404 raised inside a job carries the same guidance as an HTTP
      // error, so the UI can show "what to do next" instead of just a title.
      if (error instanceof HttpError && error.hint) record.hint = error.hint;
      record.updatedAt = Date.now();
      finish(id);
      log.warn('Background job failed', { id, message });
    });

  return id;
}

/**
 * Run a job to completion in the current request and return its record.
 *
 * Used on serverless platforms: there is no guarantee the next poll reaches the
 * same instance, so returning a job id alone would strand the client. Kept
 * beside `startJob` so both share the same record shape, deadline handling and
 * error/hint semantics.
 */
export async function runJobNow<T>(
  sessionId: string,
  steps: string[],
  task: (ctx: JobContext) => Promise<T>,
  options: JobOptions = {},
): Promise<JobRecord<T>> {
  const inline = startJob<T>(sessionId, steps, task, options);
  // `startJob` resolves asynchronously; wait for the record to leave 'running'.
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 5_000;

  for (;;) {
    const record = jobs.get(inline) as JobRecord<T> | undefined;
    if (!record) throw new Error('Inline job disappeared.');
    if (record.status !== 'running') return record;
    if (Date.now() > deadline) return record;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function getJob<T>(id: string, sessionId: string): JobRecord<T> | null {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId) return null; // never leak another session's job
  return job as JobRecord<T>;
}

/** Stop a running job. Returns false when it was already finished. */
export function cancelJob(id: string, sessionId: string): boolean {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId) return false;
  if (job.status !== 'running') return false;

  job.status = 'error';
  job.error = 'Cancelled by you.';
  job.hint = 'Nothing was written to GitHub. You can start a new scan whenever you like.';
  job.updatedAt = Date.now();
  controllers.get(id)?.abort(new Error('Cancelled'));
  finish(id);
  return true;
}

export function runningJobsFor(sessionId: string): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && job.status === 'running') count += 1;
  }
  return count;
}

/** The id of this session's running job, if any (used for a helpful 429). */
export function runningJobIdFor(sessionId: string): string | null {
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && job.status === 'running') return job.id;
  }
  return null;
}

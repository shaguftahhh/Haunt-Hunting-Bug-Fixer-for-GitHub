/**
 * In-memory background jobs.
 *
 * Scans and model calls can take 10-60 seconds, so the API returns a job id
 * immediately and the UI polls for progress. Jobs are deliberately not
 * persisted: a restart should never resurrect a half-finished GitHub write.
 */
import crypto from 'node:crypto';
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
  createdAt: number;
  updatedAt: number;
}

export interface JobContext {
  readonly id: string;
  /** Mark a step as current. `progress` is derived from the step index. */
  step(label?: string): void;
  /** Free-form progress within the current step (0-100). */
  progress(value: number): void;
}

const MAX_JOBS = 100;
const RETENTION_MS = 60 * 60 * 1000;

const jobs = new Map<string, JobRecord>();

function gc(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - job.updatedAt > RETENTION_MS) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (!oldest) break;
    jobs.delete(oldest);
  }
}

/** Create a job and run `task` in the background. Returns the job id. */
export function startJob<T>(
  sessionId: string,
  steps: string[],
  task: (ctx: JobContext) => Promise<T>,
): string {
  gc();
  const id = crypto.randomBytes(12).toString('base64url');
  const record: JobRecord<T> = {
    id,
    sessionId,
    status: 'running',
    step: steps[0] ?? 'Working',
    steps,
    progress: 0,
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, record as JobRecord);

  let stepIndex = 0;
  const ctx: JobContext = {
    id,
    step(label) {
      stepIndex += 1;
      if (label) record.step = label;
      else record.step = steps[Math.min(stepIndex, steps.length - 1)] ?? record.step;
      record.progress = Math.min(95, Math.round((stepIndex / Math.max(1, steps.length)) * 100));
      record.updatedAt = Date.now();
    },
    progress(value) {
      record.progress = Math.max(record.progress, Math.min(99, Math.round(value)));
      record.updatedAt = Date.now();
    },
  };

  task(ctx)
    .then((result) => {
      record.result = result;
      record.status = 'done';
      record.progress = 100;
      record.step = 'Done';
      record.updatedAt = Date.now();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      record.status = 'error';
      record.error = message;
      record.updatedAt = Date.now();
      log.warn('Background job failed', { id, message });
    });

  return id;
}

export function getJob<T>(id: string, sessionId: string): JobRecord<T> | null {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId) return null; // never leak another session's job
  return job as JobRecord<T>;
}

export function runningJobsFor(sessionId: string): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && job.status === 'running') count += 1;
  }
  return count;
}

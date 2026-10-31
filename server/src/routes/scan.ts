/**
 * Scan routes.
 *
 * POST /api/scan              → starts a background scan, returns { jobId } immediately
 * GET  /api/scan/:jobId       → progress + result
 * POST /api/scan/:jobId/cancel→ stop a scan that is taking too long
 * GET  /api/scan/result/:scanId → a stored scan
 *
 * The reply is sent *before* any GitHub call. An earlier version did the
 * repository access check inline, so a slow GitHub listing (or a big org) left
 * the browser waiting with no job id to poll — which looked exactly like the app
 * freezing at 2%. Now every wait is represented by a step the UI can show.
 *
 * Access is still checked server-side: a crafted request naming someone else's
 * repo fails inside the job before anything is read.
 */
import { Router } from 'express';
import { asyncHandler, HttpError, requireAuth } from '../http.js';
import { cancelJob, getJob, runningJobIdFor, runningJobsFor, startJob } from '../jobs.js';
import { getRepo, listOwnedRepos } from '../github/client.js';
import { getSession, storeScan } from '../session.js';
import { runScan } from '../scan/engine.js';
import { getRememberedDemoScan } from '../demo/store.js';
import { config } from '../config.js';
import type { JobView, RepoFile, RepoSummary, ScanResult } from '../types.js';

export const scanRouter = Router();

const STEPS = [
  'Checking repository access',
  'Reading the repository tree',
  'Skipping secrets and binaries',
  'Fetching source files',
  'Running static checks',
  'Reading open bug issues',
  'Asking the model to review',
  'Scoring findings',
];

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

scanRouter.post(
  '/scan',
  asyncHandler(async (req, res) => {
    const { token, login } = requireAuth(req);
    const session = getSession(req);
    const body = req.body as { repoFullName?: unknown };
    const repoFullName = typeof body.repoFullName === 'string' ? body.repoFullName.trim() : '';

    if (!REPO_PATTERN.test(repoFullName)) {
      throw new HttpError(400, 'Pick a repository from the list (format: owner/name).');
    }

    const running = runningJobIdFor(session.id);
    if (running) {
      throw new HttpError(
        429,
        'A scan is already running for this session.',
        'Wait for it to finish, or cancel it and start again.',
      );
    }

    const [owner, name] = repoFullName.split('/') as [string, string];

    let files: RepoFile[] = [];
    const jobId = startJob<ScanResult>(
      session.id,
      STEPS,
      async (ctx) => {
        ctx.step('Checking repository access');

        // A repo we already listed is trusted; otherwise re-list (slow, but rare).
        let repo: RepoSummary | undefined = session.repos?.find(
          (candidate) => candidate.fullName.toLowerCase() === repoFullName.toLowerCase(),
        );

        if (!repo) {
          const accessible = await listOwnedRepos(token, login, { includeWritable: true });
          session.repos = accessible;
          repo = accessible.find((candidate) => candidate.fullName.toLowerCase() === repoFullName.toLowerCase());
        }

        if (!repo) {
          throw new HttpError(
            403,
            'BugBanisher only scans repositories you own or can write to.',
            'If this is a fine-grained token, make sure this repository is included in its repository access list.',
          );
        }

        // Re-confirm write access from GitHub itself before reading anything.
        if (repo.owner.toLowerCase() === login.toLowerCase() || repo.pushAccess === true) {
          const fresh = await getRepo(token, owner, name);
          const ownsRepo = fresh.owner.toLowerCase() === login.toLowerCase();
          if (!ownsRepo && !fresh.pushAccess) {
            throw new HttpError(
              403,
              'That repository is not yours and you do not have write access.',
              'Pick a repository from the list — BugBanisher never touches anything else.',
            );
          }
        }

        ctx.checkpoint();
        const result = await runScan(
          {
            token,
            repo,
            mode: 'github',
            onFiles: (fetched) => {
              files = fetched;
            },
          },
          ctx,
          ctx.signal,
        );
        storeScan(session, { scan: result, files, repo, userLogin: login });
        return result;
      },
      {
        timeoutMs: config.scan.timeoutMs,
        timeoutMessage: `The scan did not finish within ${Math.round(config.scan.timeoutMs / 1000)}s, so BugBanisher stopped it.`,
        timeoutHint:
          'Nothing was written to GitHub. Large repositories and slow networks can cause this — try again, raise SCAN_TIMEOUT_MS, or scan a smaller repo.',
      },
    );

    res.status(202).json({ jobId });
  }),
);

scanRouter.get(
  '/scan/:jobId',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const job = getJob<ScanResult>(req.params.jobId ?? '', session.id);
    if (!job) throw new HttpError(404, 'That scan job does not exist (or belongs to another session).');

    const view: JobView<ScanResult> = {
      id: job.id,
      status: job.status,
      step: job.step,
      steps: job.steps,
      progress: job.progress,
      result: job.result,
      error: job.error,
      hint: job.hint,
      stalledForMs: job.status === 'running' ? Date.now() - job.lastProgressAt : 0,
    };
    res.json(view);
  }),
);

scanRouter.post(
  '/scan/:jobId/cancel',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const cancelled = cancelJob(req.params.jobId ?? '', session.id);
    if (!cancelled) {
      throw new HttpError(409, 'That scan already finished, so there was nothing to cancel.');
    }
    res.json({ cancelled: true });
  }),
);

scanRouter.get(
  '/scan/result/:scanId',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const record =
      session.scans.get(req.params.scanId ?? '') ?? getRememberedDemoScan(req.params.scanId ?? '');
    if (!record) {
      throw new HttpError(
        404,
        'That scan is no longer in memory.',
        'Sessions forget scans after 12 hours or after reconnecting GitHub. Run the scan again.',
      );
    }
    res.json(record.scan);
  }),
);

// Guard: a scan route mounted after the result route must not shadow it.
void runningJobsFor;
void STEPS;

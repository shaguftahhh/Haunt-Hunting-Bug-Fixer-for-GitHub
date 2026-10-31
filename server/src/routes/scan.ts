/**
 * Scan routes.
 *
 * POST /api/scan           → starts a background scan, returns { jobId }
 * GET  /api/scan/:jobId    → progress + result
 * GET  /api/scan/result/:scanId → a stored scan
 *
 * Only repositories owned by the signed-in user are accepted, even if a
 * crafted request names someone else's repo.
 */
import { Router } from 'express';
import { asyncHandler, HttpError, requireAuth } from '../http.js';
import { getJob, runningJobsFor, startJob } from '../jobs.js';
import { getRepo, listOwnedRepos } from '../github/client.js';
import { getSession, storeScan } from '../session.js';
import { runScan } from '../scan/engine.js';
import { getRememberedDemoScan } from '../demo/store.js';
import type { JobView, RepoFile, ScanResult } from '../types.js';

export const scanRouter = Router();

const STEPS = [
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
    if (runningJobsFor(session.id) > 0) {
      throw new HttpError(429, 'A scan is already running. Wait for it to finish.');
    }

    const [owner, name] = repoFullName.split('/') as [string, string];

    // Ownership check #1: the repo must be in the user's owned-repo list.
    const owned = await listOwnedRepos(token, login);
    const listed = owned.find((repo) => repo.fullName.toLowerCase() === repoFullName.toLowerCase());
    if (!listed) {
      throw new HttpError(
        403,
        'BugBanisher only scans repositories you own.',
        'If this is a fine-grained token, make sure this repository is included in its repository access list.',
      );
    }

    // Ownership check #2: re-read the repo and confirm the owner literally is you.
    const repo = await getRepo(token, owner, name);
    if (repo.owner.toLowerCase() !== login.toLowerCase()) {
      throw new HttpError(403, 'That repository is not owned by your account.');
    }

    let files: RepoFile[] = [];
    const jobId = startJob<ScanResult>(session.id, STEPS, async (ctx) => {
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
      );
      storeScan(session, { scan: result, files, repo, userLogin: login });
      return result;
    });

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
    };
    res.json(view);
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

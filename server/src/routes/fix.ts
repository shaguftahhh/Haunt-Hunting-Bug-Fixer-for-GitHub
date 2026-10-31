/**
 * Fix routes.
 *
 * POST /api/fix            → generate + verify a minimal patch for one finding
 * GET  /api/fix/:jobId     → progress and the verified patch
 * GET  /api/fix/result/:fixId → a stored patch
 *
 * Generation never writes to GitHub. It only reads the file and calls a model.
 */
import { Router } from 'express';
import { asyncHandler, HttpError, requireAuth } from '../http.js';
import { getJob, runningJobsFor, startJob } from '../jobs.js';
import { getSession, storeFix } from '../session.js';
import { generateFix } from '../patch/generate.js';
import { getFileWithSha } from '../github/client.js';
import type { FixResult, JobView } from '../types.js';

export const fixRouter = Router();

const STEPS = [
  'Locating the file',
  'Drafting a minimal patch',
  'Verifying the patch',
  'Preparing the pull request',
];

fixRouter.post(
  '/fix',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const body = req.body as { scanId?: unknown; findingId?: unknown };
    const scanId = typeof body.scanId === 'string' ? body.scanId : '';
    const findingId = typeof body.findingId === 'string' ? body.findingId : '';

    const record = session.scans.get(scanId);
    if (!record) {
      throw new HttpError(
        404,
        'That scan is no longer in memory.',
        'Run the scan again — sessions forget scans after 12 hours.',
      );
    }

    // Demo scans do not need a GitHub connection.
    if (record.scan.mode === 'github') requireAuth(req);

    if (runningJobsFor(session.id) > 0) {
      throw new HttpError(429, 'Another job is running. Wait for it to finish.');
    }

    const finding = record.scan.findings.find((candidate) => candidate.id === findingId);
    if (!finding) throw new HttpError(404, 'That finding is not part of this scan.');
    if (finding.source === 'issue' || finding.line < 1) {
      throw new HttpError(
        400,
        'This finding comes from an issue and has no file location yet.',
        'Open the issue, identify the file, then run a new scan so the finding points at code.',
      );
    }

    const jobId = startJob<FixResult>(session.id, STEPS, async (ctx) => {
      ctx.step('Locating the file');

      let beforeContent = record.files.find((file) => file.path === finding.file)?.content ?? null;
      let fileSha: string | undefined;

      if (record.scan.mode === 'github' && session.token) {
        // Re-read the file at fix time: it must be the current content, and we
        // need its blob SHA to avoid overwriting a change made after the scan.
        const current = await getFileWithSha(
          session.token,
          record.repo.owner,
          record.repo.name,
          finding.file,
          record.repo.defaultBranch,
        );
        if (!current) {
          throw new HttpError(404, `${finding.file} no longer exists on ${record.repo.defaultBranch}.`);
        }
        beforeContent = current.content;
        fileSha = current.sha;
      }

      if (beforeContent === null) {
        throw new HttpError(404, `BugBanisher does not have the content of ${finding.file}.`);
      }

      ctx.step('Drafting a minimal patch');
      const { record: fixRecord } = await generateFix(
        {
          scanId,
          mode: record.scan.mode,
          repo: record.repo,
          finding,
          path: finding.file,
          beforeContent,
          fileSha,
        },
        ctx,
      );

      storeFix(session, fixRecord);
      return fixRecord.fix;
    });

    res.status(202).json({ jobId });
  }),
);

fixRouter.get(
  '/fix/:jobId',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    requireAuth(req);
    const job = getJob<FixResult>(req.params.jobId ?? '', session.id);
    if (!job) throw new HttpError(404, 'That fix job does not exist (or belongs to another session).');

    const view: JobView<FixResult> = {
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

fixRouter.get(
  '/fix/result/:fixId',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    requireAuth(req);
    const record = session.fixes.get(req.params.fixId ?? '');
    if (!record) {
      throw new HttpError(
        404,
        'That patch is no longer in memory.',
        'Generate the fix again — patches are never persisted to disk.',
      );
    }
    res.json(record.fix);
  }),
);

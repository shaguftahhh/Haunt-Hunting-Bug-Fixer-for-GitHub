/**
 * The only route in BugBanisher that can write to GitHub.
 *
 * Requirements before a write:
 *   - an explicit confirm:true from the approval modal,
 *   - a verified fix from this session,
 *   - fewer than 3 approvals used,
 *   - a connected GitHub account that owns the repo,
 *   - the file must not have changed since the patch was generated,
 *   - a branch that is NOT the default branch.
 *
 * Dry-run short-circuits before any GitHub write and returns a simulated record.
 * BugBanisher never merges a pull request and never touches the default branch.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { asyncHandler, HttpError, requireAuth } from '../http.js';
import { addHistory, getSession, sessionView } from '../session.js';
import { config } from '../config.js';
import {
  addLabel,
  commitFile,
  createBranch,
  getBranchSha,
  getFileWithSha,
  openPullRequest,
} from '../github/client.js';
import { assertSafeBranch } from '../pr/draft.js';
import { getRememberedDemoFix } from '../demo/store.js';
import { resolveDemoFix, resolveDemoScan } from '../demo/rebuild.js';
import { log } from '../logger.js';
import type { PullRequestRecord } from '../types.js';

export const approveRouter = Router();

approveRouter.post(
  '/approve',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const body = req.body as { fixId?: unknown; confirm?: unknown };
    const fixId = typeof body.fixId === 'string' ? body.fixId : '';

    if (body.confirm !== true) {
      throw new HttpError(400, 'Approval must be explicit. Open the confirmation dialog and click "Open Pull Request".');
    }

    const fixRecord =
      session.fixes.get(fixId) ??
      getRememberedDemoFix(fixId) ??
      (await resolveDemoFix(fixId)) ??
      undefined;
    if (!fixRecord) {
      throw new HttpError(404, 'That patch is no longer in memory. Generate it again.');
    }
    const fix = fixRecord.fix;

    const scanRecord =
      session.scans.get(fixRecord.scanId) ??
      (await resolveDemoScan(fixRecord.scanId)) ??
      undefined;
    if (!scanRecord) throw new HttpError(404, 'The scan behind this patch has expired. Rescan and regenerate.');

    if (!fix.verified) {
      throw new HttpError(409, 'This patch did not pass verification, so it cannot be approved.');
    }

    if (session.approvals >= config.safety.approvalCap) {
      throw new HttpError(
        429,
        `Session cap reached: ${config.safety.approvalCap} approvals. No more pull requests can be opened in this session.`,
        'This hard cap keeps BugBanisher from becoming a bulk-PR bot. Disconnect and reconnect for a new session.',
      );
    }

    if (session.history.some((entry) => entry.fixId === fixId)) {
      throw new HttpError(409, 'This patch was already approved. Generate a new patch to open another PR.');
    }

    if (!fixRecord.afterContent || fixRecord.afterContent === fixRecord.beforeContent) {
      throw new HttpError(409, 'The patch has no change to commit.');
    }

    const baseBranch = scanRecord.repo.defaultBranch;
    assertSafeBranch(fix.branchName, baseBranch);

    const dryRun = session.dryRun;
    let number: number | null = null;
    let htmlUrl: string | null = null;
    let labelApplied = false;
    let note = '';

    if (!dryRun) {
      if (scanRecord.scan.mode !== 'github') {
        throw new HttpError(
          409,
          'This scan is from Demo Mode, which has no GitHub repository to write to.',
          'Demo Mode is always a dry run. Exit demo, scan your own repository, and approve from there.',
        );
      }

      const { token, login } = requireAuth(req);

      const ownsRepo = scanRecord.repo.owner.toLowerCase() === login.toLowerCase();
      if (!ownsRepo && scanRecord.repo.pushAccess !== true) {
        throw new HttpError(403, 'The connected account has no write access to this repository.');
      }
      if (!fixRecord.fileSha) {
        throw new HttpError(409, 'Missing file version information. Regenerate the patch.');
      }

      // The file must be unchanged since the patch was generated.
      const current = await getFileWithSha(
        token,
        scanRecord.repo.owner,
        scanRecord.repo.name,
        fixRecord.path,
        baseBranch,
      );
      if (!current) throw new HttpError(409, `${fixRecord.path} no longer exists on ${baseBranch}.`);
      if (current.sha !== fixRecord.fileSha) {
        throw new HttpError(
          409,
          `${fixRecord.path} changed after the patch was generated.`,
          'Rescan and generate a fresh patch so the diff applies to the current file.',
        );
      }

      const baseSha = await getBranchSha(token, scanRecord.repo.owner, scanRecord.repo.name, baseBranch);
      await createBranch(token, scanRecord.repo.owner, scanRecord.repo.name, fix.branchName, baseSha);

      await commitFile(token, scanRecord.repo.owner, scanRecord.repo.name, {
        path: fixRecord.path,
        content: fixRecord.afterContent,
        branch: fix.branchName,
        sha: current.sha,
        message: `${fix.prTitle}\n\n${fix.summary}\n\nOpened with BugBanisher (ai-assisted, human-approved).`,
      });

      const pr = await openPullRequest(token, scanRecord.repo.owner, scanRecord.repo.name, {
        title: fix.prTitle,
        head: fix.branchName,
        base: baseBranch,
        body: fix.prBody,
      });
      number = pr.number;
      htmlUrl = pr.htmlUrl;

      // Fine-grained tokens limited to Contents + Pull requests cannot always
      // write labels; the body always carries the disclosure either way.
      labelApplied = await addLabel(
        token,
        scanRecord.repo.owner,
        scanRecord.repo.name,
        pr.number,
        'ai-assisted',
      );
      if (!labelApplied) {
        note =
          'The PR was opened, but GitHub did not allow adding the "ai-assisted" label (your token is limited to Contents + Pull requests). The PR body states it is AI-assisted.';
      }

      log.info('Pull request opened', {
        repo: scanRecord.repo.fullName,
        pr: pr.number,
        branch: fix.branchName,
        labeled: labelApplied,
      });
    } else {
      note = 'Dry run: this approval was simulated. No branch, commit or pull request was created.';
      log.info('Dry-run approval simulated', { repo: scanRecord.repo.fullName, branch: fix.branchName });
    }

    const entry: PullRequestRecord = {
      id: crypto.randomBytes(8).toString('base64url'),
      mode: scanRecord.scan.mode,
      fixId,
      findingId: fix.finding.id,
      repoFullName: scanRecord.repo.fullName,
      number,
      title: fix.prTitle,
      branchName: fix.branchName,
      htmlUrl,
      dryRun,
      status: dryRun ? 'dry-run' : 'opened',
      createdAt: new Date().toISOString(),
      findingTitle: fix.finding.title,
      file: fix.finding.file,
      line: fix.finding.line,
    };

    session.approvals += 1;
    addHistory(session, entry);

    res.json({
      record: entry,
      session: sessionView(session),
      labelApplied,
      note,
    });
  }),
);

/**
 * Demo Mode route.
 *
 * Loads the bundled sample repo, runs the same scanner, and merges cached model
 * responses. No GitHub token, no network, no model — a 3-minute demo survives
 * bad conference Wi-Fi.
 */
import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { getSession, storeScan } from '../session.js';
import { buildDemoBundle } from '../demo/loader.js';

export const demoRouter = Router();

demoRouter.post(
  '/demo',
  asyncHandler(async (req, res) => {
    const session = getSession(req);
    const bundle = await buildDemoBundle();

    storeScan(session, {
      scan: bundle.scan,
      files: bundle.files,
      repo: bundle.repo,
      userLogin: session.user?.login ?? 'demo',
    });

    // Demo Mode is always a dry run: there is no repository to write to.
    session.dryRun = true;

    res.json({ repo: bundle.repo, scan: bundle.scan });
  }),
);

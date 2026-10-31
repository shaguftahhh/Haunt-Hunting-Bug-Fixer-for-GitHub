import fs from 'node:fs';
import path from 'node:path';
import { runScan } from '../server/src/scan/engine.js';
import type { RepoFile } from '../server/src/types.js';

const root = path.resolve('demo/sample-repo');
const paths: string[] = [];
const files: RepoFile[] = [];
function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const rel = path.relative(root, full);
      paths.push(rel);
      if (!rel.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf8');
        files.push({ path: rel, content, size: content.length });
      }
    }
  }
}
walk(root);
const ctx = { id: 't', step: (l?: string) => console.log('step:', l), progress: () => {} };
const repo = {
  owner: 'demo', name: 'moonlit-mailroom', fullName: 'demo/moonlit-mailroom', private: false,
  archived: false, fork: false, defaultBranch: 'main', description: null, language: 'JavaScript',
  stars: 0, updatedAt: null, htmlUrl: 'https://github.com/demo/moonlit-mailroom',
};
const result = await runScan({ token: '', repo, mode: 'demo', localFiles: files, localPaths: paths }, ctx as never);
console.log(JSON.stringify({ findings: result.findings.map(f => ({ id: f.id, file: f.file, line: f.line, sev: f.severity, title: f.title, rule: f.ruleId, snippetStart: f.snippetStart, snippet: f.snippet?.split('\n').slice(0,3) })), stats: result.stats, notes: result.notes }, null, 2));

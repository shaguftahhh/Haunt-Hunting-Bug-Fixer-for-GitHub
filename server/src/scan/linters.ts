/**
 * Linter detection and the static checks we can safely run ourselves.
 *
 * Security decision (documented in the README):
 *   - We RUN real parsers that only read files: the TypeScript compiler API
 *     (syntax diagnostics), Python's ast module, and ruff when it is installed.
 *   - We DETECT but do not EXECUTE ESLint/Prettier/Biome. Their config files and
 *     plugins are JavaScript, and running a stranger's JS to review their code
 *     would be an easy way to get own goals.
 *
 * We never install dependencies and never run repository scripts.
 */
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import type { Finding, RepoFile } from '../types.js';
import { languageOf } from './fileFilter.js';

export interface LinterDetection {
  id: string;
  name: string;
  configPath: string | null;
  executed: boolean;
  note: string;
}

const CONFIG_MATCHERS: Array<{
  id: string;
  name: string;
  patterns: RegExp[];
  executed: boolean;
  note: string;
}> = [
  {
    id: 'eslint',
    name: 'ESLint',
    patterns: [/^\.eslintrc(\.(json|ya?ml|js|cjs))?$/, /^eslint\.config\.(js|mjs|cjs|ts)$/],
    executed: false,
    note: 'Config may execute JavaScript, so BugBanisher detects it but does not run it.',
  },
  {
    id: 'tsc',
    name: 'TypeScript compiler',
    patterns: [/^tsconfig(\..+)?\.json$/],
    executed: true,
    note: 'Syntax diagnostics run with the TypeScript compiler API (no project install needed).',
  },
  {
    id: 'ruff',
    name: 'ruff',
    patterns: [/^\.?ruff\.toml$/, /^pyproject\.toml$/, /^setup\.cfg$/],
    executed: true,
    note: 'Runs only when the ruff binary is installed on this machine.',
  },
  {
    id: 'mypy',
    name: 'mypy',
    patterns: [/^mypy\.ini$/, /^\.mypy\.ini$/],
    executed: false,
    note: 'Type checking a stranger’s project needs its dependencies installed; not executed.',
  },
  {
    id: 'prettier',
    name: 'Prettier',
    patterns: [/^\.prettierrc(\.(json|ya?ml|js|cjs))?$/, /^prettier\.config\.(js|cjs|mjs)$/],
    executed: false,
    note: 'Formatting only — not relevant to correctness.',
  },
  {
    id: 'biome',
    name: 'Biome',
    patterns: [/^biome\.jsonc?$/],
    executed: false,
    note: 'Not executed; BugBanisher’s built-in rules still apply.',
  },
  {
    id: 'pytest',
    name: 'pytest',
    patterns: [/^pytest\.ini$/, /^conftest\.py$/],
    executed: false,
    note: 'Tests need the project’s dependencies; BugBanisher suggests how to verify a fix instead.',
  },
  {
    id: 'go-vet',
    name: 'go vet',
    patterns: [/^go\.mod$/],
    executed: false,
    note: 'Run `go vet ./...` locally after applying the patch.',
  },
];

export function detectLinters(paths: string[]): LinterDetection[] {
  const found = new Map<string, LinterDetection>();
  for (const path of paths) {
    const base = path.split('/').pop() ?? path;
    for (const matcher of CONFIG_MATCHERS) {
      if (found.has(matcher.id)) continue;
      if (matcher.patterns.some((pattern) => pattern.test(base))) {
        const installed = matcher.id === 'ruff' ? hasBinary('ruff') : true;
        found.set(matcher.id, {
          id: matcher.id,
          name: matcher.name,
          configPath: path,
          executed: matcher.executed && installed,
          note:
            matcher.id === 'ruff' && !installed
              ? 'Detected, but the ruff binary is not installed here — skipped.'
              : matcher.note,
        });
      }
    }
  }
  return [...found.values()];
}

function hasBinary(name: string): boolean {
  const result = spawnSync('which', [name], { encoding: 'utf8', timeout: 2_000 });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function lineOf(content: string, position: number): number {
  return content.slice(0, position).split('\n').length;
}

/**
 * Real syntax checks. A file that does not parse is always a bug, and it is
 * the cheapest high-confidence signal we have.
 */
export function runSyntaxChecks(files: RepoFile[]): {
  findings: Finding[];
  checks: Array<{ label: string; ok: boolean; detail: string }>;
} {
  const findings: Finding[] = [];
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
  let tsChecked = 0;
  let pyChecked = 0;
  let pyAvailable = false;

  for (const file of files) {
    const language = languageOf(file.path);

    if (language === 'javascript' || language === 'typescript') {
      const jsx = file.path.endsWith('.tsx') || file.path.endsWith('.jsx');
      const result = ts.transpileModule(file.content, {
        fileName: file.path,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          allowJs: language === 'javascript',
          checkJs: false,
        },
      });
      tsChecked += 1;

      for (const diagnostic of result.diagnostics ?? []) {
        // Ignore compiler-option diagnostics (codes >= 6000); this is a parse check.
        if (diagnostic.category !== ts.DiagnosticCategory.Error || (diagnostic.code ?? 0) >= 6000) continue;
        const line = diagnostic.start !== undefined ? lineOf(file.content, diagnostic.start) : 1;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        findings.push({
          id: `syntax-${file.path}-${line}`,
          source: 'static',
          file: file.path,
          line,
          severity: 'high',
          confidence: 98,
          title: 'File does not parse (syntax error)',
          explanation: `The ${language === 'typescript' ? 'TypeScript' : 'JavaScript'} parser stops here: ${message}`,
          whyItMatters:
            'A file that cannot be parsed cannot run at all. Syntax errors are the first thing a build or test run will hit.',
          ruleId: 'syntax/ts',
        });
        break; // one syntax error per file is enough to act on
      }
    }

    if (language === 'python') {
      const result = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
        input: file.content,
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (result.error || result.status === null) {
        // python3 is not available here: report once, do not fail the scan.
        if (!pyAvailable && pyChecked === 0) {
          checks.push({
            label: 'Python syntax check',
            ok: false,
            detail: 'python3 is not installed on this machine, so Python files were only checked by rules.',
          });
        }
        continue;
      }
      pyAvailable = true;
      pyChecked += 1;
      if (result.status !== 0) {
        const stderr = (result.stderr ?? '').trim().split('\n');
        const lineMatch = /line (\d+)/.exec(result.stderr ?? '');
        findings.push({
          id: `syntax-${file.path}`,
          source: 'static',
          file: file.path,
          line: lineMatch ? Number(lineMatch[1]) : 1,
          severity: 'high',
          confidence: 98,
          title: 'File does not parse (Python syntax error)',
          explanation: stderr.slice(-1)[0] || 'Python could not parse this file.',
          whyItMatters: 'Python refuses to import a file with a syntax error, so this code path is dead until it is fixed.',
          ruleId: 'syntax/python',
        });
      }
    }
  }

  if (tsChecked > 0) {
    checks.push({
      label: 'TypeScript/JavaScript parse check',
      ok: true,
      detail: `${tsChecked} file(s) parsed with the TypeScript compiler API.`,
    });
  }
  if (pyChecked > 0) {
    checks.push({
      label: 'Python parse check',
      ok: true,
      detail: `${pyChecked} file(s) parsed with Python's ast module.`,
    });
  }

  return { findings, checks };
}

/**
 * Optional ruff pass. Only runs if the binary exists; each file is fed through
 * stdin so nothing is written to disk.
 */
export function runRuff(files: RepoFile[]): {
  findings: Finding[];
  check: { label: string; ok: boolean; detail: string } | null;
} {
  if (!hasBinary('ruff')) return { findings: [], check: null };
  const findings: Finding[] = [];
  let scanned = 0;

  for (const file of files.filter((f) => languageOf(f.path) === 'python').slice(0, 12)) {
    const result = spawnSync(
      'ruff',
      ['check', '--no-cache', '--output-format', 'json', '--stdin-filename', file.path, '-'],
      { input: file.content, encoding: 'utf8', timeout: 10_000 },
    );
    if (result.status === null) continue;
    scanned += 1;
    try {
      const parsed = JSON.parse(result.stdout || '[]') as Array<{
        code: string;
        message: string;
        location?: { row: number };
      }>;
      for (const item of parsed.slice(0, 5)) {
        // Only correctness-ish rules; ruff's default set is mostly real defects.
        findings.push({
          id: `ruff-${file.path}-${item.location?.row ?? 1}-${item.code}`,
          source: 'static',
          file: file.path,
          line: item.location?.row ?? 1,
          severity: ['F821', 'F811', 'E999'].includes(item.code) ? 'high' : 'low',
          confidence: 80,
          title: `ruff ${item.code}: ${item.message}`,
          explanation: item.message,
          whyItMatters:
            'Ruff checks for patterns that frequently become real bugs (undefined names, shadowing, broken imports).',
          ruleId: `ruff/${item.code}`,
        });
      }
    } catch {
      /* ruff printed something unexpected; ignore this file */
    }
  }

  return {
    findings,
    check: scanned
      ? { label: 'ruff', ok: true, detail: `ruff checked ${scanned} Python file(s).` }
      : null,
  };
}

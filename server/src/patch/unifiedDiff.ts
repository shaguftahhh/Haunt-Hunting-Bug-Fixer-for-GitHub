/**
 * Unified diff tools: create a diff, parse it, and apply it strictly.
 *
 * Why write this by hand? Because "verify the patch applies cleanly" is a core
 * safety promise. We must understand every byte we accept, and we should not
 * shell out to `git apply` with model output.
 */

export interface DiffOp {
  type: 'eq' | 'del' | 'add';
  line: string;
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    ops: DiffOp[];
  }>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Split into lines while remembering whether the text ended with a newline. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === '') return { lines: [], trailingNewline: false };
  const normalized = text.replace(/\r\n/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  const body = trailingNewline ? normalized.slice(0, -1) : normalized;
  return { lines: body.split('\n'), trailingNewline };
}

/** Longest-common-subsequence diff on the changed middle section only. */
function diffMiddle(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;

  // Guard against pathological memory use; a full replacement still applies.
  if (n * m > 4_000_000) {
    return [
      ...before.map((line): DiffOp => ({ type: 'del', line })),
      ...after.map((line): DiffOp => ({ type: 'add', line })),
    ];
  }

  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = table[i];
      const next = table[i + 1];
      if (!row || !next) continue;
      row[j] = before[i] === after[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ type: 'eq', line: before[i] as string });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      ops.push({ type: 'del', line: before[i] as string });
      i += 1;
    } else {
      ops.push({ type: 'add', line: after[j] as string });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: before[i] as string });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'add', line: after[j] as string });
    j += 1;
  }
  return ops;
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before).lines;
  const b = splitLines(after).lines;

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return [
    ...a.slice(0, prefix).map((line): DiffOp => ({ type: 'eq', line })),
    ...diffMiddle(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((line): DiffOp => ({ type: 'eq', line })),
  ];
}

/** Build a git-style unified diff for a single file. */
export function createUnifiedDiff(path: string, before: string, after: string, context = 3): string {
  const ops = diffLines(before, after);
  if (!ops.some((op) => op.type !== 'eq')) return '';

  // Group ops into hunks with `context` lines around each change.
  const changeIndexes = ops.map((op, index) => (op.type === 'eq' ? -1 : index)).filter((index) => index >= 0);
  type Group = { start: number; end: number };
  const groups: Group[] = [];

  for (const index of changeIndexes) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = groups[groups.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else groups.push({ start, end });
  }

  const { trailingNewline: beforeNewline } = splitLines(before);
  const { trailingNewline: afterNewline } = splitLines(after);

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;

  for (const group of groups) {
    // Advance counters over ops before this group.
    for (; cursor < group.start; cursor += 1) {
      const op = ops[cursor];
      if (!op) continue;
      if (op.type !== 'add') oldLine += 1;
      if (op.type !== 'del') newLine += 1;
    }

    const hunkOps = ops.slice(group.start, group.end);
    const oldLen = hunkOps.filter((op) => op.type !== 'add').length;
    const newLen = hunkOps.filter((op) => op.type !== 'del').length;
    lines.push(`@@ -${oldLine},${oldLen} +${newLine},${newLen} @@`);

    const touchesEnd = group.end === ops.length;
    for (const op of hunkOps) {
      const prefix = op.type === 'eq' ? ' ' : op.type === 'del' ? '-' : '+';
      lines.push(`${prefix}${op.line}`);
    }
    if (touchesEnd && (!beforeNewline || !afterNewline)) {
      // A missing trailing newline is expressed after the last affected line.
      const lastAdd = [...hunkOps].reverse().find((op) => op.type === 'add');
      const markerNeeded = (!beforeNewline && !afterNewline) || !afterNewline || !beforeNewline;
      if (markerNeeded && lastAdd) lines.push('\\ No newline at end of file');
    }

    for (const op of hunkOps) {
      if (op.type !== 'add') oldLine += 1;
      if (op.type !== 'del') newLine += 1;
    }
    cursor = group.end;
  }

  return `${lines.join('\n')}\n`;
}

export function parseUnifiedDiff(diff: string): ParsedFileDiff {
  const rawLines = diff.replace(/\r\n/g, '\n').split('\n');
  // Drop the trailing empty element produced by a final newline.
  if (rawLines[rawLines.length - 1] === '') rawLines.pop();

  let oldPath: string | null = null;
  let newPath: string | null = null;
  const hunks: ParsedFileDiff['hunks'] = [];
  let current: ParsedFileDiff['hunks'][number] | null = null;

  for (const line of rawLines) {
    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).trim();
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = line.slice(4).trim();
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        ops: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (line.trim() === '' || line.startsWith('diff ') || line.startsWith('index ')) continue;
      throw new Error(`Unexpected line before the first hunk: "${line.slice(0, 60)}"`);
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line === '') {
      // Some models emit an empty line for an empty context line.
      current.ops.push({ type: 'eq', line: '' });
      continue;
    }
    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === ' ') current.ops.push({ type: 'eq', line: text });
    else if (prefix === '-') current.ops.push({ type: 'del', line: text });
    else if (prefix === '+') current.ops.push({ type: 'add', line: text });
    else throw new Error(`Invalid diff line prefix "${prefix}"`);
  }

  if (!oldPath || !newPath) throw new Error('Diff is missing --- / +++ file headers.');
  if (hunks.length === 0) throw new Error('Diff contains no hunks.');

  return { oldPath, newPath, hunks };
}

export interface ApplyResult {
  ok: boolean;
  content?: string;
  error?: string;
  appliedHunks?: number;
  addedLines?: number;
  removedLines?: number;
}

/**
 * Apply a single-file unified diff. Strict: context and removed lines must
 * match exactly, hunk line counts must be right, and nothing may be fuzzy.
 */
export function applyUnifiedDiff(original: string, diff: string, expectedPath?: string): ApplyResult {
  let parsed: ParsedFileDiff;
  try {
    parsed = parseUnifiedDiff(diff);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not parse the diff.' };
  }

  const stripPrefix = (path: string) => path.replace(/^[ab]\//, '');
  if (expectedPath) {
    if (stripPrefix(parsed.oldPath) !== expectedPath || stripPrefix(parsed.newPath) !== expectedPath) {
      return {
        ok: false,
        error: `Diff touches ${stripPrefix(parsed.oldPath)} → ${stripPrefix(parsed.newPath)}, expected only ${expectedPath}.`,
      };
    }
  }

  const { lines: originalLines, trailingNewline } = splitLines(original);
  const output: string[] = [];
  let cursor = 0; // 0-based index into original
  let added = 0;
  let removed = 0;

  for (const [index, hunk] of parsed.hunks.entries()) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    if (hunkStart < cursor) {
      return { ok: false, error: `Hunk ${index + 1} overlaps a previous hunk.` };
    }
    if (hunkStart > originalLines.length) {
      return { ok: false, error: `Hunk ${index + 1} starts past the end of the file.` };
    }

    // Copy untouched lines before the hunk.
    while (cursor < hunkStart) {
      const line = originalLines[cursor];
      if (line === undefined) break;
      output.push(line);
      cursor += 1;
    }

    let oldCount = 0;
    let newCount = 0;

    for (const op of hunk.ops) {
      if (op.type === 'eq') {
        if (originalLines[cursor] !== op.line) {
          return {
            ok: false,
            error: `Context mismatch at line ${cursor + 1}: expected "${op.line.slice(0, 50)}", found "${(originalLines[cursor] ?? '').slice(0, 50)}".`,
          };
        }
        output.push(op.line);
        cursor += 1;
        oldCount += 1;
        newCount += 1;
      } else if (op.type === 'del') {
        if (originalLines[cursor] !== op.line) {
          return {
            ok: false,
            error: `Removed line mismatch at line ${cursor + 1}: expected "${op.line.slice(0, 50)}", found "${(originalLines[cursor] ?? '').slice(0, 50)}".`,
          };
        }
        cursor += 1;
        removed += 1;
        oldCount += 1;
      } else {
        output.push(op.line);
        added += 1;
        newCount += 1;
      }
    }

    if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) {
      return {
        ok: false,
        error: `Hunk ${index + 1} says -${hunk.oldLines}/+${hunk.newLines} but contains -${oldCount}/+${newCount}.`,
      };
    }
  }

  while (cursor < originalLines.length) {
    const line = originalLines[cursor];
    if (line === undefined) break;
    output.push(line);
    cursor += 1;
  }

  const content = output.join('\n') + (trailingNewline ? '\n' : '');
  return { ok: true, content, appliedHunks: parsed.hunks.length, addedLines: added, removedLines: removed };
}

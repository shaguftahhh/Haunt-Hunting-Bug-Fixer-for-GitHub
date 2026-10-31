/**
 * Side-by-side (and optional unified) unified-diff viewer.
 *
 * Parsing is display-only: the server has already verified that the diff
 * applies byte-for-byte. This component never decides whether a patch is valid.
 */
import { useMemo, useState } from 'react';

interface DiffViewerProps {
  diff: string;
  redacted?: boolean;
}

type Op = { type: 'eq' | 'del' | 'add'; text: string };

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  ops: Op[];
}

interface Row {
  kind: 'hunk' | 'eq' | 'change' | 'add' | 'del';
  oldNumber: number | null;
  newNumber: number | null;
  left: string | null;
  right: string | null;
  header?: string;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parse(diff: string): { oldPath: string; newPath: string; hunks: Hunk[] } {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  let oldPath = '';
  let newPath = '';
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).trim();
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = line.slice(4).trim();
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        header: line,
        ops: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue;
    if (line === '') {
      current.ops.push({ type: 'eq', text: '' });
      continue;
    }
    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === ' ') current.ops.push({ type: 'eq', text });
    else if (prefix === '-') current.ops.push({ type: 'del', text });
    else if (prefix === '+') current.ops.push({ type: 'add', text });
  }

  return { oldPath, newPath, hunks };
}

function buildRows(hunks: Hunk[]): Row[] {
  const rows: Row[] = [];

  for (const hunk of hunks) {
    rows.push({
      kind: 'hunk',
      oldNumber: null,
      newNumber: null,
      left: null,
      right: null,
      header: hunk.header,
    });

    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    let index = 0;

    while (index < hunk.ops.length) {
      const op = hunk.ops[index];
      if (!op) break;

      if (op.type === 'eq') {
        rows.push({ kind: 'eq', oldNumber, newNumber, left: op.text, right: op.text });
        oldNumber += 1;
        newNumber += 1;
        index += 1;
        continue;
      }

      const deletions: string[] = [];
      const additions: string[] = [];
      while (index < hunk.ops.length && hunk.ops[index]?.type !== 'eq') {
        const change = hunk.ops[index];
        if (!change) break;
        if (change.type === 'del') deletions.push(change.text);
        else additions.push(change.text);
        index += 1;
      }

      const pairs = Math.max(deletions.length, additions.length);
      for (let i = 0; i < pairs; i += 1) {
        const left = deletions[i] ?? null;
        const right = additions[i] ?? null;
        const kind: Row['kind'] = left !== null && right !== null ? 'change' : left !== null ? 'del' : 'add';
        rows.push({
          kind,
          oldNumber: left !== null ? oldNumber + i : null,
          newNumber: right !== null ? newNumber + i : null,
          left,
          right,
        });
      }
      oldNumber += deletions.length;
      newNumber += additions.length;
    }
  }

  return rows;
}

function Cell({ value, side, tone }: { value: string | null; side: 'old' | 'new'; tone: 'eq' | 'del' | 'add' }) {
  if (value === null) {
    return <td className="diff-code diff-blank" aria-label={side === 'old' ? 'no before line' : 'no after line'} />;
  }
  const toneClass = tone === 'eq' ? '' : tone === 'del' ? 'diff-del' : 'diff-add';
  return (
    <td className={['diff-code', toneClass].filter(Boolean).join(' ')}>
      <span aria-hidden="true">{value === '' ? ' ' : value}</span>
      <span className="sr-only">
        {side === 'old' ? 'before: ' : 'after: '}
        {value === '' ? 'blank line' : value}
      </span>
    </td>
  );
}

export function DiffViewer({ diff, redacted }: DiffViewerProps) {
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const parsed = useMemo(() => parse(diff), [diff]);
  const rows = useMemo(() => buildRows(parsed.hunks), [parsed]);

  const added = parsed.hunks.reduce((sum, hunk) => sum + hunk.ops.filter((op) => op.type === 'add').length, 0);
  const removed = parsed.hunks.reduce((sum, hunk) => sum + hunk.ops.filter((op) => op.type === 'del').length, 0);

  if (parsed.hunks.length === 0) {
    return <p className="muted small">This patch has no content.</p>;
  }

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="mono">
          {parsed.newPath.replace(/^b\//, '')} <span className="diff-add">+{added}</span>{' '}
          <span className="diff-del">−{removed}</span>
        </span>
        <div className="row" style={{ gap: '0.4rem' }}>
          {redacted ? <span className="badge badge--medium">credentials masked</span> : null}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setMode(mode === 'split' ? 'unified' : 'split')}
            aria-pressed={mode === 'unified'}
          >
            {mode === 'split' ? 'Unified view' : 'Side-by-side view'}
          </button>
        </div>
      </div>

      <div className="diff-scroll">
        {mode === 'split' ? (
          <table className="diff-table">
            <caption className="sr-only">Side-by-side diff: before on the left, after on the right</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Before</th>
                <th scope="col">Line</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                if (row.kind === 'hunk') {
                  return (
                    <tr key={`hunk-${index}`}>
                      <td className="diff-num">·</td>
                      <td className="diff-hunk" colSpan={3}>
                        {row.header}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={`row-${index}`}>
                    <td className="diff-num">{row.oldNumber ?? ''}</td>
                    <Cell
                      value={row.left}
                      side="old"
                      tone={row.left === null ? 'eq' : row.kind === 'add' ? 'eq' : 'del'}
                    />
                    <td className="diff-num">{row.newNumber ?? ''}</td>
                    <Cell
                      value={row.right}
                      side="new"
                      tone={row.right === null ? 'eq' : row.kind === 'del' ? 'eq' : 'add'}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="diff-table diff-table--unified">
            <caption className="sr-only">Unified diff</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {parsed.hunks.flatMap((hunk, hunkIndex) => [
                <tr key={`uh-${hunkIndex}`}>
                  <td className="diff-num">·</td>
                  <td className="diff-hunk">{hunk.header}</td>
                </tr>,
                ...hunk.ops.map((op, opIndex) => {
                  const prefix = op.type === 'eq' ? ' ' : op.type === 'add' ? '+' : '−';
                  return (
                    <tr key={`uo-${hunkIndex}-${opIndex}`}>
                      <td className="diff-num" />
                      <td className={op.type === 'add' ? 'diff-add' : op.type === 'del' ? 'diff-del' : undefined}>
                        <span aria-hidden="true">
                          {prefix}
                          {op.text}
                        </span>
                        <span className="sr-only">
                          {op.type === 'add' ? 'added: ' : op.type === 'del' ? 'removed: ' : ''}
                          {op.text}
                        </span>
                      </td>
                    </tr>
                  );
                }),
              ])}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

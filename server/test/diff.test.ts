/**
 * Unified diff tests: create → parse → apply must round-trip, and bad diffs
 * must be rejected instead of guessed at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUnifiedDiff,
  createUnifiedDiff,
  diffLines,
  parseUnifiedDiff,
  splitLines,
} from '../src/patch/unifiedDiff.js';

const before = `function total(items) {
  let sum = 0;
  for (let i = 0; i <= items.length; i += 1) {
    sum += items[i].price;
  }
  return sum;
}
`;

const after = before.replace('i <= items.length', 'i < items.length');

test('diff creation produces standard headers and hunks', () => {
  const diff = createUnifiedDiff('src/pagination.js', before, after);
  assert.match(diff, /^--- a\/src\/pagination\.js$/m);
  assert.match(diff, /^\+\+\+ b\/src\/pagination\.js$/m);
  assert.match(diff, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  assert.ok(diff.includes('-  for (let i = 0; i <= items.length; i += 1) {'));
  assert.ok(diff.includes('+  for (let i = 0; i < items.length; i += 1) {'));
});

test('a generated diff applies cleanly and round-trips', () => {
  const diff = createUnifiedDiff('src/pagination.js', before, after);
  const applied = applyUnifiedDiff(before, diff, 'src/pagination.js');
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.content, after);
  assert.equal(applied.addedLines, 1);
  assert.equal(applied.removedLines, 1);
});

test('context and removed lines must match exactly', () => {
  const diff = createUnifiedDiff('src/pagination.js', before, after);
  const tampered = before.replace('let sum = 0;', 'let total = 0;');
  const applied = applyUnifiedDiff(tampered, diff, 'src/pagination.js');
  assert.equal(applied.ok, false);
  assert.match(applied.error ?? '', /mismatch|Context/i);
});

test('diffs for the wrong file are rejected', () => {
  const diff = createUnifiedDiff('src/other.js', before, after);
  const applied = applyUnifiedDiff(before, diff, 'src/pagination.js');
  assert.equal(applied.ok, false);
  assert.match(applied.error ?? '', /expected only/);
});

test('hunk counts are validated', () => {
  const diff = createUnifiedDiff('src/pagination.js', before, after).replace(/@@ -(\d+),\d+ \+(\d+),\d+ @@/, '@@ -2,9 +2,9 @@');
  const applied = applyUnifiedDiff(before, diff, 'src/pagination.js');
  assert.equal(applied.ok, false);
  assert.match(applied.error ?? '', /says|mismatch|Context/i);
});

test('garbage is rejected, not guessed', () => {
  assert.equal(applyUnifiedDiff(before, 'please fix the bug').ok, false);
  assert.throws(() => parseUnifiedDiff('not a diff'));
});

test('no-op diffs are empty and appending works', () => {
  assert.equal(createUnifiedDiff('a.js', before, before), '');
  const appended = `${before}\nmodule.exports = { total };\n`;
  const diff = createUnifiedDiff('a.js', before, appended);
  const applied = applyUnifiedDiff(before, diff, 'a.js');
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.content, appended);
});

test('splitLines keeps trailing-newline information', () => {
  assert.deepEqual(splitLines('a\nb\n'), { lines: ['a', 'b'], trailingNewline: true });
  assert.deepEqual(splitLines('a\nb'), { lines: ['a', 'b'], trailingNewline: false });
});

test('diff ops classify additions and deletions', () => {
  const ops = diffLines('a\nb\nc\n', 'a\nx\nc\n');
  assert.deepEqual(
    ops.map((op) => `${op.type}:${op.line}`),
    ['eq:a', 'del:b', 'add:x', 'eq:c'],
  );
});

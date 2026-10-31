/**
 * Precision tests for the static rules.
 *
 * These exist because "AI found a bug" is worthless if half the cards are
 * commented-out code, regex literals or strings. Each case here was a real
 * false positive observed while scanning actual repositories.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStaticRules } from '../src/scan/staticRules.js';
import { buildLineStates, isCodeAt } from '../src/scan/lexer.js';

function ruleIds(file: string, source: string): string[] {
  return runStaticRules(file, source).map((match) => match.ruleId);
}

test('a rule mention inside a string is not a finding', () => {
  const source = "    pattern: '(?<![=!<>])(?:==|!=)(?!=)',";
  assert.deepEqual(ruleIds('src/rules.ts', source), []);
});

test('regex literals are not findings', () => {
  const source = "      if (!/==\\s*None|!=\\s*None/.test(line)) return null;";
  assert.deepEqual(ruleIds('src/mechanical.ts', source), []);
});

test('multi-line template literals are not findings', () => {
  const source = ['const before = `function total(items) {', '  let sum = 0;', '  for (let i = 0; i <= items.length; i += 1) {', '}`;'].join('\n');
  assert.deepEqual(ruleIds('src/fixture.test.ts', source), []);
});

test('block comments are not findings', () => {
  const source = ['/*', '  for (let i = 0; i <= items.length; i += 1) {', '*/'].join('\n');
  assert.deepEqual(ruleIds('src/commented.js', source), []);
});

test('ignore directives silence the next line', () => {
  const source = ['// eslint-disable-next-line', '  if (a == b) { return 1; }'].join('\n');
  assert.deepEqual(ruleIds('src/silenced.js', source), []);

  const inline = '  if (a == b) { return 1; } // bugbanisher:ignore';
  assert.deepEqual(ruleIds('src/silenced.js', inline), []);
});

test('real bugs are still reported with the right line', () => {
  const source = ['function f(a, b) {', '  if (a == b) { return 1; }', '  return 0;', '}'].join('\n');
  const hits = runStaticRules('src/real.js', source);
  const loose = hits.find((hit) => hit.ruleId === 'js/loose-equality');
  assert.ok(loose, 'loose equality must still be reported');
  assert.equal(loose?.line, 2);
  assert.ok(loose?.fixHint.includes('==='), 'every finding carries a plain-English fix hint');
});

test('python docstrings are not findings', () => {
  const source = ['def f():', '    """', '    eval(user_input)', '    """', '    return 1'].join('\n');
  assert.deepEqual(ruleIds('src/doc.py', source), []);
  assert.deepEqual(ruleIds('src/eval.py', '    eval(user_input)'), ['py/eval-exec']);
});

test('the lexer tracks state across lines', () => {
  const lines = ['const a = `', '  i <= items.length', '`;', 'for (let i = 0; i <= items.length; i += 1) {}'];
  const states = buildLineStates(lines, 'typescript');
  assert.equal(isCodeAt(lines[1] as string, 3, states[1] as never, 'typescript'), false);
  assert.equal(isCodeAt(lines[3] as string, 20, states[3] as never, 'typescript'), true);
});

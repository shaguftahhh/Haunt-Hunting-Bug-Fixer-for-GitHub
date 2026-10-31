/**
 * A tiny, dependency-free lexer used to make the static rules accurate.
 *
 * It answers exactly one question: "at this column, are we in real code?"
 * It is not a parser — but it understands the four things that cause almost all
 * false positives in regex-based scanning:
 *
 *   1. block comments spanning lines  /* … *\/
 *   2. multi-line template literals     `…`  (very common in code generators and tests)
 *   3. regex literals                   /a|b/g  (they contain ==, <, ( …)
 *   4. single-quote/double-quote strings, and Python triple-quoted strings
 *
 * When it is unsure it says "code", so a real bug is never hidden.
 */

export type Mode = 'code' | 'block-comment' | 'template' | 'string' | 'regex' | 'py-string';

export interface LineState {
  mode: Mode;
  /** For py-string: the opening delimiter (''' or """). */
  delimiter?: string;
}

const JS_LANGS = new Set(['javascript', 'typescript']);

const isJs = (language: string) => JS_LANGS.has(language);
const isPython = (language: string) => language === 'python';

/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '}', '+', '-', '*', '%', '~', '^', '<', '>',
]);

/**
 * State at the END of one line, given the state at its start.
 * Used to build a cheap per-file table so each match only needs one line scan.
 */
export function advanceState(line: string, language: string, state: LineState): LineState {
  let { mode, delimiter } = state;
  let i = 0;

  while (i < line.length) {
    const char = line[i] as string;

    if (mode === 'block-comment') {
      if (char === '*' && line[i + 1] === '/') {
        mode = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'template') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '`') mode = 'code';
      i += 1;
      continue;
    }

    if (mode === 'string') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '"' || char === "'") mode = 'code';
      i += 1;
      continue;
    }

    if (mode === 'regex') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '/') mode = 'code';
      i += 1;
      continue;
    }

    if (mode === 'py-string') {
      const close = delimiter ?? '"""';
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (line.startsWith(close, i)) {
        mode = 'code';
        i += close.length;
        continue;
      }
      i += 1;
      continue;
    }

    // ---- mode === 'code'
    if (isJs(language) && char === '/' && line[i + 1] === '/') {
      // Line comment: nothing after this matters.
      return { mode: 'code' };
    }
    if (isJs(language) && char === '/' && line[i + 1] === '*') {
      mode = 'block-comment';
      i += 2;
      continue;
    }
    if (isPython(language) && char === '#') {
      return { mode: 'code' };
    }
    if (isPython(language) && (line.startsWith("'''", i) || line.startsWith('"""', i))) {
      delimiter = line.slice(i, i + 3);
      mode = 'py-string';
      i += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      mode = 'string';
      i += 1;
      continue;
    }
    if (isJs(language) && char === '`') {
      mode = 'template';
      i += 1;
      continue;
    }
    if (isJs(language) && char === '/' && startsRegex(line, i)) {
      mode = 'regex';
      i += 1;
      continue;
    }
    i += 1;
  }

  // A single-line string that never closed cannot leak into the next line in
  // JS (except with a trailing backslash, which is rare); reset it.
  if (mode === 'string') mode = 'code';
  if (mode === 'regex') mode = 'code';

  return { mode, delimiter };
}

function startsRegex(line: string, index: number): boolean {
  // Find the previous meaningful character.
  let j = index - 1;
  while (j >= 0 && /\s/.test(line[j] as string)) j -= 1;
  if (j < 0) return true;

  const previous = line[j] as string;
  if (REGEX_PRECEDERS.has(previous)) return true;

  // `return /re/`, `typeof /re/`, `case /re/`: look at the word before.
  const word = /([A-Za-z_$][\w$]*)\s*$/.exec(line.slice(0, index));
  if (word) {
    return ['return', 'typeof', 'case', 'in', 'of', 'yield', 'await', 'delete', 'void'].includes(
      word[1] ?? '',
    );
  }
  return false;
}

/** State at the start of every line in a file. */
export function buildLineStates(lines: string[], language: string): LineState[] {
  if (!isJs(language) && !isPython(language)) {
    return lines.map(() => ({ mode: 'code' }));
  }

  const states: LineState[] = [];
  let state: LineState = { mode: 'code' };

  for (const line of lines) {
    states.push(state);
    state = advanceState(line, language, state);
  }

  return states;
}

/** True when `index` in `line` is real code (not a comment/string/regex). */
export function isCodeAt(line: string, index: number, state: LineState, language: string): boolean {
  // Walk the line up to the match and stop if we enter a non-code mode.
  let current: LineState = state;
  const prefix = line.slice(0, index);
  // Re-scan incrementally so we know the mode exactly at the match column.
  let i = 0;
  let guard = 0;

  while (i < prefix.length && guard < 10_000) {
    guard += 1;
    const char = prefix[i] as string;

    if (current.mode !== 'code') {
      const next = advanceState(prefix.slice(i), language, current);
      if (next.mode !== 'code') return false;
      return true;
    }

    if (isJs(language) && char === '/' && prefix[i + 1] === '/') return false;
    if (isPython(language) && char === '#') return false;
    if (isJs(language) && char === '/' && prefix[i + 1] === '*') {
      const close = prefix.indexOf('*/', i + 2);
      if (close === -1) return false;
      i = close + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let j = i + 1;
      while (j < prefix.length) {
        if (prefix[j] === '\\') {
          j += 2;
          continue;
        }
        if (prefix[j] === quote) break;
        j += 1;
      }
      if (j >= prefix.length) return false; // inside an unterminated string
      i = j + 1;
      continue;
    }
    if (isJs(language) && char === '`') {
      const close = prefix.indexOf('`', i + 1);
      if (close === -1) return false;
      i = close + 1;
      continue;
    }
    if (isJs(language) && char === '/' && startsRegex(prefix, i)) {
      // Skip a regex literal: respect escapes and character classes.
      let j = i + 1;
      let inClass = false;
      while (j < prefix.length) {
        const c = prefix[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      if (j >= prefix.length) return false; // inside an unterminated regex
      i = j + 1;
      continue;
    }
    i += 1;
  }

  if (current.mode !== 'code') return false;
  return true;
}

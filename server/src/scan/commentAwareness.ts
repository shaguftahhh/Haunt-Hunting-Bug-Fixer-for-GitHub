/**
 * Comment and string awareness for the static rules.
 *
 * Heuristic rules get most of their false positives from two places:
 *   1. commented-out code (`// eval(x)`),
 *   2. code that only mentions a pattern inside a string (`"please use eval()"`).
 *
 * This module gives the rule runner a cheap, honest way to skip those without
 * pretending to be a real parser. It is intentionally conservative: when unsure,
 * it lets the finding through (a missed bug is worse than one extra card).
 */

const HASH_COMMENT_LANGS = new Set(['python', 'shell', 'ruby']);

/** `// eslint-disable-next-line x`, `// bugbanisher:ignore`, `# noqa` … */
const IGNORE_PATTERNS = [
  /eslint-disable-next-line/i,
  /eslint-disable-line/i,
  /bugbanisher:ignore/i,
  /^\s*#\s*noqa/i,
  /^\s*#\s*type:\s*ignore/i,
  /prettier-ignore/i,
];

export function isIgnoreDirective(line: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * True when the whole line is a comment (so a pattern in it is not code).
 * Handles //, /* (line start), * continuation, # for Python/Shell/Ruby and
 * triple-quoted Python docstring bodies (best effort).
 */
export function isCommentLine(line: string, language: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  if (HASH_COMMENT_LANGS.has(language) && trimmed.startsWith('#')) return true;
  if (language === 'c' || language === 'cpp' || language === 'java' || language === 'csharp') {
    if (trimmed.startsWith('*')) return true;
  }
  return false;
}

/**
 * True when `index` sits inside a single-quoted, double-quoted or template
 * string on this line. Counts unescaped quotes before the match; a simple but
 * effective guard for "the pattern is just mentioned in a message".
 */
export function isInsideString(line: string, index: number): boolean {
  let single = false;
  let double = false;
  let backtick = false;

  for (let i = 0; i < Math.min(index, line.length); i += 1) {
    const char = line[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === "'" && !double && !backtick) single = !single;
    else if (char === '"' && !single && !backtick) double = !double;
    else if (char === '`' && !single && !double) backtick = !backtick;
  }

  return single || double || backtick;
}

/** True when the rest of the line after `index` is a trailing comment. */
export function isTrailingComment(line: string, index: number): boolean {
  const rest = line.slice(index);
  const commentAt = rest.indexOf('//');
  if (commentAt === -1) return false;
  // Ignore "//" inside a string (e.g. a URL).
  return !isInsideString(rest, commentAt);
}

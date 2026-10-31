/**
 * Built-in static checks.
 *
 * Why not just run ESLint/ruff? Usually we can: the repo may have a linter, and
 * BugBanisher reports which ones it detected. But a browser-based tool cannot
 * execute a stranger's repository code. Running `npm install` on an untrusted
 * repo (and its postinstall scripts) would be a serious security problem.
 *
 * So we do two honest things:
 *   1. Report exactly which linters the repo ships with (see linters.ts).
 *   2. Run these dependency-free rules — the same patterns an experienced
 *      reviewer greps for — and say plainly that they are heuristic.
 *
 * Every rule answers: what is wrong, and why a learner should care.
 */
import type { Severity } from '../types.js';
import { languageOf } from './fileFilter.js';

export interface RuleMatch {
  ruleId: string;
  line: number;
  title: string;
  severity: Severity;
  confidence: number;
  explanation: string;
  whyItMatters: string;
}

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  confidence: number;
  /** Regex source; compiled per file with the `g` flag. */
  pattern: string;
  flags?: string;
  languages: string[];
  explanation: string;
  whyItMatters: string;
  /** Optional extra check with the whole file for context-aware rules. */
  contextOk?: (lines: string[], index: number) => boolean;
  /** Optional per-line guard to cut false positives. */
  lineOk?: (line: string) => boolean;
  maxPerFile?: number;
}

const JS_TS = ['javascript', 'typescript'];
const ALL = ['javascript', 'typescript', 'python', 'ruby', 'go', 'java', 'php', 'rust', 'c', 'cpp', 'csharp', 'shell'];

const RULES: Rule[] = [
  // ---------------------------------------------------------------- JavaScript
  {
    id: 'js/loose-equality',
    title: 'Loose equality can hide a type bug',
    severity: 'low',
    confidence: 70,
    pattern: '(?<![=!<>])(?:==|!=)(?!=)',
    languages: JS_TS,
    lineOk: (line) => !/(?:==|!=)\s*(?:null|undefined)\b/.test(line),
    explanation:
      'This comparison uses == or !=, which converts types before comparing. Values like "0" and 0 (or "" and false) can look equal even when they mean different things.',
    whyItMatters:
      'Type coercion is one of the most common sources of bugs in JavaScript. Using === / !== makes the comparison explicit, so future readers (and you, at 2am) know exactly what is being compared.',
    maxPerFile: 3,
  },
  {
    id: 'js/off-by-one',
    title: 'Loop can run one item past the end of the array',
    severity: 'high',
    confidence: 86,
    pattern: 'for\\s*\\([^;]*;[^;]*<=\\s*[\\w.$]*(?:\\.length|\\.size)\\b',
    languages: JS_TS,
    explanation:
      'The loop condition uses <= with .length. Array indexes stop at length - 1, so the final iteration reads undefined and often crashes or produces NaN.',
    whyItMatters:
      'Off-by-one errors are a classic "works on my machine" bug: they only fail on the last element, or when an array is empty. Learning to read loop bounds carefully transfers to every language.',
  },
  {
    id: 'js/eval',
    title: 'eval / new Function executes untrusted strings',
    severity: 'high',
    confidence: 90,
    pattern: '\\beval\\s*\\(|\\bnew\\s+Function\\s*\\(',
    languages: JS_TS,
    explanation:
      'eval() and new Function() run strings as code. If any part of that string can be influenced by a user or another service, an attacker can run their own code inside your app.',
    whyItMatters:
      'This is a direct path to remote code execution (RCE). Almost every use of eval has a safer alternative: JSON.parse for data, a lookup object for behaviour, or a real parser.',
  },
  {
    id: 'js/innerhtml',
    title: 'innerHTML can inject HTML from data',
    severity: 'high',
    confidence: 84,
    pattern: '\\.innerHTML\\s*(?:\\+)?=',
    languages: JS_TS,
    explanation:
      'Assigning to innerHTML makes the browser parse the string as HTML. If any of it came from a user, they can inject script tags or event handlers (cross-site scripting).',
    whyItMatters:
      'XSS is one of the OWASP Top 10. Using textContent for text, or a framework’s safe binding, keeps user data as data instead of code.',
  },
  {
    id: 'js/document-write',
    title: 'document.write rewrites the page',
    severity: 'medium',
    confidence: 72,
    pattern: 'document\\.write(?:ln)?\\s*\\(',
    languages: JS_TS,
    explanation:
      'document.write can wipe out the page during load and behaves differently on slow connections. It can also be an XSS vector.',
    whyItMatters:
      'DOM APIs that mutate the whole document are hard to reason about. Modern, predictable DOM updates are easier to test and safer.',
  },
  {
    id: 'js/shell-interpolation',
    title: 'Shell command built with string interpolation',
    severity: 'high',
    confidence: 82,
    pattern: '\\b(?:exec|execSync|spawnSync)\\s*\\(\\s*[`\'"][^`\'"]*\\$\\{',
    languages: JS_TS,
    explanation:
      'A shell command is assembled with template interpolation. If the value comes from a request, shell metacharacters can turn it into a second, attacker-chosen command (command injection).',
    whyItMatters:
      'Command injection gives an attacker your server. Passing arguments as an array to spawn/execFile avoids the shell entirely.',
  },
  {
    id: 'js/assignment-in-condition',
    title: 'Assignment inside an if condition',
    severity: 'high',
    confidence: 76,
    pattern: 'if\\s*\\(\\s*[A-Za-z_$][\\w$.[\\]\'"]*\\s*=\\s*[^=]',
    languages: JS_TS,
    explanation:
      'This looks like an assignment (=) where a comparison (===) was intended. The condition will be truthy almost every time, so the branch runs when it should not.',
    whyItMatters:
      'This typo is legal JavaScript, so it never throws — it just silently changes behaviour. Linters flag it; knowing the pattern helps you spot it in review.',
  },
  {
    id: 'js/weak-random',
    title: 'Math.random() used for a secret or identifier',
    severity: 'high',
    confidence: 68,
    pattern: 'Math\\.random\\s*\\(\\s*\\)',
    languages: JS_TS,
    lineOk: (line) => /token|secret|password|nonce|otp|session|key|reset/i.test(line),
    explanation:
      'Math.random() is not cryptographically secure. Attackers can predict its output, so values generated with it are guessable.',
    whyItMatters:
      'Security tokens, password-reset codes and session ids must use crypto.randomUUID() or crypto.randomBytes(). Predictable tokens are a real breach path.',
  },
  {
    id: 'js/json-parse',
    title: 'JSON.parse without a nearby try/catch',
    severity: 'medium',
    confidence: 55,
    pattern: 'JSON\\.parse\\s*\\(',
    languages: JS_TS,
    contextOk: (lines, index) => {
      const window = lines.slice(Math.max(0, index - 6), index + 4).join('\n');
      return !/try\s*\{|catch\s*\(|safeParse|tryJson/i.test(window);
    },
    explanation:
      'JSON.parse throws a SyntaxError on malformed input. Nothing nearby catches it, so one bad request or stored string can take down the request (or the process).',
    whyItMatters:
      'Never trust external data. Wrapping parse in try/catch and returning a clear 400 is how APIs stay up when clients misbehave.',
    maxPerFile: 2,
  },
  {
    id: 'js/empty-catch',
    title: 'Empty catch block swallows the error',
    severity: 'medium',
    confidence: 74,
    pattern: 'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}',
    languages: JS_TS,
    explanation:
      'This catch block does nothing, so the failure disappears. The program continues with wrong state and the real problem is harder to find.',
    whyItMatters:
      'Silent failures are the hardest bugs to debug. Logging, re-throwing, or handling the error deliberately makes failures visible and fixable.',
  },
  {
    id: 'js/parseint-radix',
    title: 'parseInt without radix 10',
    severity: 'low',
    confidence: 62,
    pattern: 'parseInt\\s*\\(\\s*[^,)]+\\)',
    languages: JS_TS,
    explanation:
      'parseInt() without a radix can interpret strings starting with "0" as octal in old engines and surprises readers. Pass the base explicitly.',
    whyItMatters:
      'Explicit is better than implicit. Small clarity fixes prevent whole classes of "why is 08 invalid?" puzzles.',
    maxPerFile: 2,
  },
  {
    id: 'js/settimeout-string',
    title: 'setTimeout with a string evaluates code',
    severity: 'medium',
    confidence: 78,
    pattern: 'setTimeout\\s*\\(\\s*[\'"]',
    languages: JS_TS,
    explanation:
      'Passing a string to setTimeout evaluates it like eval(), which is slow and a code-injection risk.',
    whyItMatters:
      'Timers should receive functions. Strings go through the JS parser at runtime, with all the security and performance downsides of eval.',
  },
  {
    id: 'js/debugger',
    title: 'debugger statement left in source',
    severity: 'low',
    confidence: 92,
    pattern: '^\\s*debugger\\s*;?\\s*$',
    languages: JS_TS,
    explanation: 'A debugger statement pauses execution when devtools are open. That should not ship to users.',
    whyItMatters:
      'Leftover debugging code is a sign of unfinished work. Cleaning it up keeps production behaviour predictable.',
  },
  {
    id: 'js/hardcoded-secret',
    title: 'Possible hardcoded credential',
    severity: 'high',
    confidence: 80,
    pattern: "(?:api[_-]?key|secret|password|passwd|token)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
    flags: 'i',
    languages: JS_TS,
    lineOk: (line) => !/process\.env|example|placeholder|changeme|your[_-]|<[^>]+>|dummy|test/i.test(line),
    explanation:
      'A credential-looking value is written directly in the source. Anyone who can read the repo (or its history) can use it, and rotating it means editing code.',
    whyItMatters:
      'Secrets belong in environment variables or a secret manager, never in Git. Once a key is committed, assume it is compromised and rotate it.',
    maxPerFile: 2,
  },
  {
    id: 'js/connection-string-credentials',
    title: 'Database URL contains a password',
    severity: 'high',
    confidence: 88,
    pattern: '(?:mongodb(?:\\+srv)?|postgres(?:ql)?|mysql|redis):\\/\\/[^\\s\'"`]+:[^\\s\'"`@]+@',
    languages: ALL,
    explanation:
      'The connection string includes a username and password. That value leaks with the repository and shows up in logs.',
    whyItMatters:
      'A leaked database password is a full data breach. Load connection strings from the environment and rotate them if they were ever committed.',
  },

  // -------------------------------------------------------------------- Python
  {
    id: 'py/bare-except',
    title: 'Bare except catches everything',
    severity: 'medium',
    confidence: 82,
    pattern: '^\\s*except\\s*:',
    languages: ['python'],
    explanation:
      'A bare except catches every exception, including KeyboardInterrupt and genuine bugs, then usually hides them.',
    whyItMatters:
      'Catching everything makes failures invisible. Catch the specific exception you can handle and let the rest surface.',
  },
  {
    id: 'py/except-pass',
    title: 'Exception silently ignored',
    severity: 'medium',
    confidence: 72,
    pattern: 'except[^:]*:\\s*pass\\s*$',
    languages: ['python'],
    explanation: 'This handler catches an error and does nothing. The failure vanishes and the program keeps running in a bad state.',
    whyItMatters: 'Error handling should either recover meaningfully or surface the problem. `pass` usually does neither.',
  },
  {
    id: 'py/eval-exec',
    title: 'eval/exec executes dynamic code',
    severity: 'high',
    confidence: 86,
    pattern: '\\b(?:eval|exec)\\s*\\(',
    languages: ['python'],
    explanation: 'eval() and exec() run strings as Python. Untrusted input here means arbitrary code execution on your server.',
    whyItMatters: 'Python has safe alternatives — ast.literal_eval for data, a dict of functions for dispatch. There is almost never a reason to eval request data.',
  },
  {
    id: 'py/shell-true',
    title: 'subprocess called with shell=True',
    severity: 'high',
    confidence: 84,
    pattern: 'subprocess\\.(?:run|call|check_call|check_output|Popen)\\s*\\([^)]*shell\\s*=\\s*True',
    languages: ['python'],
    explanation: 'shell=True hands the string to a system shell. Any interpolated value can add its own commands.',
    whyItMatters: 'Passing an argument list with shell=False prevents command injection while keeping the same functionality.',
  },
  {
    id: 'py/sql-fstring',
    title: 'SQL query built with string formatting',
    severity: 'high',
    confidence: 82,
    pattern: "execute\\s*\\(\\s*f[\"']|execute\\s*\\([^)]*%\\s*\\(",
    languages: ['python'],
    explanation: 'The SQL string is assembled with user-controlled values. That is an SQL injection, which can read or destroy the whole database.',
    whyItMatters: 'Parameterised queries (? or %s placeholders passed as arguments) let the database treat values as data, never as SQL.',
  },
  {
    id: 'py/mutable-default',
    title: 'Mutable default argument',
    severity: 'medium',
    confidence: 78,
    pattern: 'def\\s+\\w+\\s*\\([^)]*=\\s*(?:\\[\\]|\\{\\}|set\\(\\))',
    languages: ['python'],
    explanation: 'Default lists/dicts are created once and shared by every call, so data leaks between calls.',
    whyItMatters: 'This is a famous Python trap: the function "remembers" previous calls. Use None as the default and create the container inside.',
  },
  {
    id: 'py/pickle-loads',
    title: 'pickle.loads on untrusted data',
    severity: 'high',
    confidence: 85,
    pattern: 'pickle\\.loads?\\s*\\(',
    languages: ['python'],
    explanation: 'Unpickling data can execute arbitrary code. If the bytes come from a user, a network call or storage you do not control, you are running their code.',
    whyItMatters: 'Use JSON or another data-only format for untrusted input. Security scanners treat pickle as code execution.',
  },
  {
    id: 'py/os-system',
    title: 'os.system shell call',
    severity: 'high',
    confidence: 80,
    pattern: 'os\\.system\\s*\\(',
    languages: ['python'],
    explanation: 'os.system runs a command through the shell, so any interpolated value can inject extra commands.',
    whyItMatters: 'subprocess with an argument list is safer and gives you a return code and stderr instead of a number.',
  },
  {
    id: 'py/eq-none',
    title: 'Comparison to None with ==',
    severity: 'low',
    confidence: 84,
    pattern: '(?:==|!=)\\s*None\\b',
    languages: ['python'],
    explanation: 'PEP 8 asks for `is None` / `is not None`. Equality can be overridden by a custom __eq__, so it may not test identity.',
    whyItMatters: 'Using `is` makes it unambiguous that you are checking for the singleton None, and matches Python community style.',
  },

  // -------------------------------------------------------------- Everywhere
  {
    id: 'generic/private-key',
    title: 'Private key material committed',
    severity: 'high',
    confidence: 95,
    pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    languages: ALL,
    explanation: 'A private key is embedded in this file.',
    whyItMatters: 'Anyone with repo access can impersonate the key owner. Revoke and rotate it immediately — deleting the line is not enough, Git history keeps it.',
  },
];

export interface StaticScanOptions {
  maxFindingsPerFile?: number;
}

export function runStaticRules(
  path: string,
  content: string,
  options: StaticScanOptions = {},
): RuleMatch[] {
  const language = languageOf(path);
  const lines = content.split('\n');
  const matches: RuleMatch[] = [];
  const seen = new Set<string>();
  const maxFindings = options.maxFindingsPerFile ?? 8;

  for (const rule of RULES) {
    if (!rule.languages.includes(language)) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, `${rule.flags ?? ''}g`);
    } catch {
      continue;
    }

    let count = 0;
    lines.forEach((line, index) => {
      if (count >= (rule.maxPerFile ?? 1)) return;
      if (line.length > 500) return; // ignore minified-ish long lines
      regex.lastIndex = 0;
      const hit = regex.test(line);
      if (!hit) return;
      if (rule.lineOk && !rule.lineOk(line)) return;
      if (rule.contextOk && !rule.contextOk(lines, index)) return;

      const lineNumber = index + 1;
      const key = `${rule.id}:${lineNumber}`;
      if (seen.has(key)) return;
      seen.add(key);
      count += 1;

      matches.push({
        ruleId: rule.id,
        line: lineNumber,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        explanation: rule.explanation,
        whyItMatters: rule.whyItMatters,
      });
    });

    if (matches.length >= maxFindings) break;
  }

  return matches.slice(0, maxFindings);
}

/** Exposed for tests and for the UI's rule legend. */
export function ruleCatalog(): Array<{ id: string; title: string; severity: Severity; languages: string[] }> {
  return RULES.map((rule) => ({
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    languages: rule.languages,
  }));
}

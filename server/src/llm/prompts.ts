/**
 * Prompt loader.
 *
 * Prompts live in /prompts as Markdown, not in code, so teammates can tune
 * wording and review changes in a diff. Placeholders use {{double_braces}}.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const cache = new Map<string, string>();

export async function loadPrompt(name: 'findings' | 'fix'): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const file = path.join(config.promptsDir, `${name}.md`);
  const text = await fs.readFile(file, 'utf8');
  cache.set(name, text);
  return text;
}

/** Replace {{key}} placeholders. Unknown keys are left untouched on purpose. */
export function fillPrompt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

/** Numbered file content. Line numbers help the model point at the right line. */
export function withLineNumbers(content: string, maxChars: number): { text: string; truncated: boolean } {
  const lines = content.split('\n');
  let used = 0;
  const out: string[] = [];
  let truncated = false;

  for (const [index, line] of lines.entries()) {
    const rendered = `${String(index + 1).padStart(4, ' ')} | ${line}`;
    if (used + rendered.length > maxChars) {
      truncated = true;
      break;
    }
    out.push(rendered);
    used += rendered.length + 1;
  }

  return { text: out.join('\n'), truncated };
}

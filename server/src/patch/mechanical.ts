/**
 * Mechanical (non-model) fixes for rules where the correct change is obvious.
 *
 * Two reasons these exist:
 *   1. The demo and offline mode must work with no model at all.
 *   2. For a hardcoded credential we deliberately DO NOT send the file to a
 *      model. Replacing the literal with an environment lookup is deterministic
 *      and keeps the secret exactly where it belongs: out of the prompt.
 *
 * Every mechanical fix is still a normal diff that must pass verification.
 */
import type { Finding } from '../types.js';
import { languageOf } from '../scan/fileFilter.js';

export interface MechanicalResult {
  content: string;
  summary: string;
  note: string;
}

const UPPER_SNAKE = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();

export function mechanicalFix(finding: Finding, content: string): MechanicalResult | null {
  const lines = content.split('\n');
  const index = finding.line - 1;
  const line = lines[index];
  if (line === undefined) return null;
  const language = languageOf(finding.file);

  const replaceLine = (next: string, summary: string, note: string): MechanicalResult => {
    const updated = [...lines];
    updated[index] = next;
    return { content: updated.join('\n'), summary, note };
  };

  switch (finding.ruleId) {
    case 'js/off-by-one': {
      if (!line.includes('<=')) return null;
      const next = line.replace('<=', '<');
      if (next === line) return null;
      return replaceLine(
        next,
        'Changed the loop bound from <= .length to < .length so the last iteration no longer reads past the end of the array.',
        'Deterministic one-character fix for an off-by-one loop.',
      );
    }

    case 'py/eq-none': {
      if (!/==\s*None|!=\s*None/.test(line)) return null;
      const next = line.replace(/==\s*None/, 'is None').replace(/!=\s*None/, 'is not None');
      return replaceLine(
        next,
        'Compared to None with `is` / `is not`, as PEP 8 recommends, so a custom __eq__ cannot change the result.',
        'Deterministic identity-comparison fix.',
      );
    }

    case 'js/loose-equality': {
      if (/[!=]==/.test(line)) return null;
      const next = line.replace(/(?<![=!<>])==(?!=)/, '===').replace(/(?<![=!<>])!=(?!=)/, '!==');
      if (next === line) return null;
      return replaceLine(
        next,
        'Replaced loose equality with strict equality on the flagged comparison.',
        'Deterministic strict-equality fix; no type coercion.',
      );
    }

    case 'js/parseint-radix': {
      const match = /parseInt\(\s*([^,()]+?)\s*\)/.exec(line);
      if (!match) return null;
      const next = line.replace(match[0], `parseInt(${match[1]}, 10)`);
      return replaceLine(next, 'Added the missing base-10 radix to parseInt.', 'Deterministic radix fix.');
    }

    case 'js/debugger': {
      if (!/^\s*debugger\s*;?\s*$/.test(line)) return null;
      const updated = [...lines];
      updated.splice(index, 1);
      return {
        content: updated.join('\n'),
        summary: 'Removed the leftover debugger statement.',
        note: 'Deterministic deletion of a debugging statement.',
      };
    }

    case 'js/hardcoded-secret': {
      if (language !== 'javascript' && language !== 'typescript') return null;

      // const NAME = 'secret';  →  const NAME = process.env.NAME;
      const declaration = /^(\s*)(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]+)\4(\s*;?\s*)$/.exec(line);
      if (declaration) {
        const [, indent, keyword, name, , , tail] = declaration;
        const envName = /^[A-Z0-9_]+$/.test(name ?? '') ? name : UPPER_SNAKE(name ?? 'SECRET');
        const next = `${indent}${keyword} ${name} = process.env.${envName}${tail?.trim().startsWith(';') ? ';' : ''}`;
        return replaceLine(
          next,
          `Removed the committed credential and read ${envName} from the environment instead.`,
          'The value is never sent to a model; the fix is generated mechanically and masked in this view.',
        );
      }

      // apiKey: 'secret',  →  apiKey: process.env.API_KEY,
      const property = /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(['"])([^'"]+)\3(\s*,?\s*)$/.exec(line);
      if (property) {
        const [, indent, name, , , tail] = property;
        const envName = UPPER_SNAKE(name ?? 'SECRET');
        const next = `${indent}${name}: process.env.${envName}${tail?.trim().endsWith(',') ? ',' : ''}`;
        return replaceLine(
          next,
          `Removed the committed credential and read ${envName} from the environment instead.`,
          'The value is never sent to a model; the fix is generated mechanically and masked in this view.',
        );
      }

      return null;
    }

    default:
      return null;
  }
}

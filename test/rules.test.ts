import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allRuleMetas, astRules, packageJsonRules } from '../src/rules/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The READMEs advertise a specific rule count; this suite pins the rule table
// to it so adding or removing a rule without updating the docs fails CI-style.
const ADVERTISED_RULE_COUNT = 17;

describe('rule inventory', () => {
  it(`ships exactly ${ADVERTISED_RULE_COUNT} rules with unique ids`, () => {
    expect(allRuleMetas).toHaveLength(ADVERTISED_RULE_COUNT);
    expect(astRules.length + packageJsonRules.length).toBe(ADVERTISED_RULE_COUNT);
    const ids = allRuleMetas.map((meta) => meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every rule to a known tier', () => {
    for (const meta of allRuleMetas) {
      expect(['v2', '2026']).toContain(meta.tier);
    }
  });

  it('keeps every README rule-count claim in sync with the rule table', () => {
    for (const name of ['README.md', 'README.zh.md', 'README.ja.md']) {
      const text = readFileSync(join(root, name), 'utf8');
      // Matches "17 rules", "17 条", "17 ルール" — any number attached to a
      // rule-count phrase in the three languages.
      const counts = [...text.matchAll(/(\d+)\s*(?:rules|条(?:规则| conformance)?|ルール)/gi)].map(
        (match) => Number(match[1]),
      );
      expect(counts.length, `${name} should mention the rule count`).toBeGreaterThan(0);
      for (const count of counts) {
        expect(count, `${name} rule-count claim`).toBe(allRuleMetas.length);
      }
    }
  });
});

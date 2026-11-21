import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

/**
 * Remi's protocols for the online study: drafts for Michelle, copied word for word from the
 * break study's (src/lab/mystory). Remi says only what these files say; they must stay
 * readable and have the same parts as the lab study's.
 */
describe('Remi’s online protocols', () => {
  for (const [online, lab] of [['online-pre', 'pre'], ['online-mid', 'mid'], ['online-post', 'post']]) {
    it(`${online}.toml has every part ${lab}.toml has, and is marked as a draft for Michelle`, () => {
      const text = readFileSync(join(__dirname, 'mystory', `${online}.toml`), 'utf8');
      expect(text.split('\n')[0]).toMatch(/DRAFT FOR MICHELLE/);
      const mine = parse(text) as Record<string, unknown>;
      const theirs = parse(readFileSync(join(__dirname, '..', 'lab', 'mystory', `${lab}.toml`), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(mine).sort()).toEqual(Object.keys(theirs).sort());
      expect(Array.isArray((mine.collection as { questions?: unknown }).questions)).toBe(true);
    });
  }
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The lesson text is a dialogue: a paragraph starting with 「博士：」/「ノード：」 renders as a speech bubble (components/Markdown.tsx).
// A wrong prefix silently falls back to plain text, so the format is checked here.
const root = fileURLToPath(new URL('../content', import.meta.url));
const chapters = readdirSync(root).filter(d => /^\d\d-/.test(d));

describe.each(chapters)('%s/theory.md', dir => {
  const text = readFileSync(join(root, dir, 'theory.md'), 'utf8');
  const paragraphs = text.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  it('is a dialogue with well-formed speaker prefixes', () => {
    expect(text.startsWith('## ')).toBe(true);
    expect(paragraphs.filter(p => /^(博士|ノード)：/.test(p)).length).toBeGreaterThan(60);
    for (const p of paragraphs) {
      expect(p, 'use 「博士：」「ノード：」 (full-width colon)').not.toMatch(/^(パス博士|ノード君)[:：]|^(博士|ノード)(:|\s+[:：])/);
      expect(p, 'one speaker per paragraph: add a blank line').not.toMatch(/\n(博士|ノード)[：:]/);
      expect(p, 'a list item cannot be a speech bubble').not.toMatch(/^([-*]|\d+\.)\s+(博士|ノード)：/);
    }
  });

  it('ends with the sign-off, 用語メモ and ノード君の今日のポイント', () => {
    const signOff = text.indexOf('path. ネットワーク講座でした〜♪'), terms = text.indexOf('#### 用語メモ'), points = text.indexOf('#### ノード君の今日のポイント');
    expect(signOff).toBeGreaterThan(0);
    expect(terms).toBeGreaterThan(signOff);
    expect(points).toBeGreaterThan(terms);
    expect(text.slice(points + 5)).not.toMatch(/^#{2,4} /m);
  });
});

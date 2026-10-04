import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { callouts, sections, termCards } from './theory';

// The Theory text format (see lessons/theory.ts and components/Markdown.tsx). A malformed prefix or callout silently
// falls back to plain text, so the format is checked here.
const root = fileURLToPath(new URL('../content', import.meta.url));
const chapters = readdirSync(root).filter(d => /^\d\d-/.test(d));

describe.each(chapters)('%s/theory.md', dir => {
  const text = readFileSync(join(root, dir, 'theory.md'), 'utf8');
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const paragraphs = prose.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const secs = sections(text);

  it('is split into short pages: この章で学ぶこと … この章のまとめ', () => {
    expect(text.startsWith('## ')).toBe(true);
    expect(secs.length).toBeGreaterThanOrEqual(6);
    expect(secs[0].title).toBe('この章で学ぶこと');
    expect(secs[secs.length - 1].title).toBe('この章のまとめ');
    for (const s of secs) expect(s.minutes, `${s.title} is too long for one page: split it`).toBeLessThanOrEqual(15);
  });

  it('is a dialogue with well-formed speaker prefixes', () => {
    expect(paragraphs.filter(p => /^(博士|ノード)：/.test(p)).length).toBeGreaterThan(80);
    for (const p of paragraphs) {
      expect(p, 'use 「博士：」「ノード：」 (full-width colon)').not.toMatch(/^(パス博士|ノード君)[:：]|^(博士|ノード)(:|\s+[:：])/);
      expect(p, 'one speaker per paragraph: add a blank line').not.toMatch(/\n(博士|ノード)[：:]/);
      expect(p, 'a list item cannot be a speech bubble').not.toMatch(/^([-*]|\d+\.)\s+(博士|ノード)：/);
    }
  });

  it('defines its terms on cards', () => {
    const cards = termCards(text, dir);
    expect(cards.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cards.map(c => c.term)).size, 'a term is defined once per chapter').toBe(cards.length);
    for (const c of cards) expect(c.definition.length, `用語：${c.term} needs a definition on the following > lines`).toBeGreaterThan(15);
  });

  it('uses only the known callouts, and every explaining section ends with まとめ', () => {
    for (const [, label] of prose.matchAll(/^> \*\*(.+?)\*\*/gm)) expect(label in callouts || label.startsWith('用語：'), label).toBe(true);
    for (const s of secs.slice(1, -1)) expect(s.body, `${s.title}: add a > **まとめ** callout`).toMatch(/^> \*\*まとめ\*\*/m);
  });

  it('ends with the sign-off and ノード君の今日のポイント', () => {
    const last = secs[secs.length - 1].body;
    expect(last).toContain('path. ネットワーク講座でした〜♪');
    expect(last).toContain('#### ノード君の今日のポイント');
  });
});

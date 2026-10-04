/**
 * Theory text format (src/content/<dir>/theory.md):
 * - each `## ` heading starts a section, shown one page at a time;
 * - `> **用語：X**（reading）` + following `>` lines is a term card: it defines X for the hover hints in every chapter;
 * - `> **ポイント**` / `**注意**` / `**現場では**` / `**発展**` / `**まとめ**` / `**シミュレータ**` blockquotes are callouts.
 * - a `theory-visual` code fence containing a visual ID embeds an interactive diagram (components/TheoryVisual/visuals.ts).
 */
/** Callout blockquotes (`> **ポイント**` …) and their CSS class. */
export const callouts: Record<string, string> = { ポイント: 'point', 注意: 'caution', 現場では: 'field', 発展: 'advanced', まとめ: 'summary', シミュレータ: 'simulator' };
export interface Section { title: string; body: string; subsections: string[]; minutes: number }
export interface Term { term: string; reading: string; definition: string; chapter: string; section: number }

/** Japanese reading speed: about 500 characters a minute. */
const minutes = (text: string) => Math.max(1, Math.round(text.replace(/\s+/g, '').length / 500));

/** Split at `## ` headings outside code fences. Text before the first heading is dropped. */
export function sections(markdown: string): Section[] {
  const out: Section[] = [];
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h2 = !fence && /^## (.+)/.exec(line);
    if (h2) { out.push({ title: h2[1].trim(), body: '', subsections: [], minutes: 0 }); continue; }
    const s = out[out.length - 1];
    if (!s) continue;
    s.body += `${line}\n`;
    const h3 = !fence && /^### (.+)/.exec(line);
    if (h3) s.subsections.push(h3[1].trim());
  }
  for (const s of out) { s.body = s.body.trim(); s.minutes = minutes(s.body); }
  return out;
}

/** Plain text for a hover hint: no Markdown emphasis or code marks. */
const plain = (md: string) => md.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

export function termCards(markdown: string, chapter: string): Term[] {
  const out: Term[] = [];
  sections(markdown).forEach((s, section) => {
    const lines = s.body.split('\n');
    lines.forEach((line, i) => {
      const m = /^> \*\*用語：(.+?)\*\*(.*)$/.exec(line);
      if (!m) return;
      const rest: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j].startsWith('>'); j++) rest.push(lines[j].replace(/^>\s?/, ''));
      out.push({ term: m[1].trim(), reading: plain(m[2]), definition: plain(rest.join(' ')), chapter, section });
    });
  });
  return out;
}

export type Glossary = Map<string, Term>;
/** Every chapter's term cards, in curriculum order. The earliest definition wins, so a hint points back to where it was taught. */
export function buildGlossary(chapters: { id: string; text: string }[]): Glossary {
  const g: Glossary = new Map();
  for (const c of chapters) for (const t of termCards(c.text, c.id)) if (!g.has(t.term)) g.set(t.term, t);
  return g;
}

const KATAKANA = '\\u30A0-\\u30FF';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Matches any term, longest first. A term never matches inside a longer word of the same script:
 * 「ポート」 not in 「サポート」, 「IP」 not in 「IPv4」.
 */
export function termPattern(terms: Iterable<string>) {
  const list = [...terms].sort((a, b) => b.length - a.length).map(t => {
    const edge = (ch: string) => /[A-Za-z0-9]/.test(ch) ? 'A-Za-z0-9' : new RegExp(`[${KATAKANA}]`).test(ch) ? KATAKANA : '';
    const before = edge(t[0]), after = edge(t[t.length - 1]);
    return `${before ? `(?<![${before}])` : ''}${escape(t)}${after ? `(?![${after}])` : ''}`;
  });
  return list.length ? new RegExp(list.join('|'), 'g') : undefined;
}

/** Terms that appear in a piece of text: the ones it defines first, then the ones taught elsewhere. */
export function termsIn(text: string, glossary: Glossary, pattern = termPattern(glossary.keys())) {
  const found = new Set([...(pattern ? text.matchAll(pattern) : [])].map(m => m[0]));
  const defined = new Set([...text.matchAll(/^> \*\*用語：(.+?)\*\*/gm)].map(m => m[1].trim()));
  return [...found].filter(t => glossary.has(t)).sort((a, b) => Number(defined.has(b)) - Number(defined.has(a)));
}

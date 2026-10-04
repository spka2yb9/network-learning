import { curriculum } from './curriculum';
import { buildGlossary, sections, termCards, type Glossary } from './theory';

// All chapters at once: the hints in one chapter recall terms taught in the earlier ones.
const files = import.meta.glob('../content/*/theory.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const text = (dir: string) => files[`../content/${dir}/theory.md`] ?? '';

const perChapter = new Map<string, Glossary>();
/**
 * The glossary as read in one chapter: only what this chapter and the earlier ones taught (a hint recalls, it never
 * jumps ahead), and this chapter's own cards win (TTL in the DNS chapter is the cache TTL, not the IP header's).
 */
export function glossaryFor(chapter: string) {
  const index = curriculum.findIndex(x => x.id === chapter);
  if (!perChapter.has(chapter)) {
    const earlier = buildGlossary(curriculum.slice(0, index + 1).map(c => ({ id: c.id, text: text(c.dir) })));
    perChapter.set(chapter, new Map([...earlier, ...(index < 0 ? [] : termCards(text(curriculum[index].dir), chapter).map(t => [t.term, t] as const))]));
  }
  return perChapter.get(chapter)!;
}
export const theoryOf = (dir: string) => sections(text(dir));
export const chapterMinutes = (dir: string) => theoryOf(dir).reduce((sum, s) => sum + s.minutes, 0);

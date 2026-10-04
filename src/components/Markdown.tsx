import { Children, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { callouts, termPattern, type Glossary, type Term as TermDef } from '../lessons/theory';
import { chapterById } from '../lessons/curriculum';
import TheoryVisual from './TheoryVisual/TheoryVisual';

/** Dialogue lines in the lesson text: a paragraph starting with 「博士：」 or 「ノード：」 becomes a speech bubble. */
const speakers: Record<string, { name: string; icon: string; side: string }> = {
  博士: { name: 'パス博士', icon: 'chat_icon_professor.svg', side: 'teacher' },
  ノード: { name: 'ノード君', icon: 'chat_icon_young.svg', side: 'student' },
};

interface Hast { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Hast[] }
const text = (n: Hast): string => n.value ?? (n.children ?? []).map(text).join('');
const SKIP = new Set(['pre', 'code', 'a', 'h1', 'h2', 'h3', 'h4', 'strong']);
/** Wraps the first plain-text occurrence of each glossary term in a span the `span` component turns into a hint. */
const rehypeTerms = (pattern: RegExp) => () => (tree: Hast) => {
  const seen = new Set<string>();
  const split = (value: string): Hast[] => {
    const out: Hast[] = []; let last = 0;
    for (const m of value.matchAll(pattern)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ type: 'text', value: value.slice(last, m.index) }, { type: 'element', tagName: 'span', properties: { dataTerm: m[0] }, children: [{ type: 'text', value: m[0] }] });
      last = m.index! + m[0].length;
    }
    return last ? [...out, { type: 'text', value: value.slice(last) }] : [{ type: 'text', value }];
  };
  const walk = (node: Hast) => {
    if (!node.children || SKIP.has(node.tagName ?? '')) return;
    node.children = node.children.flatMap(c => c.type === 'text' ? split(c.value ?? '') : (walk(c), [c]));
  };
  walk(tree);
};

function Term({ t, children }: { t: TermDef; children: ReactNode }) {
  const chapter = chapterById(t.chapter);
  // Near the right edge the hint opens to the left, so it never widens the page.
  const place = (e: { currentTarget: HTMLElement }) => e.currentTarget.classList.toggle('flip', e.currentTarget.getBoundingClientRect().left + 360 > document.documentElement.clientWidth);
  return <span className="term" tabIndex={0} onMouseEnter={place} onFocus={place}>{children}<span className="term-tip" role="tooltip"><strong>{t.term}</strong>{t.reading && <small>{t.reading}</small>}<span>{t.definition}</span>{chapter && <em>{chapter.title}で学習</em>}</span></span>;
}

/**
 * Markdown with GFM tables. Raw HTML stays disabled (react-markdown default). Wide tables scroll inside their own box.
 * `glossary`: lesson text, where the first occurrence of each term gets a hover hint.
 */
export default function Markdown({ children, glossary }: { children: string; glossary?: Glossary }) {
  const rehype = useMemo(() => { const p = glossary && termPattern(glossary.keys()); return p ? [rehypeTerms(p)] : []; }, [glossary]);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehype} components={{
    pre: ({ node, ...props }) => {
      const code = node?.children.find(c => c.type === 'element' && c.tagName === 'code') as Hast | undefined;
      const classes = code?.properties?.className;
      return Array.isArray(classes) && classes.includes('language-theory-visual')
        ? <TheoryVisual id={text(code!).trim()}/>
        : <pre {...props}/>;
    },
    table: ({ node: _node, ...props }) => <div className="table-wrap"><table {...props}/></div>,
    // GFM autolinks URLs like http://198.51.100.80/ — those are simulated hosts, so they must not open the real internet.
    a: ({ node: _node, ...props }) => props.href?.startsWith('#') ? <a {...props}/> : <>{props.children}</>,
    h3: ({ node: _node, children: content, ...props }) => <h3 id={`sec-${String(Children.toArray(content).join(''))}`} {...props}>{content}</h3>,
    span: ({ node: _node, ...props }) => { const term = (props as Record<string, unknown>)['data-term'] as string | undefined; const t = term ? glossary?.get(term) : undefined; return t ? <Term t={t}>{props.children}</Term> : <span {...props}/>; },
    blockquote: ({ node, ...props }) => {
      const label = node?.children.find(c => c.type === 'element') as Hast | undefined;
      const head = label?.children?.find(c => c.type === 'element' || text(c).trim()) as Hast | undefined;
      const title = head?.tagName === 'strong' ? text(head) : '';
      const term = /^用語：(.+)/.exec(title)?.[1];
      const kind = term ? 'term' : callouts[title];
      return kind ? <blockquote className={`callout callout-${kind}`} id={term && `term-${term}`} {...props}/> : <blockquote {...props}/>;
    },
    p: ({ node: _node, children: content, ...props }) => {
      const [first, ...rest] = Children.toArray(content);
      const who = typeof first === 'string' ? /^(博士|ノード)：/.exec(first)?.[1] : undefined;
      if (!who) return <p {...props}>{content}</p>;
      const s = speakers[who];
      return <div className={`talk talk-${s.side}`}><img className="talk-avatar" src={`${import.meta.env.BASE_URL}${s.icon}`} alt="" width={44} height={44}/>
        <div className="talk-bubble"><span className="talk-name">{s.name}</span><p>{(first as string).slice(who.length + 1)}{rest}</p></div></div>;
    },
  }}>{children}</ReactMarkdown>;
}

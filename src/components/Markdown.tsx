import { Children } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Dialogue lines in the lesson text: a paragraph starting with 「博士：」 or 「ノード：」 becomes a speech bubble. */
const speakers: Record<string, { name: string; icon: string; side: string }> = {
  博士: { name: 'パス博士', icon: 'chat_icon_professor.svg', side: 'teacher' },
  ノード: { name: 'ノード君', icon: 'chat_icon_young.svg', side: 'student' },
};

/** Markdown with GFM tables. Raw HTML stays disabled (react-markdown default). Wide tables scroll inside their own box. */
export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    table: ({ node: _node, ...props }) => <div className="table-wrap"><table {...props}/></div>,
    // GFM autolinks URLs like http://198.51.100.80/ — those are simulated hosts, so they must not open the real internet.
    a: ({ node: _node, ...props }) => props.href?.startsWith('#') ? <a {...props}/> : <>{props.children}</>,
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

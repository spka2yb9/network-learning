import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Markdown from '../../components/Markdown';
import { chapterById, curriculum, type Chapter } from '../../lessons/curriculum';
import { glossaryFor, theoryOf } from '../../lessons/content';
import { termsIn } from '../../lessons/theory';
import { visuals } from '../../components/TheoryVisual/visuals';
import { simulationFor } from '../../labs';
import { Icon } from '../../components/Icon';
import { useUI } from '../../stores/ui';
import { lab } from '../../application/LabController';

const SimulatorPage = lazy(() => import('./SimulatorPage'));
const AwsPage = lazy(() => import('./AwsPage'));
const TerraformPage = lazy(() => import('./TerraformPage'));
const readKey = (chapter: string, section: number) => `read:${chapter}:${section}`;
const pad = (n: number) => String(n).padStart(2, '0');

/** One section per page: a long chapter reads as short, finishable pages. Contents and this section's terms stay beside it. */
function Theory({ chapter }: { chapter: Chapter }) {
  const [params, setParams] = useSearchParams();
  const doc = useMemo(() => theoryOf(chapter.dir), [chapter.dir]);
  const glossary = glossaryFor(chapter.id);
  const index = Math.min(doc.length - 1, Math.max(0, Math.trunc(Number(params.get('section') ?? 1)) - 1 || 0));
  const section = doc[index];
  const terms = useMemo(() => section ? termsIn(section.body, glossary) : [], [section, glossary]);
  // The contents list scrolls on its own (the keywords stay in view below it); keep the current page in sight.
  const toc = useRef<HTMLOListElement>(null);
  useEffect(() => { const list = toc.current, li = list?.querySelector<HTMLElement>('li.current'); if (list && li) list.scrollTop = li.offsetTop - list.clientHeight / 3; }, [index]);
  // Diagram index links name the diagram; the frame after mount runs after Layout's scroll-to-top.
  const visualParam = params.get('visual');
  useEffect(() => { if (!visualParam) return; const frame = requestAnimationFrame(() => document.querySelector(`[data-visual="${CSS.escape(visualParam)}"]`)?.scrollIntoView({ block: 'start' })); return () => cancelAnimationFrame(frame); }, [index, visualParam]);
  if (!section) return <div className="empty-state">この章の本文は準備中です。</div>;
  const go = (i: number) => setParams(i ? { section: String(i + 1) } : {});
  const finish = () => void lab.markComplete(readKey(chapter.id, index));
  const read = doc.filter((_, i) => lab.completed.has(readKey(chapter.id, i))).length;
  const next = doc[index + 1];
  const nextChapter = curriculum[curriculum.indexOf(chapter) + 1];
  const visualSections = doc.flatMap((s, i) => [...s.body.matchAll(/```theory-visual\s*\n([^\n]+)\n```/g)].flatMap(m => visuals[m[1]] ? [{ index: i, id: m[1], title: visuals[m[1]].title }] : []));
  return <div className="theory-reader">
    <article className="theory-page">
      <div className="theory-progress"><span>SECTION {pad(index + 1)} / {pad(doc.length)}</span><span><Icon name="clock" size={13}/>約{section.minutes}分</span><div className="progress-track"><span style={{ width: `${(index + 1) / doc.length * 100}%` }}/></div></div>
      <h2 className="theory-title">{section.title}</h2>
      {index === 0 && visualSections.length > 0 && <nav className="theory-visual-index" aria-label="この章の図解"><strong>この章で触って学べる図解</strong>{visualSections.map(v => <Link key={v.id} to={`/learn/${chapter.id}?section=${v.index + 1}&visual=${v.id}`}><span>§{pad(v.index + 1)}</span>{v.title}<Icon name="arrow" size={14}/></Link>)}</nav>}
      <div className="markdown theory"><Markdown key={`${chapter.id}:${index}`} glossary={glossary}>{section.body}</Markdown></div>
      <nav className="section-pager" aria-label="セクション移動">
        {index > 0 ? <button className="pager-prev" onClick={() => go(index - 1)}><small><Icon name="chevron" size={11}/>前のセクション</small><span>{doc[index - 1].title}</span></button> : <span/>}
        {next ? <button className="pager-next" onClick={() => { finish(); go(index + 1); }}><small>読んだ。次のセクションへ<Icon name="arrow" size={13}/></small><span>{next.title}</span></button>
          : <Link className="pager-next" to={`/learn/${chapter.id}?tab=simulation&section=${index + 1}`} onClick={finish}><small>読んだ。手を動かして組み立てる<Icon name="arrow" size={13}/></small><span>Simulation へ進む</span></Link>}
      </nav>
      {!next && nextChapter && <p className="muted tiny next-chapter">シミュレーションのあとは <Link to={`/learn/${nextChapter.id}`}>次の章「{nextChapter.title}」</Link> へ。</p>}
    </article>
    <aside className="theory-aside">
      <nav className="theory-toc" aria-label="この章の目次"><div className="aside-heading"><span className="eyebrow">CONTENTS</span><small>{read} / {doc.length} 読了</small></div>
        <ol ref={toc}>{doc.map((s, i) => <li key={s.title} className={`${i === index ? 'current' : ''} ${lab.completed.has(readKey(chapter.id, i)) ? 'read' : ''}`}>
          <button aria-current={i === index ? 'page' : undefined} onClick={() => go(i)}><span className="toc-number">{lab.completed.has(readKey(chapter.id, i)) ? <Icon name="check" size={12}/> : i + 1}</span><span>{s.title}</span></button>
          {i === index && s.subsections.length > 0 && <ul>{s.subsections.map(h => <li key={h}><a href={`#sec-${h}`} onClick={e => { e.preventDefault(); document.getElementById(`sec-${h}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{h}</a></li>)}</ul>}
        </li>)}</ol></nav>
      {terms.length > 0 && <section className="theory-terms" aria-label="このセクションの用語"><div className="aside-heading"><span className="eyebrow">KEYWORDS</span><small>このセクションの用語</small></div>
        {terms.map(term => { const t = glossary.get(term)!; const here = t.chapter === chapter.id && t.section === index; return <details key={term}><summary>{term}{!here && <small>{t.chapter === chapter.id ? `§${t.section + 1}` : `第${curriculum.findIndex(c => c.id === t.chapter) + 1}章`}</small>}</summary><p>{t.definition}</p></details>; })}
        <p className="tiny muted">本文の点線の語にカーソルを合わせても、意味を確認できます。</p></section>}
    </aside>
  </div>;
}

function Simulation({ chapter }: { chapter: Chapter }) {
  const sim = simulationFor(chapter.id);
  if (!sim) return <div className="empty-state">この章のSimulationは準備中です。</div>;
  const Page = sim.workspace === 'aws' ? AwsPage : sim.workspace === 'terraform' ? TerraformPage : SimulatorPage;
  return <Suspense fallback={<div className="empty-state">ワークスペースを準備しています…</div>}><Page labId={sim.id}/></Suspense>;
}

function Lesson({ chapter }: { chapter: Chapter }) {
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'simulation' ? 'simulation' : 'theory';
  useUI(s => s.revision);
  const index = curriculum.indexOf(chapter);
  const done = lab.completed.has(`${chapter.id}-mastery`);
  const doc = useMemo(() => theoryOf(chapter.dir), [chapter.dir]);
  const read = doc.filter((_, i) => lab.completed.has(readKey(chapter.id, i))).length;
  const sim = simulationFor(chapter.id);
  // Switching tabs keeps the Theory page you were on.
  const section = params.get('section');
  return <div className={`learn-page ${tab}`}>
    <div className="page-breadcrumb"><Link to="/">学習ホーム</Link><Icon name="chevron" size={12}/><span>{chapter.title}</span></div>
    <div className="page-heading"><div><span className="eyebrow">CHAPTER {pad(index + 1)} · {chapter.level}</span><h1>{chapter.title}</h1>{tab === 'theory' && !section && <p>{chapter.subtitle}。<br/>ゴール: {chapter.goal}</p>}</div><span className="badge">{done ? '✓ シミュレーション完了' : '学習中'}</span></div>
    <div className="lesson-tabs" role="tablist" aria-label="学習の進め方">
      <Link role="tab" aria-selected={tab === 'theory'} className={tab === 'theory' ? 'active' : ''} to={`/learn/${chapter.id}${section ? `?section=${section}` : ''}`} replace><Icon name="book" size={18}/><span><strong>Theory</strong><small>しくみを読む · {doc.length}セクション · {read}読了</small></span></Link>
      <Link role="tab" aria-selected={tab === 'simulation'} className={tab === 'simulation' ? 'active' : ''} to={`/learn/${chapter.id}?tab=simulation${section ? `&section=${section}` : ''}`} replace><Icon name="network" size={18}/><span><strong>Simulation</strong><small>組み立てて確かめる · {sim?.sim?.length ?? 0}ステップ{done ? ' · 完了' : ''}</small></span></Link>
    </div>
    <div role="tabpanel">{tab === 'theory' ? <Theory chapter={chapter}/> : <Simulation chapter={chapter}/>}</div>
  </div>;
}
export default function LearnPage() {
  const { chapter = 'routing' } = useParams();
  const def = chapterById(chapter);
  if (!def) return <div className="not-found"><h1>この章は見つかりませんでした。</h1><Link className="button" to="/roadmap">学習ロードマップを見る</Link></div>;
  return <Lesson key={chapter} chapter={def}/>;
}

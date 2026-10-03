import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Markdown from '../../components/Markdown';
import { chapterById, curriculum, lessonStages, type Chapter } from '../../lessons/curriculum';
import { labById, labPath, labsFor } from '../../labs';
import { Icon } from '../../components/Icon';
import LabCard from '../../components/Lab/LabCard';
import { useUI } from '../../stores/ui';
import { lab } from '../../application/LabController';

const theory = import.meta.glob('../../content/*/theory.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const professional = import.meta.glob('../../content/*/professional.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const md = (files: Record<string, string>, dir: string, name: 'theory' | 'professional') => files[`../../content/${dir}/${name}.md`] ?? '';
const ChapterVisual = lazy(() => import('../../components/Visualizer/ChapterVisual'));
const MasteryForm = lazy(() => import('../../components/Visualizer/MasteryForms'));

function Quiz({ chapter }: { chapter: Chapter }) {
  useUI(s => s.revision);
  const [index, setIndex] = useState(0);
  const q = chapter.quiz[index]; const id = index === 0 ? chapter.id : `${chapter.id}-q${index + 1}`;
  const saved = lab.quizzes.get(id);
  const [selected, setSelected] = useState<number | undefined>(saved?.selected);
  useEffect(() => setSelected(lab.quizzes.get(id)?.selected), [index]);
  const correct = chapter.quiz.filter((_, i) => lab.quizzes.get(i === 0 ? chapter.id : `${chapter.id}-q${i + 1}`)?.correct).length;
  return <div className="activity-panel quiz-panel"><span className="eyebrow">KNOWLEDGE CHECK · {index + 1} / {chapter.quiz.length} · 正解 {correct}</span><h2>仕組みを、説明できますか？</h2><p>{q.question}</p>
    <fieldset><legend className="sr-only">回答を選択</legend>{q.options.map((option, i) => <label className={`quiz-option ${selected === i ? 'selected' : ''}`} key={option}><input type="radio" name={`quiz-${id}`} checked={selected === i} onChange={() => setSelected(i)}/><span>{String.fromCharCode(65 + i)}</span>{option}</label>)}</fieldset>
    <div className="quiz-actions"><button className="button" disabled={selected === undefined} onClick={() => { if (selected !== undefined) void lab.answerQuiz(id, selected, selected === q.answer); }}>回答を確認<Icon name="check" size={16}/></button>
      <button className="button secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>前の問題</button><button className="button secondary" disabled={index === chapter.quiz.length - 1} onClick={() => setIndex(index + 1)}>次の問題<Icon name="arrow" size={14}/></button></div>
    {saved && <div className={`quiz-feedback ${saved.correct ? 'correct' : ''}`} role="status"><strong>{saved.correct ? '正解です。' : '不正解です。解説を読んで、処理をもう一度たどってみましょう。'}</strong><p>{q.explanation}</p><small>Quizに正解しても、章の修了（実技完了）にはなりません。修了はMastery Checkで判定します。</small></div>}</div>;
}
function Labs({ chapter, kinds, empty, text }: { chapter: Chapter; kinds: string[]; empty: string; text?: string }) {
  const list = labsFor(chapter.id).filter(l => kinds.includes(l.kind));
  return <div className="activity-panel"><span className="eyebrow">{kinds.includes('troubleshooting') ? 'TROUBLESHOOTING LAB' : kinds.includes('guided') ? 'GUIDED LAB' : 'CHALLENGE'}</span>
    <h2>{kinds.includes('troubleshooting') ? '「つながらない」を、手がかりに。' : kinds.includes('guided') ? '最初の実験を、いっしょに。' : '今度は、自分の力で。'}</h2>
    {text && <p>{text}</p>}
    {kinds.includes('troubleshooting') && <div className="hint-box">障害演習では「通信できません。原因を特定して直してください」とだけ伝えられます。症状 → 観測した事実 → 仮説 → 変更内容 → 再確認の結果、の順に記録しながら進めましょう。直したあとに「原因はどの層か」を答えると完了です。</div>}
    <div className="lab-grid">{list.map(l => <LabCard key={l.id} lab={l}/>)}</div>{!list.length && <p className="muted">{empty}</p>}</div>;
}
function Lesson({ chapter }: { chapter: Chapter }) {
  const [params, setParams] = useSearchParams();
  const stage = Math.min(8, Math.max(0, Math.trunc(Number(params.get('stage') ?? 0)) || 0));
  const setStage = (s: number) => setParams(s ? { stage: String(s) } : {}, { replace: true });
  useUI(s => s.revision);
  const index = curriculum.indexOf(chapter);
  const done = lab.completed.has(`${chapter.id}-mastery`);
  const masteryLabs = chapter.mastery.type === 'lab' ? chapter.mastery.labIds.map(labById).filter(l => !!l) : [];
  return <div className="learn-page"><div className="page-breadcrumb"><Link to="/">学習ホーム</Link><Icon name="chevron" size={12}/><span>{chapter.title}</span></div>
    <div className="page-heading"><div><span className="eyebrow">CHAPTER {String(index + 1).padStart(2, '0')} · {chapter.level}</span><h1>{chapter.title}</h1><p>{chapter.subtitle}。この章では、読む → 動かす → 壊す → 調べる → 直す、をひとつの流れで体験します。</p></div><span className="badge">{done ? '✓ 実技完了' : '学習中'}</span></div>
    <div className="lesson-stage-tabs" role="tablist" aria-label="学習ステップ">{lessonStages.map((name, i) => <button key={name} role="tab" aria-selected={stage === i} className={stage === i ? 'active' : ''} onClick={() => setStage(i)}><span>{String(i + 1).padStart(2, '0')}</span>{name}</button>)}</div>
    <div className="lesson-layout"><div className="lesson-main" role="tabpanel">
      {stage === 0 && <article className="markdown theory"><Markdown>{md(theory, chapter.dir, 'theory')}</Markdown></article>}
      {stage === 1 && <Suspense fallback={<div className="empty-state">可視化ツールを読み込み中…</div>}><ChapterVisual id={chapter.id}/></Suspense>}
      {stage === 2 && <div className="activity-panel"><span className="eyebrow">YOUR SAFE PLACE TO EXPERIMENT</span><h2>自由に触って、確かめよう。</h2><p>{chapter.playground.text}すべてブラウザ内のシミュレーションなので、実際のネットワークには影響しません。</p><Link className="button" to={chapter.playground.to}>{chapter.playground.label}<Icon name="arrow" size={17}/></Link><p className="muted tiny">プレイグラウンドでは「テンプレートを開く」から、他の章の構成も読み込めます。</p></div>}
      {stage === 3 && <Labs chapter={chapter} kinds={['guided']} empty="この章には、手順付きのGuided Labはありません。VisualとPlaygroundのステップで手を動かしてから、次へ進みましょう。"/>}
      {stage === 4 && <Labs chapter={chapter} kinds={['challenge', 'mastery']} empty={chapter.id === 'subnet' ? 'Visualで練習したパズルと同じ形式の課題が、Mastery Checkの後半で採点されます。' : 'この章のChallengeラボは準備中です。'} text={chapter.id === 'subnet' ? 'Visual の「アドレス割り当てパズル」に挑戦してください。ヒントなしで、5つの用途にアドレスを無駄なく、重ならないように割り当てます。' : undefined}/>}
      {stage === 5 && <Labs chapter={chapter} kinds={['troubleshooting']} empty={chapter.id === 'tcp-ip' ? 'TCP/IPの障害調査は、第7章「Linuxネットワーク」で NIC → IP → ARP → Route → DNS → TCP → TLS → Application の順に本格的に扱います。まずは第3章「ルーティング」の障害演習から始めましょう。' : 'この章専用の障害演習はありません。ラボ一覧の「Troubleshooting」から、ほかの章の障害演習に挑戦してみましょう。'}/>}
      {stage === 6 && <div className="activity-panel"><span className="eyebrow">PROFESSIONAL NOTES</span><h2>現場で役立つ、もうひとつの視点。</h2><article className="markdown professional"><Markdown>{md(professional, chapter.dir, 'professional')}</Markdown></article></div>}
      {stage === 7 && <Quiz chapter={chapter}/>}
      {stage === 8 && (chapter.mastery.type === 'form' ? <Suspense fallback={<div className="empty-state">読み込み中…</div>}><MasteryForm id={chapter.id}/></Suspense>
        : <div className="activity-panel"><span className="eyebrow">MASTERY CHECK · FINAL STATE, NOT COMMAND HISTORY</span><h2>自分の構成で、できることを証明する。</h2><p>下の{masteryLabs.length > 1 ? `${masteryLabs.length}つの` : ''}ラボの到達条件をすべて満たすと、この章は「実技完了」になります。採点するのは入力したコマンドの履歴ではなく、最終的な構成と通信の結果です。Quizに正解しただけでは修了になりません。</p>{masteryLabs.length > 0 && <div className="lab-grid">{masteryLabs.map(l => <LabCard key={l.id} lab={l}/>)}</div>}{done && <p className="success-text">この章の実技を完了しています。</p>}</div>)}
      <div className="lesson-navigation"><button className="button secondary" disabled={stage === 0} onClick={() => setStage(stage - 1)}>前のステップ</button><span>{stage + 1} / {lessonStages.length}</span><button className="button" disabled={stage === lessonStages.length - 1} onClick={() => setStage(stage + 1)}>次のステップ<Icon name="arrow" size={15}/></button></div>
    </div><aside className="learning-aside"><span className="eyebrow">TODAY'S DESTINATION</span><h3>{chapter.goal}</h3><p>うまくいかなかったら、それが学びの入口。結果だけでなく、そこに至る処理を確認しよう。</p><div className="aside-divider"/><div className="aside-tip"><Icon name="bulb" size={22}/><h4>手を動かすヒント</h4><p>一度に変える設定はひとつ。変更前と変更後を比較すると、原因が見えてきます。</p></div>
      {labsFor(chapter.id).length > 0 && <div className="aside-labs"><h4>この章のラボ</h4><ul>{labsFor(chapter.id).map(l => <li key={l.id}><Link to={labPath(l)}>{lab.completed.has(`lab:${l.id}`) ? '✓ ' : ''}{l.title}</Link></li>)}</ul></div>}
      <div className="scope-note">すべての通信は教育用シミュレーションです。簡略化している点は各章の「このシミュレータで試せること」に明記しています。</div></aside></div>
  </div>;
}
export default function LearnPage() {
  const { chapter = 'routing' } = useParams();
  const def = chapterById(chapter);
  if (!def) return <div className="not-found"><h1>この章は見つかりませんでした。</h1><Link className="button" to="/roadmap">学習ロードマップを見る</Link></div>;
  return <Lesson key={chapter} chapter={def}/>;
}

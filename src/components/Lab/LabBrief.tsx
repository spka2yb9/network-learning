import { useState } from 'react';
import { Link } from 'react-router-dom';
import Markdown from '../Markdown';
import { lab as controller } from '../../application/LabController';
import type { CheckResult, Lab } from '../../labs/types';
import { chapterById } from '../../lessons/curriculum';
import { useUI } from '../../stores/ui';
import { Icon } from '../Icon';
import Modal from '../Modal';
import SimulationSteps from './SimulationSteps';

const kindText = { guided: 'GUIDED LAB', challenge: 'CHALLENGE', troubleshooting: 'TROUBLESHOOTING', mastery: 'MASTERY CHECK', capstone: 'CAPSTONE', simulation: 'SIMULATION' } as const;
type Props = { lab: Lab; assessment?: CheckResult[]; onAssess?: () => void; onExample?: () => void };

/** Mission header shared by every workspace. A chapter's Simulation shows its steps instead. */
export default function LabBrief(props: Props) {
  return props.lab.kind === 'simulation' ? <SimulationSteps lab={props.lab} onExample={props.onExample}/> : <Mission {...props}/>;
}
/** Grading is always final-state based and supplied by the caller. */
function Mission({ lab, assessment, onAssess, onExample }: Props) {
  useUI(s => s.revision);
  const [hints, setHints] = useState(0);
  const [open, setOpen] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const done = controller.completed.has(`lab:${lab.id}`);
  const diag = lab.diagnosis && controller.quizzes.get(`diag:${lab.id}`);
  const chapter = lab.chapter === 'capstone' ? undefined : chapterById(lab.chapter);
  const allPass = assessment?.every(c => c.pass);
  return <div className={`lab-brief ${done ? 'done' : ''}`}>
    <div className="lab-objective">
      <div className="objective-icon"><Icon name={lab.kind === 'troubleshooting' ? 'alert' : lab.kind === 'capstone' ? 'flag' : 'target'}/></div>
      <div><strong>{kindText[lab.kind]} <span>{lab.title}</span>{done && <em className="done-badge"><Icon name="check" size={13}/>完了</em>}</strong><p>{lab.mission}</p></div>
      <button className="button small ghost" onClick={() => setOpen(!open)}><Icon name="book" size={16}/>{open ? '説明を閉じる' : '説明'}</button>
      {onAssess && <button className="button small" title="今の構成が到達条件を満たしているかを判定します" onClick={onAssess}>到達度を確認<Icon name="check" size={16}/></button>}
    </div>
    {open && <div className="lab-details">
      {lab.brief && <div className="markdown compact"><Markdown>{lab.brief}</Markdown></div>}
      {lab.steps && <ol className="guided-steps compact">{lab.steps.map((s, i) => <li key={s}><span>{i + 1}</span><p>{s}</p></li>)}</ol>}
      <div className="hint-area">{lab.hints.slice(0, hints).map(h => <div key={h} className="hint-box"><Icon name="bulb" size={15}/> {h}</div>)}
        {hints < lab.hints.length && <button className="button small secondary" onClick={() => setHints(hints + 1)}><Icon name="bulb" size={14}/>ヒント（{hints + 1}/{lab.hints.length}）</button>}
        {chapter && <Link className="hero-text-link" to={`/learn/${chapter.id}`}><Icon name="book" size={14}/>教材: {chapter.title}</Link>}
        {onExample && (done || lab.kind === 'guided') && <button className="button small ghost" onClick={() => setConfirm(true)}><Icon name="eye" size={14}/>解答例を開く</button>}</div>
      <p className="tiny muted">判定するのは、入力したコマンドではなく、最後のネットワークの状態（届くか・設定・分けられているか）です。解き方は1つではありません。作業中は「症状 → 観測した事実 → 仮説 → 変更 → 再確認」の順にメモしましょう。</p>
    </div>}
    {assessment && <div className="assessment" aria-live="polite"><strong>{allPass ? 'すべての到達条件を満たしました！' : 'まだ満たしていない条件があります（×の項目）'}</strong>{assessment.map(c => <span key={c.label} className={c.pass ? 'passed' : 'not-passed'}><Icon name={c.pass ? 'check' : 'close'} size={15}/>{c.label}</span>)}</div>}
    {lab.questions && <Observations lab={lab}/>}
    {lab.diagnosis && (allPass || diag) && <div className="diagnosis"><strong>{lab.diagnosis.question}</strong>
      <div className="diagnosis-options">{lab.diagnosis.options.map((o, i) => <button key={o} aria-pressed={diag?.selected === i} className={`quiz-option ${diag?.selected === i ? (diag.correct ? 'selected correct' : 'selected wrong') : ''}`} onClick={() => { void controller.answerQuiz(`diag:${lab.id}`, i, i === lab.diagnosis!.answer); onAssess?.(); }}><span>{String.fromCharCode(65 + i)}</span>{o}</button>)}</div>
      {diag && <p className={diag.correct ? 'success-text' : 'error-text'}>{diag.correct ? `正解。${lab.diagnosis.explanation}` : 'もう一度、観測した事実から考えてみましょう。'}</p>}</div>}
    {lab.diagnosis && !allPass && !diag && <p className="tiny muted diagnosis-later">直せたら「到達度を確認」を押します。そのあと、原因がどの層にあったかを答えると完了です。</p>}
    {done && lab.debrief && <div className="hint-box debrief"><Icon name="bulb" size={15}/> {lab.debrief}</div>}
    {confirm && <Modal labelledBy="example-title" onClose={() => setConfirm(false)}><div className="modal-icon"><Icon name="eye" size={28}/></div><h2 id="example-title">解答例に切り替えますか？</h2><p>今の構成は、解答例（正解の一例）に置き換わります。残したい場合は、先に書き出して保存してください。</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(false)}>キャンセル</button><button className="button" onClick={() => { onExample?.(); setConfirm(false); }}>切り替える</button></div></Modal>}
  </div>;
}
function Observations({ lab }: { lab: Lab }) {
  const [draft, setDraft] = useState<Record<string, string>>(controller.observations);
  return <form className="mastery-form observations" onSubmit={e => { e.preventDefault(); void Promise.all(lab.questions!.map(q => controller.observe(q.label, draft[q.label] ?? ''))).then(() => controller.assess()); }}>
    <strong>{lab.questions!.some(q => q.options) ? '観察と設計の設問に答える' : '観察した値を記録する'}</strong>
    {lab.questions!.map(q => { const saved = controller.observations[q.label]; return <label key={q.label}>{q.label}{q.options
      ? <select value={draft[q.label] ?? ''} onChange={e => setDraft({ ...draft, [q.label]: e.target.value })}><option value="">選んでください</option>{q.options.map(o => <option key={o}>{o}</option>)}</select>
      : <input value={draft[q.label] ?? ''} onChange={e => setDraft({ ...draft, [q.label]: e.target.value })}/>}{saved !== undefined && <small className={saved.trim() === q.answer ? 'success-text' : 'error-text'}>{saved.trim() === q.answer ? '一致' : 'まだ一致しません'}</small>}</label>; })}
    <button className="button small">記録して確認<Icon name="check" size={14}/></button></form>;
}

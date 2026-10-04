import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Markdown from '../Markdown';
import { completeLab, lab as controller } from '../../application/LabController';
import { aws, terraform } from '../../application/CloudController';
import { stepChecks, stepQuizId } from '../../labs/simulation';
import type { Lab, SimStep } from '../../labs/types';
import { curriculum } from '../../lessons/curriculum';
import { useUI } from '../../stores/ui';
import { Icon } from '../Icon';
import Modal from '../Modal';

function StepQuiz({ id, quiz }: { id: string; quiz: NonNullable<SimStep<unknown>['quiz']> }) {
  const saved = controller.quizzes.get(id);
  return <div className="sim-quiz"><strong><Icon name="search" size={15}/>観察して答える</strong><p>{quiz.question}</p>
    <div className="diagnosis-options">{quiz.options.map((o, i) => <button key={o} aria-pressed={saved?.selected === i} className={`quiz-option ${saved?.selected === i ? (saved.correct ? 'selected correct' : 'selected wrong') : ''}`} onClick={() => void controller.answerQuiz(id, i, i === quiz.answer)}><span>{String.fromCharCode(65 + i)}</span>{o}</button>)}</div>
    {saved && <p className={saved.correct ? 'success-text' : 'error-text'}>{saved.correct ? `正解。${quiz.explanation}` : 'もう一度、シミュレータの表示を確かめてみましょう。'}</p>}</div>;
}
function Hints({ hints }: { hints: string[] }) {
  const [shown, setShown] = useState(0);
  return <div className="hint-area">{hints.slice(0, shown).map(h => <div key={h} className="hint-box"><Icon name="bulb" size={15}/> {h}</div>)}
    {shown < hints.length && <button className="button small secondary" onClick={() => setShown(shown + 1)}><Icon name="bulb" size={14}/>ヒント（{shown + 1}/{hints.length}）</button>}</div>;
}

const how: Record<Lab['workspace'], string> = {
  network: 'GUI（右の「機器設定」）とTerminal（CLI）のどちらで設定してもかまいません。',
  aws: '左の RESOURCES で部品を追加し、右の PROPERTIES で設定します。変更するたびに判定し直します。',
  terraform: 'コードを編集しただけでは判定し直しません。validate・plan・apply などのコマンドを実行すると判定します。',
  capture: '',
};

/** The chapter's Simulation: build what the Theory explained, one step at a time. Each step is checked live on the workspace. */
export default function SimulationSteps({ lab, onExample }: { lab: Lab; onExample?: () => void }) {
  const revision = useUI(s => s.revision);
  const steps = (lab.sim ?? []) as SimStep<unknown>[];
  const checks = useMemo(() => stepChecks(lab, lab.workspace === 'network' ? controller.network.snapshot() : lab.workspace === 'aws' ? aws.model : terraform.ws), [lab, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = steps.map((s, i) => checks[i] && (!s.quiz || controller.quizzes.get(stepQuizId(lab.id, i))?.correct === true));
  const current = done.indexOf(false);
  const complete = steps.length > 0 && current === -1;
  // The open step follows progress; a click opens another one (-1: all closed).
  const [open, setOpen] = useState<number>();
  useEffect(() => setOpen(undefined), [current]);
  const shown = open ?? current;
  const [intro, setIntro] = useState(current <= 0);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (complete && !controller.completed.has(`lab:${lab.id}`)) void completeLab(lab.id); }, [complete, lab.id]);
  const count = done.filter(Boolean).length;
  const next = curriculum[curriculum.findIndex(c => c.id === lab.chapter) + 1];
  return <div className="lab-brief sim-steps">
    <div className="sim-head"><span className="eyebrow">SIMULATION · STEP BY STEP</span><h2>{lab.title}</h2><p>{lab.mission}</p>
      <div className="sim-progress"><span>{count} / {steps.length} ステップ</span><div className="progress-track"><span style={{ width: `${count / Math.max(1, steps.length) * 100}%` }}/></div></div>
      {lab.brief && <button className="button small ghost" aria-expanded={intro} onClick={() => setIntro(!intro)}><Icon name="book" size={15}/>{intro ? '説明を閉じる' : 'この章で組み立てるもの'}</button>}
      {intro && lab.brief && <div className="markdown compact"><Markdown>{lab.brief}</Markdown></div>}</div>
    <ol className="sim-step-list">{steps.map((s, i) => <li key={s.title} className={`sim-step ${done[i] ? 'done' : ''} ${i === current ? 'current' : ''}`}>
      <button className="sim-step-head" aria-expanded={i === shown} onClick={() => setOpen(i === shown ? -1 : i)}><span className="sim-step-number">{done[i] ? <Icon name="check" size={14}/> : i + 1}</span><span>{s.title}</span><Icon name="chevron" size={12}/></button>
      {i === shown && <div className="sim-step-body">
        <div className="markdown compact"><Markdown>{s.body}</Markdown></div>
        {s.quiz && checks[i] && <StepQuiz id={stepQuizId(lab.id, i)} quiz={s.quiz}/>}
        {s.hints && !done[i] && <Hints key={i} hints={s.hints}/>}
        <p className={`sim-step-status ${done[i] ? 'success-text' : ''}`}>{done[i] ? <><Icon name="check" size={15}/> できました。</> : !checks[i] ? '条件を満たすと、自動でチェックが付きます。' : '上の問いに答えると完了です。'}</p>
        {done[i] && i < steps.length - 1 && i !== current && current !== -1 && <button className="button small" onClick={() => setOpen(undefined)}>いまのステップへ<Icon name="arrow" size={14}/></button>}
      </div>}
    </li>)}</ol>
    {complete && <div className="sim-complete" role="status"><Icon name="flag" size={22}/><div><strong>すべてのステップを組み立てました！</strong>{lab.debrief && <p>{lab.debrief}</p>}
      {next && <Link className="button small" to={`/learn/${next.id}`}>次の章へ: {next.title}<Icon name="arrow" size={14}/></Link>}</div></div>}
    {onExample && <div className="sim-actions"><button className="button small ghost" onClick={() => setConfirm(true)}><Icon name="eye" size={14}/>完成形（解答例）を開く</button></div>}
    <p className="tiny muted">判定は、入力した手順ではなく、いまの状態で行います。{how[lab.workspace]}</p>
    {confirm && <Modal labelledBy="sim-example-title" onClose={() => setConfirm(false)}><div className="modal-icon"><Icon name="eye" size={28}/></div><h2 id="sim-example-title">完成形に切り替えますか？</h2><p>今の構成は、すべてのステップを終えた状態（解答例）に置き換わります。観察の問いへの回答は残ります。</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(false)}>キャンセル</button><button className="button" onClick={() => { onExample?.(); setConfirm(false); }}>切り替える</button></div></Modal>}
  </div>;
}

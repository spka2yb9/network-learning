import { useState } from 'react';
import { Link } from 'react-router-dom';
import { curriculum } from '../../lessons/curriculum';
import { chapterMinutes } from '../../lessons/content';
import { labs, labPath } from '../../labs';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { Icon } from '../../components/Icon';
import Modal from '../../components/Modal';
import { resetProgress } from '../../application/progress';

function ResetProgress() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) { setOpen(false); setError(''); } };
  const reset = async () => {
    setBusy(true);
    try { await resetProgress(); } catch { setBusy(false); setError('リセットできませんでした。ブラウザの保存領域が使えない可能性があります。'); }
  };
  return <section className="progress-reset"><div><h2>学習の記録</h2><p className="muted">はじめから学び直すときは、このブラウザに保存した進捗をリセットできます。</p></div>
    <button className="button small secondary text-danger" onClick={() => setOpen(true)}><Icon name="reset" size={14}/>進捗をリセット</button>
    {open && <Modal labelledBy="progress-reset-title" onClose={close}><div className="modal-icon"><Icon name="reset" size={28}/></div><h2 id="progress-reset-title">学習の進捗をリセットしますか？</h2>
      <p>このブラウザに保存した、次の記録を消します。この操作は取り消せません。</p>
      <ul className="progress-reset-list"><li>読んだセクションの記録</li><li>Simulation・ラボ・総合課題の完了</li><li>クイズ・診断・観測の回答</li><li>各ラボで組み立てた構成（最初の状態に戻ります）</li></ul>
      <p>プレイグラウンド（Network・AWS・Terraform）の構成と、名前を付けて保存した構成は残ります。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={close}>キャンセル</button><button className="button design-delete-button" disabled={busy} onClick={() => void reset()}>{busy ? 'リセット中…' : 'リセットする'}</button></div></Modal>}
  </section>;
}

export default function RoadmapPage() {
  useUI(s => s.revision);
  const capstones = labs.filter(l => l.kind === 'capstone').sort((a, b) => a.id.localeCompare(b.id));
  return <div className="roadmap-page"><div className="eyebrow">FROM YOUR FIRST PACKET TO YOUR FIRST DESIGN</div><h1>ここから、実務で使える力へ。</h1>
    <p className="muted">12の章は、どれも「Theory（しくみを読む） → Simulation（自分で組み立てて確かめる）」の2ステップで進みます。Simulationの各ステップは、操作の手順ではなく、いまの構成と通信の結果で判定します。</p>
    <div className="roadmap-list">{curriculum.map((c, i) => { const done = lab.completed.has(`${c.id}-mastery`); return <div className={`available ${done ? 'done' : ''}`} key={c.id}><span className="roadmap-number">{done ? <Icon name="check" size={16}/> : String(i + 1).padStart(2, '0')}</span><div><span className="eyebrow">{c.level} · Theory 約{chapterMinutes(c.dir)}分</span><h3>{c.title}</h3><p>{c.subtitle} — {c.goal}</p></div><Link className="button small secondary" to={`/learn/${c.id}`}>{done ? '復習する' : '学習する'}<Icon name="arrow" size={15}/></Link></div>; })}</div>
    <h2>学びの先に、6つの総合課題。</h2><p className="muted">複数の章で学んだことを組み合わせて、構築・障害調査・設計理由の説明に取り組みます。章の実技チェックと同じく、最終的な状態で採点します。</p>
    <div className="capstone-grid">{capstones.map(c => <Link key={c.id} to={labPath(c)} className={lab.completed.has(`lab:${c.id}`) ? 'done' : ''}><span className="eyebrow">{c.title.split(':')[0].toUpperCase()} · 約{c.minutes}分{lab.completed.has(`lab:${c.id}`) ? ' · 完了' : ''}</span><h3>{c.title.split(': ')[1] ?? c.title}</h3><p>{c.mission}</p><Icon name="target" size={24}/></Link>)}</div>
    <ResetProgress/></div>;
}

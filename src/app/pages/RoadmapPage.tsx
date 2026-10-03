import { useState } from 'react';
import { Link } from 'react-router-dom';
import { curriculum } from '../../lessons/curriculum';
import { labs, labPath } from '../../labs';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { Icon } from '../../components/Icon';
import Modal from '../../components/Modal';

export default function RoadmapPage() {
  useUI(s => s.revision);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState('');
  const capstones = labs.filter(l => l.kind === 'capstone').sort((a, b) => a.id.localeCompare(b.id));
  const completedLabs = labs.filter(l => lab.completed.has(`lab:${l.id}`)).length;
  const mastery = curriculum.filter(c => lab.completed.has(`${c.id}-mastery`)).length;
  const answers = lab.quizzes.size;
  const observations = Object.keys(lab.observations).length;
  const hasProgress = lab.completed.size > 0 || answers > 0 || observations > 0;
  const reset = async () => {
    const removed = await lab.resetProgress();
    setConfirm(false);
    setStatus(`学習の進捗をリセットしました。完了として記録した項目 ${removed.completed}件、Quiz・診断の回答 ${removed.quizzes}件、記録した観察値 ${removed.observations}件を消しました。`);
  };
  return <div className="roadmap-page"><div className="eyebrow">FROM YOUR FIRST PACKET TO YOUR FIRST DESIGN</div><h1>ここから、実務で使える力へ。</h1>
    <p className="muted">12の章は、どれも「理論 → 可視化 → 自由に試す → 手順付きラボ（Guided） → 自力で挑戦（Challenge） → 障害調査 → 現場の視点 → Quiz → 実技チェック」の順に進みます。実技チェックは、操作の手順ではなく最終的な結果（構成・通信・答えた値）で採点します。</p>
    <div className="roadmap-list">{curriculum.map((c, i) => { const done = lab.completed.has(`${c.id}-mastery`); return <div className={`available ${done ? 'done' : ''}`} key={c.id}><span className="roadmap-number">{done ? <Icon name="check" size={16}/> : String(i + 1).padStart(2, '0')}</span><div><span className="eyebrow">{c.level} · 約{c.minutes}分</span><h3>{c.title}</h3><p>{c.subtitle} — {c.goal}</p></div><Link className="button small secondary" to={`/learn/${c.id}`}>{done ? '復習する' : '学習する'}<Icon name="arrow" size={15}/></Link></div>; })}</div>
    <h2>学びの先に、6つの総合課題。</h2><p className="muted">複数の章で学んだことを組み合わせて、構築・障害調査・設計理由の説明に取り組みます。章の実技チェックと同じく、最終的な状態で採点します。</p>
    <div className="capstone-grid">{capstones.map(c => <Link key={c.id} to={labPath(c)} className={lab.completed.has(`lab:${c.id}`) ? 'done' : ''}><span className="eyebrow">{c.title.split(':')[0].toUpperCase()} · 約{c.minutes}分{lab.completed.has(`lab:${c.id}`) ? ' · 完了' : ''}</span><h3>{c.title.split(': ')[1] ?? c.title}</h3><p>{c.mission}</p><Icon name="target" size={24}/></Link>)}</div>
    <section className="progress-management" aria-labelledby="progress-management-title">
      <div className="section-heading"><div><span className="eyebrow">START OVER</span><h2 id="progress-management-title">学習の進捗をリセット</h2></div></div>
      <p className="muted">完了したラボと実技チェック、Quiz・診断の回答、記録した観察値をまとめて消します。ブラウザに保存した構成、AWS / Terraformのワークスペース、Terminalのコマンド履歴は残ります。</p>
      <dl className="progress-summary">
        <div><dt>完了したラボ</dt><dd>{completedLabs} / {labs.length}</dd></div>
        <div><dt>章の実技チェック</dt><dd>{mastery} / {curriculum.length}</dd></div>
        <div><dt>Quiz・診断の回答</dt><dd>{answers}</dd></div>
        <div><dt>記録した観察値</dt><dd>{observations}</dd></div>
      </dl>
      <div className="progress-management-actions">
        <button className="button secondary text-danger" disabled={!hasProgress} onClick={() => { setStatus(''); setConfirm(true); }}><Icon name="reset" size={16}/>進捗をリセット</button>
        {!hasProgress && <span className="tiny muted">リセットできる進捗はまだありません。</span>}
      </div>
      {status && <p className="success-text" role="status">{status}</p>}
    </section>
    {confirm && <Modal labelledBy="progress-reset-title" onClose={() => setConfirm(false)}>
      <div className="modal-icon"><Icon name="reset" size={28}/></div>
      <h2 id="progress-reset-title">学習の進捗をリセットしますか？</h2>
      <p>完了したラボ・実技チェック（{completedLabs}ラボ / {mastery}章）、Quiz・診断の回答（{answers}件）、記録した観察値（{observations}件）を消します。この操作は取り消せません。</p>
      <p>保存した構成、AWS / Terraformのワークスペース、Terminalのコマンド履歴は残ります。</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(false)}>キャンセル</button><button className="button danger" onClick={() => void reset()}>リセットする</button></div>
    </Modal>}
  </div>;
}

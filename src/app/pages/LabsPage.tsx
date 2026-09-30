import { useState } from 'react';
import { curriculum } from '../../lessons/curriculum';
import { labs } from '../../labs';
import type { LabKind } from '../../labs/types';
import LabCard from '../../components/Lab/LabCard';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';

const kinds: [LabKind | 'all', string][] = [['all', 'すべて'], ['guided', 'Guided'], ['challenge', 'Challenge'], ['troubleshooting', 'Troubleshooting'], ['mastery', 'Mastery'], ['capstone', 'Capstone']];
export default function LabsPage() {
  useUI(s => s.revision);
  const [kind, setKind] = useState<LabKind | 'all'>('all');
  const shown = labs.filter(l => kind === 'all' || l.kind === kind);
  const done = labs.filter(l => lab.completed.has(`lab:${l.id}`)).length;
  const groups = [{ id: 'capstone', title: '総合課題（Capstone）' }, ...curriculum.map((c, i) => ({ id: c.id, title: `${String(i + 1).padStart(2, '0')} ${c.title}` }))];
  return <div className="labs-page"><div className="page-heading"><div><span className="eyebrow">ALL LABS · FINAL-STATE GRADING</span><h1>ラボ一覧</h1><p>採点は、入力したコマンドではなく「最終的な構成と通信結果」で行います。解き方はひとつではありません。Guided は手順付きの練習、Challenge は自力での挑戦、Troubleshooting は障害調査、Mastery は章の実技チェック、Capstone は複数の章をまたぐ総合課題です。</p></div><span className="badge">完了 {done} / {labs.length}</span></div>
    <div className="segmented wide">{kinds.map(([k, label]) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{label}</button>)}</div>
    {groups.map(g => { const list = shown.filter(l => l.chapter === g.id).sort((a, b) => g.id === 'capstone' ? a.id.localeCompare(b.id, undefined, { numeric: true }) : 0); return list.length ? <section key={g.id} className="labs-group"><h2>{g.title}</h2><div className="lab-grid">{list.map(l => <LabCard key={l.id} lab={l}/>)}</div></section> : null; })}
  </div>;
}

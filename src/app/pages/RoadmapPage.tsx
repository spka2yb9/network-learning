import { Link } from 'react-router-dom';
import { curriculum } from '../../lessons/curriculum';
import { labs, labPath } from '../../labs';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { Icon } from '../../components/Icon';

export default function RoadmapPage() {
  useUI(s => s.revision);
  const capstones = labs.filter(l => l.kind === 'capstone').sort((a, b) => a.id.localeCompare(b.id));
  return <div className="roadmap-page"><div className="eyebrow">FROM YOUR FIRST PACKET TO YOUR FIRST DESIGN</div><h1>ここから、実務で使える力へ。</h1>
    <p className="muted">12の章は、どれも「理論 → 可視化 → 自由に試す → 手順付きラボ（Guided） → 自力で挑戦（Challenge） → 障害調査 → 現場の視点 → Quiz → 実技チェック」の順に進みます。実技チェックは、操作の手順ではなく最終的な結果（構成・通信・答えた値）で採点します。</p>
    <div className="roadmap-list">{curriculum.map((c, i) => { const done = lab.completed.has(`${c.id}-mastery`); return <div className={`available ${done ? 'done' : ''}`} key={c.id}><span className="roadmap-number">{done ? <Icon name="check" size={16}/> : String(i + 1).padStart(2, '0')}</span><div><span className="eyebrow">{c.level} · 約{c.minutes}分</span><h3>{c.title}</h3><p>{c.subtitle} — {c.goal}</p></div><Link className="button small secondary" to={`/learn/${c.id}`}>{done ? '復習する' : '学習する'}<Icon name="arrow" size={15}/></Link></div>; })}</div>
    <h2>学びの先に、6つの総合課題。</h2><p className="muted">複数の章で学んだことを組み合わせて、構築・障害調査・設計理由の説明に取り組みます。章の実技チェックと同じく、最終的な状態で採点します。</p>
    <div className="capstone-grid">{capstones.map(c => <Link key={c.id} to={labPath(c)} className={lab.completed.has(`lab:${c.id}`) ? 'done' : ''}><span className="eyebrow">{c.title.split(':')[0].toUpperCase()} · 約{c.minutes}分{lab.completed.has(`lab:${c.id}`) ? ' · 完了' : ''}</span><h3>{c.title.split(': ')[1] ?? c.title}</h3><p>{c.mission}</p><Icon name="target" size={24}/></Link>)}</div></div>;
}

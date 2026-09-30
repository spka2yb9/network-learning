import { useState } from 'react';
import { lab } from '../../application/LabController';
import { diagnose, type LayerCheck } from '../../application/diagnose';
import { hostKinds } from '../../simulator/core/types';
import { useUI } from '../../stores/ui';
import { Icon } from '../Icon';

/** The troubleshooting ladder. In troubleshooting / capstone labs and labs without explanations (explain: false) it unlocks only after solving, so learners investigate first. */
export default function DiagnosePanel() {
  useUI(s => s.revision);
  const selected = useUI(s => s.selectedDevice);
  const hosts = lab.network.snapshot().devices.filter(d => hostKinds.includes(d.kind));
  const [source, setSource] = useState(hosts.find(h => h.id === selected)?.id ?? hosts[0]?.id ?? '');
  const [url, setUrl] = useState('https://www.example.com/');
  const [result, setResult] = useState<LayerCheck[]>();
  const locked = !!lab.lab && (lab.lab.kind === 'troubleshooting' || lab.lab.kind === 'capstone' || lab.lab.explain === false) && !lab.completed.has(`lab:${lab.labId}`);
  return <section className="diagnose">
    <div className="section-label"><Icon name="layers" size={17}/> 切り分けラダー（下の層から順に確認）</div>
    <p className="tiny muted">Link → IP → Subnet → ARP → Route → DNS → TCP → TLS → Application の順に確かめ、最初に失敗した段で止まります。各段のコマンドは Terminal でも実行できます。</p>
    {locked ? <div className="hint-box">このラボでは、まず自分でコマンドを使って調べましょう。直してラボを完了すると、答え合わせとしてこの自動診断を使えます。</div> : <>
      <form className="diagnose-form" onSubmit={e => { e.preventDefault(); try { setResult(diagnose(lab.network.snapshot(), source, url)); } catch (err) { useUI.setState({ notice: (err as Error).message }); } }}>
        <label>送信元<select aria-label="診断の送信元" value={source} onChange={e => setSource(e.target.value)}>{hosts.map(h => <option key={h.id}>{h.id}</option>)}</select></label>
        <label>URL<input aria-label="診断するURL" value={url} onChange={e => setUrl(e.target.value)}/></label>
        <button className="button small" disabled={!source}><Icon name="play" size={13}/>診断</button></form>
      {!result && <p className="tiny muted">送信元とURLを選んで「診断」を押すと、どの段で止まるかがわかります。</p>}
      {result && <ol className="ladder">{result.map(c => <li key={c.layer} className={c.ok === undefined ? 'skipped' : c.ok ? 'ok' : 'ng'}>
        <span className="ladder-mark">{c.ok === undefined ? '–' : c.ok ? <Icon name="check" size={14}/> : <Icon name="close" size={14}/>}</span>
        <div><strong>{c.layer}</strong> <span>{c.question}</span><code>{c.command}</code><small>{c.detail}</small></div></li>)}</ol>}
    </>}
  </section>;
}

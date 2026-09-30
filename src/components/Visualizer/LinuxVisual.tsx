import { useMemo, useState } from 'react';
import { dnsScenario } from '../../simulator/scenarios/chapters';
import { diagnose } from '../../application/diagnose';
import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import { Icon } from '../Icon';

export const faults: { id: string; label: string; apply?: (n: NetworkSimulator) => void }[] = [
  { id: 'none', label: '正常' },
  { id: 'nic', label: 'NICがDOWN', apply: n => n.update('PC1', d => { d.interfaces[0].up = false; }) },
  { id: 'gw', label: 'Gatewayの設定ミス', apply: n => n.update('PC1', d => { d.gateway = '192.168.1.254'; }) },
  { id: 'dns', label: 'リゾルバが再帰を拒否', apply: n => n.update('RESOLVER', d => { d.dnsServer!.allowRecursion = ['10.0.0.0/8']; }) },
  { id: 'svc', label: 'Webサーバーが停止', apply: n => n.update('WEB', d => { d.services!.forEach(s => { s.running = false; }); }) },
  { id: 'tls', label: '証明書の名前が違う', apply: n => n.update('WEB', d => { d.services!.find(s => s.tls)!.tls!.names = ['old.example.com']; }) },
];
/** The troubleshooting ladder on a demo network: break one layer and see where the ladder stops. */
export default function LadderDemo() {
  const [fault, setFault] = useState('none');
  const checks = useMemo(() => { const n = dnsScenario(); faults.find(f => f.id === fault)?.apply?.(n); return diagnose(n.snapshot(), 'PC1', 'https://www.example.com/'); }, [fault]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="terminal"/><div><h3>下の層から順に確かめる</h3><p>「Webが見られない」の原因は、どの層にもありえます。1か所だけ壊して、切り分けラダーがどこで止まるかを見てみましょう。</p></div></div>
    <div className="segmented wide">{faults.map(f => <button key={f.id} className={fault === f.id ? 'active' : ''} onClick={() => setFault(f.id)}>{f.label}</button>)}</div>
    <ol className="ladder">{checks.map(c => <li key={c.layer} className={c.ok === undefined ? 'skipped' : c.ok ? 'ok' : 'ng'}><span className="ladder-mark">{c.ok === undefined ? '–' : <Icon name={c.ok ? 'check' : 'close'} size={14}/>}</span>
      <div><strong>{c.layer}</strong> <span>{c.question}</span><code>{c.command}</code><small>{c.detail}</small></div></li>)}</ol>
    <p className="muted tiny">PC1 から https://www.example.com/ を開く想定です。実際の調査では、各段のコマンドの出力から自分で判断します。Troubleshooting Labでは、この自動診断は修復後の答え合わせとしてだけ使えます。</p></div>;
}

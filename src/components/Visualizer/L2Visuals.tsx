import { useMemo, useReducer, useRef, useState } from 'react';
import { build } from '../../simulator/scenarios/build';
import { vlanScenario } from '../../simulator/scenarios/chapters';
import type { SimulationEvent } from '../../simulator/core/types';
import { Icon } from '../Icon';

const lan = () => build([
  { id: 'PC1', kind: 'pc', at: [0, 0], ip: { eth0: '192.168.1.11/24' } },
  { id: 'PC2', kind: 'pc', at: [0, 0], ip: { eth0: '192.168.1.12/24' } },
  { id: 'PC3', kind: 'pc', at: [0, 0], ip: { eth0: '192.168.1.13/24' } },
  { id: 'SW1', kind: 'switch', at: [0, 0] },
], [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['PC3', 'eth0', 'SW1', 'g0/3']]);
/** MAC learning, flooding and forwarding, step by step on one switch. */
export function SwitchLearning() {
  const net = useRef(lan()); const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [log, setLog] = useState<{ title: string; events: SimulationEvent[] }>();
  const snap = net.current.snapshot();
  const owner = new Map(snap.devices.flatMap(d => d.interfaces.map(i => [i.mac, d.id] as const)));
  const sw = snap.devices.find(d => d.id === 'SW1')!;
  const ping = (a: string, b: string) => { const r = net.current.ping(a, `192.168.1.1${b.slice(-1)}`); setLog({ title: `${a} → ${b} ping`, events: r.events.filter(e => e.deviceId === 'SW1' && (e.type === 'MAC_LEARNED' || e.type === 'MAC_LOOKUP')) }); refresh(); };
  return <div className="visual-card"><div className="tool-heading"><Icon name="switch"/><div><h3>スイッチはMACアドレスを覚えて転送する</h3><p>受信したフレームの<strong>送信元MAC</strong>を覚え、<strong>宛先MAC</strong>が表にあればそのポートへ、なければ受信したポート以外のすべてへ（フラッディング）送ります。ボタンでpingを送り、MACアドレステーブルとSW1の判断を見比べましょう。</p></div></div>
    <div className="quiz-actions">{[['PC1', 'PC3'], ['PC2', 'PC1'], ['PC3', 'PC2']].map(([a, b]) => <button key={a} className="button small secondary" onClick={() => ping(a, b)}>{a} → {b} に ping</button>)}
      <button className="button small secondary" onClick={() => { net.current.clearMacTable(); net.current.clearArp(); setLog(undefined); refresh(); }}><Icon name="reset" size={13}/>表をクリア</button></div>
    <div className="two-col"><div><h4>SW1 のMACアドレステーブル</h4><table className="mini-table"><thead><tr><th>VLAN</th><th>MAC</th><th>ポート</th><th>（持ち主）</th></tr></thead><tbody>{(sw.macTable ?? []).map(m => <tr key={m.mac}><td>{m.vlan}</td><td><code>{m.mac}</code></td><td>{m.port}</td><td>{owner.get(m.mac)}</td></tr>)}</tbody></table>{!sw.macTable?.length && <p className="muted tiny">空です。上のボタンでpingを送ると、学習したMACアドレスが入ります。</p>}</div>
      <div><h4>{log ? `${log.title}：SW1の判断` : 'SW1の判断'}</h4><ol className="event-steps">{log?.events.map(e => <li key={e.id} className={e.type === 'MAC_LEARNED' ? 'learn' : e.message.includes('フラッディング') ? 'flood' : 'fwd'}><strong>{e.type === 'MAC_LEARNED' ? '学習' : '転送判断'}</strong> {e.message}</li>)}</ol>
        {log && <p className="tiny">最初のARP要求は宛先 ff:ff:ff:ff:ff:ff（ブロードキャスト）なので必ずフラッディングされます。応答やその後のpingは学習済みのポートへだけ届きます。</p>}</div></div>
    <p className="muted tiny">エージング時間（覚えたMACを消すまでの時間）は、Ciscoの既定値と同じ300秒です（シミュレータ内の時間）。「表をクリア」はMACアドレステーブルとARPキャッシュを消します。</p></div>;
}
/** A broadcast reaches only the same VLAN; VLANs split one switch into several broadcast domains. */
export function BroadcastDomains() {
  const [source, setSource] = useState('PC1'); const [pc3vlan, setPc3vlan] = useState(10);
  const reached = useMemo(() => {
    const n = vlanScenario();
    n.update('SW2', d => { d.interfaces.find(i => i.id === 'g0/1')!.switchport!.accessVlan = pc3vlan; });
    return n.broadcastDomain(source, 'eth0');
  }, [source, pc3vlan]);
  const vlanOf: Record<string, number> = { PC1: 10, PC2: 20, PC3: pc3vlan, PC4: 20 };
  return <div className="visual-card"><div className="tool-heading"><Icon name="layers"/><div><h3>ブロードキャストはどこまで届く？</h3><p>2台のスイッチをTrunkでつなぎ、VLAN 10（SALES）と VLAN 20（DEV）に分けています。送信元を選ぶと、そのブロードキャストを受け取る機器が光ります。PC3のVLANを変えると、届く範囲も変わります。</p></div></div>
    <div className="inline-form"><label>送信元<select aria-label="ブロードキャストの送信元" value={source} onChange={e => setSource(e.target.value)}>{['PC1', 'PC2', 'PC3', 'PC4'].map(p => <option key={p}>{p}</option>)}</select></label>
      <label>SW2 g0/1（PC3）のアクセスVLAN<select aria-label="PC3のVLAN" value={pc3vlan} onChange={e => setPc3vlan(Number(e.target.value))}><option value={10}>10</option><option value={20}>20</option></select></label></div>
    <div className="domain-map">{['PC1', 'PC2', 'PC3', 'PC4'].map(p => <div key={p} className={`domain-node vlan-${vlanOf[p]} ${p === source ? 'source' : reached.some(r => r.device === p) ? 'hit' : ''}`}><Icon name="pc" size={22}/><strong>{p}</strong><small>VLAN {vlanOf[p]}</small></div>)}
      <div className={`domain-node router ${reached.some(r => r.device === 'R1') ? 'hit' : ''}`}><Icon name="router" size={22}/><strong>R1</strong><small>{reached.filter(r => r.device === 'R1').map(r => r.interface).join(', ') || '—'}</small></div></div>
    <p className="tiny">届いた先: {reached.map(r => `${r.device}（${r.interface}）`).join('、') || 'なし'}</p>
    <p className="muted tiny">別のVLANへはルータ（R1のサブインターフェース）を通るしかありません。ルータはブロードキャストを転送しないので、VLANの数だけブロードキャストドメインがあります。</p></div>;
}

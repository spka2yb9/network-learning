import { useMemo, useState } from 'react';
import { ospfScenario } from '../../simulator/scenarios/chapters';
import { longestPrefixMatch } from '../../simulator/l3/RoutingTable';
import { cidr, contains, isIpv4 } from '../../simulator/l3/ipv4';
import type { Route } from '../../simulator/core/types';
import { Icon } from '../Icon';

const code: Record<Route['kind'], string> = { connected: 'C', static: 'S', ospf: 'O', bgp: 'B' };
const sample: Route[] = [
  { kind: 'connected', destination: '192.168.1.0/24', interfaceId: 'g0/0', preference: 0, metric: 0 },
  { kind: 'connected', destination: '10.0.0.0/30', interfaceId: 'g0/1', preference: 0, metric: 0 },
  { kind: 'connected', destination: '10.0.0.4/30', interfaceId: 'g0/2', preference: 0, metric: 0 },
  { kind: 'static', destination: '10.0.0.0/8', nextHop: '10.0.0.2', preference: 1, metric: 0 },
  { kind: 'static', destination: '10.1.0.0/16', nextHop: '10.0.0.2', preference: 1, metric: 0 },
  { kind: 'ospf', destination: '10.1.2.0/24', nextHop: '10.0.0.2', preference: 110, metric: 20 },
  { kind: 'static', destination: '10.1.2.0/24', nextHop: '10.0.0.6', preference: 1, metric: 0 },
  { kind: 'static', destination: '0.0.0.0/0', nextHop: '10.0.0.2', preference: 1, metric: 0 },
];
/** Longest prefix match, then administrative distance, then metric — computed by the same function the simulator uses. */
export function RouteLookup() {
  const [dst, setDst] = useState('10.1.2.5');
  const valid = isIpv4(dst);
  const winner = valid ? longestPrefixMatch(sample, dst) : undefined;
  const status = (r: Route) => {
    if (!valid || !contains(r.destination, dst)) return ['miss', '一致しない'];
    if (r === winner) return ['win', '採用'];
    const p = cidr(r.destination).prefix; const w = cidr(winner!.destination).prefix;
    return p < w ? ['lose', `一致するが /${p} は /${w} より短い`] : ['lose', `同じ /${p}。ADが大きい（${r.preference} > ${winner!.preference}）`];
  };
  return <div className="visual-card"><div className="tool-heading"><Icon name="router"/><div><h3>ルーティングテーブルを引いてみる</h3><p>あるルータの経路表（サンプル）です。宛先に一致する経路のうち、①プレフィックスが最も長いもの ②同じならAD（情報源の信頼度）が小さいもの ③それも同じならメトリックが小さいもの、が選ばれます。下のボタンで宛先を変えて、「判定」の列を見比べましょう。</p></div></div>
    <div className="inline-form"><label>宛先IP<input aria-label="経路検索の宛先" value={dst} onChange={e => setDst(e.target.value.trim())}/></label>
      <div className="segmented">{['10.1.2.5', '10.1.9.9', '10.200.0.1', '192.168.1.20', '8.8.8.8'].map(v => <button key={v} className={dst === v ? 'active' : ''} onClick={() => setDst(v)}>{v}</button>)}</div></div>
    {!valid && <p className="error-text">IPv4アドレスを入力してください</p>}
    <table className="mini-table route-lookup"><thead><tr><th/><th>宛先</th><th>[AD/メトリック]</th><th>Next Hop（次に渡す先）</th><th>判定</th></tr></thead>
      <tbody>{sample.map((r, i) => { const [cls, text] = status(r); return <tr key={i} className={cls}><td>{code[r.kind]}</td><td><code>{r.destination}</code></td><td>[{r.preference}/{r.metric}]</td><td>{r.nextHop ? `via ${r.nextHop}` : `直結 ${r.interfaceId}`}</td><td>{text}</td></tr>; })}</tbody></table>
    <p className="tiny">{winner ? `→ ${dst} は ${winner.destination} ${winner.nextHop ? `via ${winner.nextHop}` : `（直結 ${winner.interfaceId}）`} へ送られます。` : valid ? '→ 一致する経路がないため破棄し、ICMP Destination Unreachable を返します。' : ''}</p>
    <p className="muted tiny">AD（Administrative Distance：小さいほど優先）の値は、Cisco IOSの既定値です。直結0・静的1・eBGP 20・OSPF 110・iBGP 200。</p></div>;
}
/** Link-state: every router has the same map (LSDB) and computes its own shortest-path tree. */
export function SpfView() {
  const [r1r2, setR1r2] = useState(true); const [cost, setCost] = useState(1);
  const data = useMemo(() => {
    const n = ospfScenario();
    n.update('R1', d => { d.interfaces.find(i => i.id === 'g0/0')!.ospfCost = cost; });
    n.setLinkState('link-2', r1r2);
    const o = n.ospf()!;
    const hops = n.traceroute('PC1', '192.168.3.10').map(p => p.address ?? '*');
    return { spf: o.spf.get('R1') ?? [], routes: n.installed('R1').filter(r => r.destination === '192.168.3.0/24'), neighbors: o.neighbors.filter(x => x.device === 'R1'), hops };
  }, [r1r2, cost]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="network"/><div><h3>OSPF：地図を共有して、最短経路を自分で計算</h3><p>4台のルータ（R1〜R4）を四角形につないだ構成です。各ルータは同じ地図（LSDB）を持ち、自分から見た最短経路を計算します（SPF）。R1–R2のリンクを切ったりコストを上げたりして、R1の経路とtracerouteの結果がどう変わるか確かめましょう。</p></div></div>
    <div className="inline-form"><label className="toggle"><input type="checkbox" checked={r1r2} onChange={e => setR1r2(e.target.checked)}/>R1–R2 リンク Up</label>
      <label>R1 g0/0（R2向き）のコスト {cost}<input aria-label="R1 g0/0 のOSPFコスト" type="range" min={1} max={20} value={cost} onChange={e => setCost(Number(e.target.value))}/></label></div>
    <div className="two-col"><div><h4>R1 のネイバー（隣接ルータ）</h4><ul className="plain">{data.neighbors.map(x => <li key={x.interfaceId}>{x.neighborDevice}（{x.neighborId}）via {x.interfaceId} — {x.state}</li>)}</ul>
      <h4>R1 のSPFツリー（R1から各ルータへの最短経路）</h4><table className="mini-table"><thead><tr><th>ルータ</th><th>コスト</th><th>経路</th></tr></thead><tbody>{data.spf.map(s => <tr key={s.routerId}><td>{s.device}</td><td>{s.cost}</td><td>{s.path.join(' → ')}</td></tr>)}</tbody></table></div>
      <div><h4>R1: 192.168.3.0/24 への経路</h4><ul className="plain">{data.routes.map((r, i) => <li key={i}><code>O {r.destination} [{r.preference}/{r.metric}] via {r.nextHop}</code></li>)}</ul><p className="tiny">コストが等しい経路が複数ある場合、実機のOSPFは複数を同時に使います（ECMP）。このシミュレータは1本だけを選びます。</p>
        <h4>traceroute PC1 → PC3</h4><ol className="plain">{data.hops.map((h, i) => <li key={i}>{h}</li>)}</ol></div></div>
    <p className="muted tiny">教育用の簡略化: 単一エリアのSPFを定常状態で計算します。Hello/DeadタイマーやDR選出、LSAの種類ごとの動作は再現していません。</p></div>;
}

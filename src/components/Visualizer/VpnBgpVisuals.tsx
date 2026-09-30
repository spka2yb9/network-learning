import { useMemo, useState } from 'react';
import { bgpScenario, vpnScenario } from '../../simulator/scenarios/chapters';
import { decodeFrame } from '../../simulator/capture/decode';
import { Icon } from '../Icon';

/** The same ping inside a GRE or an IPsec tunnel, seen on the Internet link. */
export function TunnelCapture() {
  const [mode, setMode] = useState<'ipsec' | 'gre'>('ipsec');
  const data = useMemo(() => {
    const n = vpnScenario('static');
    for (const id of ['CGW', 'VGW1']) n.update(id, d => { d.interfaces.find(i => i.kind === 'tunnel')!.tunnel!.mode = mode; });
    const r = n.ping('PC1', '10.0.1.10');
    // Skip ARP: show the first tunnelled packet on the Internet link and the original ping on the LAN.
    return { ok: r.success, first: r.captures.find(c => c.linkId === 'link-2' && (c.protocol === 'ESP' || c.info.startsWith('GRE'))), lan: r.captures.find(c => c.linkId === 'link-1' && c.protocol === 'ICMP') };
  }, [mode]);
  const layers = data.first ? decodeFrame(data.first.bytes).layers : [];
  return <div className="visual-card"><div className="tool-heading"><Icon name="lock"/><div><h3>トンネルの中身は、外から見える？</h3><p>PC1 から VPC内の EC2（10.0.1.10）へ ping。インターネット区間（CGW–INET）でキャプチャしたパケットです。ボタンで IPsec と GRE を切り替えて、中身の見え方を比べましょう。</p></div>
    <div className="segmented"><button className={mode === 'ipsec' ? 'active' : ''} onClick={() => setMode('ipsec')}>IPsec（ESP）</button><button className={mode === 'gre' ? 'active' : ''} onClick={() => setMode('gre')}>GRE</button></div></div>
    <div className="two-col"><div><h4>LAN側（PC1–CGW）</h4><p><code>{data.lan?.source} → {data.lan?.destination}</code> {data.lan?.info}</p></div>
      <div><h4>インターネット側（CGW–INET）</h4><p><code>{data.first?.source} → {data.first?.destination}</code> {data.first?.info}</p></div></div>
    <div className="nested">{layers.map((l, i) => <div key={i} className="nest" style={{ marginLeft: i * 14 }}><strong>{l.name}</strong><span>{l.fields.map(f => `${f.label}: ${f.value}`).join(' · ')}</span></div>)}</div>
    <p className="tiny">{mode === 'gre' ? 'GREは包むだけで暗号化しません。外側のIPヘッダの内側に、元のIPv4パケット（10.0.1.10宛て）がそのまま見えます。' : 'ESPでは元のパケットが暗号化され、外から見えるのは外側のIPアドレスとSPIだけです。'} 結果: {data.ok ? '疎通OK' : '失敗'}</p>
    <p className="muted tiny">教育用の簡略化: IKEのネゴシエーションや暗号処理そのものは再現しておらず、ESPのペイロードはダミーのバイト列です。</p></div>;
}
/** BGP best-path selection on R1 for SRV2's prefix. */
export function BgpDecision() {
  const [direct, setDirect] = useState(true); const [lp, setLp] = useState(false);
  const data = useMemo(() => {
    const n = bgpScenario();
    if (lp) n.update('R1', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.13.2')!.localPreference = 200; });
    n.setLinkState('link-2', direct);
    const b = n.bgp()!;
    return { paths: (b.tables.get('R1') ?? []).filter(p => p.prefix === '172.16.2.0/24'), sessions: b.sessions.filter(s => s.device === 'R1'), hops: n.traceroute('PC1', '172.16.2.10').map(p => p.address ?? '*') };
  }, [direct, lp]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="globe"/><div><h3>BGP：どの経路を選ぶ？</h3><p>AS65001（R1）から AS65002 の 172.16.2.0/24 へは、直接と AS65003 経由の2通りがあります。リンクを切ったり LOCAL_PREF を変えたりして、ベストパス（*&gt;、実際に使う経路）とその理由がどう変わるか見ましょう。</p></div></div>
    <div className="inline-form"><label className="toggle"><input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)}/>R1–R2 リンク Up</label><label className="toggle"><input type="checkbox" checked={lp} onChange={e => setLp(e.target.checked)}/>R3 から受けた経路に LOCAL_PREF 200</label></div>
    <h4>R1 のBGPセッション</h4><ul className="plain">{data.sessions.map(s => <li key={s.neighbor}>{s.neighbor}（AS{s.remoteAs}, {s.type}）— {s.state}{s.reason ? `：${s.reason}` : ''}</li>)}</ul>
    <h4>R1 のBGPテーブル: 172.16.2.0/24</h4><table className="mini-table"><thead><tr><th/><th>Next Hop</th><th>LocPrf</th><th>MED</th><th>AS_PATH</th><th>理由</th></tr></thead>
      <tbody>{data.paths.map((p, i) => <tr key={i} className={p.best ? 'win' : 'lose'}><td>{p.best ? '*>' : p.valid ? '* ' : '  '}</td><td>{p.nextHop}</td><td>{p.localPref}</td><td>{p.med}</td><td>{p.asPath.join(' ')} i</td><td>{p.reason}</td></tr>)}</tbody></table>
    <p className="tiny">traceroute PC1 → SRV2: {data.hops.join(' → ')}</p>
    <p className="muted tiny">実機の選択順（主要部分）: Weight（Cisco独自）→ LOCAL_PREF が大きい → 自身が生成 → AS_PATH が短い → ORIGIN → MED が小さい → eBGP優先 → IGPメトリック → Router ID。このシミュレータは Weight・ORIGIN・IGPメトリックを省略し、タイマーやUPDATEの細かな挙動も簡略化しています。</p></div>;
}

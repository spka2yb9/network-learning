import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { switchingKinds } from '../../simulator/core/types';
import { portKey } from '../../simulator/l2/Stp';
import { installedRoutes } from '../../simulator/l3/RoutingTable';
import { Rows, Section } from './properties/common';

/** Runtime state of the selected device, read from the simulator (never edited here). */
export default function StatePanel() {
  useUI(s => s.revision); const id = useUI(s => s.selectedDevice);
  let d;
  try { d = lab.network.device(id); } catch { return <div className="properties"><div className="empty-state">構成図の機器をクリックすると、その機器の今の状態が表示されます。</div></div>; }
  const now = lab.network.now();
  const stp = switchingKinds.includes(d.kind) ? lab.network.stpState() : undefined;
  const ospf = d.ospf ? lab.network.ospf() : undefined;
  const bgp = d.bgp ? lab.network.bgp() : undefined;
  const sec = (ms: number) => `${Math.max(0, Math.ceil((ms - now) / 1000))}s`;
  return <div className="properties state-panel">
    <p className="muted tiny">シミュレータ内の時計（仮想時刻）: {now} ms。ここは見るだけの画面です。ARPキャッシュなどは通信のたびに更新され、設定を変えるとARPキャッシュとMACアドレステーブルは消去されます。</p>
    <Section title="経路表（実際に使う経路）" count={installedRoutes(d).length}><p className="muted tiny">C＝直結、S＝静的、O＝OSPF、B＝BGP。同じ宛先の経路が複数あるときは、[AD/メトリック] が小さいほうが選ばれます。</p><Rows rows={installedRoutes(d).map((r, _, all) => [r.kind[0].toUpperCase(), r.destination, r.nextHop ?? r.interfaceId ?? '', r.kind === 'connected' ? '' : `[${r.preference}/${r.metric}]${all.filter(x => x.destination === r.destination).length > 1 ? ' ECMP' : ''}`])}/></Section>
    {Object.keys(d.lagStatus ?? {}).length > 0 && <Section title="Port-channel（LAG）" count={Object.keys(d.lagStatus!).length}><p className="muted tiny">P＝束ねて使用中、s＝suspended（条件が合わず使っていない）、D＝down。</p><Rows rows={Object.entries(d.lagStatus!).flatMap(([id, l]) => l.members.map(m => [id, m.port, m.flag, m.flag === 'P' ? `${m.bandwidth} Mbps` : m.reason]))}/></Section>}
    <Section title="ARPキャッシュ（IPとMACの対応の記憶）" count={d.arp.length}><Rows rows={d.arp.map(a => [a.ip, a.mac, a.interfaceId, sec(a.expiresAt)])} empty="空です。通信すると、ARPで調べた結果がここに入ります。"/></Section>
    {switchingKinds.includes(d.kind) && <Section title="MACアドレステーブル（MACとポートの対応）" count={d.macTable?.length ?? 0}><Rows rows={(d.macTable ?? []).map(e => [`VLAN ${e.vlan}`, e.mac, e.port, sec(e.expiresAt)])} empty="空です。フレームを受け取ると、その送信元MACと受信したポートを覚えます。"/></Section>}
    {stp?.bridges.get(d.id) && <Section title="Spanning Tree（STP：ループ防止）" count={stp.bridges.get(d.id)!.isRoot ? 'root' : ''}><p className="tiny">Root Bridge {stp.bridges.get(d.id)!.rootId} / Rootまでのコスト {stp.bridges.get(d.id)!.rootCost}。FWD＝転送中、BLK＝ループを防ぐため止めているポート。</p><Rows rows={d.interfaces.filter(i => stp.ports.has(portKey(d.id, i.id))).map(i => { const p = stp.ports.get(portKey(d.id, i.id))!; return [i.id, p.role, p.forwarding ? 'FWD' : 'BLK', String(p.cost)]; })}/></Section>}
    {(d.natTable?.length ?? 0) > 0 && <Section title="NAT変換テーブル（書き換えの対応表）" count={d.natTable!.length}><Rows rows={d.natTable!.map(e => [e.protocol, `${e.insideLocal}:${e.insideLocalPort}`, '→', `${e.insideGlobal}:${e.insideGlobalPort}`, `${e.outside}:${e.outsidePort}`])}/></Section>}
    {(d.conntrack?.length ?? 0) > 0 && <Section title="接続追跡（conntrack）" count={d.conntrack!.length}><Rows rows={d.conntrack!.map(e => [e.protocol, e.state, `${e.source}:${e.sourcePort}`, `${e.destination}:${e.destinationPort}`, sec(e.expiresAt)])}/></Section>}
    {d.dnsServer && <Section title="DNSキャッシュ" count={d.dnsCache?.length ?? 0}><Rows rows={(d.dnsCache ?? []).map(e => [e.name, e.type, e.negative ?? e.records.map(r => r.value).join(', '), sec(e.expiresAt)])} empty="空です。このサーバーが再帰リゾルバとして名前を調べると、結果がここに記録されます。"/></Section>}
    {Object.keys(d.tunnelStatus ?? {}).length > 0 && <Section title="トンネル"><Rows rows={Object.entries(d.tunnelStatus!).map(([k, v]) => [k, v.up ? 'UP' : 'DOWN', v.reason])}/></Section>}
    {ospf && <Section title="OSPF 隣接" count={ospf.neighbors.filter(x => x.device === d.id).length}><Rows rows={ospf.neighbors.filter(x => x.device === d.id).map(x => [x.neighborDevice, x.neighborId, x.interfaceId, `area ${x.area}`, x.state])} empty="隣接なし。相手とサブネット・エリアが一致しているか確認します（不一致は show logging に表示されます）。"/>
      {ospf.issues.filter(x => x.device === d.id).map(x => <p key={x.message} className="error-text tiny">{x.message}</p>)}</Section>}
    {bgp && <Section title="BGP" count={bgp.sessions.filter(s => s.device === d.id).length}>
      <Rows rows={bgp.sessions.filter(s => s.device === d.id).map(s => [s.neighbor, `AS ${s.remoteAs}`, s.type, s.state, s.reason ?? `${s.received} prefixes`])}/>
      <p className="tiny">BGPテーブル（{bgp.rounds} ラウンドの更新で収束）。*＝有効、&gt;＝ベストパス（実際に使う経路）。</p>
      <Rows rows={(bgp.tables.get(d.id) ?? []).map(p => [`${p.valid ? '*' : ' '}${p.best ? '>' : ' '}`, p.prefix, p.nextHop, `LP ${p.localPref}`, `MED ${p.med}`, p.asPath.join(' ') || 'i', p.reason ?? ''])}/></Section>}
    {(d.sockets?.length ?? 0) > 0 && <Section title="最近のTCP接続" count={d.sockets!.length} open={false}><Rows rows={d.sockets!.map(s => [s.protocol, s.local, s.remote, s.state])}/></Section>}
  </div>;
}

import { Fragment, useState } from 'react';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import type { Packet, SimulationEvent } from '../../simulator/core/types';
import { PacketDetails } from './PacketViewer';
import { Icon } from '../Icon';

export const eventLabels: Record<SimulationEvent['type'], string> = {
  PACKET_CREATED: 'パケットを作成', ROUTE_LOOKUP: '経路を検索', ARP_LOOKUP: 'ARPキャッシュを確認', ARP_REQUEST: 'MACアドレスを問い合わせ（ARP要求）', ARP_REPLY: 'MACアドレスを回答（ARP応答）',
  FRAME_SENT: 'フレームを送信', FRAME_RECEIVED: 'フレームを受信', FRAME_DISCARDED: 'フレームを破棄', MAC_LEARNED: '送信元MACを学習', MAC_LOOKUP: 'スイッチが転送先を決定',
  STP_BLOCKED: 'STPで止めたポートで破棄', BROADCAST_STORM: 'ブロードキャストストーム（L2ループ）', TTL_DECREMENTED: 'TTLを1減らす', NAT_TRANSLATED: 'NATの処理', FIREWALL_ACCEPT: 'フィルタで許可', FIREWALL_DROP: 'フィルタで拒否',
  TUNNEL_ENCAPSULATED: 'トンネル用に包む（カプセル化）', TUNNEL_DECAPSULATED: 'トンネルから取り出す', TCP_STATE: 'TCPの状態が変化', TCP_RETRANSMIT: 'TCPの再送', SOCKET_LOOKUP: '待ち受けポートを確認',
  DNS_QUERY: 'DNSに問い合わせ', DNS_RESPONSE: 'DNSの応答', DNS_CACHE: 'DNSキャッシュを使用', TLS_HANDSHAKE: 'TLSの接続手順（ハンドシェイク）', APP_DATA: 'アプリがデータを受信', PACKET_RECEIVED: '宛先に到着', PACKET_DROPPED: 'パケットを破棄',
};
const failed = (t: SimulationEvent['type']) => t === 'PACKET_DROPPED' || t === 'FIREWALL_DROP' || t === 'BROADCAST_STORM' || t === 'STP_BLOCKED' || t === 'FRAME_DISCARDED';
export function describePacket(p: Packet): string {
  if (p.protocol === 'ICMP') return `ICMP ${p.type}${p.type === 'unreachable' ? ` code ${p.code ?? 0}` : ''}`;
  if (p.protocol === 'TCP') return `TCP ${p.sourcePort} → ${p.destinationPort} [${p.flags.join(', ')}]${p.payload ? ` ${p.payload.kind.toUpperCase()}` : ''}`;
  if (p.protocol === 'UDP') return `UDP ${p.sourcePort} → ${p.destinationPort}${p.payload?.kind === 'dns' ? ` DNS ${p.payload.message.response ? 'response' : 'query'} ${p.payload.message.question.name}` : ''}`;
  return `${p.protocol}（内側: ${describePacket(p.inner)}）`;
}
export function EventList() {
  useUI(s => s.revision);
  const selected = useUI(s => s.selectedEvent);
  const [hide, setHide] = useState(false);
  const events = lab.result?.events ?? [];
  return <div className="event-list">
    {events.length > 0 && <label className="legend-toggle event-filter"><input type="checkbox" checked={hide} onChange={e => setHide(e.target.checked)}/>L2の細かいイベント（MACの学習・スイッチの転送判断・フレームの破棄）を隠す</label>}
    {events.map((e, index) => (hide && ['MAC_LEARNED', 'MAC_LOOKUP', 'FRAME_DISCARDED'].includes(e.type)) ? null : <button className={`event-row ${selected === index ? 'selected' : ''} ${failed(e.type) ? 'failed' : ''}`} key={e.id} onClick={() => useUI.setState({ selectedEvent: index, inspectorTab: 'debug' })}><span className="event-number">{String(index + 1).padStart(2, '0')}</span><span className="event-device">{e.deviceId}</span><div><strong>{eventLabels[e.type]}</strong><span>{e.message}</span></div><span className="event-time">{e.time} ms</span></button>)}
    {!events.length && <div className="empty-state">SEND バーや Terminal で ping・curl・dig などを実行すると、起きたことが順番にここに記録されます。</div>}</div>;
}
/** One row per wire transmission of an IP packet: what changed on each hop. */
function HopTable() {
  const selected = useUI(s => s.selectedEvent);
  const events = lab.result?.events ?? [];
  const hops = events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'FRAME_SENT' && e.packet);
  if (!hops.length) return <p className="muted tiny">IPパケットを運ぶフレームの送信がありません（ARPだけの通信など）。ping などを実行してください。</p>;
  let prev: SimulationEvent | undefined;
  return <div className="hop-table-wrap"><table className="hop-table"><thead><tr><th>#</th><th>送信機器</th><th>送信元MAC</th><th>宛先MAC</th><th>VLAN</th><th>送信元IP</th><th>宛先IP</th><th>TTL</th><th>内容</th></tr></thead><tbody>
    {hops.map(({ e, i }) => {
      const same = prev?.packet && e.packet && prev.packet.id === e.packet.id;
      const cell = (value: string | number | undefined, before: string | number | undefined) => <td className={same && value !== before ? 'changed' : ''}>{value ?? '—'}</td>;
      const row = <tr key={e.id} className={i === selected ? 'selected' : ''} onClick={() => useUI.setState({ selectedEvent: i })}>
        <td>{i + 1}</td><td>{e.deviceId} {e.interfaceId}</td>{cell(e.sourceMac, prev?.sourceMac)}{cell(e.destinationMac, prev?.destinationMac)}{cell(e.vlan, prev?.vlan)}
        {cell(e.packet!.source, prev?.packet?.source)}{cell(e.packet!.destination, prev?.packet?.destination)}{cell(e.packet!.ttl, prev?.packet?.ttl)}<td>{describePacket(e.packet!)}</td></tr>;
      prev = e; return row;
    })}</tbody></table><p className="muted tiny">色付きのセルは、同じパケットの1つ前のホップから変わった値です。MACアドレスはルータを通るたびに付け替えられ、TTLは1ずつ減ります。IPアドレスは、NATを通らなければ変わりません。</p></div>;
}
function PacketFields({ p }: { p: Packet }) {
  const rows: [string, string | number][] = [['Source IP', p.source], ['Destination IP', p.destination], ['TTL', p.ttl], ['Protocol', p.protocol]];
  if (p.protocol === 'ICMP') rows.push(['ICMP', `${p.type}${p.code !== undefined ? ` (code ${p.code})` : ''}`]);
  if (p.protocol === 'TCP') rows.push(['Ports', `${p.sourcePort} → ${p.destinationPort}`], ['Flags', p.flags.join(', ')], ['Seq / Ack', `${p.seq} / ${p.ack}`]);
  if (p.protocol === 'UDP') rows.push(['Ports', `${p.sourcePort} → ${p.destinationPort}`]);
  if ((p.protocol === 'TCP' || p.protocol === 'UDP') && p.payload) {
    if (p.payload.kind === 'dns') { const m = p.payload.message; rows.push(['DNS', `${m.response ? `response ${m.rcode}` : 'query'} ${m.question.name} ${m.question.type}`]); if (m.answer.length) rows.push(['Answer', m.answer.map(a => `${a.type} ${a.value}`).join(', ')]); }
    else if (p.payload.kind === 'tls') rows.push(['TLS', `${p.payload.record}${p.payload.sni ? ` SNI=${p.payload.sni}` : ''}`], ['（暗号化された中身・教育用表示）', p.payload.detail.split('\r\n')[0]]);
    else rows.push([p.payload.kind.toUpperCase(), p.payload.text.split('\r\n')[0]]);
  }
  if (p.protocol === 'ESP' || p.protocol === 'GRE') rows.push(['外側', `${p.source} → ${p.destination}`], ['内側', `${p.inner.source} → ${p.inner.destination} ${describePacket(p.inner)}`]);
  return <dl className="packet-summary">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}
export default function PacketDebugger() {
  useUI(s => s.revision);
  const selected = useUI(s => s.selectedEvent);
  const [view, setView] = useState<'step' | 'hops'>('step');
  const result = lab.result; const event = result?.events[selected];
  const capture = result?.captures.find(c => c.id === event?.captureId);
  return <section className="debugger"><div className="section-label"><Icon name="packet" size={17}/> PACKET DEBUGGER{result?.title && <span className="debug-title">{result.title}</span>}</div>
    {event && result ? <>
      <div className="segmented" role="tablist"><button className={view === 'step' ? 'active' : ''} title="イベントを1つずつ見る" onClick={() => setView('step')}>Step</button><button className={view === 'hops' ? 'active' : ''} title="ホップごとのMAC・IP・TTLの変化を表で比べる" onClick={() => setView('hops')}>Hop</button></div>
      {view === 'hops' ? <HopTable/> : <>
        <div className="debugger-controls"><button className="icon-button" aria-label="前のイベント" disabled={selected === 0} onClick={() => useUI.setState({ selectedEvent: selected - 1 })}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }}/></button><span>STEP <b>{String(selected + 1).padStart(2, '0')}</b> / {result.events.length}</span><button className="icon-button" aria-label="次のイベント" disabled={selected >= result.events.length - 1} onClick={() => useUI.setState({ selectedEvent: selected + 1 })}><Icon name="step"/></button>
          <button className="icon-button" aria-label="次のホップ" title="次にフレームを送信したイベントへ進む" onClick={() => { const next = result.events.findIndex((e, i) => i > selected && e.type === 'FRAME_SENT'); if (next >= 0) useUI.setState({ selectedEvent: next }); }}><Icon name="arrow"/></button></div>
        <input className="step-range" type="range" aria-label="イベント位置" min={0} max={result.events.length - 1} value={selected} onChange={e => useUI.setState({ selectedEvent: Number(e.target.value) })}/>
        <div className={`event-focus ${failed(event.type) ? 'failed' : ''}`}><span className="eyebrow">{event.deviceId} · {event.type}</span><h3>{eventLabels[event.type]}</h3><p>{event.message}</p>
          {event.rule && <p className="rule-hit"><Icon name="shield" size={14}/> {event.rule}</p>}{event.before && <p className="rule-hit">{event.before} → {event.after}</p>}</div>
        {event.packet && <PacketFields p={event.packet}/>}
        {event.route && <div className="route-match"><span>選ばれた経路</span><code>{event.route.destination}</code><small>{event.route.nextHop ?? '直結（Next Hopなし）'} · {event.route.kind}</small></div>}
        {capture && <PacketDetails capture={capture}/>}
      </>}
      <p className="tiny muted">記録した通信を再生しています（ネットワークを一時停止しているわけではありません）。設定を変えたら、もう一度通信を実行してください。</p>
    </> : <div className="debugger-empty"><div className="empty-orbit"><Icon name="packet" size={30}/></div><h3>パケットの旅を、ひとつずつ。</h3><p>構成図の下の SEND バーで送信元と宛先を選び、ping などを実行してください。ARP・スイッチの転送・経路の選択・TTL・NAT・Firewallの判定を、1ステップずつ追えます。</p></div>}
  </section>;
}

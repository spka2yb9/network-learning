import { useMemo, useState } from 'react';
import { dnsScenario, firewallScenario } from '../../simulator/scenarios/chapters';
import { decodeFrame } from '../../simulator/capture/decode';
import type { Capture, TcpPacket } from '../../simulator/core/types';
import { Icon } from '../Icon';

const phase = (c: Capture) => c.protocol === 'ARP' ? 'ARP' : c.protocol === 'DNS' ? 'DNS' : c.protocol === 'TLS' ? 'TLS' : c.protocol === 'HTTP' ? 'HTTP' : c.info.includes('[SYN') ? 'TCP接続' : c.info.includes('FIN') ? 'TCP終了' : 'TCP';
/** "What happens when you open a web page": every packet PC1 sends or receives, grouped by phase; click to open the nested layers. */
export function LayerExplorer() {
  const [secure, setSecure] = useState(true);
  const data = useMemo(() => {
    const n = dnsScenario();
    const link = n.snapshot().links.find(l => l.sourceDevice === 'PC1')!.id;
    const r = n.http('PC1', secure ? 'https://www.example.com/' : 'http://www.example.com/');
    return { captures: r.captures.filter(c => c.linkId === link), status: r.status };
  }, [secure]);
  const [selected, setSelected] = useState(0);
  const c = data.captures[selected] ?? data.captures[0];
  const layers = c ? decodeFrame(c.bytes).layers : [];
  const tls = c?.packet?.protocol === 'TCP' ? (c.packet as TcpPacket).payload : undefined;
  return <div className="visual-card"><div className="tool-heading"><Icon name="layers"/><div><h3>Webページを開くと、何が流れる？</h3><p>シミュレータで PC1 から <code>curl {secure ? 'https' : 'http'}://www.example.com/</code> を実行し、PC1のケーブルを通ったパケットを順に並べました。番号のボタンを押すと、そのパケットの中身が外側から順に表示されます。</p></div>
    <div className="segmented"><button className={secure ? 'active' : ''} onClick={() => { setSecure(true); setSelected(0); }}>HTTPS</button><button className={!secure ? 'active' : ''} onClick={() => { setSecure(false); setSelected(0); }}>HTTP</button></div></div>
    <div className="layer-stack">{[['Browser', 'URLから、相手の名前とポート番号（HTTPSは443、HTTPは80）を決める'], ['DNS', '名前からIPアドレスを調べる（UDP 53番）'], ['TCP', '3-way handshakeで接続'], ...(secure ? [['TLS', 'ClientHello（接続先の名前＝SNIを含む）→ 以降は暗号化']] : []), ['HTTP', 'GET / → 200 OK'], ['IP', 'すべてのメッセージはIPパケットで運ばれる'], ['Ethernet', 'ルータを通るたびに、MACアドレスを付け替えて運ぶ']].map(([k, v]) => <div key={k} className={`layer-chip l-${k}`}><strong>{k}</strong><span>{v}</span></div>)}</div>
    <div className="packet-strip">{data.captures.map((p, i) => <button key={p.id} className={`pkt ph-${phase(p).replace(/[^A-Za-z]/g, '') || 'TCP'} ${i === selected ? 'active' : ''}`} onClick={() => setSelected(i)} title={p.info}><span>{i + 1}</span>{phase(p)}</button>)}</div>
    {c && <div className="nested">{layers.map((l, i) => <div key={i} className="nest" style={{ marginLeft: i * 14 }}><strong>{l.name}</strong><span>{l.fields.slice(0, 4).map(f => `${f.label}: ${f.value}`).join(' · ')}</span></div>)}
      {tls?.kind === 'tls' && <div className="nest decrypted" style={{ marginLeft: layers.length * 14 }}><strong>（中身・教育用に表示）</strong><span>{tls.detail.split('\r\n')[0]}</span><small>実際のキャプチャでは暗号化されて見えません</small></div>}</div>}
    <p className="muted tiny">1つのパケットが DNS → TCP → TLS → HTTP と変身するのではありません。それぞれ別のパケットで、どれを開いても外側から Ethernet → IP → TCP/UDP → 中身 の順に入っています。{data.status ? ` 結果: HTTP ${data.status}` : ''}</p>
  </div>;
}
export function HandshakeTimeline() {
  const [mode, setMode] = useState<'ok' | 'rst' | 'drop'>('ok');
  const rows = useMemo(() => {
    const r = mode === 'ok' ? dnsScenario().http('PC1', 'http://203.0.113.80/') : mode === 'rst' ? dnsScenario().tcpConnect('PC1', '203.0.113.80', 8080) : firewallScenario(false).tcpConnect('PC1', '10.0.2.80', 443);
    const client = mode === 'drop' ? '10.0.1.10' : '192.168.1.10';
    const created = r.events.filter(e => e.type === 'PACKET_CREATED' && e.packet?.protocol === 'TCP').map(e => ({ p: e.packet as TcpPacket, time: e.time }));
    const isn = { c: created.find(x => x.p.source === client)?.p.seq ?? 0, s: created.find(x => x.p.source !== client)?.p.seq ?? 0 };
    return { rows: created.map(({ p, time }) => { const fromClient = p.source === client; const rel = (n: number, base: number) => ((n - base) >>> 0); return { fromClient, time, flags: p.flags.join(', '), seq: rel(p.seq, fromClient ? isn.c : isn.s), ack: p.flags.includes('ACK') ? rel(p.ack, fromClient ? isn.s : isn.c) : undefined, len: p.payload ? (p.payload.kind === 'http' || p.payload.kind === 'data' ? new TextEncoder().encode(p.payload.text).length : 0) : 0, note: p.payload?.kind === 'http' ? p.payload.text.split('\r\n')[0] : '' }; }), result: r.reason };
  }, [mode]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="clock"/><div><h3>TCPのやり取りをタイムラインで</h3><p>seq・ackは、最初の番号を0とした相対値です（Wiresharkの relative sequence number と同じ）。ボタンで3つの場面を切り替えて、やり取りの違いを比べましょう。</p></div>
    <div className="segmented"><button className={mode === 'ok' ? 'active' : ''} onClick={() => setMode('ok')}>正常（HTTP）</button><button className={mode === 'rst' ? 'active' : ''} onClick={() => setMode('rst')}>ポートが閉じている</button><button className={mode === 'drop' ? 'active' : ''} onClick={() => setMode('drop')}>途中で破棄</button></div></div>
    <div className="timeline"><div className="timeline-head"><span>クライアント</span><span>サーバー</span></div>
      {rows.rows.map((r, i) => <div key={i} className={`t-row ${r.fromClient ? 'right' : 'left'}`}><span className="t-time">{r.time}ms</span><div className="t-arrow"><strong>{r.flags}</strong><small>seq={r.seq}{r.ack !== undefined ? ` ack=${r.ack}` : ''}{r.len ? ` len=${r.len}` : ''}</small>{r.note && <em>{r.note}</em>}</div></div>)}</div>
    <p className="muted tiny">結果: {rows.result}。{mode === 'drop' ? '返事がないため、待ち時間を延ばしながらSYNを再送しています（シミュレータ内の時間。実際のOSはもっと多く再送します）。' : mode === 'rst' ? 'SYNに対してRSTが返り、すぐに「Connection refused」になります。' : 'SYN → SYN, ACK → ACK の後にデータ、最後にFINで終了します。'}</p></div>;
}

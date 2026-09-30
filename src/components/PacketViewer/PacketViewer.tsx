import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { lab } from '../../application/LabController';
import { packetFilter } from '../../simulator/capture/PacketFilter';
import { decodeFrame, type Field } from '../../simulator/capture/decode';
import { writePcap } from '../../simulator/capture/pcap';
import type { Capture, CaptureSummary } from '../../simulator/core/types';
import { useUI } from '../../stores/ui';
import { Icon } from '../Icon';

/** A row of the packet list: a simulator capture or a frame imported from a PCAP file. */
export type PacketRow = CaptureSummary & { id: number; time: number; bytes: number[]; interfaceId?: string; deviceId?: string; packet?: Capture['packet'] };

function Hex({ bytes, range }: { bytes: number[]; range?: [number, number] }) {
  const rows: ReactElement[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    rows.push(<div key={i} className="hex-row"><span className="hex-offset">{i.toString(16).padStart(4, '0')}</span>
      <span className="hex-bytes">{chunk.map((b, j) => <span key={j} className={range && i + j >= range[0] && i + j < range[0] + range[1] ? 'hl' : ''}>{b.toString(16).padStart(2, '0')}</span>)}</span>
      <span className="hex-ascii">{chunk.map((b, j) => <span key={j} className={range && i + j >= range[0] && i + j < range[0] + range[1] ? 'hl' : ''}>{b >= 32 && b < 127 ? String.fromCharCode(b) : '.'}</span>)}</span></div>);
  }
  return <div className="hex">{rows}</div>;
}
export function PacketDetails({ capture }: { capture: { bytes: number[]; packet?: Capture['packet'] } }) {
  const decoded = useMemo(() => decodeFrame(capture.bytes), [capture]);
  const [field, setField] = useState<Field>();
  const tls = capture.packet && (capture.packet.protocol === 'TCP') && capture.packet.payload?.kind === 'tls' ? capture.packet.payload : undefined;
  return <div className="packet-details">
    {decoded.layers.map((l, i) => <details key={`${l.name}-${i}`} open={i < 5}><summary onMouseEnter={() => setField({ label: l.name, value: '', offset: l.offset, length: l.length })}>{l.name}{i === 0 && <small> {capture.bytes.length} bytes</small>}</summary>
      <dl>{l.fields.map((f, j) => <div key={j} className={`field-row ${field === f ? 'active' : ''}`} onMouseEnter={() => setField(f)} onClick={() => setField(f)}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl></details>)}
    {tls && <p className="tls-note"><Icon name="lock" size={14}/> シミュレータが保持する内容（実際のキャプチャでは暗号化されて見えません）: {tls.detail.split('\r\n')[0]}</p>}
    <details open><summary>Hex dump <small>項目にカーソルを合わせると、対応するバイトが強調されます</small></summary><Hex bytes={capture.bytes} range={field && field.length ? [field.offset, field.length] : undefined}/>
      <p className="muted tiny">FCS（末尾の誤り検出用の値）とプリアンブルは含みません。IPv4・ICMP・TCP・UDPのチェックサムは計算済みです。</p></details>
  </div>;
}
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export default function PacketViewer({ rows: source, title }: { rows?: PacketRow[]; title?: string }) {
  const revision = useUI(s => s.revision);
  const [filter, setFilter] = useState(''); const [selected, setSelected] = useState<number>();
  const rows = source ?? lab.cli.captures;
  // Different packets (another file or case): the old filter and row number no longer apply.
  useEffect(() => { setFilter(''); setSelected(undefined); }, [source]);
  const filtered = useMemo(() => {
    try { return { rows: rows.filter(packetFilter(filter)), error: '' }; }
    catch (error) { return { rows: [], error: (error as Error).message }; }
  }, [filter, revision, rows]);
  const capture = filtered.rows.find(c => c.id === selected) ?? filtered.rows.at(-1);
  const t0 = rows[0]?.time ?? 0;
  return <div className="capture-view"><div className="filter-bar"><Icon name="packet" size={16}/><input aria-label="パケットフィルタ" title="tcpdump に近い書き方（一部に対応）で、表示するパケットを絞り込みます" value={filter} onChange={e => setFilter(e.target.value)} placeholder="例: tcp port 443 / udp port 53 / host 192.168.2.10 and icmp"/><span>{filtered.rows.length} / {rows.length} packets{title ? ` · ${title}` : ''}</span>
    <button className="toolbar-button" title="PCAPで書き出す（Wiresharkで開けます）" disabled={!filtered.rows.length} onClick={() => download('path-capture.pcap', writePcap(filtered.rows).buffer as ArrayBuffer, 'application/vnd.tcpdump.pcap')}><Icon name="download" size={15}/><span>PCAP</span></button></div>
    {filtered.error && <p role="alert" className="error-text">{filtered.error}</p>}
    <div className="capture-split"><div className="capture-table-wrap"><table className="capture-table"><thead><tr><th>No.</th><th>Time</th><th>Source</th><th>Destination</th><th>Protocol</th><th>Length</th><th>Info</th></tr></thead><tbody>{filtered.rows.map(c => <tr key={c.id} className={capture?.id === c.id ? 'selected' : ''} onClick={() => setSelected(c.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSelected(c.id); }}><td>{c.id}</td><td>{((c.time - t0) / 1000).toFixed(3)}</td><td>{c.source}</td><td>{c.destination}</td><td><span className={`protocol ${c.protocol.toLowerCase()}`}>{c.protocol}</span></td><td>{c.bytes.length}</td><td>{c.vlan !== undefined ? `[VLAN ${c.vlan}] ` : ''}{c.info}</td></tr>)}</tbody></table>{!filtered.rows.length && <div className="empty-state">{rows.length ? 'フィルタに一致するパケットはありません。条件を変えるか、空にしてください。' : 'まだパケットがありません。ワークスペースで ping などを実行すると、リンクを通ったフレームがここに記録されます。'}</div>}</div>
      {capture && <PacketDetails key={capture.id} capture={capture}/>}</div>
  </div>;
}

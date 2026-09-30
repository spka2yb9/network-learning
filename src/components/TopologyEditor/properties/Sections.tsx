import { useState } from 'react';
import { lab } from '../../../application/LabController';
import { forwardingKinds, hostKinds, switchingKinds, type DeviceState, type DnsType, type NatRule, type ServiceConfig } from '../../../simulator/core/types';
import { installedRoutes } from '../../../simulator/l3/RoutingTable';
import { formatRule, parseRule } from '../../../simulator/services/FirewallEngine';
import { natRuleText } from '../../../simulator/services/Nat';
import { dnsTypes, validateRecord } from '../../../simulator/services/Dns';
import { dnsService, https, ssh, web } from '../../../simulator/scenarios/build';
import { useUI } from '../../../stores/ui';
import { Icon } from '../../Icon';
import { RemoveButton, Rows, Section, TextApply, Toggle } from './common';

export function RoutingSection({ device }: { device: DeviceState }) {
  const [destination, setDestination] = useState(''); const [nextHop, setNextHop] = useState('');
  const table = lab.network.table(device.id); const installed = new Set(installedRoutes(device).map(r => JSON.stringify(r)));
  const code = (k: string) => ({ connected: 'C', static: 'S', ospf: 'O', bgp: 'B' } as Record<string, string>)[k];
  return <Section title="Routing Table（経路表）" count={table.length}>
    {!forwardingKinds.includes(device.kind) && <form key={device.gateway ?? ''} className="gateway-form" onSubmit={e => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('gw') as HTMLInputElement).value.trim(); lab.mutate(n => n.setGateway(device.id, v)); }}>
      <label>Default Gateway（LANの出口のルータ）<div className="input-action"><input name="gw" aria-label="Default Gateway" defaultValue={device.gateway ?? ''} placeholder="192.168.1.1"/><button aria-label="Gatewayを適用"><Icon name="check" size={16}/></button></div></label></form>}
    <div className="route-properties">{table.map((route, index) => <div className={`route-item ${installed.has(JSON.stringify(route)) ? '' : 'inactive'}`} key={index} title={installed.has(JSON.stringify(route)) ? '実際に使われている経路' : '同じ宛先で、より優先される経路（ADやメトリックが小さい）があるため使われていません'}>
      <span className={`route-code ${route.kind}`}>{code(route.kind)}</span><div><code>{route.destination}</code><small>{route.nextHop ? `via ${route.nextHop}` : `direct · ${route.interfaceId}`}{route.kind !== 'connected' ? ` · [${route.preference}/${route.metric}]` : ''}{route.info ? ` · ${route.info}` : ''}</small></div>
      {route.kind === 'static' && !(route.destination === '0.0.0.0/0' && route.nextHop === device.gateway && !forwardingKinds.includes(device.kind)) && <button className="icon-button" aria-label={`${route.destination} を削除`} onClick={() => lab.mutate(n => { n.deleteRoute(device.id, route.destination, route.nextHop); })}><Icon name="close" size={14}/></button>}</div>)}
      <form onSubmit={e => { e.preventDefault(); if (lab.mutate(n => n.addRoute(device.id, { destination, nextHop, preference: 1, metric: 0 }))) { setDestination(''); setNextHop(''); } }} className="route-add"><label>Destination CIDR（宛先ネットワーク）<input required aria-label="Destination CIDR" placeholder="192.168.2.0/24" value={destination} onChange={e => setDestination(e.target.value)}/></label><label>Next Hop（次に渡すルータ）<input required aria-label="Next Hop" placeholder="10.0.0.2" value={nextHop} onChange={e => setNextHop(e.target.value)}/></label><button className="button small secondary"><Icon name="plus" size={14}/>静的ルートを追加</button></form>
    </div>
    <p className="muted tiny">C＝直結、S＝静的、O＝OSPF、B＝BGP。行にカーソルを合わせると、その経路が実際に使われているかが表示されます。</p>
  </Section>;
}

const presets: Record<string, () => ServiceConfig> = { 'HTTP (80)': () => web(), 'HTTPS (443)': () => https(['www.example.com']), 'DNS (53/udp)': dnsService, 'SSH (22)': ssh };
export function ServicesSection({ device }: { device: DeviceState }) {
  const services = device.services ?? [];
  const update = (fn: (s: ServiceConfig[]) => void) => lab.mutate(n => n.update(device.id, d => { d.services ??= []; fn(d.services); if (d.services.some(s => s.app === 'dns') && !d.dnsServer) d.dnsServer = { recursive: false, rootHints: [], zones: [] }; }));
  return <Section title="サービス（待ち受けるポート）" count={services.length} open={services.length > 0}>
    {services.map((s, i) => <div key={s.name} className="service-row">
      <div className="port-form-title"><strong>{s.name}</strong><span className="tag-mini">{s.protocol}/{s.port} {s.app}</span><Toggle on={s.running} labels={['running', 'stopped']} aria={`${s.name} の稼働`} onChange={v => update(x => { x[i].running = v; })}/><RemoveButton label={`${s.name} を削除`} onClick={() => update(x => { x.splice(i, 1); })}/></div>
      <label>待ち受けアドレス<select aria-label={`${s.name} bind`} value={s.bind} onChange={e => update(x => { x[i].bind = e.target.value; })}><option value="0.0.0.0">0.0.0.0（すべて）</option><option value="127.0.0.1">127.0.0.1（ローカルのみ）</option>{device.interfaces.filter(f => f.address).map(f => <option key={f.id} value={f.address!.split('/')[0]}>{f.address!.split('/')[0]}</option>)}</select></label>
      {(s.app === 'http' || s.app === 'https') && <label>HTTPステータス<select aria-label={`${s.name} HTTP status`} value={s.http?.status ?? 200} onChange={e => update(x => { x[i].http = { status: Number(e.target.value), body: x[i].http?.body ?? '<h1>OK</h1>' }; })}>{[200, 301, 403, 404, 500, 502, 503].map(c => <option key={c}>{c}</option>)}</select></label>}
      {s.tls && <><TextApply label="証明書の名前（カンマ区切り）" value={s.tls.names.join(', ')} onApply={v => update(x => { x[i].tls!.names = v.split(',').map(t => t.trim()).filter(Boolean); })}/>
        <div className="inline-selects"><label className="check"><input type="checkbox" checked={s.tls.expired} onChange={e => update(x => { x[i].tls!.expired = e.target.checked; })}/>期限切れ</label><label className="check"><input type="checkbox" checked={s.tls.selfSigned} onChange={e => update(x => { x[i].tls!.selfSigned = e.target.checked; })}/>自己署名</label></div></>}
    </div>)}
    <div className="preset-buttons">{Object.entries(presets).map(([label, make]) => <button key={label} type="button" className="button small secondary" onClick={() => update(x => { const s = make(); if (x.some(y => y.port === s.port && y.protocol === s.protocol)) throw new Error('同じポートを使うサービスがすでにあります'); x.push(s); })}><Icon name="plus" size={12}/>{label}</button>)}</div>
  </Section>;
}
export function ResolverSection({ device }: { device: DeviceState }) {
  return <Section title="DNSクライアント（/etc/resolv.conf）" open={!!device.dnsServers?.length}>
    <TextApply label="nameserver（問い合わせ先のDNSサーバー。カンマ区切り）" aria="DNSサーバー" value={(device.dnsServers ?? []).join(', ')} placeholder="192.168.1.53" onApply={v => lab.mutate(n => n.update(device.id, d => { d.dnsServers = v ? v.split(',').map(x => x.trim()).filter(Boolean) : undefined; }))}/>
  </Section>;
}
export function DnsZoneSection({ device }: { device: DeviceState }) {
  const cfg = device.dnsServer;
  const [zoneIndex, setZone] = useState(0);
  const [rec, setRec] = useState<{ name: string; type: DnsType; ttl: string; value: string }>({ name: '', type: 'A', ttl: '300', value: '' });
  if (!cfg) return null;
  const zone = cfg.zones[zoneIndex];
  const update = (fn: (c: NonNullable<DeviceState['dnsServer']>) => void) => lab.mutate(n => n.update(device.id, d => fn(d.dnsServer!)));
  return <Section title="DNSサーバー（ゾーン）" count={cfg.zones.length}>
    <div className="inline-selects"><label className="check"><input type="checkbox" checked={cfg.recursive} onChange={e => update(c => { c.recursive = e.target.checked; })}/>再帰問い合わせに答える（再帰リゾルバとして動く）</label></div>
    {cfg.recursive && <TextApply label="Root hints（最初に聞くルートサーバーのIP。カンマ区切り）" value={cfg.rootHints.join(', ')} onApply={v => update(c => { c.rootHints = v.split(',').map(x => x.trim()).filter(Boolean); })}/>}
    {cfg.zones.length > 0 && <label>ゾーン<select aria-label="DNSゾーン" value={zoneIndex} onChange={e => setZone(Number(e.target.value))}>{cfg.zones.map((z, i) => <option key={z.origin} value={i}>{z.origin}</option>)}</select></label>}
    {zone && <table className="mini-table records"><thead><tr><th>名前</th><th>TTL</th><th>型</th><th>値</th><th/></tr></thead><tbody>{zone.records.map((r, i) => <tr key={`${r.name}${r.type}${r.value}`}><td>{r.name}</td><td>{r.ttl}</td><td>{r.type}</td><td>{r.value}</td><td><RemoveButton label={`${r.name} ${r.type} を削除`} onClick={() => update(c => { c.zones[zoneIndex].records.splice(i, 1); })}/></td></tr>)}</tbody></table>}
    {zone && <form className="record-add" onSubmit={e => { e.preventDefault(); update(c => { const name = rec.name.includes('.') || rec.name === '@' ? (rec.name === '@' ? zone.origin : rec.name) : `${rec.name}.${zone.origin}`; c.zones[zoneIndex].records.push(validateRecord({ name, type: rec.type, ttl: Number(rec.ttl), value: rec.value })); }) && setRec({ ...rec, name: '', value: '' }); }}>
      <input aria-label="レコード名" placeholder="api（または FQDN / @）" value={rec.name} onChange={e => setRec({ ...rec, name: e.target.value })}/>
      <select aria-label="レコードタイプ" value={rec.type} onChange={e => setRec({ ...rec, type: e.target.value as DnsType })}>{dnsTypes.map(t => <option key={t}>{t}</option>)}</select>
      <input aria-label="TTL" type="number" value={rec.ttl} onChange={e => setRec({ ...rec, ttl: e.target.value })}/>
      <input aria-label="レコードの値" placeholder={rec.type === 'MX' ? '10 mail.example.com.' : rec.type === 'CNAME' ? 'www.example.com.' : '203.0.113.81'} value={rec.value} onChange={e => setRec({ ...rec, value: e.target.value })}/>
      <button className="button small secondary"><Icon name="plus" size={12}/>レコードを追加</button>
    </form>}
    <TextApply label="ゾーンを追加（ゾーン名）" value="" placeholder="corp.example." button="追加" onApply={v => { if (!v) return false; return update(c => { const origin = v.endsWith('.') ? v : `${v}.`; c.zones.push({ origin, records: [{ name: origin, type: 'SOA', ttl: 3600, value: `ns.${origin} admin.${origin} 1 7200 3600 1209600 300` }] }); }); }}/>
  </Section>;
}
export function PolicySection({ device }: { device: DeviceState }) {
  const [ruleText, setRuleText] = useState(''); const [seq, setSeq] = useState('');
  const [nat, setNat] = useState({ type: 'pat', a: '', b: '', c: '', d: '' });
  const [aclName, setAclName] = useState(device.acls?.[0]?.name ?? '');
  const [aclRule, setAclRule] = useState('');
  const forwards = forwardingKinds.includes(device.kind);
  const fw = device.firewall;
  const host = hostKinds.includes(device.kind);
  return <>
    {(device.kind === 'firewall' || (host && fw)) && <Section title={device.kind === 'firewall' ? 'Firewall ポリシー' : 'ホストFirewall（iptables INPUT）'} count={fw?.rules.length ?? 0}>
      {device.kind === 'firewall' && <div className="inline-selects">
        <label>モード<select aria-label="Firewall mode" value={fw!.stateful ? 'stateful' : 'stateless'} onChange={e => lab.mutate(n => n.update(device.id, d => { d.firewall!.stateful = e.target.value === 'stateful'; }))}><option value="stateful">stateful</option><option value="stateless">stateless</option></select></label>
        <label>既定の動作<select aria-label="Firewall default" value={fw!.defaultAction} onChange={e => lab.mutate(n => n.update(device.id, d => { d.firewall!.defaultAction = e.target.value as 'permit' | 'deny'; }))}><option value="deny">deny</option><option value="permit">permit</option></select></label></div>}
      <ol className="rule-list">{fw?.rules.map(r => <li key={r.seq}><code>{formatRule(r)}</code><RemoveButton label={`ルール ${r.seq} を削除`} onClick={() => lab.mutate(n => n.update(device.id, d => { d.firewall!.rules = d.firewall!.rules.filter(x => x.seq !== r.seq); }))}/></li>)}</ol>
      <form className="rule-add" onSubmit={e => { e.preventDefault(); if (lab.mutate(n => n.update(device.id, d => { const s = Number(seq) || Math.max(0, ...d.firewall!.rules.map(x => x.seq)) + 10; const r = parseRule(s, ruleText.trim().split(/\s+/)); d.firewall!.rules = [...d.firewall!.rules.filter(x => x.seq !== s), r].sort((a, b) => a.seq - b.seq); }))) { setRuleText(''); setSeq(''); } }}>
        <input aria-label="ルール番号" placeholder="seq" value={seq} onChange={e => setSeq(e.target.value)} className="narrow"/>
        <input aria-label="Firewallルール" placeholder="permit tcp 10.0.1.0/24 host 10.0.2.80 eq 443" value={ruleText} onChange={e => setRuleText(e.target.value)}/>
        <button className="button small secondary"><Icon name="plus" size={12}/>追加</button></form>
      <p className="muted tiny">書式: permit|deny|reject プロトコル 送信元 [eq ポート] 宛先 [eq ポート] [established] [ctstate ESTABLISHED,RELATED] [in IF] [out IF]。上から順に評価し、最初に一致したルールで決まります。どれにも一致しなければ「既定の動作」になります。</p>
    </Section>}
    {host && !fw && <Section title="ホストFirewall" open={false}><button className="button small secondary" onClick={() => lab.mutate(n => n.update(device.id, d => { d.firewall = { stateful: false, defaultAction: 'permit', rules: [] }; }))}>iptables INPUT を有効にする</button></Section>}
    {forwards && <Section title="NAT" count={device.nat?.length ?? 0} open={!!device.nat?.length}>
      <ol className="rule-list">{(device.nat ?? []).map(r => <li key={r.id}><code>{natRuleText(r)}</code><RemoveButton label={`NAT ${r.id} を削除`} onClick={() => lab.mutate(n => n.update(device.id, d => { d.nat = d.nat!.filter(x => x.id !== r.id); }))}/></li>)}</ol>
      <form className="nat-add" onSubmit={e => { e.preventDefault(); lab.mutate(n => n.update(device.id, d => {
        let rule: NatRule;
        if (nat.type === 'pat') rule = { id: `pat-${Date.now() % 100000}`, type: 'pat', source: nat.a, outInterface: nat.b };
        else if (nat.type === 'static') rule = { id: `static-${Date.now() % 100000}`, type: 'static', inside: nat.a, outside: nat.b };
        else rule = { id: `pf-${Date.now() % 100000}`, type: 'port-forward', protocol: 'tcp', inside: nat.a, insidePort: Number(nat.c), outside: nat.b, outsidePort: Number(nat.d) };
        d.nat = [...(d.nat ?? []), rule];
      })); }}>
        <select aria-label="NAT種別" value={nat.type} onChange={e => setNat({ ...nat, type: e.target.value })}><option value="pat">PAT（overload）</option><option value="static">静的NAT（1:1）</option><option value="pf">ポートフォワード（TCP）</option></select>
        <input aria-label="NAT 内側" placeholder={nat.type === 'pat' ? '内側CIDR 192.168.1.0/24' : '内側IP'} value={nat.a} onChange={e => setNat({ ...nat, a: e.target.value })}/>
        {nat.type === 'pat' ? <select aria-label="NAT 出口" value={nat.b} onChange={e => setNat({ ...nat, b: e.target.value })}><option value="">出口インターフェース</option>{device.interfaces.filter(i => i.address).map(i => <option key={i.id}>{i.id}</option>)}</select>
          : <input aria-label="NAT 外側" placeholder="外側IP" value={nat.b} onChange={e => setNat({ ...nat, b: e.target.value })}/>}
        {nat.type === 'pf' && <><input aria-label="内側ポート" placeholder="内側port" className="narrow" value={nat.c} onChange={e => setNat({ ...nat, c: e.target.value })}/><input aria-label="外側ポート" placeholder="外側port" className="narrow" value={nat.d} onChange={e => setNat({ ...nat, d: e.target.value })}/></>}
        <button className="button small secondary"><Icon name="plus" size={12}/>追加</button></form>
      <p className="muted tiny">NATを使うには、上のインターフェース欄の「NAT」で inside（内側）/ outside（外側）も設定します。</p>
    </Section>}
    {forwards && device.kind !== 'firewall' && <Section title="ACL（拡張・ステートレス）" count={device.acls?.length ?? 0} open={!!device.acls?.length}>
      {(device.acls ?? []).map(a => <div key={a.name}><strong className="small-title">{a.name}</strong><ol className="rule-list">{a.rules.map(r => <li key={r.seq}><code>{formatRule(r)}</code><RemoveButton label={`${a.name} ${r.seq} を削除`} onClick={() => lab.mutate(n => n.update(device.id, d => { const x = d.acls!.find(y => y.name === a.name)!; x.rules = x.rules.filter(y => y.seq !== r.seq); }))}/></li>)}<li className="implicit">（最後に暗黙の deny ip any any：どれにも一致しなければ拒否）</li></ol></div>)}
      <form className="rule-add" onSubmit={e => { e.preventDefault(); if (lab.mutate(n => n.update(device.id, d => { d.acls ??= []; let a = d.acls.find(x => x.name === aclName); if (!a) { if (!/^[A-Za-z0-9_.-]+$/.test(aclName)) throw new Error('ACL名は英数字と _ . - で入力してください'); a = { name: aclName, rules: [] }; d.acls.push(a); } const s = Math.max(0, ...a.rules.map(x => x.seq)) + 10; a.rules.push(parseRule(s, aclRule.trim().split(/\s+/))); }))) setAclRule(''); }}>
        <input aria-label="ACL名" placeholder="ACL名" className="narrow" value={aclName} onChange={e => setAclName(e.target.value)}/>
        <input aria-label="ACLルール" placeholder="permit tcp any host 192.168.2.10 eq 80" value={aclRule} onChange={e => setAclRule(e.target.value)}/>
        <button className="button small secondary"><Icon name="plus" size={12}/>追加</button></form>
      <p className="muted tiny">作ったACLは、上のインターフェース欄の「ACL in / out」で選ぶと有効になります。</p>
    </Section>}
  </>;
}
export function SwitchingSection({ device }: { device: DeviceState }) {
  const [vlan, setVlan] = useState(''); const [name, setName] = useState('');
  if (!switchingKinds.includes(device.kind)) return null;
  return <Section title="VLAN / STP" count={(device.vlans?.length ?? 0) + 1}>
    <Rows rows={[['1', 'default', ''], ...(device.vlans ?? []).map(v => [String(v.id), v.name, <RemoveButton key={v.id} label={`VLAN ${v.id} を削除`} onClick={() => lab.mutate(n => n.update(device.id, d => { d.vlans = d.vlans!.filter(x => x.id !== v.id); }))}/>])]}/>
    <form className="vlan-add" onSubmit={e => { e.preventDefault(); if (lab.mutate(n => n.update(device.id, d => { const id = Number(vlan); if (!Number.isInteger(id) || id < 2 || id > 4094) throw new Error('VLAN IDは2〜4094で入力してください（1は既定のVLANです）'); d.vlans = [...(d.vlans ?? []).filter(x => x.id !== id), { id, name: name || `VLAN${String(id).padStart(4, '0')}` }].sort((a, b) => a.id - b.id); }))) { setVlan(''); setName(''); } }}>
      <input aria-label="VLAN ID" placeholder="VLAN ID" className="narrow" value={vlan} onChange={e => setVlan(e.target.value)}/><input aria-label="VLAN名" placeholder="名前" value={name} onChange={e => setName(e.target.value)}/><button className="button small secondary"><Icon name="plus" size={12}/>VLANを作成</button></form>
    <div className="inline-selects"><label className="check"><input type="checkbox" checked={device.stp?.enabled !== false} onChange={e => lab.mutate(n => n.update(device.id, d => { d.stp = { enabled: e.target.checked, priority: d.stp?.priority ?? 32768 }; }))}/>STP 有効</label>
      <label>Bridge priority（小さいほどRootになりやすい）<select aria-label="STP priority" value={device.stp?.priority ?? 32768} onChange={e => lab.mutate(n => n.update(device.id, d => { d.stp = { enabled: d.stp?.enabled ?? true, priority: Number(e.target.value) }; }))}>{Array.from({ length: 16 }, (_, i) => i * 4096).map(p => <option key={p}>{p}</option>)}</select></label></div>
  </Section>;
}
export function LinkSection({ linkId }: { linkId: string }) {
  const link = lab.network.snapshot().links.find(l => l.id === linkId);
  if (!link) return <div className="empty-state">このリンクは見つかりません。構成図のケーブルをクリックして選び直してください。</div>;
  return <div className="properties-title-block"><h3>リンク</h3><p className="muted tiny">{link.sourceDevice} {link.sourceInterface} ⇄ {link.targetDevice} {link.targetInterface}</p>
    <div className="port-form-title"><strong>状態</strong><Toggle on={link.up} aria="リンク状態" onChange={up => lab.mutate(n => n.setLinkState(link.id, up))}/></div>
    <form className="link-form" onSubmit={e => { e.preventDefault(); const f = e.currentTarget.elements; lab.mutate(n => n.setLinkProperties(link.id, { bandwidth: Number((f.namedItem('bw') as HTMLInputElement).value), latency: Number((f.namedItem('lat') as HTMLInputElement).value) })); }}>
      <label>帯域（Mbps）<input name="bw" aria-label="帯域" type="number" defaultValue={link.bandwidth}/></label>
      <label>遅延（ms, 仮想）<input name="lat" aria-label="遅延" type="number" defaultValue={link.latency}/></label>
      <button className="button small secondary"><Icon name="check" size={12}/>適用</button></form>
    <p className="muted tiny">帯域は、STPとOSPFのコスト計算に使われます。遅延は、シミュレータ内の時計（仮想時刻）に足されます。混雑（輻輳）や待ち行列（キュー）は再現していません。</p>
    <button className="button small text-danger" onClick={() => { lab.mutate(n => n.removeLink(link.id)); useUI.setState({ selectedLink: '' }); }}><Icon name="trash" size={14}/>ケーブルを外す</button>
  </div>;
}

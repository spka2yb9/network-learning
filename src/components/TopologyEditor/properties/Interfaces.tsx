import { useEffect, useState } from 'react';
import { lab } from '../../../application/LabController';
import { logicalMac } from '../../../simulator/core/NetworkSimulator';
import { forwardingKinds, switchingKinds, type DeviceState, type NetworkInterface } from '../../../simulator/core/types';
import { formatVlanList, parseVlanList } from '../../../simulator/l2/Vlan';
import { Icon } from '../../Icon';
import { RemoveButton, Section, Toggle } from './common';
import { speedText } from '../../../cli/common';

function PortForm({ device, port }: { device: DeviceState; port: NetworkInterface }) {
  const [address, setAddress] = useState(port.address ?? '');
  useEffect(() => setAddress(port.address ?? ''), [port.address]);
  const link = lab.network.snapshot().links.find(l => (l.sourceDevice === device.id && l.sourceInterface === port.id) || (l.targetDevice === device.id && l.targetInterface === port.id));
  const kind = port.kind ?? 'ethernet';
  const sp = port.switchport;
  const setSp = (patch: Partial<NonNullable<NetworkInterface['switchport']>>) => lab.mutate(n => n.update(device.id, d => { const i = d.interfaces.find(x => x.id === port.id)!; i.switchport = { ...i.switchport!, ...patch }; }));
  const line = device.lineDown?.includes(port.parent ?? port.id) ? 'no carrier' : kind === 'tunnel' ? (device.tunnelStatus?.[port.id]?.up ? 'tunnel up' : 'tunnel down') : '';
  const lagState = kind === 'port-channel' ? device.lagStatus?.[port.id] : undefined;
  const member = port.channelGroup && device.lagStatus?.[`po${port.channelGroup.group}`]?.members.find(m => m.port === port.id);
  return <form className="port-form" onSubmit={e => { e.preventDefault(); lab.mutate(n => n.configureInterface(device.id, port.id, address, port.up)); }}>
    <div className="port-form-title"><strong>{port.id}</strong>{kind !== 'ethernet' && <span className="tag-mini">{kind}{port.vlan ? ` ${port.vlan}` : ''}</span>}{line && <span className="tag-mini warn">{line}</span>}
      <Toggle on={port.up} aria={`${port.id} の状態`} onChange={up => lab.mutate(n => n.configureInterface(device.id, port.id, port.address, up))}/>
      {kind !== 'ethernet' && <RemoveButton label={`${port.id} を削除`} onClick={() => lab.mutate(n => n.update(device.id, d => {
        d.interfaces = d.interfaces.filter(i => i.id !== port.id);
        if (kind === 'port-channel') for (const i of d.interfaces) if (i.channelGroup && `po${i.channelGroup.group}` === port.id) delete i.channelGroup;
      }))}/>}
    </div>
    {lagState && <small>{lagState.protocol} · 使用中のメンバー {lagState.members.filter(m => m.flag === 'P').map(m => m.port).join(', ') || 'なし'} · 合計 {speedText(lagState.capacity)}（1つのフローはメンバー1本分まで）</small>}
    {port.channelGroup ? <p className="tiny">{`po${port.channelGroup.group}`} のメンバー（mode {port.channelGroup.mode}）: <strong>{member?.flag === 'P' ? '束ねて使用中' : member?.flag === 's' ? 'suspended（使用していない）' : 'down'}</strong>{member?.flag !== 'P' && member?.reason ? ` — ${member.reason}` : ''}。VLAN・IPアドレスは po{port.channelGroup.group} で設定します。</p>
    : sp ? <div className="switchport-form">
      <label>モード<select aria-label={`${port.id} switchport mode`} value={sp.mode} onChange={e => setSp({ mode: e.target.value as 'access' | 'trunk' })}><option value="access">access</option><option value="trunk">trunk</option></select></label>
      {sp.mode === 'access' ? <label>VLAN<input aria-label={`${port.id} access VLAN`} type="number" min={1} max={4094} value={sp.accessVlan} onChange={e => setSp({ accessVlan: Number(e.target.value) })}/></label>
        : <><label>許可VLAN<input key={formatVlanList(sp.allowedVlans)} aria-label={`${port.id} allowed VLAN`} defaultValue={formatVlanList(sp.allowedVlans)} onBlur={e => { try { const v = e.target.value.trim(); setSp({ allowedVlans: v === '1-4094' || v === 'all' ? 'all' : parseVlanList(v) }); } catch (err) { lab.mutate(() => { throw err; }); } }}/></label>
          <label>ネイティブVLAN<input aria-label={`${port.id} native VLAN`} type="number" min={1} max={4094} value={sp.nativeVlan} onChange={e => setSp({ nativeVlan: Number(e.target.value) })}/></label></>}
      {device.kind === 'l3switch' && <button type="button" className="button small secondary" title="スイッチのポートをやめ、IPアドレスを持つポートにします" onClick={() => lab.mutate(n => n.update(device.id, d => { delete d.interfaces.find(i => i.id === port.id)!.switchport; }))}>ルーテッドポートにする</button>}
    </div> : <>
      <label>IPv4アドレス / プレフィックス長<div className="input-action"><input aria-label={`${device.id} ${port.id} IPv4`} value={address} onChange={e => setAddress(e.target.value)} placeholder="例: 10.0.0.1/30"/><button title="IP設定を適用" aria-label={`${port.id} IP設定を適用`}><Icon name="check" size={16}/></button></div></label>
      {device.kind === 'l3switch' && kind === 'ethernet' && <button type="button" className="button small secondary" title="IPアドレスを消し、スイッチのポート（アクセスVLAN 1）に戻します" onClick={() => lab.mutate(n => n.update(device.id, d => { const i = d.interfaces.find(x => x.id === port.id)!; delete i.address; i.switchport = { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 }; }))}>L2ポートに戻す</button>}
    </>}
    {port.tunnel && <small>tunnel {port.tunnel.mode} {port.tunnel.source} → {port.tunnel.destination}{device.tunnelStatus?.[port.id] ? ` · ${device.tunnelStatus[port.id].reason}` : ''}</small>}
    {forwardingKinds.includes(device.kind) && !sp && !port.channelGroup && <div className="inline-selects">
      <label>NAT<select aria-label={`${port.id} NAT`} value={port.nat ?? ''} onChange={e => lab.mutate(n => n.update(device.id, d => { const i = d.interfaces.find(x => x.id === port.id)!; if (e.target.value) i.nat = e.target.value as 'inside' | 'outside'; else delete i.nat; }))}><option value="">-</option><option value="inside">inside</option><option value="outside">outside</option></select></label>
      {(device.acls ?? []).length > 0 && (['in', 'out'] as const).map(dir => <label key={dir}>ACL {dir}<select aria-label={`${port.id} ACL ${dir}`} value={port.acl?.[dir] ?? ''} onChange={e => lab.mutate(n => n.update(device.id, d => { const i = d.interfaces.find(x => x.id === port.id)!; i.acl = { ...i.acl, [dir]: e.target.value || undefined }; if (!i.acl.in && !i.acl.out) delete i.acl; }))}><option value="">-</option>{device.acls!.map(a => <option key={a.name}>{a.name}</option>)}</select></label>)}
    </div>}
    <small>{port.mac}{port.description ? ` · ${port.description}` : ''}</small>
    {link && <button type="button" className="button small text-danger" onClick={() => lab.mutate(n => n.removeLink(link.id))} aria-label={`${device.id} ${port.id} のケーブルを外す`}><Icon name="close" size={11}/>ケーブルを外す</button>}
  </form>;
}
function AddLogical({ device }: { device: DeviceState }) {
  const switching = switchingKinds.includes(device.kind); const forwards = forwardingKinds.includes(device.kind);
  const options = [...(forwards ? [['subinterface', 'サブインターフェース（VLANごとの仮想ポート・802.1Q）']] : []), ...(switching ? [['svi', 'SVI（VLANの仮想インターフェース）']] : []), ['loopback', 'Loopback（機器内の仮想アドレス）'], ...(forwards ? [['tunnel', 'Tunnel（IPsec / GRE）']] : [])] as [string, string][];
  const [kind, setKind] = useState(options[0]?.[0] ?? 'loopback'); const [a, setA] = useState(''); const [b, setB] = useState('');
  if (device.kind === 'pc' || device.kind === 'server') return null;
  const add = () => lab.mutate(n => n.update(device.id, d => {
    const num = Number(a);
    if (kind === 'subinterface') { const parent = d.interfaces.find(i => i.id === b)!; if (!parent) throw new Error('親ポートを選んでください'); d.interfaces.push({ id: `${parent.id}.${num}`, kind: 'subinterface', parent: parent.id, vlan: num, mac: parent.mac, up: true }); }
    else if (kind === 'svi') d.interfaces.push({ id: `vlan${num}`, kind: 'svi', vlan: num, mac: logicalMac(d, 0x10, num), up: true });
    else if (kind === 'loopback') d.interfaces.push({ id: `lo${num || 0}`, kind: 'loopback', mac: logicalMac(d, 0x20, num || 0), up: true });
    else d.interfaces.push({ id: `tunnel${num || 1}`, kind: 'tunnel', mac: logicalMac(d, 0x30, num || 1), up: true });
    if (!Number.isInteger(num) || num < 0 || num > 4094) throw new Error('番号・VLAN IDは0〜4094で入力してください');
  }));
  return <div className="add-logical"><select aria-label="追加するインターフェース種別" value={kind} onChange={e => setKind(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    <input aria-label="番号またはVLAN" placeholder={kind === 'subinterface' || kind === 'svi' ? 'VLAN ID' : '番号'} value={a} onChange={e => setA(e.target.value)}/>
    {kind === 'subinterface' && <select aria-label="親ポート" value={b} onChange={e => setB(e.target.value)}><option value="">親ポート</option>{device.interfaces.filter(i => (i.kind ?? 'ethernet') === 'ethernet' && !i.switchport).map(i => <option key={i.id}>{i.id}</option>)}</select>}
    <button type="button" className="button small secondary" onClick={add}><Icon name="plus" size={13}/>追加</button>
    {kind === 'tunnel' && <p className="muted tiny">トンネルの送信元・宛先・PSK（事前共有鍵）は、Terminal のCLIで設定します（例: interface tunnel1 → tunnel source g0/1）。</p>}</div>;
}
export default function Interfaces({ device }: { device: DeviceState }) {
  return <Section title="インターフェース" count={device.interfaces.length}>
    {device.interfaces.map(port => <PortForm key={port.id} device={device} port={port}/>)}
    <AddLogical device={device}/>
  </Section>;
}

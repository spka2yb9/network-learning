import type { Context, Mode } from './CliEngine';
import { pad, ping, speedText, traceroute } from './common';
import { logicalMac } from '../simulator/core/NetworkSimulator';
import { forwardingKinds, switchingKinds, type DeviceState, type LagMode, type LoadBalance, type NatRule, type NetworkInterface } from '../simulator/core/types';
import { flowText } from '../simulator/core/flow';
import { lag } from '../simulator/scenarios/build';
import { cidr, contains, ipOf, ipv4, isIpv4 } from '../simulator/l3/ipv4';
import { installedRoutes, l3Up, resolveRoute, routingTable } from '../simulator/l3/RoutingTable';
import { formatVlanList, parseVlanList, validVlan } from '../simulator/l2/Vlan';
import { portKey } from '../simulator/l2/Stp';
import { formatRule, parseRule } from '../simulator/services/FirewallEngine';
import { natRuleText } from '../simulator/services/Nat';
import { bgpRouterId } from '../simulator/routing/Bgp';
import { routerId } from '../simulator/routing/LinkState';

const ANY = '0.0.0.0/0';
const num = (s: string | undefined, min: number, max: number, label: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}は${min}〜${max}の整数です`);
  return n;
};
/** Cisco-style "network mask" or "network wildcard" → CIDR. */
export function toCidr(address: string | undefined, mask?: string, wildcard = false) {
  if (!address) throw new Error('ネットワークを CIDR（例: 10.0.0.0/24）で指定してください');
  if (address.includes('/')) return cidr(address).canonical;
  if (!mask) throw new Error('CIDR（例: 10.0.0.0/24）で指定してください');
  let m = ipv4(mask); if (wildcard) m = (~m) >>> 0;
  const prefix = 32 - Math.log2(((~m) >>> 0) + 1);
  if (!Number.isInteger(prefix)) throw new Error(`連続していないマスクです: ${mask}`);
  return cidr(`${address}/${prefix}`).canonical;
}
const ifaceName = (d: DeviceState, name: string) => {
  const n = name.toLowerCase().replace(/^gigabitethernet/, 'g').replace(/^gi(?=\d)/, 'g').replace(/^lo(?:opback)?(\d+)$/, 'lo$1').replace(/^tu(?:nnel)?(\d+)$/, 'tunnel$1').replace(/^vl(?:an)?(\d+)$/, 'vlan$1').replace(/^po(?:rt-?channel)?(\d+)$/, 'po$1');
  return d.interfaces.find(i => i.id.toLowerCase() === n)?.id ?? n;
};
/** `ip route` arguments after the prefix: `<next-hop>` | `<IF> [next-hop]`, then [distance]. */
const routeVia = (d: DeviceState, rest: string[]) => {
  const viaIf = rest[0] && !isIpv4(rest[0]) ? ifaceName(d, rest[0]) : undefined;
  return { viaIf, nextHop: viaIf ? (rest[1] && isIpv4(rest[1]) ? rest[1] : undefined) : rest[0] };
};
// IOS-style abbreviations: per mode, the keyword paths the parser knows. A unique prefix of a keyword stands for it (sh ip int b, int g0/0, no shut); expansion stops at the first value.
type Words = { [k: string]: Words };
const words = (paths: string) => { const root: Words = {}; for (const p of paths.split(',')) p.trim().split(' ').reduce((n, k) => (n[k] ??= {}), root); return root; };
const expand = (t: string[], node: Words): string[] => {
  const [x, ...rest] = t; const keys = Object.keys(node);
  const m = !x ? [] : keys.includes(x) ? [x] : keys.filter(k => k.startsWith(x));
  return m.length === 1 ? [m[0], ...expand(rest, node[m[0]])] : t;
};
const EXEC = words('enable,disable,exit,end,configure terminal,write memory,copy running-config startup-config,ping,traceroute,clear arp,clear arp-cache,clear ip arp,clear ip nat translation,clear ip bgp,clear mac address-table,clear mac-address-table,clear conntrack,'
  + ['interfaces trunk', 'ip interface brief', 'ip route static', 'ip route connected', 'ip route ospf', 'ip route bgp', 'ip arp', 'ip cef exact-route', 'ip nat translations', 'ip access-lists', 'ip ospf neighbor', 'ip ospf database', 'ip bgp summary', 'arp', 'running-config', 'startup-config', 'mac address-table', 'mac-address-table', 'vlan brief', 'spanning-tree', 'etherchannel summary', 'etherchannel load-balance', 'access-lists', 'crypto session', 'crypto ipsec sa', 'crypto isakmp sa', 'firewall', 'conntrack', 'logging', 'clock'].map(x => `show ${x}`).join(','));
const conf = (sub: string) => { const ps = `interface range,port-channel load-balance,hostname,ip route,ip default-gateway,ip nat inside source static,ip routing,ip access-list extended,ip prefix-list,vlan,spanning-tree priority,spanning-tree vlan,router ospf,router bgp,firewall mode stateful,firewall mode stateless,firewall default permit,firewall default deny,firewall rule,clear conntrack,exit,end${sub ? `,${sub}` : ''}`; return words(`${ps},${ps.split(',').map(p => `no ${p}`).join(',')}`); };
const VOCAB: Record<Mode, Words> = { user: EXEC, privileged: EXEC, config: conf(''), vlan: conf('name'), acl: conf('permit,deny,reject,remark'), 'router-bgp': conf('neighbor,network,bgp router-id'),
  'router-ospf': conf('network,passive-interface,router-id,default-information originate,maximum-paths'),
  interface: conf('ip address,ip nat inside,ip nat outside,ip access-group,ip ospf cost,shutdown,description,encapsulation dot1q,channel-group,speed,switchport mode access,switchport mode trunk,switchport access vlan,switchport trunk native vlan,switchport trunk allowed vlan add,switchport trunk allowed vlan remove,switchport trunk allowed vlan none,spanning-tree cost,spanning-tree portfast,tunnel source,tunnel destination,tunnel mode ipsec,tunnel mode gre,tunnel protection psk,tunnel protection proposal') };

// ---------------------------------------------------------------- show
function lineProtocol(ctx: Context, i: NetworkInterface) {
  const d = ctx.device;
  if (!i.up) return 'down';
  if (i.kind === 'loopback') return 'up';
  if (i.kind === 'tunnel') return d.tunnelStatus?.[i.id]?.up ? 'up' : 'down';
  if (i.kind === 'svi') return d.lineDown?.includes(i.id) ? 'down' : 'up';
  if (i.kind === 'port-channel' || i.parent?.startsWith('po')) return d.lagStatus?.[i.parent ?? i.id]?.up ? 'up' : 'down';
  const port = i.parent ?? i.id;
  const link = ctx.network.snapshot().links.find(l => (l.sourceDevice === ctx.id && l.sourceInterface === port) || (l.targetDevice === ctx.id && l.targetInterface === port));
  if (!link || !link.up) return 'down';
  const [pd, pp] = link.sourceDevice === ctx.id ? [link.targetDevice, link.targetInterface] : [link.sourceDevice, link.sourceInterface];
  return ctx.network.device(pd).interfaces.find(x => x.id === pp)?.up && d.interfaces.find(x => x.id === port)?.up ? 'up' : 'down';
}
function showInterfaces(ctx: Context, only?: string) {
  const list = ctx.device.interfaces.filter(i => !only || i.id === only);
  if (!list.length) throw new Error(`インターフェース ${only} がありません（show ip interface brief で名前を確認できます）`);
  return list.map(i => {
    const status = i.up ? 'up' : 'administratively down';
    const member = i.channelGroup && ctx.device.lagStatus?.[`po${i.channelGroup.group}`]?.members.find(m => m.port === i.id);
    const lag = i.kind === 'port-channel' ? ctx.device.lagStatus?.[i.id] : undefined;
    const lines = [`${i.id} is ${status}, line protocol is ${lineProtocol(ctx, i)}${member?.flag === 's' ? ' (suspended)' : ''}`, `  Hardware ${lag ? 'is EtherChannel, address' : 'address'} is ${i.mac}${i.description ? `\n  Description: ${i.description}` : ''}`];
    const link = (i.kind ?? 'ethernet') === 'ethernet' && ctx.network.snapshot().links.find(l => (l.sourceDevice === ctx.id && l.sourceInterface === i.id) || (l.targetDevice === ctx.id && l.targetInterface === i.id));
    if (link) lines.push(`  BW ${link.bandwidth * 1000} Kbit/sec（リンク速度 ${speedText(link.bandwidth)}）`);
    if (lag) {
      const used = lag.members.filter(m => m.flag === 'P');
      lines.push(`  BW ${lag.capacity * 1000} Kbit/sec（使用中のメンバー ${used.length}本の合計 ${speedText(lag.capacity)}。1つのフローは、このうち1本だけを使います）`, `  Members in this channel: ${used.map(m => m.port).join(' ') || 'なし'}${lag.members.length > used.length ? `（使用していないメンバー: ${lag.members.filter(m => m.flag !== 'P').map(m => `${m.port}(${m.flag})`).join(' ')}）` : ''}`, `  Protocol: ${lag.protocol}`);
    }
    if (i.channelGroup) lines.push(`  Member of po${i.channelGroup.group}（mode ${i.channelGroup.mode}）: ${member?.flag === 'P' ? 'bundled' : member?.flag === 's' ? 'suspended' : 'down'} — ${member?.reason ?? ''}`);
    if (i.address) lines.push(`  Internet address is ${i.address}`);
    if (i.switchport && !i.channelGroup) lines.push(`  Switchport: mode ${i.switchport.mode}, ${i.switchport.mode === 'access' ? `access VLAN ${i.switchport.accessVlan}` : `native VLAN ${i.switchport.nativeVlan}, allowed ${formatVlanList(i.switchport.allowedVlans)}`}`);
    if (i.kind === 'subinterface') lines.push(`  Encapsulation 802.1Q Virtual LAN, Vlan ID ${i.vlan ?? '未設定（encapsulation dot1q <VLAN> で設定）'}`);
    if (i.kind === 'tunnel') {
      const t = i.tunnel; const s = ctx.device.tunnelStatus?.[i.id];
      lines.push(`  Tunnel source ${t?.source ?? 'unset'}, destination ${t?.destination ?? 'unset'}`, `  Tunnel protocol/transport ${t?.mode === 'ipsec' ? 'IPSEC/IP' : 'GRE/IP'}`, `  Tunnel state: ${s?.up ? 'UP' : 'DOWN'} — ${s?.reason ?? ''}`);
    }
    if (i.nat) lines.push(`  NAT: ${i.nat}`);
    if (i.acl?.in || i.acl?.out) lines.push(`  Access list: in ${i.acl.in ?? 'not set'}, out ${i.acl.out ?? 'not set'}`);
    return lines.join('\n');
  }).join('\n');
}
function showIpInterfaceBrief(ctx: Context) {
  return ['Interface        IP-Address       Status                 Protocol', ...ctx.device.interfaces.map(i =>
    `${pad(i.id, 16)} ${pad(ipOf(i.address) ?? 'unassigned', 16)} ${pad(i.up ? 'up' : 'administratively down', 22)} ${lineProtocol(ctx, i)}`)].join('\n');
}
const code = (r: { kind: string; destination: string; info?: string }) => ({ connected: 'C', static: 'S', ospf: r.info?.startsWith('O*E2') ? 'O E2' : 'O', bgp: 'B' } as Record<string, string>)[r.kind] + (r.destination === ANY ? '*' : '');
function showIpRoute(ctx: Context, filter?: string) {
  const d = ctx.device;
  if (filter && isIpv4(filter)) {
    const candidates = routingTable(d).filter(r => contains(r.destination, filter)).sort((a, b) => cidr(b.destination).prefix - cidr(a.destination).prefix || a.preference - b.preference);
    const resolved = resolveRoute(d, filter); const best = resolved?.route;
    if (!best) return `% Network not in table（${filter} に一致する経路がありません。Default Route もありません）`;
    const blocks = resolved.ecmp?.paths ?? [resolved];
    // routingTable() builds fresh Connected entries on each call, so compare by value, not identity.
    const same = (r: typeof best) => r.destination === best.destination && r.kind === best.kind && r.nextHop === best.nextHop && r.interfaceId === best.interfaceId && r.preference === best.preference;
    return [`Routing entry for ${best.destination}`, `  Known via "${best.kind}", distance ${best.preference}, metric ${best.metric}`, '  Routing Descriptor Blocks:',
      ...blocks.map((b, i) => `  ${i === 0 ? '*' : ' '} ${b.route.nextHop ? `${b.nextHop}, via ${b.iface.id}` : `directly connected, via ${b.iface.id}`}`),
      ...(blocks.length > 1 ? [`  （ECMP: 等コストのNext Hopが${blocks.length}本。どれを使うかはパケットのフロー（送信元/宛先IP・プロトコル・ポート）のハッシュで決まります。show ip cef exact-route <送信元> <宛先> で確かめられます）`] : []),
      '', `最長一致の候補（${filter} を含む経路）:`, ...candidates.map(r => `  ${same(r) ? '→' : ' '} ${pad(r.destination, 18)} /${cidr(r.destination).prefix}  ${r.kind} [${r.preference}/${r.metric}] ${r.nextHop ? `via ${r.nextHop}` : r.interfaceId}`)].join('\n');
  }
  if (filter && !['static', 'connected', 'ospf', 'bgp'].includes(filter)) throw new Error(`show ip route [<IP>|static|connected|ospf|bgp]（${filter} は指定できません）`);
  const all = installedRoutes(d);
  const routes = all.filter(r => !filter || r.kind === filter).sort((a, b) => cidr(a.destination).network - cidr(b.destination).network || cidr(a.destination).prefix - cidr(b.destination).prefix);
  const dflt = all.find(r => r.destination === ANY);
  return ['Codes: C - connected, S - static, O - OSPF, B - BGP, * - candidate default', '',
    dflt ? `Gateway of last resort is ${dflt.nextHop ?? dflt.interfaceId} to network 0.0.0.0` : 'Gateway of last resort is not set', '',
    // Equal-cost paths of one prefix are listed under it, like IOS: the prefix once, then one line per next hop.
    ...routes.map((r, i) => {
      const via = `[${r.preference}/${r.metric}] via ${r.nextHop ?? r.interfaceId}${r.nextHop && r.interfaceId ? `, ${r.interfaceId}` : ''}`;
      if (i > 0 && routes[i - 1].destination === r.destination && r.kind !== 'connected') return `${' '.repeat(25)}${via}`;
      return `${pad(code(r), 5)} ${pad(r.destination, 18)} ${r.kind === 'connected' ? `is directly connected, ${r.interfaceId}` : `${via}${r.info ? `  (${r.info})` : ''}`}`;
    }),
    ...(routes.some((r, i) => i > 0 && routes[i - 1].destination === r.destination) ? ['', '（同じ宛先に複数の行があるのは ECMP: 等コストの経路を同時に使っています）'] : [])].join('\n');
}
function showVlan(ctx: Context) {
  const d = ctx.device;
  const all = [{ id: 1, name: 'default' }, ...(d.vlans ?? [])];
  return ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------',
    ...all.map(v => `${pad(v.id, 4)} ${pad(v.name, 32)} active    ${d.interfaces.filter(i => !i.channelGroup && i.switchport?.mode === 'access' && i.switchport.accessVlan === v.id).map(i => i.id).join(', ')}`)].join('\n');
}
function showTrunk(ctx: Context) {
  const trunks = ctx.device.interfaces.filter(i => i.switchport?.mode === 'trunk' && !i.channelGroup);
  if (!trunks.length) return 'トランクポートはありません';
  const active = [1, ...(ctx.device.vlans ?? []).map(v => v.id)];
  return ['Port        Mode         Encapsulation  Status        Native vlan', ...trunks.map(i => `${pad(i.id, 11)} on           802.1q         ${pad(lineProtocol(ctx, i) === 'up' ? 'trunking' : 'not-connect', 13)} ${i.switchport!.nativeVlan}`),
    '', 'Port        Vlans allowed on trunk', ...trunks.map(i => `${pad(i.id, 11)} ${formatVlanList(i.switchport!.allowedVlans)}`),
    '', 'Port        Vlans allowed and active in management domain', ...trunks.map(i => `${pad(i.id, 11)} ${formatVlanList(active.filter(v => i.switchport!.allowedVlans === 'all' || i.switchport!.allowedVlans.includes(v)))}`)].join('\n');
}
function showStp(ctx: Context) {
  const stp = ctx.network.stpState();
  const b = stp.bridges.get(ctx.id);
  if (!b) return 'Spanning tree は無効です（no spanning-tree）';
  const rows = ctx.device.interfaces.filter(i => stp.ports.has(portKey(ctx.id, i.id)));
  return [`Spanning tree enabled protocol ieee（教育用: 単一インスタンス・安定状態のみ）`, `  Root ID    ${b.rootId}`, b.isRoot ? '             This bridge is the root' : `             Cost ${b.rootCost}, Port ${b.rootPort}`, `  Bridge ID  ${b.bridgeId}`, '',
    'Interface        Role Sts Cost', '---------------- ---- --- ---------', ...rows.map(i => { const p = stp.ports.get(portKey(ctx.id, i.id))!; return `${pad(i.id, 16)} ${pad({ root: 'Root', designated: 'Desg', alternate: 'Altn', disabled: 'Disa' }[p.role], 4)} ${p.forwarding ? 'FWD' : 'BLK'} ${p.cost}`; })].join('\n');
}
function showEtherchannel(ctx: Context, what?: string) {
  const d = ctx.device;
  if (what === 'load-balance') return `EtherChannel Load-Balancing Configuration:\n        ${d.lagLoadBalance ?? 'src-dst-mixed-ip-port'}\n（ハッシュに使う値: ${({ 'src-dst-mac': '送信元/宛先MACアドレス', 'src-dst-ip': '送信元/宛先IPアドレス', 'src-dst-mixed-ip-port': '送信元/宛先IPアドレスとTCP/UDPポート' } as Record<LoadBalance, string>)[d.lagLoadBalance ?? 'src-dst-mixed-ip-port']}）`;
  if (what && what !== 'summary') throw new Error('show etherchannel summary / show etherchannel load-balance');
  const lags = Object.entries(d.lagStatus ?? {});
  if (!lags.length) return 'Port-channel はありません（interface <IF> → channel-group <番号> mode active で作成します）';
  return ['Flags:  D - down        P - bundled in port-channel', '        s - suspended   S - Layer2   R - Layer3   U - in use', `Number of channel-groups in use: ${lags.length}`, '',
    'Group  Port-channel  Protocol    Ports', '------+-------------+-----------+-----------------------------------------------',
    ...lags.map(([id, l]) => `${pad(l.group, 6)} ${pad(`${id}(${d.interfaces.find(i => i.id === id)?.switchport ? 'S' : 'R'}${l.up ? 'U' : 'D'})`, 13)} ${pad(l.protocol, 11)} ${l.members.map(m => pad(`${m.port}(${m.flag})`, 11)).join(' ')}`),
    ...lags.flatMap(([id, l]) => l.members.filter(m => m.flag !== 'P').map(m => `  ${m.port}（${id}）: ${m.flag === 's' ? 'suspended' : 'down'} — ${m.reason}`))].join('\n');
}
/** `show ip cef exact-route <src> <dst> [tcp|udp <sport> <dport>]`: which ECMP path this flow's hash picks. */
function exactRoute(ctx: Context, t: string[]) {
  const [src, dst, proto, sport, dport] = t;
  if (!src || !dst || !isIpv4(src) || !isIpv4(dst)) throw new Error('使い方: show ip cef exact-route <送信元IP> <宛先IP> [tcp|udp <送信元ポート> <宛先ポート>]');
  const p = proto?.toUpperCase();
  if (p && p !== 'TCP' && p !== 'UDP') throw new Error('プロトコルは tcp / udp です（省略すると ICMP などポートのない通信として計算します）');
  const flow = { protocol: (p ?? 'ICMP') as 'TCP' | 'UDP' | 'ICMP', source: src, destination: dst, sourcePort: p ? num(sport, 1, 65535, '送信元ポート') : 0, destinationPort: p ? num(dport, 1, 65535, '宛先ポート') : 0 };
  const r = resolveRoute(ctx.device, dst, { flow });
  if (!r) return `${src} -> ${dst} => no route`;
  return [`${src} -> ${dst} =>IP adj out of ${r.iface.id}, addr ${r.nextHop}`,
    r.ecmp ? `（ECMP: ${r.ecmp.choice.candidates.join(' / ')} のうち、フロー「${flowText(flow)}」のハッシュ ${r.ecmp.choice.hash} mod ${r.ecmp.paths.length} = ${r.ecmp.choice.chosen} → ${r.ecmp.choice.chosen + 1}本目）` : '（等コストの経路は1本だけです）'].join('\n');
}
function showBgp(ctx: Context, arg?: string) {
  const b = ctx.network.bgp();
  const d = ctx.device;
  if (!d.bgp || !b) return '% BGP not active';
  const sessions = b.sessions.filter(s => s.device === ctx.id);
  if (arg === 'summary') return [`BGP router identifier ${bgpRouterId(d)}, local AS number ${d.bgp.asn}`, `（収束までの更新ラウンド: ${b.rounds}）`, '', 'Neighbor        V    AS   State/PfxRcd', ...sessions.map(s => `${pad(s.neighbor, 15)} 4 ${pad(s.remoteAs, 6)} ${s.state === 'Established' ? s.received : s.state}`)].join('\n');
  const table = b.tables.get(ctx.id) ?? [];
  if (arg && arg.includes('/')) {
    const paths = table.filter(p => p.prefix === cidr(arg).canonical);
    if (!paths.length) return `% Network not in table`;
    return [`BGP routing table entry for ${cidr(arg).canonical}`, ...paths.map(p => `  ${p.asPath.join(' ') || 'Local'}${p.best ? '  ← best' : ''}\n    ${p.nextHop} from ${p.from} (${p.peerRouterId})\n    LOCAL_PREF ${p.localPref}, MED ${p.med}, ${p.type}${p.valid ? '' : ', NEXT_HOP 到達不能（無効）'}\n    判定: ${p.reason ?? ''}`)].join('\n');
  }
  return [`BGP table version, local router ID is ${bgpRouterId(d)}`, 'Status codes: * valid, > best, i - internal', '', '     Network            Next Hop          Metric LocPrf Path',
    ...table.sort((a, b2) => cidr(a.prefix).network - cidr(b2.prefix).network).map(p => `${p.valid ? '*' : ' '}${p.best ? '>' : ' '}${p.type === 'iBGP' ? 'i' : ' '}  ${pad(p.prefix, 18)} ${pad(p.nextHop, 17)} ${pad(p.med, 6)} ${pad(p.localPref, 6)} ${[...p.asPath, 'i'].join(' ')}`)].join('\n');
}
function showLogging(ctx: Context) {
  const logs: string[] = [];
  const o = ctx.network.ospf();
  for (const i of o?.issues.filter(x => x.device === ctx.id) ?? []) logs.push(`%OSPF-4-ERRRCV: ${i.message}`);
  for (const s of ctx.network.bgp()?.sessions.filter(x => x.device === ctx.id && x.state !== 'Established') ?? []) logs.push(`%BGP-3-NOTIFICATION: neighbor ${s.neighbor} ${s.state}: ${s.reason}`);
  for (const [id, s] of Object.entries(ctx.device.tunnelStatus ?? {})) if (!s.up) logs.push(`%CRYPTO-4-TUNNEL: ${id} down: ${s.reason}`);
  for (const [id, l] of Object.entries(ctx.device.lagStatus ?? {})) for (const m of l.members.filter(x => x.flag === 's')) logs.push(`%EC-5-${m.reason.includes('速度') ? 'CANNOT_BUNDLE2' : 'L3DONTBNDL2'}: ${m.port} suspended（${id}）: ${m.reason}`);
  for (const i of ctx.device.interfaces) if (i.up && (i.kind ?? 'ethernet') === 'ethernet' && lineProtocol(ctx, i) === 'down' && ctx.network.snapshot().links.some(l => (l.sourceDevice === ctx.id && l.sourceInterface === i.id) || (l.targetDevice === ctx.id && l.targetInterface === i.id))) logs.push(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${i.id}, changed state to down`);
  return logs.length ? logs.join('\n') : 'ログはありません（教育用: 設定の不整合があるとここに表示されます）';
}
export function runningConfig(d: DeviceState) {
  const out = [`hostname ${d.id}`, '!'];
  for (const v of d.vlans ?? []) out.push(`vlan ${v.id}`, ` name ${v.name}`, '!');
  if (d.stp && !d.stp.enabled) out.push('no spanning-tree', '!'); else if (d.stp && d.stp.priority !== 32768) out.push(`spanning-tree priority ${d.stp.priority}`, '!');
  if (d.lagLoadBalance) out.push(`port-channel load-balance ${d.lagLoadBalance}`, '!');
  for (const i of d.interfaces) {
    out.push(`interface ${i.id}`);
    if (i.description) out.push(` description ${i.description}`);
    if (i.kind === 'subinterface' && i.vlan !== undefined) out.push(` encapsulation dot1q ${i.vlan}`);
    if (i.channelGroup) out.push(` channel-group ${i.channelGroup.group} mode ${i.channelGroup.mode}`);
    if (i.switchport) {
      if (i.switchport.mode === 'access') out.push(` switchport mode access`, ` switchport access vlan ${i.switchport.accessVlan}`);
      else out.push(' switchport mode trunk', ...(i.switchport.allowedVlans !== 'all' ? [` switchport trunk allowed vlan ${formatVlanList(i.switchport.allowedVlans)}`] : []), ...(i.switchport.nativeVlan !== 1 ? [` switchport trunk native vlan ${i.switchport.nativeVlan}`] : []));
    } else if (switchingKinds.includes(d.kind) && ((i.kind ?? 'ethernet') === 'ethernet' || i.kind === 'port-channel')) out.push(' no switchport');
    if (i.address) out.push(` ip address ${i.address}`);
    if (i.tunnel) out.push(` tunnel source ${i.tunnel.source}`, ` tunnel destination ${i.tunnel.destination}`, ` tunnel mode ${i.tunnel.mode === 'ipsec' ? 'ipsec ipv4' : 'gre ip'}`, ...(i.tunnel.psk ? [` tunnel protection psk ${i.tunnel.psk}`] : []), ...(i.tunnel.proposal ? [` tunnel protection proposal ${i.tunnel.proposal}`] : []));
    if (i.nat) out.push(` ip nat ${i.nat}`);
    if (i.acl?.in) out.push(` ip access-group ${i.acl.in} in`);
    if (i.acl?.out) out.push(` ip access-group ${i.acl.out} out`);
    if (i.ospfCost) out.push(` ip ospf cost ${i.ospfCost}`);
    if (i.stpCost) out.push(` spanning-tree cost ${i.stpCost}`);
    out.push(i.up ? ' no shutdown' : ' shutdown', '!');
  }
  if (d.ospf) out.push(`router ospf ${d.ospf.processId}`, ...(d.ospf.routerId ? [` router-id ${d.ospf.routerId}`] : []), ...d.ospf.networks.map(n => ` network ${n.prefix} area ${n.area}`), ...d.ospf.passive.map(p => ` passive-interface ${p}`), ...(d.ospf.defaultOriginate ? [' default-information originate'] : []), ...(d.ospf.maximumPaths ? [` maximum-paths ${d.ospf.maximumPaths}`] : []), '!');
  if (d.bgp) out.push(`router bgp ${d.bgp.asn}`, ...(d.bgp.routerId ? [` bgp router-id ${d.bgp.routerId}`] : []), ...d.bgp.neighbors.flatMap(n => [` neighbor ${n.ip} remote-as ${n.remoteAs}`,
    ...(n.updateSource ? [` neighbor ${n.ip} update-source ${n.updateSource}`] : []), ...(n.nextHopSelf ? [` neighbor ${n.ip} next-hop-self`] : []), ...(n.shutdown ? [` neighbor ${n.ip} shutdown`] : []),
    ...(n.prefixListIn ? [` neighbor ${n.ip} prefix-list ${n.prefixListIn} in`] : []), ...(n.prefixListOut ? [` neighbor ${n.ip} prefix-list ${n.prefixListOut} out`] : []),
    ...(n.localPreference !== undefined ? [` neighbor ${n.ip} local-preference ${n.localPreference}`] : []), ...(n.med !== undefined ? [` neighbor ${n.ip} med ${n.med}`] : []), ...(n.prepend ? [` neighbor ${n.ip} as-path prepend ${n.prepend}`] : [])]),
    ...d.bgp.networks.map(n => ` network ${n}`), '!');
  for (const l of d.prefixLists ?? []) for (const e of l.entries) out.push(`ip prefix-list ${l.name} seq ${e.seq} ${e.action} ${e.prefix}${e.ge ? ` ge ${e.ge}` : ''}${e.le ? ` le ${e.le}` : ''}`);
  for (const a of d.acls ?? []) out.push(`ip access-list extended ${a.name}`, ...a.rules.map(r => ` ${formatRule(r)}`), '!');
  for (const r of d.nat ?? []) out.push(natRuleText(r));
  if (d.firewall) out.push(`firewall mode ${d.firewall.stateful ? 'stateful' : 'stateless'}`, `firewall default ${d.firewall.defaultAction}`, ...d.firewall.rules.map(r => `firewall rule ${formatRule(r)}`));
  if (d.gateway) out.push(`ip default-gateway ${d.gateway}`);
  for (const r of d.routes) out.push(`ip route ${r.destination} ${r.interfaceId ?? ''} ${r.nextHop ?? ''}${r.preference !== 1 ? ` ${r.preference}` : ''}`.replace(/\s+/g, ' ').trim());
  return [...out, 'end'].join('\n');
}
function show(ctx: Context, t: string[]): string {
  const d = ctx.device; const s = t.join(' ');
  if (s === 'ip interface brief' || s === 'ip int brief' || s === 'ip int br') return showIpInterfaceBrief(ctx);
  if (t[0] === 'interfaces' && t[1] === 'trunk') return showTrunk(ctx);
  if (t[0] === 'interfaces' || t[0] === 'interface' || (t[0] === 'ip' && t[1] === 'interface')) return showInterfaces(ctx, t[0] === 'ip' ? (t[2] && ifaceName(d, t[2])) : t[1] && ifaceName(d, t[1]));
  if (t[0] === 'ip' && t[1] === 'route') return showIpRoute(ctx, t[2]);
  if (t[0] === 'ip' && t[1] === 'cef' && t[2] === 'exact-route') return exactRoute(ctx, t.slice(3));
  if (t[0] === 'etherchannel') return showEtherchannel(ctx, t[1]);
  if (s === 'arp' || s === 'ip arp') return ['Protocol  Address          Age  Hardware Addr      Interface', ...d.interfaces.filter(i => i.address && l3Up(d, i)).map(i => `Internet  ${pad(ipOf(i.address)!, 16)} -    ${pad(i.mac, 18)} ${i.id}`),
    ...d.arp.map(a => `Internet  ${pad(a.ip, 16)} ${pad(Math.floor((120_000 - (a.expiresAt - ctx.network.now())) / 60_000), 4)} ${pad(a.mac, 18)} ${a.interfaceId}`)].join('\n');
  if (s.startsWith('mac address-table') || s.startsWith('mac-address-table')) {
    if (!switchingKinds.includes(d.kind)) throw new Error('MACアドレステーブルはスイッチの機能です（ルータでは show arp でIPとMACの対応を見ます）');
    const rows = (d.macTable ?? []).filter(e => e.expiresAt > ctx.network.now());
    return ['          Mac Address Table', '-------------------------------------------', 'Vlan    Mac Address         Type        Ports', '----    -----------         --------    -----',
      ...rows.sort((a, b) => a.vlan - b.vlan).map(e => `${pad(e.vlan, 7)} ${pad(e.mac, 19)} DYNAMIC     ${e.port}`), `Total Mac Addresses for this criterion: ${rows.length}`].join('\n');
  }
  if (t[0] === 'vlan') { if (!switchingKinds.includes(d.kind)) throw new Error('VLANデータベースはスイッチの機能です'); return showVlan(ctx); }
  if (t[0] === 'spanning-tree') return showStp(ctx);
  if (s === 'running-config' || s === 'run' || s === 'startup-config') return runningConfig(d);
  if (s === 'ip nat translations') return ['Pro  Inside global          Inside local           Outside global', ...(d.natTable ?? []).filter(e => e.expiresAt > ctx.network.now()).map(e => `${pad(e.protocol, 4)} ${pad(`${e.insideGlobal}:${e.insideGlobalPort}`, 22)} ${pad(`${e.insideLocal}:${e.insideLocalPort}`, 22)} ${e.outside}:${e.outsidePort}`),
    ...(d.nat ?? []).filter(r => r.type !== 'pat').map(r => r.type === 'static' ? `---  ${pad(r.outside, 22)} ${pad(r.inside, 22)} ---` : `${r.protocol}  ${pad(`${r.outside}:${r.outsidePort}`, 22)} ${pad(`${r.inside}:${r.insidePort}`, 22)} ---`)].join('\n');
  if (s === 'access-lists' || s === 'ip access-lists') return (d.acls ?? []).map(a => [`Extended IP access list ${a.name}`, ...a.rules.map(r => `    ${formatRule(r)}`)].join('\n')).join('\n') || 'ACLはありません';
  if (s === 'ip ospf neighbor') {
    const o = ctx.network.ospf();
    return ['Neighbor ID     Pri   State        Address         Interface', ...(o?.neighbors.filter(n => n.device === ctx.id) ?? []).map(n => `${pad(n.neighborId, 15)} 1     FULL/ -      ${pad(n.address, 15)} ${n.interfaceId}`)].join('\n');
  }
  if (s === 'ip ospf database') {
    const o = ctx.network.ospf();
    if (!o) return '% OSPF not enabled';
    return ['            OSPF Router with ID (' + routerId(d) + ')（教育用: Router LSAのみ）', ...o.lsdb.map(l => `Router LSA ${l.routerId} (${l.device}) area ${l.areas.join(',')}\n${l.links.map(x => x.type === 'router' ? `   → neighbor ${x.neighborId} cost ${x.cost}` : `   stub ${x.prefix} cost ${x.cost}`).join('\n')}${l.external.length ? `\n   external ${l.external.join(', ')}` : ''}`)].join('\n');
  }
  if (s === 'ip ospf') { const o = ctx.network.ospf(); return d.ospf ? `Routing Process "ospf ${d.ospf.processId}" with ID ${routerId(d)}\n${(o?.spf.get(ctx.id) ?? []).map(e => `  SPF: ${e.device} cost ${e.cost} path ${e.path.join(' → ')}`).join('\n')}` : '% OSPF not enabled'; }
  if (t[0] === 'ip' && t[1] === 'bgp') return showBgp(ctx, t[2]);
  if (s === 'crypto session' || s === 'crypto ipsec sa' || s === 'crypto isakmp sa') {
    const tunnels = d.interfaces.filter(i => i.kind === 'tunnel');
    return tunnels.map(i => `Interface: ${i.id}\nSession status: ${d.tunnelStatus?.[i.id]?.up ? 'UP-ACTIVE' : 'DOWN'}\nPeer: ${i.tunnel?.destination ?? 'unset'}\n  ${d.tunnelStatus?.[i.id]?.reason ?? ''}`).join('\n\n') || 'トンネルはありません';
  }
  if (s === 'firewall') { if (!d.firewall) throw new Error('Firewallポリシーがありません'); return [`mode ${d.firewall.stateful ? 'stateful' : 'stateless'} / default ${d.firewall.defaultAction}`, ...d.firewall.rules.map(r => `  ${formatRule(r)}`)].join('\n'); }
  if (s === 'conntrack') return (d.conntrack ?? []).filter(e => e.expiresAt > ctx.network.now()).map(e => `${pad(e.protocol, 4)} ${pad(e.state, 12)} src=${e.source}:${e.sourcePort} dst=${e.destination}:${e.destinationPort}`).join('\n') || '接続追跡テーブルは空です';
  if (s === 'logging') return showLogging(ctx);
  if (s === 'clock') return `仮想時刻 ${ctx.network.now()} ms`;
  throw new Error(`未対応のshowコマンドです: show ${s}（help で使える show コマンドを確認できます）`);
}

// ---------------------------------------------------------------- configure
function createInterface(d: DeviceState, name: string): NetworkInterface {
  const existing = d.interfaces.find(i => i.id === name);
  if (existing) return existing;
  let m: RegExpExecArray | null;
  if ((m = /^(.+)\.(\d+)$/.exec(name))) {
    const parent = d.interfaces.find(i => i.id === m![1]);
    if (!parent || !forwardingKinds.includes(d.kind) || parent.switchport) throw new Error('サブインターフェースはルータのルーテッドポートに作成します（例: interface g0/0.10）');
    const i: NetworkInterface = { id: name, kind: 'subinterface', parent: parent.id, mac: parent.mac, up: true };
    d.interfaces.push(i); return i;
  }
  if ((m = /^vlan(\d+)$/.exec(name))) {
    if (!switchingKinds.includes(d.kind)) throw new Error('interface vlan はスイッチで使用します');
    const vlan = Number(m[1]); if (!validVlan(vlan)) throw new Error('VLAN IDは1〜4094です');
    const i: NetworkInterface = { id: name, kind: 'svi', vlan, mac: logicalMac(d, 0x10, vlan), up: true };
    d.interfaces.push(i); return i;
  }
  if ((m = /^po(\d+)$/.exec(name))) {
    if (!switchingKinds.includes(d.kind) && !forwardingKinds.includes(d.kind)) throw new Error('Port-channel はスイッチ・ルータで使用します');
    const group = Number(m[1]); if (group < 1 || group > 64) throw new Error('Port-channel の番号は1〜64です');
    const i: NetworkInterface = { id: name, kind: 'port-channel', mac: logicalMac(d, 0x40, group), up: true, ...(switchingKinds.includes(d.kind) ? { switchport: { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 } } : {}) };
    d.interfaces.push(i); return i;
  }
  if ((m = /^lo(\d+)$/.exec(name))) { const i: NetworkInterface = { id: name, kind: 'loopback', mac: logicalMac(d, 0x20, Number(m[1])), up: true }; d.interfaces.push(i); return i; }
  if ((m = /^tunnel(\d+)$/.exec(name))) {
    if (!forwardingKinds.includes(d.kind)) throw new Error('トンネルはルータで使用します');
    const i: NetworkInterface = { id: name, kind: 'tunnel', mac: logicalMac(d, 0x30, Number(m[1])), up: true }; d.interfaces.push(i); return i;
  }
  throw new Error(`インターフェース ${name} がありません`);
}
function interfaceCommand(ctx: Context, t: string[]): string {
  const { network, id } = ctx; const port = ctx.session.iface!;
  const set = (fn: (i: NetworkInterface, d: DeviceState) => void) => { network.update(id, d => fn(d.interfaces.find(i => i.id === port)!, d)); return ''; };
  const s = t.join(' ');
  if (t[0] === 'ip' && t[1] === 'address' && t[2]) return set(i => { i.address = t[3] && !t[2].includes('/') ? `${t[2]}/${cidr(toCidr(t[2], t[3])).prefix}` : t[2]; });
  if (s === 'no ip address') return set(i => { delete i.address; });
  if (s === 'shutdown') return set(i => { i.up = false; });
  if (s === 'no shutdown') return set(i => { i.up = true; });
  if (t[0] === 'description') return set(i => { i.description = t.slice(1).join(' '); });
  if (t[0] === 'encapsulation' && t[1]?.toLowerCase() === 'dot1q') return set(i => { if (i.kind !== 'subinterface') throw new Error('encapsulation dot1q はサブインターフェースで設定します（例: interface g0/0.10 → encapsulation dot1q 10）'); i.vlan = num(t[2], 1, 4094, 'VLAN ID'); });
  if (t[0] === 'channel-group' && t[2] === 'mode' && ['active', 'passive', 'on'].includes(t[3])) {
    const group = num(t[1], 1, 64, 'channel-group の番号');
    const created = !ctx.network.device(id).interfaces.some(i => i.id === `po${group}`);
    set((i, d) => {
      if ((i.kind ?? 'ethernet') !== 'ethernet' || (!switchingKinds.includes(d.kind) && !forwardingKinds.includes(d.kind))) throw new Error('channel-group はスイッチ・ルータの物理ポートで設定します');
      lag(d, group, t[3] as LagMode, i.id);
    });
    return created ? `Creating a port-channel interface po${group}` : '';
  }
  if (t[0] === 'channel-group') throw new Error('使い方: channel-group <番号> mode active|passive|on（active / passive はLACP、on はネゴシエーションなしの static）');
  if (s === 'no channel-group') return set(i => { delete i.channelGroup; });
  if (t[0] === 'speed') {
    const speeds = [10, 100, 1000, 2500, 5000, 10000, 25000, 40000, 50000, 100000, 400000];
    const mbps = Number(t[1]);
    if (!speeds.includes(mbps)) throw new Error(`speed <Mbps>（${speeds.join(' / ')}）`);
    const link = network.snapshot().links.find(l => (l.sourceDevice === id && l.sourceInterface === port) || (l.targetDevice === id && l.targetInterface === port));
    if (!link) throw new Error(`${port} にはケーブルが接続されていません`);
    network.setLinkProperties(link.id, { bandwidth: mbps, latency: link.latency });
    return `（教育用: このシミュレータでは速度をリンク（ケーブル）が持つため、${link.sourceDevice === id ? link.targetDevice : link.sourceDevice} 側も ${speedText(mbps)} になります。実機では両端のポート・モジュール・ケーブルが対応している必要があります）`;
  }
  if (t[0] === 'switchport' || s === 'no switchport') {
    return set((i, d) => {
      if (!switchingKinds.includes(d.kind) || ((i.kind ?? 'ethernet') !== 'ethernet' && i.kind !== 'port-channel')) throw new Error('switchport はスイッチの物理ポート・Port-channel で設定します');
      if (i.channelGroup) throw new Error(`${i.id} は po${i.channelGroup.group} のメンバーです。L2の設定は interface po${i.channelGroup.group} で行います（メンバーにも反映されます）`);
      const members = d.interfaces.filter(x => i.kind === 'port-channel' && x.channelGroup?.group === Number(i.id.slice(2)));
      const sync = () => { for (const m of members) { if (i.switchport) m.switchport = structuredClone(i.switchport); else delete m.switchport; } };
      if (s === 'no switchport') { if (d.kind !== 'l3switch') throw new Error('no switchport（ルーテッドポート）はL3スイッチのみです'); delete i.switchport; sync(); return; }
      const sp = i.switchport ??= { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 };
      if (t.length === 1) return;
      if (t[1] === 'mode' && (t[2] === 'access' || t[2] === 'trunk')) sp.mode = t[2];
      else if (t[1] === 'access' && t[2] === 'vlan') sp.accessVlan = num(t[3], 1, 4094, 'VLAN ID');
      else if (t[1] === 'trunk' && t[2] === 'native' && t[3] === 'vlan') sp.nativeVlan = num(t[4], 1, 4094, 'VLAN ID');
      else if (t[1] === 'trunk' && t[2] === 'allowed' && t[3] === 'vlan') {
        const current = sp.allowedVlans === 'all' ? Array.from({ length: 4094 }, (_, n) => n + 1) : sp.allowedVlans;
        if (t[4] === 'add' || t[4] === 'remove') {
          const list = parseVlanList(t[5] ?? ''); if (list === 'all') throw new Error('add / remove には VLAN 一覧を指定します');
          const next = t[4] === 'add' ? [...new Set([...current, ...list])].sort((a, b) => a - b) : current.filter(v => !list.includes(v));
          sp.allowedVlans = next.length === 4094 ? 'all' : next;
        } else if (t[4] === 'none') sp.allowedVlans = [];
        else sp.allowedVlans = parseVlanList(t[4] ?? '');
      } else throw new Error('使い方: switchport mode access|trunk / switchport access vlan <ID> / switchport trunk allowed vlan ... / switchport trunk native vlan <ID>');
      sync();
    });
  }
  if (s === 'ip nat inside' || s === 'ip nat outside') return set(i => { i.nat = t[2] as 'inside' | 'outside'; });
  if (/^no ip nat( inside| outside)?$/.test(s)) return set(i => { delete i.nat; });
  if (t[0] === 'ip' && t[1] === 'access-group' && t[2] && (t[3] === 'in' || t[3] === 'out')) return set(i => { i.acl = { ...i.acl, [t[3]]: t[2] }; });
  if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'access-group' && (t[4] === 'in' || t[4] === 'out' || t[3] === 'in' || t[3] === 'out')) return set(i => { const dir = (t[4] ?? t[3]) as 'in' | 'out'; if (i.acl) delete i.acl[dir]; });
  if (t[0] === 'ip' && t[1] === 'ospf' && t[2] === 'cost') return set(i => { i.ospfCost = num(t[3], 1, 65535, 'OSPFコスト'); });
  if (s === 'no ip ospf cost') return set(i => { delete i.ospfCost; });
  if (t[0] === 'spanning-tree' && t[1] === 'cost') return set(i => { i.stpCost = num(t[2], 1, 200_000_000, 'STPコスト'); });
  if (t[0] === 'no' && t[1] === 'spanning-tree' && t[2] === 'cost') return set(i => { delete i.stpCost; });
  if (t[t[0] === 'no' ? 1 : 0] === 'spanning-tree' && t[t[0] === 'no' ? 2 : 1] === 'portfast') return '（教育用: portfast は再現しません。このシミュレータのSTPは収束後の状態だけを計算するため、設定しなくても結果は同じです）';
  if (t[0] === 'tunnel') {
    return set((i, d) => {
      if (i.kind !== 'tunnel') throw new Error('tunnel コマンドはトンネルインターフェースで設定します（例: interface tunnel1）');
      const tn = i.tunnel ??= { source: '0.0.0.0', destination: '0.0.0.0', mode: 'gre' };
      if (t[1] === 'source') { const src = isIpv4(t[2] ?? '') ? t[2] : ipOf(d.interfaces.find(x => x.id === ifaceName(d, t[2] ?? ''))?.address); if (!src) throw new Error('tunnel source <IP|インターフェース>'); tn.source = src; }
      else if (t[1] === 'destination') { ipv4(t[2] ?? ''); tn.destination = t[2]; }
      else if (t[1] === 'mode' && t[2] === 'ipsec') { tn.mode = 'ipsec'; tn.proposal ??= 'aes256-sha256'; }
      else if (t[1] === 'mode' && t[2] === 'gre') { tn.mode = 'gre'; delete tn.psk; delete tn.proposal; }
      else if (t[1] === 'protection' && t[2] === 'psk' && t[3]) tn.psk = t[3];
      else if (t[1] === 'protection' && t[2] === 'proposal' && t[3]) tn.proposal = t[3];
      else throw new Error('tunnel source|destination <IP> / tunnel mode ipsec|gre / tunnel protection psk <鍵> / tunnel protection proposal <名前>');
    });
  }
  return fromSubmode(ctx, t, 'interface: ip address / shutdown / no shutdown / description / switchport ... / channel-group <n> mode active|passive|on / speed <Mbps> / exit');
}
/**
 * Like IOS, a global-config command typed in a sub-mode (e.g. `interface g0/2` while in interface g0/1)
 * runs in global config and leaves the sub-mode. Anything else is an error — never silently ignored.
 */
function fromSubmode(ctx: Context, t: string[], usage: string): string {
  const saved = { ...ctx.session };
  ctx.session.mode = 'config'; ctx.session.iface = undefined; ctx.session.range = undefined;
  try { return configCommand(ctx, t); }
  catch (error) {
    Object.assign(ctx.session, saved);
    if (error instanceof Error && error.message.startsWith('未対応の設定コマンド')) throw new Error(`Invalid input: ${t.join(' ')}（このモードで使えるのは ${usage}。exit で抜けてから入力することもできます）`);
    throw error;
  }
}
function natCommand(ctx: Context, t: string[], remove: boolean): string {
  // ip nat inside source <CIDR> interface <IF> overload | ip nat inside source static [tcp|udp] <in> [port] <out|interface IF> [port]
  if (t[0] !== 'inside' || t[1] !== 'source') throw new Error('ip nat inside source ... の形式です');
  const d = ctx.device; let rule: NatRule;
  const outsideIp = (a: string[]) => a[0] === 'interface' ? ipOf(d.interfaces.find(i => i.id === ifaceName(d, a[1] ?? ''))?.address) : a[0];
  if (t[2] === 'static') {
    if (t[3] === 'tcp' || t[3] === 'udp') {
      const outside = outsideIp(t.slice(6)); const outPort = t[6] === 'interface' ? t[8] : t[7];
      if (!outside) throw new Error('外側アドレスを指定してください');
      rule = { id: `pf-${t[3]}-${outPort}`, type: 'port-forward', protocol: t[3], inside: t[4], insidePort: num(t[5], 1, 65535, 'ポート'), outside, outsidePort: num(outPort, 1, 65535, 'ポート') };
    } else { const outside = outsideIp(t.slice(4)); if (!outside) throw new Error('外側アドレスを指定してください'); rule = { id: `static-${t[3]}`, type: 'static', inside: t[3], outside }; }
  } else {
    if (t[2] === 'list') throw new Error('教育用の簡略構文: ACLの代わりに CIDR を指定します（例: ip nat inside source 192.168.1.0/24 interface g0/1 overload）');
    if (t[3] !== 'interface' || !t[4] || t[5] !== 'overload') throw new Error('ip nat inside source <CIDR> interface <IF> overload');
    const source = toCidr(t[2]);
    rule = { id: `pat-${source.replace(/[./]/g, '-')}`, type: 'pat', source, outInterface: ifaceName(d, t[4]) };
  }
  ctx.network.update(ctx.id, x => {
    const same = (r: NatRule) => natRuleText(r) === natRuleText(rule);
    if (remove) { const before = (x.nat ?? []).length; x.nat = (x.nat ?? []).filter(r => !same(r)); if (x.nat.length === before) throw new Error('一致するNATルールがありません'); if (!x.nat.length) delete x.nat; }
    else if (!(x.nat ?? []).some(same)) x.nat = [...(x.nat ?? []), rule];
  });
  return '';
}
function configCommand(ctx: Context, t: string[]): string {
  const { network, id, session: s, device: d } = ctx;
  const cmd = t.join(' ');
  if (t[0] === 'interface' && t[1] === 'range' && t[2]) {
    // interface range g0/1-2 / g0/1 - 2 / g0/1, g0/3
    const ports = t.slice(2).join('').split(',').flatMap(part => {
      const m = /^(.*?)(\d+)-(\d+)$/.exec(part);
      if (!m) return [ifaceName(d, part)];
      const [a, b] = [Number(m[2]), Number(m[3])];
      if (b < a || b - a > 63) throw new Error(`範囲が不正です: ${part}`);
      return Array.from({ length: b - a + 1 }, (_, k) => ifaceName(d, `${m[1]}${a + k}`));
    });
    for (const p of ports) { const i = d.interfaces.find(x => x.id === p); if (!i || (i.kind ?? 'ethernet') !== 'ethernet') throw new Error(`interface range には存在する物理ポートを指定します: ${p}`); }
    s.mode = 'interface'; s.iface = ports[0]; s.range = [...new Set(ports)]; return '';
  }
  if (t[0] === 'interface' && t[1]) {
    const name = ifaceName(d, t.slice(1).join(''));
    if (!d.interfaces.some(i => i.id === name)) network.update(id, x => { createInterface(x, name); });
    s.mode = 'interface'; s.iface = name; s.range = undefined; return '';
  }
  if (t[0] === 'no' && t[1] === 'interface' && t[2]) {
    const name = ifaceName(d, t.slice(2).join(''));
    network.update(id, x => {
      const i = x.interfaces.find(y => y.id === name);
      if (!i || (i.kind ?? 'ethernet') === 'ethernet') throw new Error('削除できるのは論理インターフェース（サブインターフェース / SVI / loopback / tunnel / Port-channel）のみです');
      x.interfaces = x.interfaces.filter(y => y !== i);
      // Deleting a port-channel releases its members (they become individual ports again).
      if (i.kind === 'port-channel') for (const m of x.interfaces) if (m.channelGroup?.group === Number(i.id.slice(2))) delete m.channelGroup;
    });
    return '';
  }
  if (t[0] === 'port-channel' && t[1] === 'load-balance') {
    const method = t[2] as LoadBalance;
    if (!['src-dst-mac', 'src-dst-ip', 'src-dst-mixed-ip-port'].includes(method)) throw new Error('port-channel load-balance src-dst-mac|src-dst-ip|src-dst-mixed-ip-port');
    network.update(id, x => { if (method === 'src-dst-mixed-ip-port') delete x.lagLoadBalance; else x.lagLoadBalance = method; });
    return '';
  }
  if (t[0] === 'hostname') throw new Error('教育用: ホスト名は構成図の機器名と連動するため、ここでは変更できません');
  if (t[0] === 'ip' && t[1] === 'route') {
    // CIDR, or network + dotted mask like IOS (ip route 0.0.0.0 0.0.0.0 <next-hop> = default route).
    const rest = t.slice(t[2]?.includes('/') ? 3 : 4);
    if (!rest[0]) throw new Error('使い方: ip route <CIDR> <next-hop|interface> [distance]（例: ip route 192.168.2.0/24 10.0.0.2）');
    const dest = toCidr(t[2], t[3]); const { viaIf, nextHop } = routeVia(d, rest);
    const distance = rest.find((x, i) => i > 0 && /^\d+$/.test(x));
    network.addRoute(id, { destination: dest, nextHop, interfaceId: viaIf, preference: distance ? num(distance, 1, 255, 'distance') : 1, metric: 0 });
    return '';
  }
  if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'route') {
    if (!t[3]) throw new Error('使い方: no ip route <CIDR> [next-hop]（例: no ip route 192.168.2.0/24）');
    const dest = toCidr(t[3], t[4]);
    const { viaIf, nextHop } = routeVia(d, t.slice(t[3].includes('/') ? 4 : 5));
    if (!network.deleteRoute(id, dest, nextHop, viaIf)) throw new Error('指定されたStatic routeはありません（show ip route static で登録済みの経路を確認できます）');
    return '';
  }
  if (t[0] === 'ip' && t[1] === 'default-gateway') { if (!t[2]) throw new Error('使い方: ip default-gateway <IP>（削除は no ip default-gateway）'); network.setGateway(id, t[2]); return ''; }
  if (cmd === 'no ip default-gateway') { network.setGateway(id, ''); return ''; }
  if (t[0] === 'ip' && t[1] === 'nat') return natCommand(ctx, t.slice(2), false);
  if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'nat') return natCommand(ctx, t.slice(3), true);
  if (t[0] === 'ip' && t[1] === 'routing') return forwardingKinds.includes(d.kind) ? '' : (() => { throw new Error('この機器はIPルーティングできません（L3スイッチ / ルータを使用）'); })();
  if (t[0] === 'vlan' && t[1]) {
    if (!switchingKinds.includes(d.kind)) throw new Error('VLANはスイッチで作成します');
    const list = parseVlanList(t[1]); if (list === 'all') throw new Error('VLAN IDを指定してください');
    network.update(id, x => { for (const v of list) if (v !== 1 && !(x.vlans ?? []).some(y => y.id === v)) x.vlans = [...(x.vlans ?? []), { id: v, name: `VLAN${String(v).padStart(4, '0')}` }]; });
    s.mode = 'vlan'; s.vlan = list[0]; return '';
  }
  if (t[0] === 'no' && t[1] === 'vlan' && t[2]) { const v = num(t[2], 2, 4094, 'VLAN ID'); network.update(id, x => { x.vlans = (x.vlans ?? []).filter(y => y.id !== v); }); return ''; }
  if (t[0] === 'spanning-tree' || (t[0] === 'no' && t[1] === 'spanning-tree')) {
    if (!switchingKinds.includes(d.kind)) throw new Error('STPはスイッチの機能です');
    const neg = t[0] === 'no'; const a = t.slice(neg ? 2 : 1);
    if (a[0] === 'vlan') a.splice(0, 2); // single instance: `spanning-tree vlan <list> …` applies to the one tree
    if (a.length && a[0] !== 'priority') throw new Error(`spanning-tree ${a[0]} は未対応です（spanning-tree [priority <0-61440>] / no spanning-tree [priority]。cost / portfast は interface モードで設定します）`);
    network.update(id, x => {
      const stp = x.stp ??= { enabled: true, priority: 32768 };
      if (neg) { if (a[0] === 'priority') stp.priority = 32768; else stp.enabled = false; }
      else { stp.enabled = true; if (a[0] === 'priority') { const p = num(a[1], 0, 61440, 'priority'); if (p % 4096) throw new Error('priority は4096の倍数です（0, 4096, 8192 …）'); stp.priority = p; } }
    });
    return '';
  }
  if (t[0] === 'router' && t[1] === 'ospf') {
    if (!forwardingKinds.includes(d.kind)) throw new Error('OSPFはルータ系機器で設定します');
    const pid = num(t[2], 1, 65535, 'プロセスID');
    network.update(id, x => { x.ospf ??= { processId: pid, networks: [], passive: [] }; });
    s.mode = 'router-ospf'; return '';
  }
  if (t[0] === 'no' && t[1] === 'router' && t[2] === 'ospf') { network.update(id, x => { delete x.ospf; }); return ''; }
  if (t[0] === 'router' && t[1] === 'bgp') {
    if (!forwardingKinds.includes(d.kind)) throw new Error('BGPはルータ系機器で設定します');
    const asn = num(t[2], 1, 4_294_967_295, 'AS番号');
    if (d.bgp && d.bgp.asn !== asn) throw new Error(`BGPは既に AS ${d.bgp.asn} で動作しています（1台で動かせるBGPのASは1つです。router bgp ${d.bgp.asn} で設定に入ります）`);
    network.update(id, x => { x.bgp ??= { asn, networks: [], neighbors: [] }; });
    s.mode = 'router-bgp'; return '';
  }
  if (t[0] === 'no' && t[1] === 'router' && t[2] === 'bgp') { network.update(id, x => { delete x.bgp; }); return ''; }
  if (t[0] === 'ip' && t[1] === 'access-list' && t[2] === 'extended' && t[3]) {
    network.update(id, x => { if (!(x.acls ?? []).some(a => a.name === t[3])) x.acls = [...(x.acls ?? []), { name: t[3], rules: [] }]; });
    s.mode = 'acl'; s.acl = t[3]; return '';
  }
  if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'access-list' && t[4]) { network.update(id, x => { x.acls = (x.acls ?? []).filter(a => a.name !== t[4]); }); return ''; }
  if (t[0] === 'ip' && t[1] === 'prefix-list' && t[2]) {
    const seqAt = t[3] === 'seq' ? 4 : -1; const seq = seqAt > 0 ? num(t[4], 1, 65535, 'seq') : undefined; const a = seqAt > 0 ? 5 : 3;
    const action = t[a] as 'permit' | 'deny'; if ((action !== 'permit' && action !== 'deny') || !t[a + 1]) throw new Error('ip prefix-list <名前> seq <n> permit|deny <CIDR> [ge n] [le n]');
    const prefix = toCidr(t[a + 1]);
    const ge = t.indexOf('ge') > 0 ? num(t[t.indexOf('ge') + 1], 1, 32, 'ge') : undefined; const le = t.indexOf('le') > 0 ? num(t[t.indexOf('le') + 1], 1, 32, 'le') : undefined;
    network.update(id, x => {
      const list = (x.prefixLists ??= []).find(l => l.name === t[2]) ?? (x.prefixLists.push({ name: t[2], entries: [] }), x.prefixLists.at(-1)!);
      const n = seq ?? (Math.max(0, ...list.entries.map(e => e.seq)) + 5);
      list.entries = [...list.entries.filter(e => e.seq !== n), { seq: n, action, prefix, ...(ge ? { ge } : {}), ...(le ? { le } : {}) }].sort((p, q) => p.seq - q.seq);
    });
    return '';
  }
  if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'prefix-list' && t[3]) {
    // `no ip prefix-list P` removes the list; with `seq <n>` (or `permit|deny <CIDR>`) only that entry. A list left empty is removed, like IOS.
    const seq = t[4] === 'seq' ? num(t[5], 1, 65535, 'seq') : undefined; const a = seq ? 6 : 4; const prefix = t[a + 1] && toCidr(t[a + 1]);
    network.update(id, x => {
      const list = x.prefixLists?.find(l => l.name === t[3]);
      if (t.length > 4) { const before = list?.entries.length; if (list) list.entries = list.entries.filter(e => !((seq === undefined || e.seq === seq) && (!prefix || (e.action === t[a] && e.prefix === prefix)))); if (!list || list.entries.length === before) throw new Error('一致するprefix-listのエントリがありません'); }
      x.prefixLists = (x.prefixLists ?? []).filter(l => l.name !== t[3] || (t.length > 4 && l.entries.length));
    });
    return '';
  }
  if (t[0] === 'firewall' || (t[0] === 'no' && t[1] === 'firewall')) {
    if (d.kind !== 'firewall') throw new Error('firewall コマンドはFirewall機器で使用します（ルータではACLを使用）');
    network.update(id, x => {
      const f = x.firewall!;
      if (t[0] === 'no' && t[2] === 'rule') { const n = num(t[3], 1, 65535, 'ルール番号'); const before = f.rules.length; f.rules = f.rules.filter(r => r.seq !== n); if (before === f.rules.length) throw new Error('そのルールはありません'); }
      else if (t[1] === 'mode' && (t[2] === 'stateful' || t[2] === 'stateless')) f.stateful = t[2] === 'stateful';
      else if (t[1] === 'default' && (t[2] === 'permit' || t[2] === 'deny')) f.defaultAction = t[2];
      else if (t[1] === 'rule') { const seq = num(t[2], 1, 65535, 'ルール番号'); const r = parseRule(seq, t.slice(3)); for (const i of [r.inInterface, r.outInterface]) if (i && !x.interfaces.some(y => y.id === i)) throw new Error(`インターフェース ${i} がありません`); f.rules = [...f.rules.filter(y => y.seq !== seq), r].sort((a, b) => a.seq - b.seq); }
      else throw new Error('firewall mode stateful|stateless / firewall default permit|deny / firewall rule <seq> ... / no firewall rule <seq>');
    });
    return '';
  }
  if (cmd === 'clear conntrack' && d.kind === 'firewall') { network.clearConntrack(id); return ''; }
  throw new Error(`未対応の設定コマンドです: ${cmd}（help を参照）`);
}
function ospfCommand(ctx: Context, t: string[]): string {
  const { network, id } = ctx; const neg = t[0] === 'no'; const a = neg ? t.slice(1) : t;
  if (a[0] === 'network') {
    const areaAt = a.indexOf('area'); if (areaAt < 0) throw new Error('network <CIDR> area <n> / network <IP> <wildcard> area <n>');
    const prefix = toCidr(a[1], areaAt === 3 ? a[2] : undefined, true); const area = num(a[areaAt + 1], 0, 65535, 'エリア');
    network.update(id, x => { const o = x.ospf!; o.networks = o.networks.filter(n => !(n.prefix === prefix && n.area === area)); if (!neg) o.networks.push({ prefix, area }); });
    return '';
  }
  if (a[0] === 'passive-interface' && a[1]) { const p = ifaceName(ctx.device, a[1]); network.update(id, x => { const o = x.ospf!; o.passive = o.passive.filter(y => y !== p); if (!neg) o.passive.push(p); }); return ''; }
  if (a[0] === 'router-id') { if (!neg && !a[1]) throw new Error('使い方: router-id <IPv4>'); network.update(id, x => { if (neg) delete x.ospf!.routerId; else { ipv4(a[1]); x.ospf!.routerId = a[1]; } }); return ''; }
  if (a.join(' ') === 'default-information originate') { network.update(id, x => { x.ospf!.defaultOriginate = !neg; }); return ''; }
  if (a[0] === 'maximum-paths') { network.update(id, x => { if (neg) delete x.ospf!.maximumPaths; else x.ospf!.maximumPaths = num(a[1], 1, 16, 'maximum-paths'); }); return ''; }
  return fromSubmode(ctx, t, 'router ospf: network / passive-interface / router-id / default-information originate / maximum-paths <1-16>');
}
function bgpCommand(ctx: Context, t: string[]): string {
  const { network, id } = ctx; const neg = t[0] === 'no'; const a = neg ? t.slice(1) : t;
  if (a[0] === 'neighbor' && a[1]) {
    ipv4(a[1]); const ip = a[1]; const what = a[2];
    network.update(id, x => {
      const b = x.bgp!;
      let n = b.neighbors.find(y => y.ip === ip);
      if (what === 'remote-as') { if (neg) { b.neighbors = b.neighbors.filter(y => y.ip !== ip); return; } const asn = num(a[3], 1, 4_294_967_295, 'AS番号'); if (n) n.remoteAs = asn; else b.neighbors.push({ ip, remoteAs: asn }); return; }
      if (!what && neg) { b.neighbors = b.neighbors.filter(y => y.ip !== ip); return; }
      if (!n) throw new Error(`先に neighbor ${ip} remote-as <AS> を設定してください`);
      n = n!;
      if (what === 'shutdown') n.shutdown = !neg || undefined;
      else if (what === 'next-hop-self') n.nextHopSelf = !neg || undefined;
      else if (what === 'update-source') { if (neg) delete n.updateSource; else n.updateSource = ifaceName(x, a[3] ?? ''); }
      else if (what === 'prefix-list' && (a[4] === 'in' || a[4] === 'out')) { const key = a[4] === 'in' ? 'prefixListIn' : 'prefixListOut'; if (neg) delete n[key]; else n[key] = a[3]; }
      else if (what === 'local-preference') { if (neg) delete n.localPreference; else n.localPreference = num(a[3], 0, 4_294_967_295, 'LOCAL_PREF'); }
      else if (what === 'med') { if (neg) delete n.med; else n.med = num(a[3], 0, 4_294_967_295, 'MED'); }
      else if (what === 'as-path' && a[3] === 'prepend') { if (neg) delete n.prepend; else n.prepend = num(a[4], 0, 10, 'prepend回数'); }
      else throw new Error('neighbor <IP> remote-as|shutdown|next-hop-self|update-source|prefix-list|local-preference|med|as-path prepend');
    });
    return '';
  }
  if (a[0] === 'network' && a[1]) { const prefix = toCidr(a[1], a[2] === 'mask' ? a[3] : undefined); network.update(id, x => { const b = x.bgp!; b.networks = b.networks.filter(y => y !== prefix); if (!neg) b.networks.push(prefix); }); return ''; }
  if (a[0] === 'bgp' && a[1] === 'router-id') { if (!neg && !a[2]) throw new Error('使い方: bgp router-id <IPv4>'); network.update(id, x => { if (neg) delete x.bgp!.routerId; else { ipv4(a[2]); x.bgp!.routerId = a[2]; } }); return ''; }
  return fromSubmode(ctx, t, 'router bgp: neighbor ... / network <CIDR> / bgp router-id <IP>');
}
function aclCommand(ctx: Context, t: string[]): string {
  const name = ctx.session.acl!;
  if (!['permit', 'deny', 'reject', 'remark'].includes(t[0]) && !/^\d+$/.test(t[t[0] === 'no' ? 1 : 0] ?? '')) return fromSubmode(ctx, t, 'ip access-list: [行番号] permit|deny ... / no <行番号> / remark ... / exit');
  if (t[0] === 'remark') return '';
  ctx.network.update(ctx.id, x => {
    const acl = x.acls!.find(a => a.name === name)!;
    if (t[0] === 'no') { const n = num(t[1], 1, 65535, '行番号'); acl.rules = acl.rules.filter(r => r.seq !== n); return; }
    const hasSeq = /^\d+$/.test(t[0]);
    const seq = hasSeq ? num(t[0], 1, 65535, '行番号') : Math.max(0, ...acl.rules.map(r => r.seq)) + 10;
    const rule = parseRule(seq, hasSeq ? t.slice(1) : t);
    if (rule.action === 'reject') throw new Error('ACLで使えるのは permit / deny です（reject は Firewall機器の firewall rule で使います）');
    if (rule.ctState || rule.inInterface || rule.outInterface) throw new Error('ACLでは ctstate / in / out 条件は使えません（ACLはステートレス）');
    acl.rules = [...acl.rules.filter(r => r.seq !== seq), rule].sort((a, b) => a.seq - b.seq);
  });
  return '';
}

export function iosCommand(ctx: Context): string {
  const { session: s, network, id } = ctx;
  const viaDo = ctx.tokens[0] === 'do' && s.mode !== 'user' && s.mode !== 'privileged';
  const t = expand(viaDo ? ctx.tokens.slice(1) : ctx.tokens, viaDo ? EXEC : VOCAB[s.mode]);
  const cmd = t.join(' ');
  if (cmd === 'enable' || cmd === 'en') { s.mode = s.mode === 'user' ? 'privileged' : s.mode; return ''; }
  if (cmd === 'disable') { s.mode = 'user'; return ''; }
  if (cmd === 'end' || cmd === '^Z') { if (s.mode !== 'user') s.mode = 'privileged'; s.iface = undefined; s.range = undefined; return ''; }
  if (cmd === 'exit') { s.mode = ({ interface: 'config', vlan: 'config', 'router-ospf': 'config', 'router-bgp': 'config', acl: 'config', config: 'privileged', privileged: 'user', user: 'user' } as const)[s.mode]; s.iface = undefined; s.range = undefined; return ''; }
  if ((cmd === 'configure terminal' || cmd === 'conf t' || cmd === 'config t')) { if (s.mode === 'user') throw new Error('Invalid input: 先に enable で特権モードに入ってください'); s.mode = 'config'; return ''; }
  if (cmd === 'write memory' || cmd === 'write' || cmd === 'wr' || cmd === 'copy running-config startup-config') return '[OK]（シミュレータの設定はブラウザに自動保存されます）';
  if (!viaDo && s.mode !== 'user' && s.mode !== 'privileged') {
    if (s.mode === 'interface' && s.range) {
      // interface range: run the command on every port of the range (a global command leaves the mode after the first).
      const out: string[] = []; const range = s.range;
      for (const p of range) { if (s.mode !== 'interface') break; s.iface = p; out.push(interfaceCommand({ ...ctx, device: network.device(id) }, t)); }
      if (s.mode === 'interface') s.iface = range[0];
      return [...new Set(out.filter(Boolean))].join('\n');
    }
    if (s.mode === 'interface') return interfaceCommand(ctx, t);
    if (s.mode === 'vlan') { if (t[0] === 'name' && t[1]) { network.update(id, x => { const v = x.vlans?.find(y => y.id === s.vlan); if (!v) throw new Error('Default VLAN 1 may not have its name changed（VLAN 1 は既定のVLANのため名前を変更できません）'); v.name = t.slice(1).join('_').slice(0, 32); }); return ''; } return fromSubmode(ctx, t, 'vlan: name <名前> / exit'); }
    if (s.mode === 'router-ospf') return ospfCommand(ctx, t);
    if (s.mode === 'router-bgp') return bgpCommand(ctx, t);
    if (s.mode === 'acl') return aclCommand(ctx, t);
    return configCommand(ctx, t);
  }
  const [c0, c1] = t;
  if (c0 === 'show' || c0 === 'sh') return show(ctx, t.slice(1));
  if (c0 === 'ping') {
    if (!c1) throw new Error('ping <IPv4> [repeat N] [ttl N]');
    const repeat = t.includes('repeat') ? Number(t[t.indexOf('repeat') + 1]) : 5;
    const ttl = t.includes('ttl') ? Number(t[t.indexOf('ttl') + 1]) : 64;
    return ping(ctx, c1, repeat, ttl, 'ios');
  }
  if (c0 === 'traceroute' || c0 === 'trace') { if (!c1) throw new Error('traceroute <IPv4>'); return traceroute(ctx, c1, 'udp', 33434, 16, 'ios'); }
  if (cmd === 'clear arp' || cmd === 'clear arp-cache' || cmd === 'clear ip arp') { network.clearArp(id); return 'ARPキャッシュをクリアしました'; }
  if (cmd.startsWith('clear mac address-table') || cmd.startsWith('clear mac-address-table')) { network.clearMacTable(id); return 'MACアドレステーブルをクリアしました'; }
  if (cmd === 'clear ip nat translation *') { network.clearNat(id); return 'NAT変換テーブルをクリアしました'; }
  if (cmd === 'clear conntrack') { network.clearConntrack(id); return '接続追跡テーブルをクリアしました'; }
  if (cmd.startsWith('clear ip bgp')) return '（教育用: BGPは設定変更のたびに再計算されます）';
  if (s.mode === 'user' && ['ip', 'interface', 'router', 'vlan', 'no', 'hostname', 'spanning-tree', 'firewall'].includes(c0)) throw new Error('Invalid input: 設定は enable → configure terminal の後に行います');
  if (s.mode === 'privileged' && ['ip', 'interface', 'router', 'vlan', 'no', 'firewall'].includes(c0)) throw new Error('Invalid input: 設定コマンドは configure terminal の後に入力します');
  throw new Error(`未対応のコマンド、またはモードが違います: ${cmd}（今のモードはプロンプト末尾の > / # / (config)# でわかります。help で一覧を表示）`);
}

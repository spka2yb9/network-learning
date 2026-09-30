import { forwardingKinds, switchingKinds, type DeviceState, type FilterRule, type NatRule, type NetworkInterface, type Route } from './types';
import { cidr, interfaceAddress, ipv4, overlaps } from '../l3/ipv4';
import { validVlan } from '../l2/Vlan';
import { normalizeName, validateRecord } from '../services/Dns';

export const deviceKinds = ['pc', 'server', 'router', 'switch', 'l3switch', 'firewall', 'internet'] as const;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
const name = (s: unknown, max = 32) => typeof s === 'string' && /^[A-Za-z0-9_.-]+$/.test(s) && s.length <= max;
const text = (s: unknown, max: number) => s === undefined || (typeof s === 'string' && s.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(s));

export function validateRoute(device: DeviceState, route: Route): Route {
  const destination = cidr(route.destination).canonical;
  if (route.nextHop) ipv4(route.nextHop);
  assert(route.nextHop || route.interfaceId, 'Next Hop または出力ポートが必要です');
  assert(!route.interfaceId || device.interfaces.some(i => i.id === route.interfaceId), '出力ポートがありません');
  assert(isInt(route.preference, 0, 255) && isInt(route.metric, 0, 16_777_215), 'Preference（AD）は0〜255、Metric は0以上の整数です');
  const out: Route = { destination, preference: route.preference, metric: route.metric, kind: 'static' };
  if (route.nextHop) out.nextHop = route.nextHop;
  if (route.interfaceId) out.interfaceId = route.interfaceId;
  return out;
}
function validateRule(r: FilterRule, device: DeviceState): FilterRule {
  assert(isInt(r.seq, 1, 65535), 'ルール番号は1〜65535です');
  assert(['permit', 'deny', 'reject'].includes(r.action) && ['ip', 'tcp', 'udp', 'icmp'].includes(r.protocol), 'ルールの動作・プロトコルが不正です');
  cidr(r.source); cidr(r.destination);
  for (const p of [r.sourcePort, r.destinationPort]) if (p !== undefined) assert(Array.isArray(p) && isInt(p[0], 0, 65535) && isInt(p[1], p[0], 65535) && (r.protocol === 'tcp' || r.protocol === 'udp'), 'ポート条件が不正です');
  assert(r.established === undefined || (typeof r.established === 'boolean' && r.protocol === 'tcp'), 'established は tcp ルールのみです');
  assert(r.ctState === undefined || (Array.isArray(r.ctState) && r.ctState.every(s => ['new', 'established', 'related'].includes(s))), 'ctstateが不正です');
  for (const i of [r.inInterface, r.outInterface]) assert(i === undefined || device.interfaces.some(x => x.id === i), `ルールのインターフェース ${i} がありません`);
  assert(text(r.description, 80), '説明が長すぎます');
  return structuredClone(r);
}

/** Full validation of one device. Throws a learner-readable message on the first problem. */
export function validateDevice(input: DeviceState, others: DeviceState[]): DeviceState {
  assert(input && typeof input === 'object', '機器データが不正です');
  const device = structuredClone(input);
  assert(typeof device.id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/.test(device.id), '機器名は英字で始まり、英数字・_・- だけを使う24文字以内です（例: R1, PC-2）');
  assert(deviceKinds.includes(device.kind), `未対応の機器種別です: ${device.kind}`);
  assert(Array.isArray(device.interfaces) && device.interfaces.length > 0 && device.interfaces.length <= 64, 'インターフェース数は1〜64です');
  assert(Number.isFinite(device.position?.x) && Number.isFinite(device.position?.y), '座標が不正です');
  const forwards = forwardingKinds.includes(device.kind); const switching = switchingKinds.includes(device.kind);
  const ids = new Set<string>();
  const foreignMacs = new Set(others.filter(d => d.id !== device.id).flatMap(d => d.interfaces.map(i => i.mac)));
  const ownMacs = new Set<string>();
  const byId = new Map(device.interfaces.map(i => [i.id, i]));
  for (const iface of device.interfaces as NetworkInterface[]) {
    assert(typeof iface.id === 'string' && /^[a-zA-Z0-9/_.-]{1,24}$/.test(iface.id) && !ids.has(iface.id), `ポート名が不正、または重複しています: ${iface.id}`);
    ids.add(iface.id);
    assert(typeof iface.up === 'boolean', 'インターフェース状態が不正です');
    const kind = iface.kind ?? 'ethernet';
    assert(['ethernet', 'subinterface', 'svi', 'tunnel', 'loopback'].includes(kind), 'インターフェース種別が不正です');
    assert(typeof iface.mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(iface.mac) && !(parseInt(iface.mac.slice(0, 2), 16) & 1), `ユニキャストMACが不正です: ${iface.id}`);
    assert(!foreignMacs.has(iface.mac), `MACアドレスが他の機器と重複しています: ${iface.mac}`);
    if (kind === 'subinterface') {
      const parent = byId.get(iface.parent ?? '');
      assert(parent && (parent.kind ?? 'ethernet') === 'ethernet' && !parent.switchport, `${iface.id}: 親となるルーテッドポートがありません`);
      assert(forwards || device.kind === 'server', 'サブインターフェースはルータ系機器で使用します');
      assert(iface.vlan === undefined || validVlan(iface.vlan), `${iface.id}: encapsulation dot1q のVLAN IDは1〜4094です`);
      assert(iface.vlan !== undefined || !iface.address, `${iface.id}: IPアドレスの前に encapsulation dot1q <VLAN> を設定してください`);
      assert(iface.vlan === undefined || !device.interfaces.some(o => o !== iface && o.kind === 'subinterface' && o.parent === iface.parent && o.vlan === iface.vlan), `${iface.id}: 同じ親ポートで同じVLANが重複しています`);
      assert(iface.mac === parent.mac, 'サブインターフェースのMACは親ポートと同じです');
    } else {
      assert(!ownMacs.has(iface.mac), `機器内でMACアドレスが重複しています: ${iface.mac}`);
      ownMacs.add(iface.mac);
      assert(iface.parent === undefined, '親ポートはサブインターフェースのみ指定できます');
    }
    if (kind === 'svi') { assert(switching, 'SVI (interface vlan) はスイッチで使用します'); assert(validVlan(iface.vlan!), 'SVIのVLAN IDは1〜4094です'); }
    else if (kind !== 'subinterface') assert(iface.vlan === undefined, 'VLAN番号はSVI / サブインターフェースのみです');
    if (kind === 'tunnel') {
      assert(forwards, 'トンネルインターフェースはルータ系機器で使用します');
      if (iface.tunnel) {
        ipv4(iface.tunnel.source); ipv4(iface.tunnel.destination);
        assert(['gre', 'ipsec'].includes(iface.tunnel.mode), 'トンネルモードは gre / ipsec です');
        assert(text(iface.tunnel.psk, 64) && text(iface.tunnel.proposal, 64), 'IKE設定が長すぎます');
      }
    } else assert(iface.tunnel === undefined, 'トンネル設定はトンネルインターフェースのみです');
    if (iface.switchport) {
      assert(switching && kind === 'ethernet', 'switchport はスイッチの物理ポートのみです');
      const sp = iface.switchport;
      assert(['access', 'trunk'].includes(sp.mode) && validVlan(sp.accessVlan) && validVlan(sp.nativeVlan), 'switchport設定が不正です');
      assert(sp.allowedVlans === 'all' || (Array.isArray(sp.allowedVlans) && sp.allowedVlans.length <= 4094 && sp.allowedVlans.every(validVlan)), 'allowed VLANが不正です');
      assert(!iface.address, 'L2ポート（switchport）にはIPアドレスを設定できません。SVIまたは no switchport を使用します');
    } else if (device.kind === 'switch' && kind === 'ethernet') throw new Error('L2スイッチの物理ポートは switchport（L2ポート）のみです。ルーテッドポートが必要ならL3スイッチを使います');
    if (iface.address) {
      interfaceAddress(iface.address);
      assert(device.kind !== 'switch' || kind === 'svi', 'L2スイッチのIPアドレスは管理用SVI（interface vlan）に設定します');
    }
    assert(iface.stpCost === undefined || isInt(iface.stpCost, 1, 200_000_000), 'STPコストが不正です');
    assert(iface.ospfCost === undefined || isInt(iface.ospfCost, 1, 65535), 'OSPFコストは1〜65535です');
    assert(iface.nat === undefined || (forwards && (iface.nat === 'inside' || iface.nat === 'outside')), 'ip nat inside / outside はルータ系機器のみです');
    assert(text(iface.description, 80), 'description は80文字以内です');
    if (iface.acl) for (const a of [iface.acl.in, iface.acl.out]) assert(a === undefined || (device.acls ?? []).some(x => x.name === a), `ACL ${a} が定義されていません`);
  }
  const addressed = device.interfaces.filter(i => i.address && i.kind !== 'tunnel');
  for (let a = 0; a < addressed.length; a++) for (let b = a + 1; b < addressed.length; b++) {
    assert(!overlaps(addressed[a].address!, addressed[b].address!), `${addressed[b].id} のネットワークが ${addressed[a].id} と重複しています（1台の機器で、同じネットワークを2つのポートには設定できません）`);
  }
  if (device.gateway) ipv4(device.gateway);
  assert(Array.isArray(device.routes) && device.routes.length <= 256, '経路表が不正です');
  const routes = device.routes.map(r => validateRoute(device, r));
  if (device.vlans) {
    assert(switching && Array.isArray(device.vlans) && device.vlans.length <= 256, 'VLANデータベースはスイッチのみです');
    const seen = new Set<number>();
    for (const v of device.vlans) { assert(validVlan(v.id) && !seen.has(v.id), `VLAN ${v.id} が不正または重複しています`); assert(text(v.name, 32), 'VLAN名は32文字以内です'); seen.add(v.id); }
  }
  if (device.stp) assert(switching && typeof device.stp.enabled === 'boolean' && isInt(device.stp.priority, 0, 61440) && device.stp.priority % 4096 === 0, 'STP priority は0〜61440の4096刻みです');
  if (device.dnsServers) { assert(Array.isArray(device.dnsServers) && device.dnsServers.length <= 3, 'DNSサーバーは3つまでです'); device.dnsServers.forEach(ipv4); }
  if (device.services) {
    assert(Array.isArray(device.services) && device.services.length <= 16, 'サービスは16個までです');
    for (const s of device.services) {
      assert(name(s.name, 24), 'サービス名が不正です');
      assert((s.protocol === 'tcp' || s.protocol === 'udp') && isInt(s.port, 1, 65535) && ['http', 'https', 'dns', 'ssh', 'generic'].includes(s.app), `${s.name}: サービス設定が不正です`);
      assert(typeof s.running === 'boolean', 'running が不正です');
      ipv4(s.bind);
      if (s.http) assert(isInt(s.http.status, 100, 599) && text(s.http.body, 2000), 'HTTP応答の設定が不正です');
      if (s.tls) { assert(Array.isArray(s.tls.names) && s.tls.names.length <= 8 && typeof s.tls.expired === 'boolean' && typeof s.tls.selfSigned === 'boolean', 'TLS証明書の設定が不正です'); s.tls.names.forEach(n => normalizeName(n.replace(/^\*\./, 'wildcard.'))); }
    }
    assert(new Set(device.services.map(s => `${s.protocol}/${s.port}`)).size === device.services.length, '同じポートで複数のサービスは待ち受けできません');
  }
  if (device.dnsServer) {
    const z = device.dnsServer;
    assert(Array.isArray(z.zones) && z.zones.length <= 20 && typeof z.recursive === 'boolean' && Array.isArray(z.rootHints) && z.rootHints.length <= 13, 'DNSサーバー設定が不正です');
    z.rootHints.forEach(ipv4); (z.allowRecursion ?? []).forEach(c => cidr(c));
    for (const zone of z.zones) {
      zone.origin = normalizeName(zone.origin);
      assert(Array.isArray(zone.records) && zone.records.length <= 300, 'ゾーンのレコード数は300件までです');
      zone.records = zone.records.map(validateRecord);
      assert(zone.records.every(r => r.name === zone.origin || r.name.endsWith(zone.origin === '.' ? '.' : `.${zone.origin}`)), `${zone.origin} の外側の名前は登録できません`);
    }
  }
  if (device.nat) {
    assert(forwards && Array.isArray(device.nat) && device.nat.length <= 32, 'NATはルータ系機器で設定します');
    for (const r of device.nat as NatRule[]) {
      assert(name(r.id, 40), 'NATルールIDが不正です');
      if (r.type === 'pat') { cidr(r.source); assert(device.interfaces.some(i => i.id === r.outInterface), 'NATの出力インターフェースがありません'); }
      else if (r.type === 'static') { ipv4(r.inside); ipv4(r.outside); }
      else if (r.type === 'port-forward') { ipv4(r.inside); ipv4(r.outside); assert((r.protocol === 'tcp' || r.protocol === 'udp') && isInt(r.insidePort, 1, 65535) && isInt(r.outsidePort, 1, 65535), 'ポートフォワード設定が不正です'); }
      else throw new Error('NATルール種別が不正です');
    }
  }
  if (device.acls) {
    assert(Array.isArray(device.acls) && device.acls.length <= 32, 'ACLは32個までです');
    for (const acl of device.acls) { assert(name(acl.name), 'ACL名が不正です'); assert(Array.isArray(acl.rules) && acl.rules.length <= 100, 'ACLのルールは100行までです'); acl.rules = acl.rules.map(r => validateRule(r, device)); }
  }
  if (device.firewall) {
    const f = device.firewall;
    assert(typeof f.stateful === 'boolean' && (f.defaultAction === 'permit' || f.defaultAction === 'deny') && Array.isArray(f.rules) && f.rules.length <= 200, 'Firewallポリシーが不正です');
    f.rules = f.rules.map(r => validateRule(r, device));
  }
  if (device.ospf) {
    const o = device.ospf;
    assert(forwards && isInt(o.processId, 1, 65535) && Array.isArray(o.networks) && Array.isArray(o.passive), 'OSPF設定が不正です');
    if (o.routerId) ipv4(o.routerId);
    o.networks = o.networks.map(n => { assert(isInt(n.area, 0, 65535), 'OSPFエリアは0〜65535です（簡略化）'); return { prefix: cidr(n.prefix).canonical, area: n.area }; });
    o.passive.forEach(p => assert(device.interfaces.some(i => i.id === p), `passive-interface ${p} がありません`));
  }
  if (device.prefixLists) {
    for (const l of device.prefixLists) {
      assert(name(l.name) && Array.isArray(l.entries) && l.entries.length <= 100, 'prefix-listが不正です');
      l.entries = l.entries.map(e => {
        const range = cidr(e.prefix);
        assert(isInt(e.seq, 1, 65535) && (e.action === 'permit' || e.action === 'deny'), 'prefix-listの行が不正です');
        assert(e.ge === undefined || isInt(e.ge, range.prefix + 1, 32), 'ge はプレフィックス長より大きく32以下です');
        assert(e.le === undefined || isInt(e.le, Math.max(range.prefix, e.ge ?? 0), 32), 'le はプレフィックス長（ge）以上32以下です');
        return { ...e, prefix: range.canonical };
      });
    }
  }
  if (device.bgp) {
    const b = device.bgp;
    assert(forwards && isInt(b.asn, 1, 4_294_967_295) && Array.isArray(b.networks) && Array.isArray(b.neighbors) && b.neighbors.length <= 32, 'BGP設定が不正です');
    if (b.routerId) ipv4(b.routerId);
    b.networks = b.networks.map(n => cidr(n).canonical);
    const seen = new Set<string>();
    for (const n of b.neighbors) {
      ipv4(n.ip); assert(!seen.has(n.ip), `neighbor ${n.ip} が重複しています`); seen.add(n.ip);
      assert(isInt(n.remoteAs, 1, 4_294_967_295), 'remote-as が不正です');
      for (const list of [n.prefixListIn, n.prefixListOut]) assert(list === undefined || (device.prefixLists ?? []).some(l => l.name === list), `prefix-list ${list} が定義されていません`);
      assert(n.updateSource === undefined || device.interfaces.some(i => i.id === n.updateSource), 'update-source のインターフェースがありません');
      assert(n.localPreference === undefined || isInt(n.localPreference, 0, 4_294_967_295), 'local-preference が不正です');
      assert(n.med === undefined || isInt(n.med, 0, 4_294_967_295), 'MED が不正です');
      assert(n.prepend === undefined || isInt(n.prepend, 0, 10), 'AS_PATH prepend は0〜10回です');
    }
  }
  return { ...device, routes };
}

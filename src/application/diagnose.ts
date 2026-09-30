import { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import { cidr, contains, isIpv4 } from '../simulator/l3/ipv4';

export interface LayerCheck { layer: string; question: string; command: string; ok: boolean | undefined; detail: string }

/**
 * The troubleshooting ladder, run on an isolated copy:
 * Link → IP → same subnet / gateway → ARP → Route → DNS → TCP → TLS → Application.
 * Stops at the first failing layer (later layers are "not reached").
 */
export function diagnose(snapshot: NetworkSnapshot, source: string, url: string): LayerCheck[] {
  const n = NetworkSimulator.fromSnapshot(snapshot);
  const d = n.device(source);
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(url);
  const scheme = m?.[1] ?? 'http'; const host = m?.[2] ?? url; const port = Number(m?.[3] ?? (scheme === 'https' ? 443 : 80));
  const out: LayerCheck[] = [];
  let stop = false;
  const step = (layer: string, question: string, command: string, fn: () => [boolean, string]) => {
    if (stop) { out.push({ layer, question, command, ok: undefined, detail: '下の段で失敗したため、確認していません' }); return; }
    const [ok, detail] = fn(); out.push({ layer, question, command, ok, detail }); if (!ok) stop = true;
  };
  const iface = d.interfaces.find(i => i.address && (i.kind ?? 'ethernet') === 'ethernet') ?? d.interfaces[0];
  step('Link', 'リンク（NIC）は上がっているか', 'ip link', () => {
    if (!iface.up) return [false, `${iface.id} が DOWN です（ip link set ${iface.id} up で上げられます）`];
    if (d.lineDown?.includes(iface.id)) return [false, `${iface.id} は NO-CARRIER（信号が来ていない）です。ケーブル、リンクの状態、相手側のポートを確認します`];
    return [true, `${iface.id} は UP です`];
  });
  step('IP', 'IPアドレスが設定されているか', 'ip addr', () => iface.address ? [true, `${iface.id} ${iface.address}`] : [false, 'IPアドレスが設定されていません']);
  step('Subnet', 'Default Gateway（LANの出口のルータ）は同じサブネットにあるか', 'ip route', () => {
    if (!d.gateway) return [false, 'Default Gatewayが設定されていません'];
    return contains(cidr(iface.address!).canonical, d.gateway) ? [true, `Gateway ${d.gateway} は ${cidr(iface.address!).canonical} の中にあります`] : [false, `Gateway ${d.gateway} が自分のサブネット ${cidr(iface.address!).canonical} の外にあります`];
  });
  step('ARP', 'GatewayのMACアドレスをARPで調べられるか', 'ping <gateway> → ip neigh', () => {
    const r = n.ping(source, d.gateway!);
    const reply = r.events.find(e => e.type === 'ARP_REPLY' && e.message.startsWith(d.gateway!));
    return reply || r.success ? [true, reply?.message ?? 'ARPキャッシュに登録済みです'] : [false, `${d.gateway} からARPの応答がありません。スイッチ・VLAN・Gateway側のインターフェースを確認します`];
  });
  const resolver = d.dnsServers?.[0];
  const target = isIpv4(host) ? host : resolver;
  step('Route', '宛先（名前で指定したときはDNSサーバー）まで往復できるか', `traceroute -I ${target ?? '<宛先>'}`, () => {
    if (!target) return [false, 'DNSサーバーが設定されていません（/etc/resolv.conf）'];
    const r = n.ping(source, target);
    if (r.success) return [true, `${target} までpingが往復できます`];
    const probes = n.traceroute(source, target, 16, 'icmp');
    const last = probes.at(-1);
    return [false, last?.marker ? `${last.address} が ${last.marker} を返しました（経路がない、または拒否された）` : `${target} までpingが往復できません（${r.reason}）`];
  });
  let address = isIpv4(host) ? host : undefined;
  step('DNS', 'DNSで名前からIPアドレスを引けるか', `dig ${host}`, () => {
    if (address) return [true, 'IPアドレスで指定しているため、DNSは使いません'];
    const r = n.dnsLookup(source, host);
    address = r.message?.answer.find(a => a.type === 'A')?.value;
    return address ? [true, `${host} → ${address}`] : [false, `名前解決に失敗しました: ${r.reason}`];
  });
  step('TCP', `TCP ${port}番ポートに接続できるか`, `nc -zv ${host} ${port}`, () => { const r = n.tcpConnect(source, address!, port); return [r.success, r.success ? '3-way handshake が成立しました' : r.reason]; });
  if (scheme === 'https') step('TLS', 'TLSの接続が成立するか（証明書は正しいか）', `curl -v ${url}`, () => { const r = n.http(source, url); const tls = r.stages.find(s => s.layer === 'TLS'); return [!!tls?.ok, tls?.detail ?? r.reason]; });
  step('Application', 'アプリケーションが正しく応答するか', `curl -I ${url}`, () => { const r = n.http(source, url); return [r.success, r.status ? `HTTP ${r.status}` : r.reason]; });
  return out;
}

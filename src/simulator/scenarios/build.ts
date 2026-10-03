import { createDevice, logicalMac, NetworkSimulator } from '../core/NetworkSimulator';
import type { DeviceKind, DeviceState, LagMode, ServiceConfig } from '../core/types';

export interface DeviceSpec {
  id: string;
  kind: DeviceKind;
  at: [number, number];
  ip?: Record<string, string>;
  gw?: string;
  dns?: string[];
  routes?: [string, string][];
  set?: (d: DeviceState) => void;
}
/** Compact topology builder shared by every lab. Each call yields an independent simulator. Optional 5th link field: speed in Mbps (default 1000). */
export function build(devices: DeviceSpec[], links: ([string, string, string, string] | [string, string, string, string, number])[], opts: { latency?: number } = {}) {
  const n = new NetworkSimulator();
  devices.forEach((spec, i) => {
    const d = createDevice(spec.id, spec.kind, i + 1, { x: spec.at[0], y: spec.at[1] });
    for (const [port, address] of Object.entries(spec.ip ?? {})) {
      const iface = d.interfaces.find(p => p.id === port);
      if (!iface) throw new Error(`${spec.id}: ${port} がありません`);
      iface.address = address;
    }
    if (spec.gw) d.gateway = spec.gw;
    if (spec.dns) d.dnsServers = spec.dns;
    for (const [destination, nextHop] of spec.routes ?? []) d.routes.push({ destination, nextHop, preference: 1, metric: 0, kind: 'static' });
    spec.set?.(d);
    n.addDevice(d);
  });
  links.forEach(([a, pa, b, pb, bandwidth = 1000], i) => n.connect({ id: `link-${i + 1}`, sourceDevice: a, sourceInterface: pa, targetDevice: b, targetInterface: pb, up: true, bandwidth, latency: opts.latency ?? 1 }));
  return n;
}

// ---- small config helpers used by scenarios, CLI and tests ----
export const web = (name = 'nginx', body = '<h1>It works!</h1>', port = 80): ServiceConfig => ({ name, protocol: 'tcp', port, app: 'http', running: true, bind: '0.0.0.0', http: { status: 200, body } });
export const https = (names: string[], body = '<h1>Secure page</h1>', name = 'nginx-tls'): ServiceConfig => ({ name, protocol: 'tcp', port: 443, app: 'https', running: true, bind: '0.0.0.0', http: { status: 200, body }, tls: { names, expired: false, selfSigned: false } });
export const dnsService = (): ServiceConfig => ({ name: 'named', protocol: 'udp', port: 53, app: 'dns', running: true, bind: '0.0.0.0' });
export const ssh = (): ServiceConfig => ({ name: 'sshd', protocol: 'tcp', port: 22, app: 'ssh', running: true, bind: '0.0.0.0' });
/** `iperf3 -s`: target of the throughput measurement. */
export const iperf = (): ServiceConfig => ({ name: 'iperf3', protocol: 'tcp', port: 5201, app: 'generic', running: true, bind: '0.0.0.0' });
/** Bundle physical ports into `po<group>`. The port-channel takes the first member's L2 settings (like IOS). */
export function lag(d: DeviceState, group: number, mode: LagMode, ...ports: string[]) {
  const first = d.interfaces.find(i => i.id === ports[0])!;
  if (!d.interfaces.some(i => i.id === `po${group}`)) d.interfaces.push({ id: `po${group}`, kind: 'port-channel', mac: logicalMac(d, 0x40, group), up: true, ...(first.switchport ? { switchport: structuredClone(first.switchport) } : {}) });
  for (const p of ports) d.interfaces.find(i => i.id === p)!.channelGroup = { group, mode };
}
/** Add physical ports up to `count` (same naming and MAC scheme as createDevice). */
export function addPorts(d: DeviceState, count: number) {
  const base = d.interfaces[0].mac.split(':').slice(0, 5).join(':');
  const switching = !!d.interfaces[0].switchport;
  for (let i = d.interfaces.filter(x => (x.kind ?? 'ethernet') === 'ethernet').length; i < count; i++) {
    d.interfaces.push({ id: switching ? `g0/${i + 1}` : `g0/${i}`, up: true, mac: `${base}:${(i + 1).toString(16).padStart(2, '0')}`, ...(switching ? { switchport: { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 } } : {}) });
  }
}
export function access(d: DeviceState, vlan: number, ...ports: string[]) {
  for (const p of ports) d.interfaces.find(i => i.id === p)!.switchport = { mode: 'access', accessVlan: vlan, allowedVlans: 'all', nativeVlan: 1 };
}
export function trunk(d: DeviceState, port: string, allowed: number[] | 'all' = 'all', native = 1) {
  d.interfaces.find(i => i.id === port)!.switchport = { mode: 'trunk', accessVlan: 1, allowedVlans: allowed, nativeVlan: native };
}
export function vlans(d: DeviceState, ...list: [number, string][]) { d.vlans = list.map(([id, name]) => ({ id, name })); }
export function subinterface(d: DeviceState, parent: string, vlan: number, address: string) {
  const p = d.interfaces.find(i => i.id === parent)!;
  d.interfaces.push({ id: `${parent}.${vlan}`, kind: 'subinterface', parent, vlan, mac: p.mac, up: true, address });
}
export function svi(d: DeviceState, vlan: number, address: string) {
  d.interfaces.push({ id: `vlan${vlan}`, kind: 'svi', vlan, mac: logicalMac(d, 0x10, vlan), up: true, address });
}
export function loopback(d: DeviceState, n: number, address: string) {
  d.interfaces.push({ id: `lo${n}`, kind: 'loopback', mac: logicalMac(d, 0x20, n), up: true, address });
}
export function tunnel(d: DeviceState, n: number, address: string, source: string, destination: string, mode: 'gre' | 'ipsec' = 'ipsec', psk = 'path-demo-psk') {
  d.interfaces.push({ id: `tunnel${n}`, kind: 'tunnel', mac: logicalMac(d, 0x30, n), up: true, address,
    tunnel: { source, destination, mode, ...(mode === 'ipsec' ? { psk, proposal: 'aes256-sha256' } : {}) } });
}

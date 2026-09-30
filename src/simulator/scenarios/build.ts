import { createDevice, logicalMac, NetworkSimulator } from '../core/NetworkSimulator';
import type { DeviceKind, DeviceState, ServiceConfig } from '../core/types';

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
/** Compact topology builder shared by every lab. Each call yields an independent simulator. */
export function build(devices: DeviceSpec[], links: [string, string, string, string][], opts: { latency?: number } = {}) {
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
  links.forEach(([a, pa, b, pb], i) => n.connect({ id: `link-${i + 1}`, sourceDevice: a, sourceInterface: pa, targetDevice: b, targetInterface: pb, up: true, bandwidth: 1000, latency: opts.latency ?? 1 }));
  return n;
}

// ---- small config helpers used by scenarios, CLI and tests ----
export const web = (name = 'nginx', body = '<h1>It works!</h1>', port = 80): ServiceConfig => ({ name, protocol: 'tcp', port, app: 'http', running: true, bind: '0.0.0.0', http: { status: 200, body } });
export const https = (names: string[], body = '<h1>Secure page</h1>', name = 'nginx-tls'): ServiceConfig => ({ name, protocol: 'tcp', port: 443, app: 'https', running: true, bind: '0.0.0.0', http: { status: 200, body }, tls: { names, expired: false, selfSigned: false } });
export const dnsService = (): ServiceConfig => ({ name: 'named', protocol: 'udp', port: 53, app: 'dns', running: true, bind: '0.0.0.0' });
export const ssh = (): ServiceConfig => ({ name: 'sshd', protocol: 'tcp', port: 22, app: 'ssh', running: true, bind: '0.0.0.0' });
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

import type { DeviceState, NatEntry, NatRule, NetworkInterface, Packet } from '../core/types';
import { contains, ipOf } from '../l3/ipv4';
import { encodeIp } from '../capture/encode';
import { flowKey } from './FirewallEngine';

/** Cisco IOS default translation timeouts (tcp 24h, udp 5min, icmp 1min). */
const TIMEOUT = { tcp: 86_400_000, udp: 300_000, icmp: 60_000 };

export function withSource(packet: Packet, ip: string, port?: number): Packet {
  if ((packet.protocol === 'TCP' || packet.protocol === 'UDP') && port !== undefined) return { ...packet, source: ip, sourcePort: port };
  if (packet.protocol === 'ICMP' && port !== undefined && (packet.type === 'echo-request' || packet.type === 'echo-reply')) return { ...packet, source: ip, identifier: port };
  return { ...packet, source: ip };
}
export function withDestination(packet: Packet, ip: string, port?: number): Packet {
  if ((packet.protocol === 'TCP' || packet.protocol === 'UDP') && port !== undefined) return { ...packet, destination: ip, destinationPort: port };
  if (packet.protocol === 'ICMP' && port !== undefined && (packet.type === 'echo-request' || packet.type === 'echo-reply')) return { ...packet, destination: ip, identifier: port };
  return { ...packet, destination: ip };
}
export const natRuleText = (r: NatRule) => r.type === 'pat' ? `ip nat inside source ${r.source} interface ${r.outInterface} overload`
  : r.type === 'static' ? `ip nat inside source static ${r.inside} ${r.outside}`
  : `ip nat inside source static ${r.protocol} ${r.inside} ${r.insidePort} ${r.outside} ${r.outsidePort}`;

export interface NatResult { packet: Packet; entry: NatEntry; before: string; after: string }
const socket = (ip: string, port?: number) => port === undefined ? ip : `${ip}:${port}`;

function live(device: DeviceState, now: number) {
  device.natTable = (device.natTable ?? []).filter(e => e.expiresAt > now);
  return device.natTable;
}
function freePort(table: NatEntry[], protocol: NatEntry['protocol'], global: string, preferred: number) {
  const used = (p: number) => table.some(e => e.protocol === protocol && e.insideGlobal === global && e.insideGlobalPort === p);
  if (!used(preferred)) return preferred;
  for (let p = 1024; p <= 65535; p++) if (!used(p)) return p;
  throw new Error('NATポートを割り当てられません');
}

/** Inside → outside (source translation), evaluated after routing like Cisco IOS. */
export function natOutbound(device: DeviceState, packet: Packet, outIface: NetworkInterface, now: number): NatResult | undefined {
  const table = live(device, now);
  const rules = device.nat ?? [];
  const flow = flowKey(packet);
  const before = socket(packet.source, flow?.sourcePort);
  const result = (entry: NatEntry): NatResult => {
    entry.expiresAt = now + TIMEOUT[entry.protocol];
    const translated = withSource(packet, entry.insideGlobal, flow ? entry.insideGlobalPort : undefined);
    return { packet: translated, entry, before, after: socket(entry.insideGlobal, flow ? entry.insideGlobalPort : undefined) };
  };
  if (flow) {
    const existing = table.find(e => e.protocol === flow.protocol && e.insideLocal === flow.source && e.insideLocalPort === flow.sourcePort
      && e.outside === flow.destination && (flow.protocol === 'icmp' || e.outsidePort === flow.destinationPort));
    if (existing) return result(existing);
  }
  const stat = rules.find(r => r.type === 'static' && r.inside === packet.source);
  if (stat && stat.type === 'static') {
    const entry: NatEntry = { protocol: flow?.protocol ?? 'icmp', insideLocal: packet.source, insideLocalPort: flow?.sourcePort ?? 0, insideGlobal: stat.outside,
      insideGlobalPort: flow?.sourcePort ?? 0, outside: packet.destination, outsidePort: flow?.destinationPort ?? 0, rule: natRuleText(stat), expiresAt: 0 };
    if (flow) table.push(entry);
    return result(entry);
  }
  const pat = rules.find(r => r.type === 'pat' && r.outInterface === outIface.id && contains(r.source, packet.source));
  const global = ipOf(outIface.address);
  if (pat && flow && global) {
    const port = freePort(table, flow.protocol, global, flow.sourcePort);
    const entry: NatEntry = { protocol: flow.protocol, insideLocal: flow.source, insideLocalPort: flow.sourcePort, insideGlobal: global, insideGlobalPort: port,
      outside: flow.destination, outsidePort: flow.protocol === 'icmp' ? port : flow.destinationPort, rule: natRuleText(pat), expiresAt: 0 };
    table.push(entry);
    return result(entry);
  }
  return undefined;
}

/** Outside → inside (destination translation), evaluated before routing. */
export function natInbound(device: DeviceState, packet: Packet, now: number): NatResult | undefined {
  const table = live(device, now);
  const rules = device.nat ?? [];
  // ICMP errors quote the translated packet: map them back to the inside host.
  if (packet.protocol === 'ICMP' && packet.original) {
    const of = flowKey(packet.original);
    const entry = of && table.find(e => e.protocol === of.protocol && e.insideGlobal === of.source && e.insideGlobalPort === of.sourcePort && e.outside === of.destination);
    const stat = !entry ? rules.find(r => r.type === 'static' && r.outside === packet.destination) : undefined;
    if (entry || (stat && stat.type === 'static')) {
      const inside = entry ? entry.insideLocal : (stat as Extract<NatRule, { type: 'static' }>).inside;
      const original = withSource(packet.original, inside, entry ? entry.insideLocalPort : undefined);
      const translated: Packet = { ...packet, destination: inside, original, quote: encodeIp(original).slice(0, 28) };
      return { packet: translated, entry: entry ?? { protocol: 'icmp', insideLocal: inside, insideLocalPort: 0, insideGlobal: packet.destination, insideGlobalPort: 0, outside: packet.source, outsidePort: 0, rule: natRuleText(stat!), expiresAt: now },
        before: packet.destination, after: inside };
    }
    return undefined;
  }
  const flow = flowKey(packet);
  const before = socket(packet.destination, flow?.destinationPort);
  const result = (entry: NatEntry): NatResult => {
    entry.expiresAt = now + TIMEOUT[entry.protocol];
    return { packet: withDestination(packet, entry.insideLocal, flow ? entry.insideLocalPort : undefined), entry, before, after: socket(entry.insideLocal, flow ? entry.insideLocalPort : undefined) };
  };
  if (flow) {
    const existing = table.find(e => e.protocol === flow.protocol && e.insideGlobal === flow.destination && e.insideGlobalPort === flow.destinationPort
      && e.outside === flow.source && (flow.protocol === 'icmp' || e.outsidePort === flow.sourcePort));
    if (existing) return result(existing);
    const forward = rules.find(r => r.type === 'port-forward' && r.protocol === flow.protocol && r.outside === flow.destination && r.outsidePort === flow.destinationPort);
    if (forward && forward.type === 'port-forward') {
      const entry: NatEntry = { protocol: flow.protocol, insideLocal: forward.inside, insideLocalPort: forward.insidePort, insideGlobal: forward.outside, insideGlobalPort: forward.outsidePort,
        outside: flow.source, outsidePort: flow.sourcePort, rule: natRuleText(forward), expiresAt: 0 };
      table.push(entry);
      return result(entry);
    }
  }
  const stat = rules.find(r => r.type === 'static' && r.outside === packet.destination);
  if (stat && stat.type === 'static') {
    const entry: NatEntry = { protocol: flow?.protocol ?? 'icmp', insideLocal: stat.inside, insideLocalPort: flow?.destinationPort ?? 0, insideGlobal: stat.outside,
      insideGlobalPort: flow?.destinationPort ?? 0, outside: packet.source, outsidePort: flow?.sourcePort ?? 0, rule: natRuleText(stat), expiresAt: 0 };
    if (flow) table.push(entry);
    return result(entry);
  }
  return undefined;
}

import { describe, expect, it } from 'vitest';
import { NetworkSimulator, createDevice } from './NetworkSimulator';
import { routingScenario } from '../scenarios/routing';
import { bits, cidr, contains, dotted, interfaceAddress, ipv4 } from '../l3/ipv4';
import { longestPrefixMatch, resolveRoute } from '../l3/RoutingTable';
import { checksum } from '../capture/encode';
import { packetFilter } from '../capture/PacketFilter';
import type { Route } from './types';

describe('IPv4 / CIDR', () => {
  it('explains a /27 bitwise', () => {
    const c = cidr('192.168.10.70/27');
    expect(dotted(c.network)).toBe('192.168.10.64');
    expect(dotted(c.mask)).toBe('255.255.255.224');
    expect(dotted(c.broadcast)).toBe('192.168.10.95');
    expect(c.hostCount).toBe(30);
    expect(bits(c.ip)).toBe('11000000.10101000.00001010.01000110');
  });
  it.each(['/0', '/31', '/32'])('handles prefix %s without signed overflow', prefix => {
    const c = cidr(`192.168.10.70${prefix}`);
    expect(c.network).toBeGreaterThanOrEqual(0);
    expect(contains(c.canonical, c.address)).toBe(true);
  });
  it('supports point-to-point /31 and host /32', () => {
    expect(cidr('10.0.0.0/31').hostCount).toBe(2);
    expect(cidr('10.0.0.1/32').hostCount).toBe(1);
    expect(interfaceAddress('10.0.0.0/31')).toBe('10.0.0.0/31');
  });
  it.each(['300.1.1.1', '192.168.01.1', '127.1', '0xC0.168.1.1', '::1', '1.2.3'])('rejects non-canonical IPv4 %s', value => expect(() => ipv4(value)).toThrow());
  it.each(['10.0.0.1/33', '10.0.0.1/-1', '10.0.0.1/', '10.0.0.1/24/x'])('rejects invalid CIDR %s', value => expect(() => cidr(value)).toThrow());
  it.each(['10.0.0.0/24', '10.0.0.255/24', '224.0.0.1/24'])('rejects invalid interface host %s', value => expect(() => interfaceAddress(value)).toThrow());
});
describe('Routing', () => {
  const route = (destination: string, preference = 1, metric = 0): Route => ({ destination, nextHop: '10.0.0.1', kind: 'static', preference, metric });
  it('chooses prefix before preference before metric', () => {
    const routes = [route('0.0.0.0/0'), route('192.168.0.0/16'), route('192.168.2.0/24', 100), route('192.168.2.0/24', 10, 50), route('192.168.2.0/24', 10, 5)];
    expect(longestPrefixMatch(routes, '192.168.2.10')).toEqual(routes[4]);
    expect(longestPrefixMatch(routes, '8.8.8.8')).toEqual(routes[0]);
  });
  it('does not invent a default route', () => expect(longestPrefixMatch([], '8.8.8.8')).toBeUndefined());
  it('resolves recursive next hops', () => {
    const n = routingScenario();
    n.addRoute('R1', { destination: '172.16.0.1/32', nextHop: '10.0.0.2', preference: 1, metric: 0 });
    n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '172.16.0.1', preference: 1, metric: 0 });
    expect(resolveRoute(n.device('R1'), '192.168.2.10')?.nextHop).toBe('10.0.0.2');
  });
  it('detects recursive next-hop cycles', () => {
    const n = routingScenario();
    n.addRoute('R1', { destination: '172.16.0.1/32', nextHop: '172.16.0.2', preference: 1, metric: 0 });
    n.addRoute('R1', { destination: '172.16.0.2/32', nextHop: '172.16.0.1', preference: 1, metric: 0 });
    expect(resolveRoute(n.device('R1'), '172.16.0.1')).toBeUndefined();
  });
  it('skips a route whose next hop does not resolve; AD 255 is never used; re-entering a route updates its AD', () => {
    const n = routingScenario(true);
    n.addRoute('R1', { destination: '192.168.2.0/25', nextHop: '172.31.0.1', preference: 1, metric: 0 });
    expect(resolveRoute(n.device('R1'), '192.168.2.10')?.route.destination).toBe('192.168.2.0/24');
    expect(n.installed('R1').map(r => r.destination)).not.toContain('192.168.2.0/25');
    expect(n.ping('PC1', '192.168.2.10').success).toBe(true);
    n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 200, metric: 0 });
    expect(n.device('R1').routes.filter(r => r.destination === '192.168.2.0/24')).toMatchObject([{ preference: 200 }]);
    n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 255, metric: 0 });
    expect(resolveRoute(n.device('R1'), '192.168.2.10')).toBeUndefined();
    expect(n.installed('R1').map(r => r.destination)).not.toContain('192.168.2.0/24');
  });
});
describe('Vertical slice / packet semantics', () => {
  it('fails before configuration; succeeds after forward AND return routes are set', () => {
    const n = routingScenario();
    expect(n.ping('PC1', '192.168.2.10').success).toBe(false);
    n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 1, metric: 0 });
    const partial = n.ping('PC1', '192.168.2.10');
    expect(partial.success).toBe(false);
    expect(partial.reason).toContain('応答が戻りません');
    n.addRoute('R2', { destination: '192.168.1.0/24', nextHop: '10.0.0.1', preference: 1, metric: 0 });
    expect(n.ping('PC1', '192.168.2.10').success).toBe(true);
    expect(n.ping('PC2', '192.168.1.10').success).toBe(true);
  });
  it('supports the smaller PC → Router → PC network', () => {
    const n = routingScenario();
    n.removeDevice('R2');
    n.configureInterface('R1', 'g0/1', '192.168.2.1/24', true);
    n.connect({ id: 'direct', sourceDevice: 'R1', sourceInterface: 'g0/1', targetDevice: 'PC2', targetInterface: 'eth0', up: true, bandwidth: 1000, latency: 1 });
    expect(n.ping('PC1', '192.168.2.10').success).toBe(true);
  });
  it('fails after route deletion and recovers after restoring it', () => {
    const n = routingScenario(true);
    n.deleteRoute('R1', '192.168.2.0/24');
    expect(n.ping('PC1', '192.168.2.10').reason).toContain('R1');
    n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 1, metric: 0 });
    expect(n.ping('PC1', '192.168.2.10').success).toBe(true);
  });
  it('uses next-hop ARP, not remote destination ARP, and learns on both ends', () => {
    const n = routingScenario(true);
    const r = n.ping('PC1', '192.168.2.10');
    expect(n.device('PC1').arp[0].ip).toBe('192.168.1.1');
    expect(n.device('R1').arp.some(a => a.ip === '192.168.1.10')).toBe(true);
    expect(r.events.filter(e => e.type === 'ARP_REQUEST')).toHaveLength(3);
    expect(n.ping('PC1', '192.168.2.10').events.filter(e => e.type === 'ARP_REQUEST')).toHaveLength(0);
    n.advanceTime(120001);
    expect(n.ping('PC1', '192.168.2.10').events.filter(e => e.type === 'ARP_REQUEST')).toHaveLength(3);
  });
  it('changes MAC per hop and decrements TTL only at routers', () => {
    const r = routingScenario(true).ping('PC1', '192.168.2.10');
    const frames = r.events.filter(e => e.type === 'FRAME_SENT' && e.packet?.protocol === 'ICMP' && e.packet.type === 'echo-request');
    expect(frames.map(e => e.packet?.ttl)).toEqual([64, 63, 62]);
    expect(new Set(frames.map(e => e.sourceMac)).size).toBe(3);
    expect(new Set(frames.map(e => e.packet?.source)).size).toBe(1);
    expect(r.reply?.ttl).toBe(62);
  });
  it('returns actual TTL expiry replies for traceroute', () => {
    const probes = routingScenario(true).traceroute('PC1', '192.168.2.10');
    expect(probes.map(p => p.address)).toEqual(['192.168.1.1', '10.0.0.2', '192.168.2.10']);
    const first = probes[0].result.reply;
    expect(first?.protocol === 'ICMP' && first.type).toBe('time-exceeded');
  });
  it('traceroute does not reveal a hop whose ICMP reply cannot return', () => {
    const n = routingScenario(true); n.deleteRoute('R2', '192.168.1.0/24');
    expect(n.traceroute('PC1', '192.168.2.10', 3)[1].address).toBeUndefined();
  });
  it('terminates routing loops via TTL', () => {
    const n = routingScenario(true);
    for (const [id, nextHop] of [['R1', '10.0.0.2'], ['R2', '10.0.0.1']]) n.addRoute(id, { destination: '172.16.0.0/16', nextHop, preference: 1, metric: 0 });
    const r = n.ping('PC1', '172.16.0.1', 5);
    expect(r.success).toBe(false);
    expect(r.reason).toContain('TTL exceeded');
    expect(r.reply?.type).toBe('time-exceeded');
  });
  it('link down removes the connected route (line protocol down)', () => {
    const n = routingScenario(true); n.setLinkState('link-2', false);
    expect(n.table('R1').some(r => r.destination === '10.0.0.0/30')).toBe(false);
    expect(n.ping('PC1', '192.168.2.10').reason).toContain('経路がありません');
  });
  it('does not use missing or down links', () => {
    const n = routingScenario(true); n.setLinkState('link-2', false);
    expect(n.ping('PC1', '192.168.2.10').success).toBe(false);
    n.setLinkState('link-2', true);
    expect(n.ping('PC1', '192.168.2.10').success).toBe(true);
    n.configureInterface('R2', 'g0/0', '10.0.0.2/30', false);
    expect(n.ping('PC1', '192.168.2.10').success).toBe(false);
  });
  it('does not find an IP on an unrelated link', () => {
    const n = routingScenario(true); n.setGateway('PC1', '192.168.1.99');
    expect(n.ping('PC1', '192.168.2.10').reason).toContain('ARP応答なし');
  });
  it('treats an incorrect source mask as on-link and fails ARP', () => {
    const n = routingScenario(true); n.configureInterface('PC1', 'eth0', '192.168.1.10/16', true);
    expect(n.ping('PC1', '192.168.2.10').reason).toContain('ARP応答なし');
  });
  it('delivers to a local interface without decrementing TTL', () => expect(routingScenario().ping('PC1', '192.168.1.10').reply?.ttl).toBe(64));
  it('does not mutate saved event packet snapshots', () => {
    const r = routingScenario(true).ping('PC1', '192.168.2.10');
    expect(r.events[0].packet?.ttl).toBe(64);
    expect(r.events.find(e => e.type === 'PACKET_RECEIVED')?.packet?.ttl).toBe(62);
  });
});
describe('Capture / serialization / boundaries', () => {
  it('writes correct IPv4 and ICMP checksums and frame lengths', () => {
    const r = routingScenario(true).ping('PC1', '192.168.2.10');
    const c = r.captures.find(c => c.protocol === 'ICMP')!;
    expect(checksum(c.bytes.slice(14, 34))).toBe(0);
    expect(checksum(c.bytes.slice(34))).toBe(0);
    expect(c.bytes[16] * 256 + c.bytes[17]).toBe(c.bytes.length - 14);
    expect(c.bytes[22]).toBe(64);
  });
  it('filters shared capture data and rejects unsupported filters', () => {
    const r = routingScenario(true).ping('PC1', '192.168.2.10');
    expect(r.captures.filter(packetFilter('icmp and host 192.168.2.10'))).toHaveLength(6);
    expect(r.captures.filter(packetFilter('arp'))).toHaveLength(6);
    expect(r.captures.filter(packetFilter('tcp'))).toHaveLength(0);
    expect(() => packetFilter('bogus')).toThrow();
    expect(() => packetFilter('icmp and')).toThrow();
  });
  it('round-trips configuration and starts with cold ARP caches', () => {
    const n = routingScenario(true); n.ping('PC1', '192.168.2.10');
    const restored = NetworkSimulator.fromSnapshot(JSON.parse(JSON.stringify(n.snapshot())));
    expect(restored.device('PC1').arp).toEqual([]);
    expect(restored.ping('PC1', '192.168.2.10').success).toBe(true);
  });
  it('rejects occupied ports and duplicate MACs', () => {
    const n = routingScenario();
    expect(() => n.connect({ ...n.snapshot().links[0], id: 'duplicate' })).toThrow();
    expect(() => n.addDevice(createDevice('PC3', 'pc', 1))).toThrow();
  });
  it('does not permit mutation through snapshots or device access', () => {
    const n = routingScenario(); n.device('PC1').interfaces[0].up = false;
    expect(n.device('PC1').interfaces[0].up).toBe(true);
  });
  it('rejects corrupt persisted data', () => {
    const state = routingScenario().snapshot(); state.devices[0].interfaces[0].address = 'bad';
    expect(() => NetworkSimulator.fromSnapshot(state)).toThrow();
  });
});

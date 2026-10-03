import { describe, expect, it } from 'vitest';
import { designScenario, ecmpScenario, lagScenario } from '../scenarios/chapters';
import { build, iperf, lag } from '../scenarios/build';
import { resolveRoute } from '../l3/RoutingTable';
import { flowOf } from './flow';
import type { NetworkSimulator } from './NetworkSimulator';

const link = (n: NetworkSimulator, a: string, pa: string) => n.snapshot().links.find(l => (l.sourceDevice === a && l.sourceInterface === pa) || (l.targetDevice === a && l.targetInterface === pa))!.id;
const po = (n: NetworkSimulator, id = 'SW1') => n.lagState()[id].po1;
const flags = (n: NetworkSimulator, id = 'SW1') => po(n, id).members.map(m => m.flag).join('');
/** Eight TCP streams PC1 → PC3 (different source ports = different flows). */
const streams = (n: NetworkSimulator, from = 'PC1', to = '192.168.10.13', count = 8) => n.throughput(Array.from({ length: count }, () => ({ from, to })));
const membersUsed = (n: NetworkSimulator) => new Set(streams(n).streams.flatMap(s => s.hops.filter(h => h.device === 'SW1' && h.lag).map(h => h.interfaceId)));

describe('Link aggregation (LACP / static)', () => {
  it('bundles both members into one logical link that carries VLAN 10 and 20 as a trunk', () => {
    const n = lagScenario({ lag: true });
    expect(po(n)).toMatchObject({ up: true, protocol: 'LACP', capacity: 2000 });
    expect(flags(n)).toBe('PP');
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
    const r = n.ping('PC2', '192.168.20.14');
    expect(r.success).toBe(true);
    // Frames on a member cable keep their 802.1Q tag; the MAC table points at the port-channel, not at a member.
    const members = [link(n, 'SW1', 'g0/7'), link(n, 'SW1', 'g0/8')];
    expect(r.captures.filter(c => members.includes(c.linkId) && c.protocol === 'ICMP').every(c => c.vlan === 20)).toBe(true);
    expect(n.device('SW2').macTable!.find(e => e.mac === n.device('PC2').interfaces[0].mac)?.port).toBe('po1');
  });
  it('STP sees the bundle as one port: nothing is blocked (without LAG, one of the two cables is)', () => {
    const plain = lagScenario().stpState();
    expect([...plain.ports.values()].filter(p => p.role === 'alternate')).toHaveLength(1);
    const bundledStp = lagScenario({ lag: true }).stpState();
    expect([...bundledStp.ports.values()].filter(p => p.role === 'alternate')).toHaveLength(0);
    expect(bundledStp.ports.get('SW1|po1')?.forwarding).toBe(true);
    expect(bundledStp.ports.has('SW1|g0/7')).toBe(false);
  });
  it('adds and removes members', () => {
    const n = lagScenario();
    for (const sw of ['SW1', 'SW2']) n.update(sw, d => lag(d, 1, 'active', 'g0/7'));
    expect(flags(n)).toBe('P');
    expect(po(n).capacity).toBe(1000);
    for (const sw of ['SW1', 'SW2']) n.update(sw, d => lag(d, 1, 'active', 'g0/8'));
    expect(flags(n)).toBe('PP');
    expect(po(n).capacity).toBe(2000);
    for (const sw of ['SW1', 'SW2']) n.update(sw, d => { delete d.interfaces.find(i => i.id === 'g0/8')!.channelGroup; });
    expect(po(n).members.map(m => m.port)).toEqual(['g0/7']);
    // g0/8 is an ordinary trunk again, parallel to po1: STP must block one of them.
    expect([...n.stpState().ports.values()].filter(p => p.role === 'alternate')).toHaveLength(1);
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
  });
  it('a failed member lowers capacity but the logical link stays up; all members down takes it down', () => {
    const n = lagScenario({ lag: true });
    n.setLinkState(link(n, 'SW1', 'g0/7'), false);
    expect(po(n)).toMatchObject({ up: true, capacity: 1000 });
    expect(flags(n)).toBe('DP');
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
    expect(membersUsed(n)).toEqual(new Set(['g0/8']));
    n.setLinkState(link(n, 'SW1', 'g0/8'), false);
    expect(po(n).up).toBe(false);
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
    n.setLinkState(link(n, 'SW1', 'g0/7'), true);
    expect(po(n)).toMatchObject({ up: true, capacity: 1000 });
  });
  it('active–passive bundles, passive–passive does not', () => {
    const n = lagScenario({ lag: true });
    n.update('SW2', d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'passive'; });
    expect(flags(n)).toBe('PP');
    n.update('SW1', d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'passive'; });
    expect(flags(n)).toBe('ss');
    expect(po(n).members[0].reason).toContain('passive');
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
  });
  it('static mode on bundles only against on; mixed or one-sided configuration suspends the members', () => {
    const n = lagScenario({ lag: true });
    for (const sw of ['SW1', 'SW2']) n.update(sw, d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'on'; });
    expect(po(n)).toMatchObject({ protocol: 'static', capacity: 2000 });
    n.update('SW2', d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'active'; });
    expect(flags(n)).toBe('ss');
    expect(flags(n, 'SW2')).toBe('ss');
    const oneSided = lagScenario({ lag: true });
    oneSided.update('SW2', d => { d.interfaces = d.interfaces.filter(i => i.kind !== 'port-channel').map(i => ({ ...i, channelGroup: undefined })); });
    expect(flags(oneSided)).toBe('ss');
    expect(po(oneSided).members[0].reason).toContain('LACPDU');
    expect(oneSided.ping('PC1', '192.168.10.13').success).toBe(false);
  });
  it('a member with a different speed is suspended', () => {
    const n = lagScenario({ lag: true });
    n.setLinkProperties(link(n, 'SW1', 'g0/8'), { bandwidth: 100, latency: 1 });
    expect(flags(n)).toBe('Ps');
    expect(po(n).members[1].reason).toContain('速度');
    expect(flags(n, 'SW2')).toBe('Ps');
    expect(po(n).capacity).toBe(1000);
  });
  it('rejects invalid configuration', () => {
    const n = lagScenario({ lag: true });
    expect(() => n.update('SW1', d => { d.interfaces.find(i => i.id === 'g0/8')!.channelGroup!.mode = 'on'; })).toThrow(/混在/);
    expect(() => n.update('SW1', d => { d.interfaces.find(i => i.id === 'g0/1')!.channelGroup = { group: 2, mode: 'active' }; })).toThrow(/po2/);
    expect(() => n.update('SW1', d => { d.interfaces = d.interfaces.filter(i => i.id !== 'po1'); })).toThrow(/po1/);
    expect(() => ecmpScenario().update('R1', d => lag(d, 1, 'active', 'g0/1'))).toThrow(/IPアドレス/);
    expect(() => lagScenario().update('PC1', d => { d.interfaces.push({ id: 'po1', kind: 'port-channel', mac: '02:00:00:01:40:01', up: true }); })).toThrow(/Port-channel/);
  });
  it('trunk allowed VLANs are those of the port-channel', () => {
    const n = lagScenario({ lag: true });
    n.update('SW1', d => { d.interfaces.find(i => i.id === 'po1')!.switchport!.allowedVlans = [10]; });
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
    expect(n.ping('PC2', '192.168.20.14').success).toBe(false);
  });
  it('hashes per flow: one flow sticks to one member, many flows use both; src-dst-mac keeps one host pair on one member', () => {
    const n = lagScenario({ lag: true });
    const pick = () => n.ping('PC1', '192.168.10.13').events.filter(e => e.type === 'LAG_HASH' && e.deviceId === 'SW1' && e.packet?.protocol === 'ICMP').map(e => e.choice!.chosen);
    expect(new Set([...pick(), ...pick()]).size).toBe(1);
    expect(membersUsed(n)).toEqual(new Set(['g0/7', 'g0/8']));
    n.update('SW1', d => { d.lagLoadBalance = 'src-dst-mac'; });
    expect(membersUsed(n).size).toBe(1);
  });
  it('routed (L3) port-channel between routers', () => {
    const n = build([
      { id: 'A', kind: 'router', at: [0, 0], ip: { 'g0/0': '192.168.1.1/24' }, set: d => { lag(d, 1, 'active', 'g0/1', 'g0/2'); d.interfaces.find(i => i.id === 'po1')!.address = '10.9.0.1/30'; d.routes.push({ destination: '192.168.2.0/24', nextHop: '10.9.0.2', preference: 1, metric: 0, kind: 'static' }); } },
      { id: 'B', kind: 'router', at: [0, 0], ip: { 'g0/0': '192.168.2.1/24' }, set: d => { lag(d, 1, 'passive', 'g0/1', 'g0/2'); d.interfaces.find(i => i.id === 'po1')!.address = '10.9.0.2/30'; d.routes.push({ destination: '192.168.1.0/24', nextHop: '10.9.0.1', preference: 1, metric: 0, kind: 'static' }); } },
      { id: 'H1', kind: 'pc', at: [0, 0], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
      { id: 'H2', kind: 'server', at: [0, 0], ip: { eth0: '192.168.2.10/24' }, gw: '192.168.2.1', set: d => { d.services = [iperf()]; } },
    ], [['H1', 'eth0', 'A', 'g0/0'], ['A', 'g0/1', 'B', 'g0/1'], ['A', 'g0/2', 'B', 'g0/2'], ['B', 'g0/0', 'H2', 'eth0']]);
    expect(n.ping('H1', '192.168.2.10').success).toBe(true);
    n.setLinkState('link-2', false);
    expect(n.ping('H1', '192.168.2.10').success).toBe(true);
    n.setLinkState('link-3', false);
    expect(n.device('A').lineDown).toContain('po1');
    expect(n.ping('H1', '192.168.2.10').success).toBe(false);
  });
});

describe('ECMP', () => {
  const paths = (n: NetworkSimulator) => resolveRoute(n.device('R1'), '10.20.0.10')?.ecmp?.paths.map(p => p.nextHop) ?? [resolveRoute(n.device('R1'), '10.20.0.10')?.nextHop];
  const via = (n: NetworkSimulator, count = 8) => { const r = n.throughput(Array.from({ length: count }, () => ({ from: 'PC1', to: '10.20.0.10' }))); return { r, routers: new Set(r.streams.flatMap(s => s.hops.map(h => h.device)).filter(d => d === 'R2' || d === 'R3')) }; };
  it('installs several equal-cost next hops for one prefix (static and OSPF)', () => {
    for (const routing of ['static', 'ospf'] as const) {
      const n = ecmpScenario(routing);
      expect(n.installed('R1').filter(r => r.destination === '10.20.0.0/24').map(r => r.nextHop).sort(), routing).toEqual(['10.0.12.2', '10.0.13.3']);
      expect(paths(n), routing).toEqual(['10.0.12.2', '10.0.13.3']);
    }
  });
  it('different cost or AD is not ECMP; maximum-paths 1 is single-path', () => {
    const cost = ecmpScenario('ospf');
    cost.update('R1', d => { d.interfaces.find(i => i.id === 'g0/1')!.ospfCost = 5; });
    expect(paths(cost)).toEqual(['10.0.13.3']);
    const ad = ecmpScenario('static');
    ad.update('R1', d => { d.routes.find(r => r.nextHop === '10.0.13.3')!.preference = 5; });
    expect(paths(ad)).toEqual(['10.0.12.2']);
    expect(ad.installed('R1').filter(r => r.destination === '10.20.0.0/24')).toHaveLength(1);
    const single = ecmpScenario('ospf');
    single.update('R1', d => { d.ospf!.maximumPaths = 1; });
    expect(paths(single)).toEqual(['10.0.12.2']);
  });
  it('keeps one flow on one path and spreads different flows', () => {
    const n = ecmpScenario('static');
    const packet = { id: 1, source: '192.168.1.10', destination: '10.20.0.10', ttl: 64, protocol: 'TCP' as const, sourcePort: 50000, destinationPort: 80, flags: ['SYN' as const], seq: 0, ack: 0, window: 1 };
    const pick = () => resolveRoute(n.device('R1'), '10.20.0.10', { flow: flowOf(packet) })!.nextHop;
    expect(new Set([pick(), pick(), pick()]).size).toBe(1);
    const chosen = () => n.ping('PC1', '10.20.0.10').events.find(e => e.type === 'ECMP_HASH' && e.deviceId === 'R1')!.choice!.chosen;
    expect(chosen()).toBe(chosen());
    expect(via(n).routers).toEqual(new Set(['R2', 'R3']));
  });
  it('a failed path leaves the candidates and traffic moves to the rest; it comes back on repair', () => {
    for (const routing of ['static', 'ospf'] as const) {
      const n = ecmpScenario(routing);
      n.setLinkState(link(n, 'R1', 'g0/1'), false);
      expect(paths(n), routing).toEqual(['10.0.13.3']);
      const down = via(n);
      expect(down.routers).toEqual(new Set(['R3']));
      // OSPF moves every flow. With static routes only R1 (next to the failure) notices: R4 still sends some replies to R2.
      expect(resolveRoute(n.device('R4'), '192.168.1.10')?.ecmp?.paths.length ?? 1, routing).toBe(routing === 'ospf' ? 1 : 2);
      expect(down.r.success, routing).toBe(routing === 'ospf');
      n.setLinkState(link(n, 'R1', 'g0/1'), true);
      expect(paths(n), routing).toEqual(['10.0.12.2', '10.0.13.3']);
      expect(via(n).routers).toEqual(new Set(['R2', 'R3']));
    }
  });
  it('a remote failure is invisible to static ECMP (some flows are lost) but OSPF reconverges', () => {
    const fail = (n: NetworkSimulator) => { n.setLinkState(link(n, 'R2', 'g0/1'), false); return n; };
    const st = fail(ecmpScenario('static'));
    expect(paths(st)).toEqual(['10.0.12.2', '10.0.13.3']);
    const lost = via(st).r.streams.filter(s => !s.ok);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.length).toBeLessThan(8);
    const os = fail(ecmpScenario('ospf'));
    expect(paths(os)).toEqual(['10.0.13.3']);
    expect(via(os).r.success).toBe(true);
  });
  it('a next hop that loses its interface may resolve recursively through the default route (unless the interface is given)', () => {
    const n = ecmpScenario('static');
    n.update('R1', d => { d.routes.push({ destination: '0.0.0.0/0', nextHop: '10.0.13.3', preference: 1, metric: 0, kind: 'static' }); });
    n.setLinkState(link(n, 'R1', 'g0/1'), false);
    // 10.20.0.0/24 via 10.0.12.2: 10.0.12.0/24 is gone, but 0.0.0.0/0 still "reaches" 10.0.12.2 — the route stays (IOS behaves the same way).
    expect(n.installed('R1').filter(r => r.destination === '10.20.0.0/24').map(r => r.nextHop)).toContain('10.0.12.2');
    n.update('R1', d => { d.routes.find(r => r.nextHop === '10.0.12.2')!.interfaceId = 'g0/1'; });
    expect(n.installed('R1').filter(r => r.destination === '10.20.0.0/24').map(r => r.nextHop)).toEqual(['10.0.13.3']);
  });
  it('traceroute and the Debugger agree on the chosen path', () => {
    const n = ecmpScenario('static');
    const ping = n.ping('PC1', '10.20.0.10');
    const choice = ping.events.find(e => e.type === 'ECMP_HASH' && e.deviceId === 'R1')!.choice!;
    const nextHop = choice.candidates[choice.chosen].split(/[ （]/)[1];
    const forward = ping.events.filter(e => e.type === 'FRAME_SENT' && e.packet?.protocol === 'ICMP' && e.packet.type === 'echo-request').map(e => e.deviceId);
    expect(forward).toEqual(['PC1', 'R1', nextHop === '10.0.12.2' ? 'R2' : 'R3', 'R4']);
    expect(n.traceroute('PC1', '10.20.0.10', 8, 'icmp').map(p => p.address)).toEqual(['192.168.1.1', nextHop, nextHop === '10.0.12.2' ? '10.0.24.4' : '10.0.34.4', '10.20.0.10']);
  });
});

describe('Bandwidth model', () => {
  const chain = (middle: number) => build([
    { id: 'PC', kind: 'pc', at: [0, 0], ip: { eth0: '10.0.0.1/24' } },
    { id: 'SW1', kind: 'switch', at: [0, 0] }, { id: 'SW2', kind: 'switch', at: [0, 0] },
    { id: 'SRV', kind: 'server', at: [0, 0], ip: { eth0: '10.0.0.2/24' }, set: d => { d.services = [iperf()]; } },
  ], [['PC', 'eth0', 'SW1', 'g0/1', 10_000], ['SW1', 'g0/2', 'SW2', 'g0/2', middle], ['SW2', 'g0/1', 'SRV', 'eth0', 10_000]]);
  it('the slowest link on the path limits one flow (bottleneck)', () => {
    const r = chain(1000).throughput([{ from: 'PC', to: '10.0.0.2' }]);
    expect(r.streams[0].hops.map(h => h.bandwidth)).toEqual([10_000, 1000, 10_000]);
    expect(r.streams[0].limit).toBe(1000);
    expect(r.total).toBe(1000);
    expect(chain(25_000).throughput([{ from: 'PC', to: '10.0.0.2' }]).total).toBe(10_000);
  });
  it('flows sharing a link split it equally', () => {
    const r = chain(1000).throughput([{ from: 'PC', to: '10.0.0.2' }, { from: 'PC', to: '10.0.0.2' }]);
    expect(r.streams.map(s => s.rate)).toEqual([500, 500]);
    expect(r.total).toBe(1000);
  });
  it('a LAG aggregates capacity, but one flow still gets one member; member failure lowers capacity', () => {
    const n = lagScenario({ lag: true });
    expect(streams(n, 'PC1', '192.168.10.13', 1).total).toBe(1000);
    const many = streams(n);
    expect(many.total).toBe(2000);
    expect(many.streams.every(s => s.hops.some(h => h.lag?.capacity === 2000))).toBe(true);
    n.setLinkState(link(n, 'SW1', 'g0/8'), false);
    expect(po(n).capacity).toBe(1000);
    expect(streams(n).total).toBe(1000);
  });
  it('without a LAG, STP leaves one cable idle: the parallel cable adds no capacity', () => {
    expect(designScenario({ lag: false }).throughput(['PC1', 'PC2', 'PC1', 'PC2'].map(from => ({ from, to: '10.20.0.10' }))).total).toBe(1000);
    expect(designScenario({ lag: true }).throughput(['PC1', 'PC2', 'PC1', 'PC2', 'PC1', 'PC2'].map(from => ({ from, to: '10.20.0.10' }))).total).toBe(2000);
  });
});

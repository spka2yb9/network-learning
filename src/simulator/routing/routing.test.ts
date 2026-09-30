import { describe, expect, it } from 'vitest';
import { bgpScenario, ospfScenario, vpnScenario } from '../scenarios/chapters';
import { build, loopback } from '../scenarios/build';
import { packetFilter } from '../capture/PacketFilter';
import { prefixListPermits } from './Bgp';
import { resolveRoute } from '../l3/RoutingTable';

const route = (n: ReturnType<typeof ospfScenario>, id: string, ip: string) => resolveRoute(n.device(id), ip);

describe('Link-state routing (OSPF-like)', () => {
  it('forms adjacencies, floods LSAs and installs shortest paths', () => {
    const n = ospfScenario();
    const o = n.ospf()!;
    expect(o.neighbors.filter(x => x.device === 'R1').map(x => x.neighborDevice).sort()).toEqual(['R2', 'R4']);
    expect(o.lsdb).toHaveLength(4);
    const r = route(n, 'R1', '192.168.3.10');
    expect(r?.route.kind).toBe('ospf');
    expect(r?.route.metric).toBe(3);
    expect(n.ping('PC1', '192.168.3.10').success).toBe(true);
  });
  it('interface cost changes the chosen path', () => {
    const n = ospfScenario();
    const before = route(n, 'R1', '192.168.3.10')!.nextHop;
    n.update('R1', d => { d.interfaces.find(i => i.id === (before === '10.0.12.2' ? 'g0/0' : 'g0/1'))!.ospfCost = 50; });
    expect(route(n, 'R1', '192.168.3.10')!.nextHop).not.toBe(before);
  });
  it('reconverges around a failed link', () => {
    const n = ospfScenario();
    const hop = route(n, 'R1', '192.168.3.10')!.nextHop;
    const link = n.snapshot().links.find(l => l.sourceDevice === 'R1' && l.targetDevice === (hop === '10.0.12.2' ? 'R2' : 'R4'))!;
    n.setLinkState(link.id, false);
    // Link down: line protocol down removes the connected route and the adjacency
    expect(route(n, 'R1', '192.168.3.10')!.nextHop).not.toBe(hop);
    expect(n.ping('PC1', '192.168.3.10').success).toBe(true);
  });
  it('area mismatch prevents adjacency and is reported', () => {
    const n = ospfScenario();
    n.update('R2', d => { d.ospf!.networks = [{ prefix: '10.0.0.0/16', area: 1 }]; });
    const o = n.ospf()!;
    expect(o.neighbors.some(x => x.device === 'R1' && x.neighborDevice === 'R2')).toBe(false);
    expect(o.issues.some(i => i.message.includes('エリア'))).toBe(true);
  });
  it('does not route without OSPF', () => expect(ospfScenario(false).ping('PC1', '192.168.3.10').success).toBe(false));
  it('a static route whose next hop goes away falls back to OSPF', () => {
    const n = ospfScenario();
    n.addRoute('R1', { destination: '192.168.3.0/24', nextHop: '10.0.12.2', preference: 1, metric: 0 });
    expect(route(n, 'R1', '192.168.3.10')?.route.kind).toBe('static');
    n.setLinkState('link-2', false); // R1–R2: 10.0.12.2 no longer resolves
    expect(route(n, 'R1', '192.168.3.10')?.route).toMatchObject({ kind: 'ospf', nextHop: '10.0.14.2' });
    expect(n.installed('R1').find(r => r.destination === '192.168.3.0/24')?.kind).toBe('ospf');
    expect(n.ping('PC1', '192.168.3.10').success).toBe(true);
  });
  it('does not advertise a subnet whose line protocol is down', () => {
    const n = ospfScenario();
    n.setLinkState('link-6', false); // R3 g0/2 stays administratively up but loses carrier
    expect(n.ospf()!.lsdb.find(l => l.device === 'R3')!.links.some(x => x.type === 'stub' && x.prefix === '192.168.3.0/24')).toBe(false);
    expect(route(n, 'R1', '192.168.3.10')).toBeUndefined();
  });
});

describe('BGP', () => {
  it('establishes eBGP sessions and prefers the shortest AS_PATH', () => {
    const n = bgpScenario();
    const b = n.bgp()!;
    expect(b.sessions.every(s => s.state === 'Established')).toBe(true);
    const best = b.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)!;
    expect(best.asPath).toEqual([65002]);
    expect(b.tables.get('R1')!.filter(p => p.prefix === '172.16.2.0/24')).toHaveLength(2);
    expect(route(n, 'R1', '172.16.2.10')?.route).toMatchObject({ kind: 'bgp', preference: 20 });
    expect(n.http('PC1', 'http://172.16.2.10/').status).toBe(200);
  });
  it('rejects its own ASN in AS_PATH (loop prevention)', () => {
    const b = bgpScenario().bgp()!;
    expect(b.log.some(l => l.to === 'R1' && l.prefix === '192.168.1.0/24' && l.action === 'reject-loop')).toBe(true);
    expect(b.tables.get('R1')!.some(p => p.prefix === '192.168.1.0/24' && p.type !== 'local')).toBe(false);
  });
  it('LOCAL_PREF beats AS_PATH length', () => {
    const n = bgpScenario();
    n.update('R1', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.13.2')!.localPreference = 200; });
    const best = n.bgp()!.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)!;
    expect(best.asPath).toEqual([65003, 65002]);
    expect(best.reason).toContain('LOCAL_PREF');
  });
  it('AS_PATH prepend steers inbound traffic', () => {
    const n = bgpScenario();
    n.update('R2', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.12.1')!.prepend = 3; });
    expect(n.bgp()!.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)!.asPath).toEqual([65003, 65002]);
  });
  it('remote-as mismatch keeps the session down and withdraws routes; failover converges', () => {
    const n = bgpScenario();
    n.update('R1', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.12.2')!.remoteAs = 65009; });
    const b = n.bgp()!;
    const s = b.sessions.find(x => x.device === 'R1' && x.neighbor === '10.0.12.2')!;
    expect(s.state).not.toBe('Established');
    expect(s.reason).toContain('remote-as');
    expect(b.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)!.asPath).toEqual([65003, 65002]);
    expect(n.ping('PC1', '172.16.2.10').success).toBe(true);
  });
  it('prefix-list filtering and the network statement requirement', () => {
    const n = bgpScenario();
    n.update('R2', d => {
      d.prefixLists = [{ name: 'ONLY-LAN', entries: [{ seq: 5, action: 'deny', prefix: '172.16.2.0/24' }, { seq: 10, action: 'permit', prefix: '0.0.0.0/0', le: 32 }] }];
      d.bgp!.neighbors.find(x => x.ip === '10.0.12.1')!.prefixListOut = 'ONLY-LAN';
    });
    const b = n.bgp()!;
    expect(b.log.some(l => l.action === 'filtered-out' && l.prefix === '172.16.2.0/24')).toBe(true);
    expect(b.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)!.asPath).toEqual([65003, 65002]);
    n.update('R3', d => { d.bgp!.networks.push('172.31.0.0/16'); });
    expect(n.bgp()!.tables.get('R3')!.some(p => p.prefix === '172.31.0.0/16')).toBe(false);
    expect(prefixListPermits({ name: 'x', entries: [{ seq: 1, action: 'permit', prefix: '10.0.0.0/8', ge: 16, le: 24 }] }, '10.1.0.0/16')).toBe(true);
    expect(prefixListPermits({ name: 'x', entries: [{ seq: 1, action: 'permit', prefix: '10.0.0.0/8', ge: 16, le: 24 }] }, '10.0.0.0/8')).toBe(false);
  });
  it('lower MED wins between paths from the same neighboring AS', () => {
    const n = build([
      { id: 'R1', kind: 'router', at: [0, 0], ip: { 'g0/0': '10.0.1.1/30', 'g0/1': '10.0.2.1/30' }, set: d => { d.bgp = { asn: 65001, networks: [], neighbors: [{ ip: '10.0.1.2', remoteAs: 65002 }, { ip: '10.0.2.2', remoteAs: 65002 }] }; } },
      { id: 'A', kind: 'router', at: [200, 0], ip: { 'g0/0': '10.0.1.2/30', 'g0/2': '172.16.0.1/24' }, set: d => { d.bgp = { asn: 65002, networks: ['172.16.0.0/24'], neighbors: [{ ip: '10.0.1.1', remoteAs: 65001, med: 50 }] }; } },
      { id: 'B', kind: 'router', at: [200, 200], ip: { 'g0/0': '10.0.2.2/30', 'g0/2': '172.16.0.2/24' }, set: d => { d.bgp = { asn: 65002, networks: ['172.16.0.0/24'], neighbors: [{ ip: '10.0.2.1', remoteAs: 65001, med: 10 }] }; } },
      { id: 'SW', kind: 'switch', at: [400, 100] },
    ], [['R1', 'g0/0', 'A', 'g0/0'], ['R1', 'g0/1', 'B', 'g0/0'], ['A', 'g0/2', 'SW', 'g0/1'], ['B', 'g0/2', 'SW', 'g0/2']]);
    const best = n.bgp()!.tables.get('R1')!.find(p => p.best)!;
    expect(best.nextHop).toBe('10.0.2.2');
    expect(best.reason).toContain('MED');
  });
  it('iBGP needs next-hop-self (or an IGP route) to use eBGP-learned next hops', () => {
    const n = build([
      // The advertised LAN lives on a loopback: an unplugged port would lose its connected route.
      { id: 'E', kind: 'router', at: [0, 0], ip: { 'g0/0': '10.1.0.1/30' }, set: d => { loopback(d, 0, '8.8.8.1/24'); d.bgp = { asn: 65100, networks: ['8.8.8.0/24'], neighbors: [{ ip: '10.1.0.2', remoteAs: 65001 }] }; } },
      { id: 'B1', kind: 'router', at: [200, 0], ip: { 'g0/0': '10.1.0.2/30', 'g0/1': '10.2.0.1/30' }, set: d => { d.bgp = { asn: 65001, networks: [], neighbors: [{ ip: '10.1.0.1', remoteAs: 65100 }, { ip: '10.2.0.2', remoteAs: 65001 }] }; } },
      { id: 'B2', kind: 'router', at: [400, 0], ip: { 'g0/0': '10.2.0.2/30' }, set: d => { d.bgp = { asn: 65001, networks: [], neighbors: [{ ip: '10.2.0.1', remoteAs: 65001 }] }; } },
    ], [['E', 'g0/0', 'B1', 'g0/0'], ['B1', 'g0/1', 'B2', 'g0/0']]);
    const path = n.bgp()!.tables.get('B2')!.find(p => p.prefix === '8.8.8.0/24')!;
    expect(path.valid).toBe(false);
    expect(path.nextHop).toBe('10.1.0.1');
    n.update('B1', d => { d.bgp!.neighbors[1].nextHopSelf = true; });
    const fixed = n.bgp()!.tables.get('B2')!.find(p => p.prefix === '8.8.8.0/24')!;
    expect(fixed).toMatchObject({ valid: true, best: true, nextHop: '10.2.0.1', type: 'iBGP' });
  });
});

describe('VPN (route-based IPsec)', () => {
  it('encrypts across the Internet and decapsulates at the far gateway', () => {
    const n = vpnScenario('static');
    expect(n.device('CGW').tunnelStatus?.tunnel1.up).toBe(true);
    const r = n.ping('PC1', '10.0.1.10');
    expect(r.success).toBe(true);
    expect(r.events.some(e => e.type === 'TUNNEL_ENCAPSULATED')).toBe(true);
    expect(r.events.some(e => e.type === 'TUNNEL_DECAPSULATED')).toBe(true);
    const internetLink = n.snapshot().links.find(l => l.sourceDevice === 'CGW' && l.targetDevice === 'INET')!.id;
    const onInternet = r.captures.filter(c => c.linkId === internetLink);
    expect(onInternet.length).toBeGreaterThan(0);
    expect(onInternet.every(c => c.protocol === 'ESP' || c.protocol === 'ARP')).toBe(true);
    expect(onInternet.find(c => c.protocol === 'ESP')?.source).toBe('198.51.100.2');
  });
  it('PSK mismatch brings the tunnel down with an IKE reason', () => {
    const n = vpnScenario('static');
    n.update('VGW1', d => { d.interfaces.find(i => i.id === 'tunnel1')!.tunnel!.psk = 'wrong'; });
    expect(n.device('CGW').tunnelStatus?.tunnel1).toMatchObject({ up: false });
    expect(n.device('CGW').tunnelStatus?.tunnel1.reason).toContain('PSK');
    expect(n.ping('PC1', '10.0.1.10').success).toBe(false);
  });
  it('comes up when the tunnel destination is reachable only through OSPF', () => {
    const n = vpnScenario('static');
    const ospf = (prefix: string) => ({ processId: 1, networks: [{ prefix, area: 0 }], passive: [] });
    n.update('CGW', d => { d.routes = d.routes.filter(r => r.destination !== '0.0.0.0/0'); d.ospf = ospf('198.51.100.0/30'); });
    n.update('INET', d => { d.ospf = ospf('0.0.0.0/0'); });
    n.update('VGW1', d => { d.routes = d.routes.filter(r => r.destination !== '0.0.0.0/0'); d.ospf = ospf('203.0.113.0/30'); });
    expect(route(n, 'CGW', '203.0.113.2')?.route.kind).toBe('ospf');
    expect(n.device('CGW').tunnelStatus?.tunnel1.up).toBe(true);
    expect(n.ping('PC1', '10.0.1.10').success).toBe(true);
  });
  it('missing route over the tunnel sends traffic to the Internet instead', () => {
    const n = vpnScenario('static');
    n.deleteRoute('CGW', '10.0.0.0/16');
    const r = n.ping('PC1', '10.0.1.10');
    expect(r.success).toBe(false);
    expect(r.events.some(e => e.type === 'TUNNEL_ENCAPSULATED')).toBe(false);
  });
  it('GRE is not encrypted: the inner packet is visible in the capture', () => {
    const n = vpnScenario('static');
    for (const id of ['CGW', 'VGW1']) n.update(id, d => { const t = d.interfaces.find(i => i.id === 'tunnel1')!.tunnel!; t.mode = 'gre'; delete t.psk; delete t.proposal; });
    const r = n.ping('PC1', '10.0.1.10');
    expect(r.success).toBe(true);
    expect(r.captures.some(c => c.ipProtocol === 47 && c.info.startsWith('GRE: 192.168.10.10 → 10.0.1.10') && c.hosts.includes('10.0.1.10'))).toBe(true);
    // tcpdump filters match the outer header: src/dst are the tunnel endpoints, the inner TCP port is not a port of the packet.
    const gre = n.http('PC1', 'http://10.0.1.10/').captures.filter(c => c.ipProtocol === 47);
    expect(gre.length).toBeGreaterThan(0);
    expect(gre.filter(packetFilter('src host 198.51.100.2 or src host 203.0.113.2'))).toHaveLength(gre.length);
    expect(gre.filter(packetFilter('port 80'))).toHaveLength(0);
  });
  it('BGP over two tunnels fails over when the primary tunnel goes down', () => {
    const n = vpnScenario('bgp');
    const b = n.bgp()!;
    expect(b.sessions.filter(s => s.device === 'CGW').every(s => s.state === 'Established')).toBe(true);
    expect(resolveRoute(n.device('CGW'), '10.0.1.10')?.iface.id).toBe('tunnel1');
    expect(n.ping('PC1', '10.0.1.10').success).toBe(true);
    n.update('CGW', d => { d.interfaces.find(i => i.id === 'tunnel1')!.up = false; });
    expect(resolveRoute(n.device('CGW'), '10.0.1.10')?.iface.id).toBe('tunnel2');
    expect(n.ping('PC1', '10.0.1.10').success).toBe(true);
  });
});

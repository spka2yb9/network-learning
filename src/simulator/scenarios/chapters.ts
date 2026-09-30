import type { DeviceState, DnsRecord, DnsZone } from '../core/types';
import { access, build, dnsService, https, loopback, ssh, subinterface, svi, trunk, tunnel, vlans, web } from './build';

// ---------------------------------------------------------------- ④ Ethernet / VLAN
/** Two switches joined by a trunk, router-on-a-stick for inter-VLAN routing. */
export function vlanScenario(ready = true) {
  return build([
    { id: 'PC1', kind: 'pc', at: [40, 60], ip: { eth0: '192.168.10.11/24' }, gw: '192.168.10.1' },
    { id: 'PC2', kind: 'pc', at: [40, 300], ip: { eth0: '192.168.20.12/24' }, gw: '192.168.20.1' },
    { id: 'SW1', kind: 'switch', at: [280, 180], set: d => { vlans(d, [10, 'SALES'], [20, 'DEV']); access(d, 10, 'g0/1'); access(d, 20, 'g0/2'); trunk(d, 'g0/3'); if (ready) trunk(d, 'g0/8'); } },
    { id: 'SW2', kind: 'switch', at: [560, 180], set: d => { vlans(d, [10, 'SALES'], [20, 'DEV']); access(d, 10, 'g0/1'); access(d, 20, 'g0/2'); trunk(d, 'g0/3'); } },
    { id: 'PC3', kind: 'pc', at: [800, 60], ip: { eth0: '192.168.10.13/24' }, gw: '192.168.10.1' },
    { id: 'PC4', kind: 'pc', at: [800, 300], ip: { eth0: '192.168.20.14/24' }, gw: '192.168.20.1' },
    { id: 'R1', kind: 'router', at: [280, -80], set: d => { subinterface(d, 'g0/0', 10, '192.168.10.1/24'); subinterface(d, 'g0/0', 20, '192.168.20.1/24'); } },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/3', 'SW2', 'g0/3'], ['SW2', 'g0/1', 'PC3', 'eth0'], ['SW2', 'g0/2', 'PC4', 'eth0'], ['SW1', 'g0/8', 'R1', 'g0/0']]);
}
/** Inter-VLAN routing on a Layer 3 switch (SVIs). */
export function l3SwitchScenario() {
  return build([
    { id: 'PC1', kind: 'pc', at: [60, 60], ip: { eth0: '10.10.10.11/24' }, gw: '10.10.10.1' },
    { id: 'PC2', kind: 'pc', at: [60, 260], ip: { eth0: '10.10.20.12/24' }, gw: '10.10.20.1' },
    { id: 'L3SW', kind: 'l3switch', at: [340, 160], set: d => { vlans(d, [10, 'USERS'], [20, 'SERVERS']); access(d, 10, 'g0/1'); access(d, 20, 'g0/2'); svi(d, 10, '10.10.10.1/24'); svi(d, 20, '10.10.20.1/24'); } },
  ], [['PC1', 'eth0', 'L3SW', 'g0/1'], ['PC2', 'eth0', 'L3SW', 'g0/2']]);
}
/** Three switches in a triangle: a physical loop that STP must break. */
export function stpScenario(stp = true) {
  const sw = (id: string, x: number, y: number, priority = 32768) => ({ id, kind: 'switch' as const, at: [x, y] as [number, number], set: (d: DeviceState) => { d.stp = { enabled: stp, priority }; } });
  return build([
    { id: 'PC1', kind: 'pc', at: [40, 40], ip: { eth0: '192.168.1.11/24' } },
    sw('SW1', 260, 40), sw('SW2', 620, 40), sw('SW3', 440, 280),
    { id: 'PC2', kind: 'pc', at: [840, 40], ip: { eth0: '192.168.1.12/24' } },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['SW1', 'g0/2', 'SW2', 'g0/2'], ['SW2', 'g0/3', 'SW3', 'g0/3'], ['SW3', 'g0/2', 'SW1', 'g0/3'], ['SW2', 'g0/1', 'PC2', 'eth0']]);
}

// ---------------------------------------------------------------- ⑤ DNS
const soa = (origin: string, ttl = 3600, minimum = 300): DnsRecord => ({ name: origin, type: 'SOA', ttl, value: `ns1.${origin === '.' ? 'root-servers.net.' : origin} hostmaster.${origin === '.' ? 'root-servers.net.' : origin} 2026092801 7200 3600 1209600 ${minimum}` });
export const exampleZone = (): DnsZone => ({ origin: 'example.com.', records: [
  soa('example.com.'),
  { name: 'example.com.', type: 'NS', ttl: 86400, value: 'ns1.example.com.' },
  { name: 'ns1.example.com.', type: 'A', ttl: 86400, value: '198.51.100.30' },
  { name: 'example.com.', type: 'A', ttl: 300, value: '203.0.113.80' },
  { name: 'www.example.com.', type: 'A', ttl: 300, value: '203.0.113.80' },
  { name: 'www.example.com.', type: 'AAAA', ttl: 300, value: '2001:db8::80' },
  { name: 'shop.example.com.', type: 'CNAME', ttl: 300, value: 'www.example.com.' },
  { name: 'example.com.', type: 'MX', ttl: 3600, value: '10 mail.example.com.' },
  { name: 'mail.example.com.', type: 'A', ttl: 3600, value: '203.0.113.25' },
  { name: 'example.com.', type: 'TXT', ttl: 3600, value: 'v=spf1 mx -all' },
] });
export function dnsScenario() {
  return build([
    { id: 'PC1', kind: 'pc', at: [40, 60], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1', dns: ['192.168.1.53'] },
    { id: 'RESOLVER', kind: 'server', at: [40, 280], ip: { eth0: '192.168.1.53/24' }, gw: '192.168.1.1', set: d => {
      d.services = [dnsService()];
      d.dnsServer = { recursive: true, rootHints: ['198.51.100.10'], allowRecursion: ['192.168.1.0/24'], zones: [{ origin: '1.168.192.in-addr.arpa.', records: [
        soa('1.168.192.in-addr.arpa.'), { name: '1.168.192.in-addr.arpa.', type: 'NS', ttl: 86400, value: 'resolver.corp.example.' },
        { name: '10.1.168.192.in-addr.arpa.', type: 'PTR', ttl: 3600, value: 'pc1.corp.example.' }, { name: '53.1.168.192.in-addr.arpa.', type: 'PTR', ttl: 3600, value: 'resolver.corp.example.' }] }] };
    } },
    { id: 'SW1', kind: 'switch', at: [240, 170] },
    { id: 'R1', kind: 'router', at: [440, 170], ip: { 'g0/0': '192.168.1.1/24', 'g0/1': '100.64.0.2/30' }, routes: [['0.0.0.0/0', '100.64.0.1']] },
    { id: 'ISP', kind: 'internet', at: [660, 170], ip: { 'g0/0': '100.64.0.1/30', 'g0/1': '198.51.100.1/24', 'g0/2': '203.0.113.1/24' }, routes: [['192.168.1.0/24', '100.64.0.2']] },
    { id: 'SW2', kind: 'switch', at: [880, 60] },
    { id: 'ROOT', kind: 'server', at: [1080, -80], ip: { eth0: '198.51.100.10/24' }, gw: '198.51.100.1', set: d => { d.services = [dnsService()]; d.dnsServer = { recursive: false, rootHints: [], zones: [{ origin: '.', records: [
      soa('.', 86400, 86400), { name: '.', type: 'NS', ttl: 518400, value: 'a.root-servers.net.' }, { name: 'a.root-servers.net.', type: 'A', ttl: 518400, value: '198.51.100.10' },
      { name: 'com.', type: 'NS', ttl: 172800, value: 'a.gtld-servers.net.' }, { name: 'a.gtld-servers.net.', type: 'A', ttl: 172800, value: '198.51.100.20' },
    ] }] }; } },
    { id: 'TLD', kind: 'server', at: [1080, 60], ip: { eth0: '198.51.100.20/24' }, gw: '198.51.100.1', set: d => { d.services = [dnsService()]; d.dnsServer = { recursive: false, rootHints: [], zones: [{ origin: 'com.', records: [
      soa('com.', 900, 900), { name: 'com.', type: 'NS', ttl: 172800, value: 'a.gtld-servers.net.' },
      { name: 'example.com.', type: 'NS', ttl: 172800, value: 'ns1.example.com.' }, { name: 'ns1.example.com.', type: 'A', ttl: 172800, value: '198.51.100.30' },
    ] }] }; } },
    { id: 'AUTH', kind: 'server', at: [1080, 200], ip: { eth0: '198.51.100.30/24' }, gw: '198.51.100.1', set: d => { d.services = [dnsService()]; d.dnsServer = { recursive: false, rootHints: [], zones: [exampleZone()] }; } },
    { id: 'WEB', kind: 'server', at: [880, 320], ip: { eth0: '203.0.113.80/24' }, gw: '203.0.113.1', set: d => { d.services = [web('nginx', '<h1>www.example.com</h1>'), https(['www.example.com', 'example.com'], '<h1>www.example.com (TLS)</h1>')]; } },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['RESOLVER', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/8', 'R1', 'g0/0'], ['R1', 'g0/1', 'ISP', 'g0/0'], ['ISP', 'g0/1', 'SW2', 'g0/8'],
    ['SW2', 'g0/1', 'ROOT', 'eth0'], ['SW2', 'g0/2', 'TLD', 'eth0'], ['SW2', 'g0/3', 'AUTH', 'eth0'], ['ISP', 'g0/2', 'WEB', 'eth0']]);
}

// ---------------------------------------------------------------- ⑥ NAT / Firewall
/** Private LAN behind R1 (PAT). ISP has no route to 192.168.1.0/24, so NAT is required. */
export function natScenario(ready = true) {
  return build([
    { id: 'PC1', kind: 'pc', at: [40, 40], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1', dns: ['198.51.100.53'] },
    { id: 'PC2', kind: 'pc', at: [40, 220], ip: { eth0: '192.168.1.11/24' }, gw: '192.168.1.1', dns: ['198.51.100.53'] },
    { id: 'NAS', kind: 'server', at: [40, 400], ip: { eth0: '192.168.1.20/24' }, gw: '192.168.1.1', set: d => { d.services = [web('nas-web', '<h1>Home NAS</h1>')]; } },
    { id: 'SW1', kind: 'switch', at: [260, 220] },
    { id: 'R1', kind: 'router', at: [480, 220], ip: { 'g0/0': '192.168.1.1/24', 'g0/1': '203.0.113.2/30' }, routes: [['0.0.0.0/0', '203.0.113.1']], set: d => {
      d.interfaces[0].nat = 'inside'; d.interfaces[1].nat = 'outside';
      if (ready) d.nat = [{ id: 'pat-lan', type: 'pat', source: '192.168.1.0/24', outInterface: 'g0/1' }];
    } },
    { id: 'ISP', kind: 'internet', at: [700, 220], ip: { 'g0/0': '203.0.113.1/30', 'g0/1': '198.51.100.1/24' } },
    { id: 'SRV', kind: 'server', at: [920, 120], ip: { eth0: '198.51.100.80/24' }, gw: '198.51.100.1', set: d => { d.services = [web('nginx', '<h1>Public web</h1>')]; } },
    { id: 'EXT', kind: 'pc', at: [920, 320], ip: { eth0: '198.51.100.50/24' }, gw: '198.51.100.1' },
    { id: 'SW2', kind: 'switch', at: [800, 380] },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['NAS', 'eth0', 'SW1', 'g0/3'], ['SW1', 'g0/8', 'R1', 'g0/0'], ['R1', 'g0/1', 'ISP', 'g0/0'],
    ['ISP', 'g0/1', 'SW2', 'g0/8'], ['SW2', 'g0/1', 'SRV', 'eth0'], ['SW2', 'g0/2', 'EXT', 'eth0']]);
}
/** Inside / DMZ / outside around a stateful firewall. Default deny, no rules yet. */
export function firewallScenario(rules = false) {
  return build([
    { id: 'PC1', kind: 'pc', at: [40, 60], ip: { eth0: '10.0.1.10/24' }, gw: '10.0.1.1' },
    { id: 'FW', kind: 'firewall', at: [320, 160], ip: { 'g0/0': '203.0.113.2/30', 'g0/1': '10.0.1.1/24', 'g0/2': '10.0.2.1/24' }, routes: [['0.0.0.0/0', '203.0.113.1']], set: d => {
      d.interfaces[0].description = 'outside'; d.interfaces[1].description = 'inside'; d.interfaces[2].description = 'dmz';
      d.interfaces[0].nat = 'outside'; d.interfaces[1].nat = 'inside';
      d.nat = [{ id: 'pat-inside', type: 'pat', source: '10.0.1.0/24', outInterface: 'g0/0' }, { id: 'dmz-web', type: 'port-forward', protocol: 'tcp', outside: '203.0.113.2', outsidePort: 443, inside: '10.0.2.80', insidePort: 443 }];
      if (rules) d.firewall!.rules = [
        { seq: 10, action: 'permit', protocol: 'tcp', source: '10.0.1.0/24', destination: '10.0.2.80/32', destinationPort: [443, 443] },
        { seq: 20, action: 'permit', protocol: 'tcp', source: '0.0.0.0/0', destination: '10.0.2.80/32', destinationPort: [443, 443], inInterface: 'g0/0' },
        { seq: 30, action: 'permit', protocol: 'ip', source: '10.0.1.0/24', destination: '0.0.0.0/0', outInterface: 'g0/0' },
      ];
    } },
    { id: 'DMZWEB', kind: 'server', at: [320, 380], ip: { eth0: '10.0.2.80/24' }, gw: '10.0.2.1', set: d => { d.services = [web('nginx'), https(['203.0.113.2', 'shop.example.com']), ssh()]; } },
    { id: 'ISP', kind: 'internet', at: [600, 160], ip: { 'g0/0': '203.0.113.1/30', 'g0/1': '198.51.100.1/24' } },
    { id: 'EXT', kind: 'pc', at: [860, 160], ip: { eth0: '198.51.100.50/24' }, gw: '198.51.100.1' },
  ], [['PC1', 'eth0', 'FW', 'g0/1'], ['FW', 'g0/2', 'DMZWEB', 'eth0'], ['FW', 'g0/0', 'ISP', 'g0/0'], ['ISP', 'g0/1', 'EXT', 'eth0']]);
}

// ---------------------------------------------------------------- ③ dynamic routing / ⑪ BGP
/** Square of routers running OSPF. R1–R2–R3 and R1–R4–R3. */
export function ospfScenario(enabled = true) {
  const ospf = (d: DeviceState, networks: string[]) => { if (enabled) d.ospf = { processId: 1, networks: networks.map(prefix => ({ prefix, area: 0 })), passive: ['g0/2'] }; };
  return build([
    { id: 'PC1', kind: 'pc', at: [-160, 160], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'R1', kind: 'router', at: [60, 160], ip: { 'g0/0': '10.0.12.1/30', 'g0/1': '10.0.14.1/30', 'g0/2': '192.168.1.1/24' }, set: d => ospf(d, ['10.0.0.0/16', '192.168.1.0/24']) },
    { id: 'R2', kind: 'router', at: [320, 20], ip: { 'g0/0': '10.0.12.2/30', 'g0/1': '10.0.23.1/30' }, set: d => ospf(d, ['10.0.0.0/16']) },
    { id: 'R4', kind: 'router', at: [320, 300], ip: { 'g0/0': '10.0.14.2/30', 'g0/1': '10.0.34.1/30' }, set: d => ospf(d, ['10.0.0.0/16']) },
    { id: 'R3', kind: 'router', at: [580, 160], ip: { 'g0/0': '10.0.23.2/30', 'g0/1': '10.0.34.2/30', 'g0/2': '192.168.3.1/24' }, set: d => ospf(d, ['10.0.0.0/16', '192.168.3.0/24']) },
    { id: 'PC3', kind: 'pc', at: [800, 160], ip: { eth0: '192.168.3.10/24' }, gw: '192.168.3.1' },
  ], [['PC1', 'eth0', 'R1', 'g0/2'], ['R1', 'g0/0', 'R2', 'g0/0'], ['R1', 'g0/1', 'R4', 'g0/0'], ['R2', 'g0/1', 'R3', 'g0/0'], ['R4', 'g0/1', 'R3', 'g0/1'], ['R3', 'g0/2', 'PC3', 'eth0']]);
}
/** Three ASes in a triangle with eBGP. */
export function bgpScenario(ready = true) {
  const bgp = (asn: number, network: string, neighbors: [string, number][]) => (d: DeviceState) => {
    d.bgp = { asn, networks: ready ? [network] : [], neighbors: ready ? neighbors.map(([ip, remoteAs]) => ({ ip, remoteAs })) : [] };
    loopback(d, 0, `10.255.0.${asn - 65000}/32`);
  };
  return build([
    { id: 'PC1', kind: 'pc', at: [-180, 160], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'R1', kind: 'router', at: [40, 160], ip: { 'g0/0': '10.0.12.1/30', 'g0/1': '10.0.13.1/30', 'g0/2': '192.168.1.1/24' }, set: bgp(65001, '192.168.1.0/24', [['10.0.12.2', 65002], ['10.0.13.2', 65003]]) },
    { id: 'R2', kind: 'router', at: [320, 20], ip: { 'g0/0': '10.0.12.2/30', 'g0/1': '10.0.23.1/30', 'g0/2': '172.16.2.1/24' }, set: bgp(65002, '172.16.2.0/24', [['10.0.12.1', 65001], ['10.0.23.2', 65003]]) },
    { id: 'R3', kind: 'router', at: [320, 300], ip: { 'g0/0': '10.0.13.2/30', 'g0/1': '10.0.23.2/30', 'g0/2': '172.16.3.1/24' }, set: bgp(65003, '172.16.3.0/24', [['10.0.13.1', 65001], ['10.0.23.1', 65002]]) },
    { id: 'SRV2', kind: 'server', at: [560, 20], ip: { eth0: '172.16.2.10/24' }, gw: '172.16.2.1', set: d => { d.services = [web()]; } },
    { id: 'SRV3', kind: 'server', at: [560, 300], ip: { eth0: '172.16.3.10/24' }, gw: '172.16.3.1' },
  ], [['PC1', 'eth0', 'R1', 'g0/2'], ['R1', 'g0/0', 'R2', 'g0/0'], ['R1', 'g0/1', 'R3', 'g0/0'], ['R2', 'g0/1', 'R3', 'g0/1'], ['R2', 'g0/2', 'SRV2', 'eth0'], ['R3', 'g0/2', 'SRV3', 'eth0']]);
}

// ---------------------------------------------------------------- ⑪ VPN
/**
 * Office → Internet → cloud gateway, with a route-based IPsec tunnel.
 * `mode`: 'static' routes over the tunnel, or 'bgp' over two tunnels (redundancy).
 */
export function vpnScenario(mode: 'none' | 'static' | 'bgp' = 'static') {
  return build([
    { id: 'PC1', kind: 'pc', at: [-160, 160], ip: { eth0: '192.168.10.10/24' }, gw: '192.168.10.1' },
    { id: 'CGW', kind: 'router', at: [60, 160], ip: { 'g0/0': '192.168.10.1/24', 'g0/1': '198.51.100.2/30' }, routes: [['0.0.0.0/0', '198.51.100.1'], ...(mode === 'static' ? [['10.0.0.0/16', '169.254.10.2']] as [string, string][] : [])], set: d => {
      if (mode === 'none') return;
      tunnel(d, 1, '169.254.10.1/30', '198.51.100.2', '203.0.113.2');
      if (mode === 'bgp') {
        tunnel(d, 2, '169.254.20.1/30', '198.51.100.2', '203.0.113.6');
        d.bgp = { asn: 65000, networks: ['192.168.10.0/24'], neighbors: [{ ip: '169.254.10.2', remoteAs: 64512 }, { ip: '169.254.20.2', remoteAs: 64512 }] };
      }
    } },
    { id: 'INET', kind: 'internet', at: [320, 160], ip: { 'g0/0': '198.51.100.1/30', 'g0/1': '203.0.113.1/30', 'g0/2': '203.0.113.5/30' } },
    { id: 'VGW1', kind: 'router', at: [580, 40], ip: { 'g0/0': '203.0.113.2/30', 'g0/1': '10.0.1.1/24' }, routes: [['0.0.0.0/0', '203.0.113.1'], ...(mode === 'static' ? [['192.168.10.0/24', '169.254.10.1']] as [string, string][] : [])], set: d => {
      if (mode === 'none') return;
      tunnel(d, 1, '169.254.10.2/30', '203.0.113.2', '198.51.100.2');
      if (mode === 'bgp') d.bgp = { asn: 64512, networks: ['10.0.1.0/24'], neighbors: [{ ip: '169.254.10.1', remoteAs: 65000 }, { ip: '10.0.1.2', remoteAs: 64512, nextHopSelf: true }] };
    } },
    { id: 'VGW2', kind: 'router', at: [580, 300], ip: { 'g0/0': '203.0.113.6/30', 'g0/1': '10.0.1.2/24' }, routes: [['0.0.0.0/0', '203.0.113.5']], set: d => {
      if (mode !== 'bgp') return;
      tunnel(d, 2, '169.254.20.2/30', '203.0.113.6', '198.51.100.2');
      d.bgp = { asn: 64512, networks: ['10.0.1.0/24'], neighbors: [{ ip: '169.254.20.1', remoteAs: 65000, prepend: 2 }, { ip: '10.0.1.1', remoteAs: 64512, nextHopSelf: true }] };
    } },
    { id: 'VPCSW', kind: 'switch', at: [800, 160] },
    { id: 'EC2', kind: 'server', at: [1000, 160], ip: { eth0: '10.0.1.10/24' }, gw: '10.0.1.1', set: d => { d.services = [web('app', '<h1>App in VPC</h1>'), ssh()]; } },
  ], [['PC1', 'eth0', 'CGW', 'g0/0'], ['CGW', 'g0/1', 'INET', 'g0/0'], ['INET', 'g0/1', 'VGW1', 'g0/0'], ['INET', 'g0/2', 'VGW2', 'g0/0'],
    ['VGW1', 'g0/1', 'VPCSW', 'g0/1'], ['VGW2', 'g0/1', 'VPCSW', 'g0/2'], ['VPCSW', 'g0/3', 'EC2', 'eth0']]);
}

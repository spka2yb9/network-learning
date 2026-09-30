import { describe, expect, it } from 'vitest';
import { CliEngine } from './CliEngine';
import { build } from '../simulator/scenarios/build';
import { bgpScenario, dnsScenario, l3SwitchScenario, natScenario, ospfScenario, vlanScenario, vpnScenario } from '../simulator/scenarios/chapters';
import { routingScenario } from '../simulator/scenarios/routing';

const run = (cli: CliEngine, id: string, ...lines: string[]) => lines.map(l => cli.execute(id, l)).filter(Boolean).join('\n');

describe('IOS-style CLI', () => {
  it('runs global-config commands from a sub-mode like IOS and never silently ignores unknown input', () => {
    const n = vlanScenario(); const cli = new CliEngine(n);
    run(cli, 'SW2', 'enable', 'configure terminal', 'interface g0/1', 'switchport access vlan 20', 'interface g0/2', 'switchport access vlan 10', 'end');
    const ports = n.device('SW2').interfaces;
    expect(ports.find(i => i.id === 'g0/1')!.switchport!.accessVlan).toBe(20);
    expect(ports.find(i => i.id === 'g0/2')!.switchport!.accessVlan).toBe(10); // switched interface, not applied to g0/1 again
    run(cli, 'R1', 'enable', 'configure terminal', 'interface g0/0.10', 'ip route 10.9.9.0/24 192.168.10.254', 'end');
    expect(n.device('R1').routes.some(r => r.destination === '10.9.9.0/24')).toBe(true);
    const out = run(cli, 'R1', 'configure terminal', 'interface g0/0.10', 'frobnicate now');
    expect(out).toContain('Invalid input: frobnicate now');
    expect(cli.prompt('R1')).toContain('(config-if)#'); // still in the sub-mode after an error
  });
  it('builds VLANs, access ports and a trunk from scratch', () => {
    const n = vlanScenario();
    // Reset SW2 to factory defaults via CLI and rebuild.
    n.update('SW2', d => { d.vlans = []; d.interfaces.forEach(i => { if (i.switchport) i.switchport = { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 }; }); });
    const cli = new CliEngine(n);
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
    const out = run(cli, 'SW2', 'enable', 'configure terminal', 'vlan 10', 'name SALES', 'exit', 'vlan 20', 'exit',
      'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface g0/2', 'switchport access vlan 20', 'exit',
      'interface g0/3', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'end');
    expect(out).toBe('');
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
    expect(n.ping('PC2', '192.168.20.14').success).toBe(true);
    const vlan = cli.execute('SW2', 'show vlan brief');
    expect(vlan).toMatch(/10\s+SALES\s+active\s+g0\/1/);
    expect(cli.execute('SW2', 'show interfaces trunk')).toContain('10,20');
    cli.execute('PC1', 'ping 192.168.10.13');
    expect(cli.execute('SW2', 'show mac address-table')).toMatch(/10\s+02:00/);
    expect(cli.execute('SW1', 'show spanning-tree')).toContain('Root ID');
  });
  it('router-on-a-stick with subinterfaces via CLI', () => {
    const n = vlanScenario();
    n.removeDevice('R1');
    n.addDevice({ id: 'R9', kind: 'router', position: { x: 0, y: 0 }, routes: [], arp: [], interfaces: [{ id: 'g0/0', mac: '02:00:00:99:00:01', up: true }] });
    n.connect({ id: 'uplink', sourceDevice: 'SW1', sourceInterface: 'g0/8', targetDevice: 'R9', targetInterface: 'g0/0', up: true, bandwidth: 1000, latency: 1 });
    const cli = new CliEngine(n);
    run(cli, 'R9', 'enable', 'conf t', 'interface g0/0.10', 'encapsulation dot1q 10', 'ip address 192.168.10.1/24', 'exit',
      'interface g0/0.20', 'encapsulation dot1q 20', 'ip address 192.168.20.1 255.255.255.0', 'end');
    expect(cli.execute('R9', 'show ip interface brief')).toMatch(/g0\/0\.20\s+192\.168\.20\.1/);
    expect(n.ping('PC1', '192.168.20.14').success).toBe(true);
    expect(cli.execute('R9', 'show running-config')).toContain('encapsulation dot1q 20');
  });
  it('configures PAT and shows translations', () => {
    const n = natScenario(false);
    const cli = new CliEngine(n);
    expect(n.ping('PC1', '198.51.100.80').success).toBe(false);
    run(cli, 'R1', 'enable', 'conf t', 'ip nat inside source 192.168.1.0/24 interface g0/1 overload', 'end');
    expect(cli.execute('PC1', 'curl http://198.51.100.80/')).toContain('Public web');
    const table = cli.execute('R1', 'show ip nat translations');
    expect(table).toMatch(/tcp\s+203\.0\.113\.2:49152\s+192\.168\.1\.10:49152/);
    run(cli, 'R1', 'conf t', 'ip nat inside source static tcp 192.168.1.20 80 interface g0/1 8080', 'end');
    expect(cli.execute('EXT', 'curl http://203.0.113.2:8080/')).toContain('NAS');
    expect(cli.execute('R1', 'show running-config')).toContain('ip nat inside source static tcp 192.168.1.20 80 203.0.113.2 8080');
  });
  it('extended ACL is evaluated top-down with implicit deny', () => {
    const n = routingScenario(true); const cli = new CliEngine(n);
    run(cli, 'R2', 'enable', 'conf t', 'ip access-list extended PROTECT', '10 deny icmp any host 192.168.2.10', 'exit', 'interface g0/0', 'ip access-group PROTECT in', 'end');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('Packet filtered');
    // implicit deny also blocks the ICMP error return? No: errors come from R2 itself. But everything else is denied too:
    expect(n.ping('PC1', '10.0.0.2').success).toBe(false);
    run(cli, 'R2', 'conf t', 'ip access-list extended PROTECT', '20 permit ip any any', 'end');
    expect(n.ping('PC1', '10.0.0.2').success).toBe(true);
    expect(cli.execute('R2', 'show access-lists')).toContain('20 permit ip any any');
  });
  it('OSPF via CLI (wildcard syntax) and show commands', () => {
    const n = ospfScenario(false); const cli = new CliEngine(n);
    for (const [id, nets] of [['R1', ['10.0.12.0 0.0.0.3', '10.0.14.0 0.0.0.3', '192.168.1.0 0.0.0.255']], ['R2', ['10.0.0.0 0.0.255.255']], ['R4', ['10.0.0.0/16']], ['R3', ['10.0.0.0/16', '192.168.3.0/24']]] as [string, string[]][]) {
      run(cli, id, 'enable', 'conf t', 'router ospf 1', ...nets.map(x => `network ${x} area 0`), 'end');
    }
    expect(n.ping('PC1', '192.168.3.10').success).toBe(true);
    expect(cli.execute('R1', 'show ip ospf neighbor')).toContain('FULL');
    expect(cli.execute('R1', 'show ip route')).toMatch(/O\s+192\.168\.3\.0\/24\s+\[110\/3\]/);
    expect(cli.execute('R1', 'show ip route 192.168.3.10')).toContain('最長一致の候補');
    run(cli, 'R2', 'conf t', 'router ospf 1', 'no network 10.0.0.0/16 area 0', 'network 10.0.0.0/16 area 5', 'end');
    expect(cli.execute('R1', 'show logging')).toContain('エリア');
  });
  it('BGP via CLI, summary and path detail', () => {
    const n = bgpScenario(false); const cli = new CliEngine(n);
    const conf = [['R1', 65001, '192.168.1.0/24', [['10.0.12.2', 65002], ['10.0.13.2', 65003]]], ['R2', 65002, '172.16.2.0/24', [['10.0.12.1', 65001], ['10.0.23.2', 65003]]], ['R3', 65003, '172.16.3.0/24', [['10.0.13.1', 65001], ['10.0.23.1', 65002]]]] as const;
    for (const [id, asn, net, peers] of conf) run(cli, id, 'enable', 'conf t', `router bgp ${asn}`, ...peers.map(([ip, as]) => `neighbor ${ip} remote-as ${as}`), `network ${net}`, 'end');
    expect(cli.execute('R1', 'show ip bgp summary')).toMatch(/10\.0\.12\.2\s+4 65002\s+\d/);
    expect(cli.execute('R1', 'show ip bgp')).toMatch(/\*>\s+172\.16\.2\.0\/24\s+10\.0\.12\.2/);
    run(cli, 'R1', 'conf t', 'router bgp 65001', 'neighbor 10.0.13.2 local-preference 300', 'end');
    expect(cli.execute('R1', 'show ip bgp 172.16.2.0/24')).toContain('LOCAL_PREF');
    run(cli, 'R1', 'conf t', 'router bgp 65001', 'neighbor 10.0.12.2 remote-as 64999', 'end');
    expect(cli.execute('R1', 'show logging')).toContain('remote-as');
    expect(cli.execute('R1', 'router bgp 65009')).toContain('%');
  });
  it('IPsec tunnel via CLI', () => {
    const n = vpnScenario('none'); const cli = new CliEngine(n);
    run(cli, 'CGW', 'enable', 'conf t', 'interface tunnel1', 'ip address 169.254.10.1/30', 'tunnel source g0/1', 'tunnel destination 203.0.113.2', 'tunnel mode ipsec', 'tunnel protection psk s3cret', 'exit', 'ip route 10.0.1.0/24 tunnel1', 'end');
    expect(cli.execute('CGW', 'show crypto session')).toContain('DOWN');
    run(cli, 'VGW1', 'enable', 'conf t', 'interface tunnel1', 'ip address 169.254.10.2/30', 'tunnel source 203.0.113.2', 'tunnel destination 198.51.100.2', 'tunnel mode ipsec', 'tunnel protection psk s3cret', 'exit', 'ip route 192.168.10.0/24 169.254.10.1', 'end');
    expect(cli.execute('CGW', 'show crypto session')).toContain('UP-ACTIVE');
    expect(cli.execute('PC1', 'curl http://10.0.1.10/')).toContain('App in VPC');
  });
  it('sub-mode fallbacks, dotted masks and usage errors instead of JS crashes', () => {
    const n = natScenario(false); const cli = new CliEngine(n);
    // interface mode: only `ip nat inside|outside` sets the role; the global `ip nat inside source ...` falls through
    run(cli, 'R1', 'enable', 'conf t', 'interface g0/1', 'ip nat inside source 192.168.1.0/24 interface g0/1 overload');
    expect(n.device('R1').nat).toHaveLength(1);
    expect(n.device('R1').interfaces.find(i => i.id === 'g0/1')!.nat).toBe('outside');
    run(cli, 'R1', 'interface g0/1', 'no ip nat inside source 192.168.1.0/24 interface g0/1 overload');
    expect([n.device('R1').nat, n.device('R1').interfaces.find(i => i.id === 'g0/1')!.nat]).toEqual([undefined, 'outside']);
    // ACL mode falls back to global config like the other sub-modes
    run(cli, 'R1', 'ip access-list extended X', 'permit ip any any', 'interface g0/0');
    expect(cli.prompt('R1')).toBe('R1(config-if)#');
    expect(n.device('R1').acls![0].rules).toHaveLength(1);
    run(cli, 'R1', 'exit', 'no ip route 0.0.0.0/0', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1');
    expect(n.device('R1').routes).toMatchObject([{ destination: '0.0.0.0/0', nextHop: '203.0.113.1' }]);
    for (const [cmd, text] of [['ip route', '使い方: ip route'], ['no ip route', '使い方: no ip route'], ['ip nat inside source', 'ip nat inside source <CIDR>'], ['ip prefix-list L seq 5 permit', 'ip prefix-list <名前>']])
      expect(cli.execute('R1', cmd)).toContain(text);
    const sw = new CliEngine(l3SwitchScenario());
    expect(run(sw, 'L3SW', 'enable', 'conf t', 'vlan 1', 'name X')).toContain('VLAN 1');
    expect(run(sw, 'L3SW', 'vlan 10', 'name STAFF', 'end')).toBe('');
    sw.network.setLinkState('link-1', false);
    expect(sw.execute('L3SW', 'show ip interface brief')).toMatch(/vlan10\s+10\.10\.10\.1\s+up\s+down/);
    expect(sw.execute('L3SW', 'show ip route')).not.toContain('10.10.10.0/24');
  });
  it('mode errors are explained', () => {
    const cli = new CliEngine(routingScenario());
    expect(cli.execute('R1', 'interface g0/0')).toContain('enable');
    expect(cli.execute('R1', 'show nonsense')).toContain('%');
    cli.execute('R1', 'enable'); cli.execute('R1', 'conf t'); cli.execute('R1', 'interface g0/0');
    expect(cli.prompt('R1')).toBe('R1(config-if)#');
    expect(cli.execute('R1', 'do show ip route')).toContain('Codes');
  });
});

describe('Linux CLI', () => {
  it('dig / nslookup / curl / ss produce realistic output from the simulated state', () => {
    const cli = new CliEngine(dnsScenario());
    const dig = cli.execute('PC1', 'dig www.example.com');
    expect(dig).toContain('status: NOERROR');
    expect(dig).toMatch(/www\.example\.com\.\s+\d+\s+IN\s+A\s+203\.0\.113\.80/);
    expect(cli.execute('PC1', 'dig +short example.com MX')).toBe('10 mail.example.com.');
    expect(cli.execute('PC1', 'dig @198.51.100.30 www.example.com')).toContain('flags: qr aa rd');
    expect(cli.execute('PC1', 'dig nope.example.com')).toContain('NXDOMAIN');
    expect(cli.execute('PC1', 'dig -x 192.168.1.10')).toContain('pc1.corp.example.');
    expect(cli.execute('PC1', 'dig www.example.com +trace')).toContain('Referral');
    expect(cli.execute('PC1', 'nslookup shop.example.com')).toContain('canonical name');
    expect(cli.execute('PC1', 'curl -v https://www.example.com/')).toContain('[TLS]');
    expect(cli.execute('PC1', 'curl https://203.0.113.80/')).toContain('curl: (60)');
    expect(cli.execute('WEB', 'ss -tlnp')).toMatch(/tcp\s+LISTEN\s+0\.0\.0\.0:443/);
    expect(cli.execute('PC1', 'ping -c 2 www.example.com')).toContain('2 received');
  });
  it('troubleshooting commands reflect failures layer by layer', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    cli.execute('PC1', 'ip link set eth0 down');
    expect(cli.execute('PC1', 'ip addr')).toContain('state DOWN');
    expect(cli.execute('PC1', 'ping 192.168.1.1')).toContain('Network is unreachable');
    cli.execute('PC1', 'ip link set eth0 up');
    expect(cli.execute('PC1', 'ip route get 8.8.8.8')).toContain('via 192.168.1.1');
    cli.execute('PC1', 'echo "nameserver 192.168.1.99" > /etc/resolv.conf');
    expect(cli.execute('PC1', 'cat /etc/resolv.conf')).toBe('nameserver 192.168.1.99');
    expect(cli.execute('PC1', 'curl http://www.example.com/')).toContain('curl: (6)');
    cli.execute('PC1', 'echo "nameserver 192.168.1.53" > /etc/resolv.conf');
    cli.execute('WEB', 'systemctl stop nginx');
    expect(cli.execute('PC1', 'curl http://www.example.com/')).toContain('Connection refused');
    expect(cli.execute('WEB', 'systemctl status nginx')).toContain('inactive');
    cli.execute('WEB', 'systemctl start nginx');
    expect(cli.execute('PC1', 'nc -zv www.example.com 80')).toContain('succeeded');
    expect(cli.execute('PC1', 'traceroute -I 203.0.113.80')).toMatch(/3\s+203\.0\.113\.80/);
    expect(cli.execute('PC1', 'traceroute 203.0.113.80')).toMatch(/3\s+203\.0\.113\.80/);
  });
  it('iptables INPUT rules and nft view', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    run(cli, 'WEB', 'iptables -P INPUT DROP', 'iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT', 'iptables -A INPUT -p tcp --dport 443 -j ACCEPT');
    expect(cli.execute('PC1', 'curl http://203.0.113.80/')).toContain('timed out');
    expect(cli.execute('PC1', 'curl -k https://203.0.113.80/')).toContain('TLS');
    cli.execute('WEB', 'iptables -I INPUT 1 -p tcp --dport 80 -j REJECT');
    // REJECT answers with ICMP port unreachable → the client's connect() fails with ECONNREFUSED.
    expect(cli.execute('PC1', 'curl http://203.0.113.80/')).toContain('Connection refused');
    expect(cli.execute('WEB', 'iptables -L -n')).toMatch(/1\s+REJECT\s+tcp/);
    expect(cli.execute('WEB', 'nft list ruleset')).toContain('policy drop');
    cli.execute('WEB', 'iptables -D INPUT 1');
    expect(cli.execute('WEB', 'iptables -A FORWARD -j DROP')).toContain('INPUT');
    expect(cli.execute('WEB', 'iptables -F')).toBe('');
    expect(cli.execute('WEB', 'iptables -S')).toBe('-P INPUT DROP');
  });
  it('sleep advances virtual time so DNS cache TTL decreases', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    cli.execute('PC1', 'dig www.example.com');
    cli.execute('PC1', 'sleep 100');
    expect(cli.execute('PC1', 'dig www.example.com')).toMatch(/www\.example\.com\.\s+200\s+IN\s+A/);
    cli.execute('RESOLVER', 'rndc flush');
    expect(cli.execute('RESOLVER', 'rndc dumpdb -cache')).toContain('空');
  });
  it('explain=false hides the simulator diagnosis (troubleshooting labs)', () => {
    const n = routingScenario(); const cli = new CliEngine(n);
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('シミュレータ所見');
    cli.explain = false;
    const out = cli.execute('PC1', 'ping 192.168.2.10');
    expect(out).not.toContain('シミュレータ所見');
    expect(out).toContain('Destination Net Unreachable');
  });
  it('tcpdump filters recorded frames per interface', () => {
    const n = build([
      { id: 'A', kind: 'pc', at: [0, 0], ip: { eth0: '10.0.0.1/24' } },
      { id: 'B', kind: 'pc', at: [100, 0], ip: { eth0: '10.0.0.2/24' } },
    ], [['A', 'eth0', 'B', 'eth0']]);
    const cli = new CliEngine(n);
    cli.execute('A', 'ping -c 2 10.0.0.2');
    expect(cli.execute('B', 'tcpdump -i eth0 icmp').split('\n').filter(l => l.includes('ICMP'))).toHaveLength(4);
    expect(cli.execute('B', 'tcpdump -e arp')).toContain('ff:ff:ff:ff:ff:ff');
    expect(cli.execute('B', 'tcpdump -c 1 icmp')).toContain('1 packets captured');
    for (const bad of ['tcpdump -c 0', 'tcpdump -c abc']) expect(cli.execute('B', bad)).toContain('invalid packet count');
  });
  it('validates option values (nc -w, traceroute -p, systemctl without a unit)', () => {
    const cli = new CliEngine(dnsScenario());
    expect(cli.execute('PC1', 'nc -w 3 -zv 203.0.113.80 80')).toContain('succeeded');
    expect(cli.execute('PC1', 'traceroute -T -p abc 203.0.113.80')).toContain('ポートは1〜65535');
    expect(cli.execute('WEB', 'systemctl status')).toContain('使い方: systemctl');
  });
});

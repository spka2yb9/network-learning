import { describe, expect, it } from 'vitest';
import { CliEngine } from './CliEngine';
import { build } from '../simulator/scenarios/build';
import { bgpScenario, dnsScenario, ecmpScenario, l3SwitchScenario, lagScenario, natScenario, ospfScenario, stpScenario, vlanScenario, vpnScenario } from '../simulator/scenarios/chapters';
import { diagnose } from '../application/diagnose';
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
    // A sub-interface created without encapsulation yet never prints "undefined".
    run(cli, 'R9', 'conf t', 'interface g0/0.30', 'end');
    expect(cli.execute('R9', 'show running-config')).not.toContain('undefined');
    expect(cli.execute('R9', 'show interfaces g0/0.30')).toContain('Vlan ID 未設定');
    expect(cli.execute('PC1', 'ethtool')).toContain('使い方: ethtool');
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

describe('Link aggregation, ECMP and speed via CLI (same Core state as the GUI)', () => {
  it('interface range → channel-group creates po1; the trunk is set on po1; show etherchannel / interfaces po1', () => {
    const n = lagScenario(); const cli = new CliEngine(n);
    const created = run(cli, 'SW1', 'enable', 'conf t', 'interface range g0/7-8', 'channel-group 1 mode active', 'exit', 'interface port-channel 1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'end');
    expect(created).toContain('Creating a port-channel interface po1');
    expect(cli.prompt('SW1')).toBe('SW1#');
    expect(cli.execute('SW1', 'show etherchannel summary')).toMatch(/po1\(SD\)\s+LACP\s+g0\/7\(s\)\s+g0\/8\(s\)/);
    expect(cli.execute('SW1', 'show logging')).toContain('%EC-5-L3DONTBNDL2');
    run(cli, 'SW2', 'enable', 'conf t', 'interface range g0/7 - 8', 'channel-group 1 mode passive', 'end');
    expect(cli.execute('SW1', 'show etherchannel summary')).toMatch(/po1\(SU\)\s+LACP\s+g0\/7\(P\)\s+g0\/8\(P\)/);
    expect(n.ping('PC2', '192.168.20.14').success).toBe(true);
    const po = cli.execute('SW1', 'show interfaces po1');
    expect(po).toContain('BW 2000000 Kbit/sec');
    expect(po).toContain('Members in this channel: g0/7 g0/8');
    expect(cli.execute('SW1', 'show interfaces trunk')).toMatch(/po1\s+on/);
    expect(cli.execute('SW1', 'show interfaces trunk')).not.toMatch(/g0\/7/);
    expect(cli.execute('SW1', 'show running-config')).toMatch(/interface g0\/7\n channel-group 1 mode active/);
    expect(cli.execute('SW1', 'show spanning-tree')).toMatch(/po1\s+Desg FWD/);
    expect(cli.execute('SW1', 'show interfaces g0/8')).toContain('Member of po1（mode active）: bundled');
    // A member cannot take its own L2 settings; mixing static and LACP is rejected.
    expect(run(cli, 'SW1', 'conf t', 'interface g0/7', 'switchport access vlan 10', 'end')).toContain('po1 のメンバー');
    expect(run(cli, 'SW1', 'conf t', 'interface g0/8', 'channel-group 1 mode on', 'end')).toContain('混在');
  });
  it('mode on vs LACP, speed mismatch and load-balance are visible and fixable from the CLI', () => {
    const n = lagScenario({ lag: true }); const cli = new CliEngine(n);
    run(cli, 'SW2', 'enable', 'conf t', 'interface range g0/7-8', 'no channel-group', 'channel-group 1 mode on', 'end');
    expect(cli.execute('SW2', 'show etherchannel summary')).toMatch(/static\s+g0\/7\(s\)/);
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
    run(cli, 'SW2', 'conf t', 'interface range g0/7-8', 'no channel-group', 'channel-group 1 mode active', 'end');
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
    expect(run(cli, 'SW1', 'enable', 'conf t', 'interface g0/8', 'speed 100', 'end')).toContain('100 Mbps');
    expect(cli.execute('SW2', 'show logging')).toContain('%EC-5-CANNOT_BUNDLE2');
    expect(cli.execute('SW1', 'show interfaces po1')).toContain('BW 1000000 Kbit/sec');
    run(cli, 'SW1', 'conf t', 'interface g0/8', 'speed 1000', 'exit', 'port-channel load-balance src-dst-mac', 'end');
    expect(cli.execute('SW1', 'show etherchannel load-balance')).toContain('src-dst-mac');
    expect(cli.execute('SW1', 'show running-config')).toContain('port-channel load-balance src-dst-mac');
    run(cli, 'SW1', 'conf t', 'no interface po1', 'end');
    expect(n.device('SW1').interfaces.some(i => i.channelGroup)).toBe(false);
  });
  it('show ip route lists every equal-cost next hop; exact-route explains the per-flow choice; maximum-paths 1 is single-path', () => {
    const n = ecmpScenario('none'); const cli = new CliEngine(n);
    run(cli, 'R1', 'enable', 'conf t', 'ip route 10.20.0.0/24 10.0.12.2', 'ip route 10.20.0.0 255.255.255.0 10.0.13.3', 'end');
    const table = cli.execute('R1', 'show ip route');
    expect(table).toMatch(/S\s+10\.20\.0\.0\/24\s+\[1\/0\] via 10\.0\.12\.2\n\s+\[1\/0\] via 10\.0\.13\.3/);
    expect(cli.execute('R1', 'show ip route 10.20.0.10')).toMatch(/\* 10\.0\.12\.2, via g0\/1\n\s+10\.0\.13\.3, via g0\/2/);
    const routes = [...Array(12).keys()].map(i => cli.execute('R1', `show ip cef exact-route 192.168.1.10 10.20.0.10 tcp ${50000 + i} 80`).split('\n')[0]);
    expect(new Set(routes).size).toBe(2);
    expect(cli.execute('R1', 'show ip cef exact-route 192.168.1.10 10.20.0.10 tcp 50000 80').split('\n')[0]).toBe(routes[0]);
    const o = ecmpScenario('ospf'); const c2 = new CliEngine(o);
    expect(c2.execute('R1', 'show ip route ospf')).toMatch(/O\s+10\.20\.0\.0\/24\s+\[110\/3\] via 10\.0\.12\.2, g0\/1.*\n\s+\[110\/3\] via 10\.0\.13\.3, g0\/2/);
    run(c2, 'R1', 'enable', 'conf t', 'router ospf 1', 'maximum-paths 1', 'end');
    expect(o.installed('R1').filter(r => r.destination === '10.20.0.0/24')).toHaveLength(1);
    expect(c2.execute('R1', 'show running-config')).toContain(' maximum-paths 1');
  });
  it('iperf3 reports the bottleneck rate and per-stream sharing; ethtool shows the speed', () => {
    const n = lagScenario({ lag: true }); const cli = new CliEngine(n);
    const one = cli.execute('PC1', 'iperf3 -c 192.168.10.13');
    expect(one).toMatch(/1\.00 Gbits\/sec/);
    expect(one).toContain('po1のメンバー');
    expect(cli.execute('PC1', 'iperf3 -c 192.168.10.13 -P 8')).toMatch(/\[SUM\]\s+0\.00-10\.00\s+sec\s+2\.00 Gbits\/sec/);
    expect(cli.lastResult?.events.some(e => e.type === 'LAG_HASH')).toBe(true);
    expect(cli.execute('PC1', 'iperf3 -c 192.168.10.12')).toContain('unable to connect');
    expect(cli.execute('PC1', 'ethtool eth0')).toContain('Speed: 10000Mb/s');
    cli.execute('PC2', 'iperf3 -s');
    expect(n.device('PC2').services?.some(s => s.port === 5201)).toBe(true);
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

describe('review regressions', () => {
  it('dig / nslookup report a refusing server as connection refused, not a timeout', () => {
    const cli = new CliEngine(dnsScenario());
    expect(cli.execute('PC1', 'dig @203.0.113.80 www.example.com')).toMatch(/^;; communications error to 203\.0\.113\.80#53: connection refused\n;; no servers could be reached/);
    expect(cli.execute('PC1', 'nslookup www.example.com 203.0.113.80')).toContain('connection refused');
  });
  it('no spanning-tree priority resets the priority; cost / portfast stay in interface mode', () => {
    const n = stpScenario(); const cli = new CliEngine(n);
    run(cli, 'SW1', 'enable', 'conf t', 'spanning-tree priority 4096', 'no spanning-tree priority 4096');
    expect(n.device('SW1').stp).toEqual({ enabled: true, priority: 32768 });
    run(cli, 'SW1', 'no spanning-tree', 'interface g0/1', 'spanning-tree cost 5', 'no spanning-tree cost', 'spanning-tree portfast');
    expect([cli.prompt('SW1'), n.device('SW1').stp!.enabled, n.device('SW1').interfaces.find(i => i.id === 'g0/1')!.stpCost]).toEqual(['SW1(config-if)#', false, undefined]);
  });
  it('no ip route <CIDR> <IF> <next-hop> deletes only that route', () => {
    const n = routingScenario(true); const cli = new CliEngine(n);
    run(cli, 'R1', 'enable', 'conf t', 'ip route 10.9.0.0/24 g0/1 10.0.0.2', 'ip route 10.9.0.0/24 10.0.0.2', 'no ip route 10.9.0.0/24 g0/1 10.0.0.2');
    expect(n.device('R1').routes.filter(r => r.destination === '10.9.0.0/24').map(r => `${r.interfaceId ?? '-'} ${r.nextHop}`)).toEqual(['- 10.0.0.2']);
  });
  it('running-config prints ip route <CIDR> <IF> <next-hop>, the form it can be pasted back as', () => {
    const cli = new CliEngine(routingScenario(true));
    run(cli, 'R1', 'enable', 'conf t', 'ip route 10.8.0.0/24 g0/1 10.0.0.2', 'end');
    expect(cli.execute('R1', 'show running-config')).toContain('\nip route 10.8.0.0/24 g0/1 10.0.0.2\n');
  });
  it('iptables rejects options it does not implement instead of widening the rule', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    for (const bad of ['-p tcp -m multiport --dports 22,80', '! -s 10.0.0.0/8', '-p tcp --dport 22 extra']) expect(cli.execute('WEB', `iptables -A INPUT ${bad} -j DROP`)).toContain('未対応');
    expect(n.device('WEB').firewall?.rules ?? []).toHaveLength(0);
    expect(cli.execute('WEB', 'iptables -I INPUT 1 -p tcp --destination-port 22 -j ACCEPT')).toBe('');
  });
  it('iptables -L -n and nft list ruleset show every match condition', () => {
    const cli = new CliEngine(dnsScenario());
    cli.execute('WEB', 'iptables -A INPUT -p tcp --sport 53 -i eth0 -j ACCEPT');
    expect(cli.execute('WEB', 'iptables -L -n')).toContain('tcp spt:53 in:eth0');
    expect(cli.execute('WEB', 'nft list ruleset')).toContain('iifname "eth0" meta l4proto tcp tcp sport 53 accept');
  });
  it('ip route lists a gateway outside the subnet with the note subnet-ts-02 / linux-ts-02 point to', () => {
    const n = routingScenario(true); n.configureInterface('PC1', 'eth0', '192.168.10.10/24', true);
    expect(new CliEngine(n).execute('PC1', 'ip route')).toContain('default via 192.168.1.1 （Next Hopに到達できません）');
  });
  it('default and 0.0.0.0/0 are one route; diagnose also sees a static default route', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    expect(cli.execute('PC1', 'ip route add 0.0.0.0/0 via 192.168.1.1')).toContain('File exists');
    run(cli, 'PC1', 'ip route del 0.0.0.0/0', 'ip route add 0.0.0.0/0 via 192.168.1.1');
    expect(cli.execute('PC1', 'ip route').match(/^default/gm)).toHaveLength(1);
    expect(run(cli, 'PC1', 'ip route del default', 'ip route')).not.toContain('default');
    n.update('PC1', d => { d.routes.push({ destination: '0.0.0.0/0', nextHop: '192.168.1.1', preference: 1, metric: 0, kind: 'static' }); });
    expect(diagnose(n.snapshot(), 'PC1', 'https://www.example.com/')[2].ok).toBe(true);
  });
  it('ip route replace validates the gateway before removing the old route', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    expect(run(cli, 'PC1', 'ip route add 10.5.0.0/16 via 192.168.1.1', 'ip route replace 10.5.0.0/16 via bogus')).toContain('%');
    expect(n.device('PC1').routes).toMatchObject([{ destination: '10.5.0.0/16', nextHop: '192.168.1.1' }]);
  });
  it('ip default-gateway needs an address; only no ip default-gateway removes it', () => {
    const n = vlanScenario(); const cli = new CliEngine(n);
    expect(run(cli, 'SW1', 'enable', 'conf t', 'ip default-gateway 192.168.10.1', 'ip default-gateway')).toContain('使い方');
    expect(n.device('SW1').gateway).toBe('192.168.10.1');
    run(cli, 'SW1', 'no ip default-gateway');
    expect(n.device('SW1').gateway).toBeUndefined();
  });
  it('no ip prefix-list <name> seq <n> removes only that entry', () => {
    const n = bgpScenario(); const cli = new CliEngine(n);
    run(cli, 'R1', 'enable', 'conf t', 'ip prefix-list P seq 10 permit 10.0.0.0/8', 'ip prefix-list P seq 20 permit 10.1.0.0/16', 'no ip prefix-list P seq 10');
    expect(n.device('R1').prefixLists).toMatchObject([{ name: 'P', entries: [{ seq: 20 }] }]);
  });
  it('accepts IOS abbreviations (int, shut, sh ip ro, sh ip int b, do wr) and ip link set dev', () => {
    const n = routingScenario(true); const cli = new CliEngine(n);
    expect(run(cli, 'R1', 'en', 'conf t', 'int g0/0', 'shut')).toBe('');
    expect(n.device('R1').interfaces.find(i => i.id === 'g0/0')!.up).toBe(false);
    expect(run(cli, 'R1', 'no shut', 'do wr', 'end')).toContain('[OK]');
    expect(cli.execute('R1', 'sh ip ro')).toContain('Codes');
    expect(cli.execute('R1', 'sh int g0/0')).toContain('g0/0 is up');
    expect(cli.execute('R1', 'sh ip int b')).toMatch(/g0\/0\s+192\.168\.1\.1\s+up/);
    cli.execute('PC1', 'ip link set dev eth0 down');
    expect(n.device('PC1').interfaces[0].up).toBe(false);
  });
  it('usage errors instead of "undefined"; attached / clustered option values; ifconfig changes state', () => {
    const n = dnsScenario(); const cli = new CliEngine(n);
    expect(cli.execute('PC1', 'ip route get')).toContain('使い方');
    expect(cli.execute('PC1', 'ping -c2 192.168.1.1')).toContain('2 received');
    expect(cli.execute('PC1', 'tcpdump -ni eth0 icmp')).toContain('ICMP');
    expect(cli.execute('PC1', 'curl -X GET http://203.0.113.80/')).not.toMatch(/^curl: \(/);
    expect(cli.execute('PC1', 'dig +short -t MX example.com')).toBe('10 mail.example.com.');
    run(cli, 'PC1', 'ifconfig eth0 192.168.1.20 netmask 255.255.255.0', 'ifconfig eth0 down');
    expect(n.device('PC1').interfaces[0]).toMatchObject({ address: '192.168.1.20/24', up: false });
    const r = new CliEngine(ospfScenario()); run(r, 'R1', 'enable', 'conf t', 'ip route 0.0.0.0/0 10.0.12.2', 'end');
    expect(r.execute('R1', 'show ip route connected')).toContain('Gateway of last resort is 10.0.12.2');
    expect(r.execute('R1', 'show ip route foo')).toContain('%');
    expect(run(r, 'R1', 'conf t', 'router ospf 1', 'router-id')).toContain('使い方');
  });
});

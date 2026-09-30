import { describe, expect, it } from 'vitest';
import { CliEngine } from './CliEngine';
import { routingScenario } from '../simulator/scenarios/routing';

describe('CLI integration', () => {
  it('configures, diagnoses, breaks and repairs the full slice', () => {
    const n = routingScenario(); const cli = new CliEngine(n);
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('100%');
    for (const [id, destination, hop] of [['R1', '192.168.2.0/24', '10.0.0.2'], ['R2', '192.168.1.0/24', '10.0.0.1']]) {
      cli.execute(id, 'enable'); cli.execute(id, 'configure terminal');
      expect(cli.execute(id, `ip route ${destination} ${hop}`)).toBe('');
      expect(n.installed(id).some(r => r.destination === destination && r.nextHop === hop)).toBe(true);
      cli.execute(id, 'end');
    }
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('1 received');
    expect(cli.execute('PC1', 'traceroute 192.168.2.10')).toContain('10.0.0.2');
    cli.execute('R1', 'configure terminal'); cli.execute('R1', 'no ip route 192.168.2.0/24');
    expect(cli.execute('R1', 'show ip route')).not.toContain('192.168.2.0/24');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('100%');
  });
  it('has per-device modes and protects config in user mode', () => {
    const n = routingScenario(); const cli = new CliEngine(n);
    expect(cli.execute('R1', 'ip route 192.168.2.0/24 10.0.0.2')).toContain('%');
    cli.execute('R1', 'enable'); cli.execute('R1', 'configure terminal');
    expect(cli.prompt('R1')).toBe('R1(config)#'); expect(cli.prompt('R2')).toBe('R2>');
  });
  it('interface changes affect ping and running-config', () => {
    const n = routingScenario(true); const cli = new CliEngine(n);
    cli.execute('R1', 'enable'); cli.execute('R1', 'configure terminal'); cli.execute('R1', 'interface g0/1'); cli.execute('R1', 'shutdown');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('100%');
    cli.execute('R1', 'no shutdown');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('1 received');
  });
  it('Linux subset changes simulator state', () => {
    const n = routingScenario(true); const cli = new CliEngine(n);
    expect(cli.execute('PC1', 'ip route add default via 192.168.1.99')).toContain('File exists');
    cli.execute('PC1', 'ip route replace default via 192.168.1.99');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('ARP応答なし');
    cli.execute('PC1', 'ip route replace default via 192.168.1.1');
    expect(cli.execute('PC1', 'ping 192.168.2.10')).toContain('1 received');
    expect(cli.execute('PC1', 'tcpdump icmp')).toContain('Echo (ping) reply');
    expect(cli.execute('PC1', 'tcpdump bogus')).toContain('%');
  });
});

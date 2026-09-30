import { createDevice, NetworkSimulator } from '../core/NetworkSimulator';

export function routingScenario(ready = false) {
  const network = new NetworkSimulator();
  const specs = [
    { id: 'PC1', kind: 'pc' as const, ips: ['192.168.1.10/24'], gateway: '192.168.1.1' },
    { id: 'R1', kind: 'router' as const, ips: ['192.168.1.1/24', '10.0.0.1/30'] },
    { id: 'R2', kind: 'router' as const, ips: ['10.0.0.2/30', '192.168.2.1/24'] },
    { id: 'PC2', kind: 'pc' as const, ips: ['192.168.2.10/24'], gateway: '192.168.2.1' },
  ];
  specs.forEach((s, i) => {
    const d = createDevice(s.id, s.kind, i + 1, { x: 55 + i * 240, y: 130 });
    d.interfaces.forEach((port, index) => { port.address = s.ips[index]; });
    d.gateway = s.gateway; network.addDevice(d);
  });
  [['PC1', 'eth0', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/0'], ['R2', 'g0/1', 'PC2', 'eth0']].forEach(([sourceDevice, sourceInterface, targetDevice, targetInterface], i) => {
    network.connect({ id: `link-${i + 1}`, sourceDevice, sourceInterface, targetDevice, targetInterface, up: true, bandwidth: 1000, latency: 1 });
  });
  if (ready) {
    network.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 1, metric: 0 });
    network.addRoute('R2', { destination: '192.168.1.0/24', nextHop: '10.0.0.1', preference: 1, metric: 0 });
  }
  return network;
}

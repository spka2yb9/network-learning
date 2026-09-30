import { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import { resolveRoute } from '../simulator/l3/RoutingTable';
import { cidr } from '../simulator/l3/ipv4';

export interface CheckResult { label: string; pass: boolean }
export function gradeRouting(snapshot: NetworkSnapshot): CheckResult[] {
  // Isolated copy: assessment never warms the learner's ARP or changes their capture.
  const n = NetworkSimulator.fromSnapshot(snapshot);
  const safe = (check: () => boolean) => { try { return check(); } catch { return false; } };
  return [
    { label: 'PC1 → PC2 の往復通信が成立する', pass: safe(() => n.ping('PC1', '192.168.2.10').success) },
    { label: 'PC2 → PC1 の往復通信が成立する', pass: safe(() => n.ping('PC2', '192.168.1.10').success) },
    { label: 'R1 がR2を次の転送先として選ぶ', pass: safe(() => resolveRoute(n.device('R1'), '192.168.2.10')?.nextHop === '10.0.0.2') },
    { label: 'R2 がR1を次の転送先として選ぶ', pass: safe(() => resolveRoute(n.device('R2'), '192.168.1.10')?.nextHop === '10.0.0.1') },
    { label: '静的ルートの宛先が必要な相手側LANの範囲に限られる', pass: safe(() => ['R1', 'R2'].every(id => {
      const d = n.device(id);
      const allowed = cidr(id === 'R1' ? '192.168.2.0/24' : '192.168.1.0/24');
      return d.routes.every(route => {
        const range = cidr(route.destination);
        return range.network >= allowed.network && range.broadcast <= allowed.broadcast;
      });
    })) },
  ];
}

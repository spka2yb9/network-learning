import { switchingKinds, type DeviceState, type Link } from '../core/types';

export type PortRole = 'root' | 'designated' | 'alternate' | 'disabled';
export interface StpPort { role: PortRole; forwarding: boolean; cost: number }
export interface StpBridge { bridgeId: string; rootId: string; rootCost: number; rootPort?: string; isRoot: boolean }
export interface StpResult { bridges: Map<string, StpBridge>; ports: Map<string, StpPort> }

export const portKey = (device: string, port: string) => `${device}|${port}`;
/** IEEE 802.1D short path cost by link speed (Mbps). */
export function defaultStpCost(bandwidth: number) {
  return bandwidth >= 10_000 ? 2 : bandwidth >= 1000 ? 4 : bandwidth >= 100 ? 19 : 100;
}
const bridgeId = (d: DeviceState) => `${String(d.stp?.priority ?? 32768).padStart(5, '0')}.${d.interfaces[0].mac}`;
export const stpEnabled = (d: DeviceState) => switchingKinds.includes(d.kind) && (d.stp?.enabled ?? true);

/**
 * Steady-state spanning tree (single instance, like 802.1D / MST instance 0).
 * BPDU exchange, timers and the listening/learning transition are not simulated.
 */
export function computeStp(devices: DeviceState[], links: Link[]): StpResult {
  const byId = new Map(devices.map(d => [d.id, d]));
  const bridges = new Map<string, StpBridge>();
  const ports = new Map<string, StpPort>();
  const isBridgePort = (deviceId: string, portId: string) => {
    const d = byId.get(deviceId);
    return !!d && stpEnabled(d) && !!d.interfaces.find(i => i.id === portId)?.switchport;
  };
  const portUp = (deviceId: string, portId: string) => byId.get(deviceId)?.interfaces.find(i => i.id === portId)?.up ?? false;
  const portIndex = (deviceId: string, portId: string) => byId.get(deviceId)!.interfaces.findIndex(i => i.id === portId) + 1;
  type Edge = { a: string; pa: string; b: string; pb: string; costA: number; costB: number };
  const edges: Edge[] = [];
  for (const d of devices) if (stpEnabled(d)) bridges.set(d.id, { bridgeId: bridgeId(d), rootId: bridgeId(d), rootCost: 0, isRoot: true });
  for (const l of links) {
    const active = l.up && portUp(l.sourceDevice, l.sourceInterface) && portUp(l.targetDevice, l.targetInterface);
    for (const [d, p] of [[l.sourceDevice, l.sourceInterface], [l.targetDevice, l.targetInterface]]) {
      if (!isBridgePort(d, p)) continue;
      const iface = byId.get(d)!.interfaces.find(i => i.id === p)!;
      ports.set(portKey(d, p), { role: active ? 'designated' : 'disabled', forwarding: active, cost: iface.stpCost ?? defaultStpCost(l.bandwidth) });
    }
    if (active && isBridgePort(l.sourceDevice, l.sourceInterface) && isBridgePort(l.targetDevice, l.targetInterface)) {
      edges.push({ a: l.sourceDevice, pa: l.sourceInterface, b: l.targetDevice, pb: l.targetInterface,
        costA: ports.get(portKey(l.sourceDevice, l.sourceInterface))!.cost, costB: ports.get(portKey(l.targetDevice, l.targetInterface))!.cost });
    }
  }
  // Connected components of bridges; each component elects its own root.
  const component = new Map<string, string>();
  for (const id of bridges.keys()) {
    if (component.has(id)) continue;
    const stack = [id]; const members: string[] = [];
    component.set(id, id);
    while (stack.length) {
      const cur = stack.pop()!; members.push(cur);
      for (const e of edges) for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) if (x === cur && !component.has(y)) { component.set(y, id); stack.push(y); }
    }
    const root = members.map(m => bridges.get(m)!.bridgeId).sort()[0];
    for (const m of members) bridges.get(m)!.rootId = root;
  }
  // Dijkstra from each root: cost is added by the port receiving the BPDU.
  const dist = new Map<string, number>();
  for (const [id, b] of bridges) dist.set(id, b.rootId === b.bridgeId ? 0 : Infinity);
  const done = new Set<string>();
  while (done.size < bridges.size) {
    const next = [...bridges.keys()].filter(id => !done.has(id)).sort((x, y) => dist.get(x)! - dist.get(y)!)[0];
    done.add(next);
    if (dist.get(next) === Infinity) continue;
    for (const e of edges) for (const [from, to, cost] of [[e.a, e.b, e.costB], [e.b, e.a, e.costA]] as const) {
      if (from === next && dist.get(next)! + cost < dist.get(to)!) dist.set(to, dist.get(next)! + cost);
    }
  }
  for (const [id, b] of bridges) {
    b.rootCost = dist.get(id)!; b.isRoot = b.rootId === b.bridgeId;
    if (b.isRoot) continue;
    // Root port: lowest (path cost, neighbor bridge ID, neighbor port ID, own port ID).
    const candidates = edges.flatMap(e => [
      ...(e.b === id ? [{ port: e.pb, cost: dist.get(e.a)! + e.costB, peer: bridges.get(e.a)!.bridgeId, peerPort: portIndex(e.a, e.pa), own: portIndex(e.b, e.pb) }] : []),
      ...(e.a === id ? [{ port: e.pa, cost: dist.get(e.b)! + e.costA, peer: bridges.get(e.b)!.bridgeId, peerPort: portIndex(e.b, e.pb), own: portIndex(e.a, e.pa) }] : []),
    ]).sort((x, y) => x.cost - y.cost || x.peer.localeCompare(y.peer) || x.peerPort - y.peerPort || x.own - y.own);
    b.rootPort = candidates[0]?.port;
  }
  for (const e of edges) {
    const A = bridges.get(e.a)!; const B = bridges.get(e.b)!;
    const aWins = A.rootCost - B.rootCost || A.bridgeId.localeCompare(B.bridgeId) || portIndex(e.a, e.pa) - portIndex(e.b, e.pb);
    const [loserId, loserPort] = aWins < 0 ? [e.b, e.pb] : [e.a, e.pa];
    const loser = ports.get(portKey(loserId, loserPort))!;
    if (bridges.get(loserId)!.rootPort === loserPort) loser.role = 'root';
    else { loser.role = 'alternate'; loser.forwarding = false; }
  }
  return { bridges, ports };
}

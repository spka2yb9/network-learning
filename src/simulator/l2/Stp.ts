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
 * `logical` maps a cabled port to the port STP sees: a bundled LAG member → its port-channel (all members are one
 * STP port whose cost follows the aggregate speed), an unbundled member → null (it carries nothing).
 */
export function computeStp(devices: DeviceState[], links: Link[], logical: (device: string, port: string) => string | null = (_, p) => p): StpResult {
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
  const ends = links.map(l => ({ l, a: logical(l.sourceDevice, l.sourceInterface), b: logical(l.targetDevice, l.targetInterface) }))
    .filter((e): e is { l: Link; a: string; b: string } => e.a !== null && e.b !== null);
  const active = (e: typeof ends[number]) => e.l.up && portUp(e.l.sourceDevice, e.a) && portUp(e.l.targetDevice, e.b);
  // A port-channel's speed is the sum of its active members.
  const speed = new Map<string, number>();
  for (const e of ends) for (const [d, p] of [[e.l.sourceDevice, e.a], [e.l.targetDevice, e.b]]) {
    const k = portKey(d, p);
    speed.set(k, (speed.get(k) ?? 0) + (active(e) ? e.l.bandwidth : 0));
  }
  for (const e of ends) {
    const on = active(e);
    for (const [d, p] of [[e.l.sourceDevice, e.a], [e.l.targetDevice, e.b]]) {
      if (!isBridgePort(d, p)) continue;
      const k = portKey(d, p);
      if (ports.get(k)?.forwarding) continue; // another member of the same port-channel is already active
      const iface = byId.get(d)!.interfaces.find(i => i.id === p)!;
      ports.set(k, { role: on ? 'designated' : 'disabled', forwarding: on, cost: iface.stpCost ?? defaultStpCost(speed.get(k) || e.l.bandwidth) });
    }
    if (on && isBridgePort(e.l.sourceDevice, e.a) && isBridgePort(e.l.targetDevice, e.b)
      && !edges.some(x => (x.a === e.l.sourceDevice && x.pa === e.a && x.b === e.l.targetDevice && x.pb === e.b) || (x.b === e.l.sourceDevice && x.pb === e.a && x.a === e.l.targetDevice && x.pa === e.b))) {
      edges.push({ a: e.l.sourceDevice, pa: e.a, b: e.l.targetDevice, pb: e.b,
        costA: ports.get(portKey(e.l.sourceDevice, e.a))!.cost, costB: ports.get(portKey(e.l.targetDevice, e.b))!.cost });
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

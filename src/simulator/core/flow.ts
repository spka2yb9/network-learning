import type { LoadBalance, Packet } from './types';

/**
 * The fields a router / switch feeds into its load-balancing hash for one packet (5-tuple).
 * ICMP and tunnels carry no ports, so all such packets between two addresses form one flow.
 */
export function flowOf(p: Packet) {
  const ports = p.protocol === 'TCP' || p.protocol === 'UDP' ? [p.sourcePort, p.destinationPort] : [0, 0];
  return { protocol: p.protocol, source: p.source, destination: p.destination, sourcePort: ports[0], destinationPort: ports[1] };
}
export type FlowKey = ReturnType<typeof flowOf>;
export const flowText = (f: FlowKey) => f.sourcePort || f.destinationPort
  ? `${f.protocol} ${f.source}:${f.sourcePort} → ${f.destination}:${f.destinationPort}`
  : `${f.protocol} ${f.source} → ${f.destination}`;

/**
 * Deterministic 32-bit FNV-1a. Real devices use their own (often seeded) hash functions;
 * what matters for learners is that the same input always gives the same result.
 */
export function flowHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // Final avalanche so inputs differing only in the last digit still spread across a small number of paths.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

/** Hash input for choosing a port-channel member, by `port-channel load-balance` method. */
export function lagHashInput(method: LoadBalance, frame: { sourceMac: string; destinationMac: string; packet?: Packet; arp?: { senderIp: string; targetIp: string } }) {
  if (method === 'src-dst-mac') return `MAC ${frame.sourceMac} → ${frame.destinationMac}`;
  const ips = frame.packet ? [frame.packet.source, frame.packet.destination] : frame.arp ? [frame.arp.senderIp, frame.arp.targetIp] : undefined;
  if (!ips) return `MAC ${frame.sourceMac} → ${frame.destinationMac}`;
  if (method === 'src-dst-ip' || !frame.packet) return `IP ${ips[0]} → ${ips[1]}`;
  return flowText(flowOf(frame.packet));
}

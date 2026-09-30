import type { Context } from './CliEngine';
import type { IcmpPacket } from '../simulator/core/types';
import { isIpv4 } from '../simulator/l3/ipv4';

export const note = (ctx: Context, text: string) => ctx.cli.explain && text ? `\n（シミュレータ所見）${text}` : '';
const linuxIcmp = (p: IcmpPacket) => p.type === 'time-exceeded' ? 'Time to live exceeded'
  : ({ 0: 'Destination Net Unreachable', 1: 'Destination Host Unreachable', 3: 'Destination Port Unreachable', 13: 'Packet filtered' } as Record<number, string>)[p.code ?? 0] ?? 'Destination Unreachable';

/** Resolve a hostname through the simulated stub resolver (Linux) — IPs pass through. */
export function resolveName(ctx: Context, target: string, program: string) {
  if (isIpv4(target)) return target;
  if (!/^[a-zA-Z0-9.-]+$/.test(target)) throw new Error(`${program}: ${target}: 名前またはIPv4アドレスではありません`);
  const r = ctx.network.dnsLookup(ctx.id, target, 'A');
  ctx.cli.record(r, `${program} ${target}（名前解決）`);
  const a = r.message?.answer.find(x => x.type === 'A');
  if (!a) throw new Error(`${program}: ${target}: ${r.message?.rcode === 'NXDOMAIN' ? 'Name or service not known' : 'Temporary failure in name resolution'}${ctx.cli.explain ? `（${r.reason}）` : ''}`);
  return a.value;
}

export function ping(ctx: Context, target: string, count: number, ttl: number, style: 'linux' | 'ios') {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('回数は1〜10です');
  const ip = style === 'linux' ? resolveName(ctx, target, 'ping') : target;
  const lines: string[] = []; const marks: string[] = [];
  let received = 0; let errors = 0; let reason = ''; let total = 0;
  for (let seq = 1; seq <= count; seq++) {
    const r = ctx.network.ping(ctx.id, ip, ttl, seq);
    ctx.cli.record(r, `ping ${target}`);
    total += r.elapsed;
    if (!r.success && !reason) reason = r.reason;
    if (r.success) { received++; marks.push('!'); lines.push(`64 bytes from ${ip}: icmp_seq=${seq} ttl=${r.reply!.ttl} time=${r.elapsed} ms`); continue; }
    if (r.reply) { errors++; marks.push(r.reply.type === 'time-exceeded' ? '&' : 'U'); lines.push(`From ${r.reply.source} icmp_seq=${seq} ${linuxIcmp(r.reply)}`); continue; }
    const localDrop = r.events.find(e => e.type === 'PACKET_DROPPED');
    marks.push('.');
    if (style === 'linux' && (!r.events.length || localDrop?.deviceId === ctx.id)) {
      if (r.reason.includes('経路がありません') || r.reason.includes('Upポート')) return `ping: connect: Network is unreachable${note(ctx, r.reason)}`;
      if (r.reason.includes('ARP') || r.reason.includes('Link')) { errors++; lines.push(`From ${r.events[0]?.packet?.source ?? ip} icmp_seq=${seq} Destination Host Unreachable`); }
    }
  }
  const loss = Math.round((1 - received / count) * 100);
  if (style === 'ios') {
    return ['Type escape sequence to abort.', `Sending ${count}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, marks.join(''),
      `Success rate is ${100 - loss} percent (${received}/${count})${received ? `, round-trip min/avg/max = ${Math.round(total / count)} ms（仮想時間）` : ''}`].join('\n') + note(ctx, received === count ? '' : reason);
  }
  return [`PING ${target} (${ip}) 56(84) bytes of data.`, ...lines, '', `--- ${target} ping statistics ---`,
    `${count} packets transmitted, ${received} received, ${errors ? `+${errors} errors, ` : ''}${loss}% packet loss, time ${total}ms（仮想リンク遅延）`].join('\n') + note(ctx, received === count ? '' : reason);
}

export function traceroute(ctx: Context, target: string, mode: 'icmp' | 'udp' | 'tcp', port: number, maxHops: number, style: 'linux' | 'ios') {
  const ip = style === 'linux' ? resolveName(ctx, target, 'traceroute') : target;
  const probes = ctx.network.traceroute(ctx.id, ip, maxHops, mode, port);
  probes.forEach(p => ctx.cli.record(p.result, `traceroute ${target}`));
  const last = probes.at(-1)!;
  const why = last.result.success ? '' : last.address ? '' : last.result.reason;
  if (style === 'ios') {
    return ['Type escape sequence to abort.', `Tracing the route to ${ip}`, ...probes.map(p => `  ${p.ttl} ${p.address ? `${p.address} ${p.result.elapsed} msec${p.marker ? ` ${p.marker}` : ''}` : '*'}`)].join('\n') + note(ctx, why);
  }
  return [`traceroute to ${target} (${ip}), ${maxHops} hops max, ${mode === 'icmp' ? 'ICMP' : mode === 'tcp' ? `TCP SYN port ${port}` : 'UDP'}（教育用: 各ホップ1プローブ）`,
    ...probes.map(p => `${String(p.ttl).padStart(2)}  ${p.address ? `${p.address}  ${p.result.elapsed} ms${p.marker ? ` ${p.marker}` : ''}` : '*'}`)].join('\n') + note(ctx, why);
}
export const pad = (s: string | number, n: number) => String(s).padEnd(n);

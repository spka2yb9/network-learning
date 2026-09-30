import { cidr, dotted, ipv4, overlaps } from '../simulator/l3/ipv4';

export interface Need { name: string; hosts: number }
export interface Allocation { name: string; hosts: number; prefix: number; network: string; first: string; last: string; broadcast: string; usable: number }
/** Smallest prefix whose usable hosts (2^h − 2) fit `hosts` (gateway included by the caller). */
export function prefixFor(hosts: number) {
  for (let p = 30; p >= 1; p--) if (2 ** (32 - p) - 2 >= hosts) return p;
  throw new Error('台数が大きすぎます');
}
/** VLSM: largest first, each block aligned on its own size. */
export function planVlsm(block: string, needs: Need[]): { allocations: Allocation[]; free: string; error?: string } {
  const b = cidr(block);
  let cursor = b.network;
  const allocations: Allocation[] = [];
  for (const need of [...needs].sort((x, y) => y.hosts - x.hosts)) {
    const prefix = prefixFor(need.hosts);
    const size = 2 ** (32 - prefix);
    if (prefix < b.prefix) return { allocations, free: '', error: `${need.name} には /${prefix} が必要で、${block} に収まりません` };
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size - 1 > b.broadcast) return { allocations, free: '', error: `${block} の空きが足りません（${need.name} を割り当てられません）` };
    allocations.push({ name: need.name, hosts: need.hosts, prefix, network: `${dotted(cursor)}/${prefix}`, first: dotted(cursor + 1), last: dotted(cursor + size - 2), broadcast: dotted(cursor + size - 1), usable: size - 2 });
    cursor += size;
  }
  return { allocations, free: cursor <= b.broadcast ? `${dotted(cursor)} 〜 ${dotted(b.broadcast)}（${b.broadcast - cursor + 1} アドレス）` : 'なし' };
}
export interface PuzzleCheck { label: string; pass: boolean }
/** Grade a learner's allocation: inside the block, aligned, big enough, minimal, non-overlapping. Any valid layout passes. */
export function gradeAllocation(block: string, needs: Need[], answers: Record<string, string>): PuzzleCheck[] {
  const checks: PuzzleCheck[] = [];
  const parsed = needs.map(n => { try { return { n, c: cidr(answers[n.name] ?? '') }; } catch { return { n, c: undefined }; } });
  checks.push({ label: 'すべての部署にCIDR（ネットワークアドレス/プレフィックス）を書いた', pass: parsed.every(p => p.c) });
  const ok = parsed.filter((p): p is { n: Need; c: ReturnType<typeof cidr> } => !!p.c);
  const b = cidr(block);
  checks.push({ label: 'ネットワークアドレスで書いている（ホスト部が0）', pass: ok.length > 0 && ok.every(p => p.c.ip === p.c.network) });
  checks.push({ label: `すべて ${block} の範囲内`, pass: ok.length > 0 && ok.every(p => p.c.network >= b.network && p.c.broadcast <= b.broadcast) });
  checks.push({ label: '必要台数（Gateway含む）が収まる', pass: ok.length > 0 && ok.every(p => p.c.hostCount >= p.n.hosts) });
  checks.push({ label: '無駄がない（必要台数を満たす最小のプレフィックス）', pass: ok.length > 0 && ok.every(p => p.c.prefix === prefixFor(p.n.hosts)) });
  checks.push({ label: 'サブネット同士が重ならない', pass: ok.length > 0 && ok.every((p, i) => ok.every((q, j) => i === j || !overlaps(p.c.canonical, q.c.canonical))) });
  return checks;
}
/** Random practice question (deterministic per seed). */
export function practice(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  const rnd = (n: number) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
  const prefix = 20 + rnd(11);
  const bases = ['10', '172.16', '192.168'];
  const base = bases[rnd(3)];
  const ip = base === '10' ? `10.${rnd(256)}.${rnd(256)}.${1 + rnd(254)}` : base === '172.16' ? `172.${16 + rnd(16)}.${rnd(256)}.${1 + rnd(254)}` : `192.168.${rnd(256)}.${1 + rnd(254)}`;
  ipv4(ip);
  const c = cidr(`${ip}/${prefix}`);
  return { question: `${ip}/${prefix}`, network: dotted(c.network), broadcast: dotted(c.broadcast), hosts: String(c.hostCount), first: c.firstHost, last: c.lastHost };
}

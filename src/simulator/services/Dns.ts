import ipaddr from 'ipaddr.js';
import type { DnsCacheEntry, DnsMessage, DnsQuestion, DnsRecord, DnsType, DnsZone } from '../core/types';
import { ipv4 } from '../l3/ipv4';

export const dnsTypes: readonly DnsType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'PTR'];
const label = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

export function normalizeName(input: string) {
  let name = input.trim().toLowerCase();
  if (name === '.' || name === '') return '.';
  if (!name.endsWith('.')) name += '.';
  if (name.length > 254 || !name.slice(0, -1).split('.').every(l => label.test(l))) throw new Error(`ドメイン名が不正です: ${input}`);
  return name;
}
export const isSubdomain = (name: string, zone: string) => zone === '.' || name === zone || name.endsWith(`.${zone}`);
export const parentName = (name: string) => name === '.' ? '.' : name.slice(name.indexOf('.') + 1) || '.';
export function reverseName(ip: string) { ipv4(ip); return `${ip.split('.').reverse().join('.')}.in-addr.arpa.`; }

export function validateRecord(input: DnsRecord): DnsRecord {
  const name = normalizeName(input.name);
  if (!dnsTypes.includes(input.type)) throw new Error(`未対応のレコードタイプです: ${input.type}`);
  if (!Number.isInteger(input.ttl) || input.ttl < 0 || input.ttl > 604_800) throw new Error('TTLは0〜604800秒です');
  const v = String(input.value ?? '').trim();
  let value = v;
  switch (input.type) {
    case 'A': ipv4(v); break;
    case 'AAAA': if (!ipaddr.IPv6.isValid(v)) throw new Error(`IPv6アドレスが不正です: ${v}`); value = ipaddr.IPv6.parse(v).toString(); break;
    case 'CNAME': case 'NS': case 'PTR': value = normalizeName(v); break;
    case 'MX': {
      const [pref, host, extra] = v.split(/\s+/);
      if (extra !== undefined || !/^\d{1,5}$/.test(pref) || Number(pref) > 65535 || !host) throw new Error('MXは "優先度 ホスト名" の形式です（例: 10 mail.example.com.）');
      value = `${Number(pref)} ${normalizeName(host)}`; break;
    }
    case 'TXT': value = v.replace(/^"|"$/g, ''); if (new TextEncoder().encode(value).length > 255 || /[\x00-\x1f"]/.test(value)) throw new Error('TXTは255バイト（UTF-8）以内の1文字列です'); break;
    case 'SOA': {
      const p = v.split(/\s+/);
      if (p.length !== 7 || p.slice(2).some(n => !/^\d+$/.test(n))) throw new Error('SOAは "mname rname serial refresh retry expire minimum" の形式です');
      value = [normalizeName(p[0]), normalizeName(p[1]), ...p.slice(2).map(Number)].join(' '); break;
    }
  }
  if (input.type === 'CNAME' && name === value) throw new Error('CNAMEが自分自身を指しています');
  return { name, type: input.type, ttl: input.ttl, value };
}
export const soaMinimum = (soa: DnsRecord) => Math.min(soa.ttl, Number(soa.value.split(' ')[6]));
export function formatRecord(r: DnsRecord, ttl = r.ttl) {
  return `${r.name.padEnd(24)} ${String(ttl).padEnd(6)} IN  ${r.type.padEnd(5)} ${r.type === 'TXT' ? `"${r.value}"` : r.value}`;
}

type AuthAnswer = Pick<DnsMessage, 'aa' | 'rcode' | 'answer' | 'authority' | 'additional'>;
function glue(records: DnsRecord[], targets: string[]) {
  return records.filter(r => (r.type === 'A' || r.type === 'AAAA') && targets.includes(r.name));
}
/** RFC 1034 §4.3.2 (subset): delegation, exact match, CNAME chasing inside the zone, NXDOMAIN / NODATA. No wildcards, no DNSSEC. */
export function authoritativeAnswer(zones: DnsZone[], q: DnsQuestion): AuthAnswer | undefined {
  const zone = zones.filter(z => isSubdomain(q.name, z.origin)).sort((a, b) => b.origin.length - a.origin.length)[0];
  if (!zone) return undefined;
  const records = zone.records;
  const soa = records.filter(r => r.type === 'SOA' && r.name === zone.origin);
  const answer: DnsRecord[] = [];
  let name = q.name;
  for (let i = 0; i < 8; i++) {
    // Delegation: the first NS node below the apex on the path to the name. A CNAME target below a cut: the answer so far + referral (step 3b).
    const path: string[] = [];
    for (let n = name; n !== zone.origin && n !== '.'; n = parentName(n)) path.unshift(n);
    const ns = path.map(cut => records.filter(r => r.type === 'NS' && r.name === cut)).find(l => l.length);
    if (ns) return { aa: answer.length > 0, rcode: 'NOERROR', answer, authority: ns, additional: glue(records, ns.map(r => r.value)) };
    const here = records.filter(r => r.name === name);
    if (!here.length) {
      const nonTerminal = records.some(r => r.name.endsWith(`.${name}`));
      return { aa: true, rcode: nonTerminal ? 'NOERROR' : 'NXDOMAIN', answer, authority: soa, additional: [] };
    }
    const match = here.filter(r => r.type === q.type);
    if (match.length) {
      answer.push(...match);
      const targets = match.filter(r => r.type === 'MX' || r.type === 'NS').map(r => r.type === 'MX' ? r.value.split(' ')[1] : r.value);
      return { aa: true, rcode: 'NOERROR', answer, authority: [], additional: glue(records, targets) };
    }
    const cname = here.find(r => r.type === 'CNAME');
    if (cname) {
      answer.push(cname);
      if (!isSubdomain(cname.value, zone.origin)) return { aa: true, rcode: 'NOERROR', answer, authority: [], additional: [] };
      name = cname.value;
      continue;
    }
    return { aa: true, rcode: 'NOERROR', answer, authority: soa, additional: [] };
  }
  return { aa: true, rcode: 'SERVFAIL', answer, authority: [], additional: [] };
}

// ---- Cache ----
export function cacheGet(cache: DnsCacheEntry[], name: string, type: DnsType, now: number) {
  return cache.find(e => e.expiresAt > now && e.name === name && (e.type === type || e.negative === 'NXDOMAIN'));
}
export function cachePut(cache: DnsCacheEntry[], entry: DnsCacheEntry) {
  const i = cache.findIndex(e => e.name === entry.name && e.type === entry.type);
  if (i >= 0) cache.splice(i, 1);
  if (entry.expiresAt > 0) cache.push(entry);
  if (cache.length > 500) cache.splice(0, cache.length - 500);
}
export const remainingTtl = (entry: DnsCacheEntry, now: number) => Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
function cacheRRsets(cache: DnsCacheEntry[], records: DnsRecord[], now: number) {
  const sets = new Map<string, DnsRecord[]>();
  for (const r of records) sets.set(`${r.name}|${r.type}`, [...(sets.get(`${r.name}|${r.type}`) ?? []), r]);
  for (const set of sets.values()) {
    const ttl = Math.min(...set.map(r => r.ttl));
    if (ttl > 0) cachePut(cache, { name: set[0].name, type: set[0].type, records: set, expiresAt: now + ttl * 1000 });
  }
}

// ---- Iterative resolution (recursive resolver / dig +trace) ----
export interface ResolveStep {
  server: string;
  question: DnsQuestion;
  result: 'answer' | 'referral' | 'nxdomain' | 'nodata' | 'timeout' | 'cache' | 'error';
  detail: string;
  zone?: string;
  response?: DnsMessage;
}
export interface ResolverIO {
  now(): number;
  query(server: string, q: DnsQuestion): DnsMessage | undefined;
  cache?: DnsCacheEntry[];
}
export interface ResolveResult { rcode: DnsMessage['rcode']; answer: DnsRecord[]; authority: DnsRecord[]; steps: ResolveStep[] }

export function resolveIterative(question: DnsQuestion, rootHints: string[], io: ResolverIO, depth = 0, budget = { queries: 0 }): ResolveResult {
  const steps: ResolveStep[] = [];
  const answer: DnsRecord[] = [];
  let name = question.name;
  const done = (rcode: DnsMessage['rcode'], authority: DnsRecord[] = []): ResolveResult => ({ rcode, answer, authority, steps });
  const withTtl = (e: DnsCacheEntry) => e.records.map(r => ({ ...r, ttl: remainingTtl(e, io.now()) }));
  for (let chain = 0; chain < 8; chain++) {
    const q = { name, type: question.type };
    if (io.cache) {
      const hit = cacheGet(io.cache, name, q.type, io.now());
      if (hit) {
        steps.push({ server: 'cache', question: q, result: 'cache', detail: hit.negative ? `キャッシュ: ${hit.negative}（残りTTL ${remainingTtl(hit, io.now())}秒）` : `キャッシュ: ${hit.records.length}件（残りTTL ${remainingTtl(hit, io.now())}秒）` });
        if (hit.negative === 'NXDOMAIN') return done('NXDOMAIN');
        if (hit.negative === 'NODATA') return done('NOERROR');
        answer.push(...withTtl(hit));
        return done('NOERROR');
      }
      const alias = q.type !== 'CNAME' && cacheGet(io.cache, name, 'CNAME', io.now());
      if (alias && !alias.negative) {
        steps.push({ server: 'cache', question: { name, type: 'CNAME' }, result: 'cache', detail: `キャッシュ: CNAME → ${alias.records[0].value}` });
        answer.push(...withTtl(alias)); name = alias.records[0].value; continue;
      }
    }
    // Start from the closest cached zone cut, otherwise the root hints.
    let servers = rootHints; let zone = '.';
    if (io.cache) {
      for (let n = name; ; n = parentName(n)) {
        const ns = cacheGet(io.cache, n, 'NS', io.now());
        const addresses = ns && !ns.negative ? ns.records.flatMap(r => { const a = cacheGet(io.cache!, r.value, 'A', io.now()); return a && !a.negative ? a.records.map(x => x.value) : []; }) : [];
        if (addresses.length) { servers = addresses; zone = n; break; }
        if (n === '.') break;
      }
    }
    let restarted = false;
    for (let step = 0; step < 16 && !restarted; step++) {
      let response: DnsMessage | undefined; let server = servers[0];
      for (const s of servers) {
        if (++budget.queries > 40) return done('SERVFAIL');
        server = s; response = io.query(s, q);
        if (response && response.rcode !== 'REFUSED' && response.rcode !== 'SERVFAIL') break;
        steps.push({ server: s, question: q, zone, result: response ? 'error' : 'timeout', detail: response ? `${response.rcode}` : '応答なし（タイムアウト）', response });
        response = undefined;
      }
      if (!response) return done('SERVFAIL');
      let last = name;
      for (const r of response.answer) if (r.type === 'CNAME' && r.name === last) last = r.value;
      if (response.rcode === 'NXDOMAIN') {
        steps.push({ server, question: q, zone, result: 'nxdomain', detail: 'NXDOMAIN: その名前は存在しません', response });
        const soa = response.authority.find(r => r.type === 'SOA');
        // RFC 2308 §2.1: a CNAME chain in the answer is positive data; the NXDOMAIN belongs to the last name in the chain.
        if (io.cache) cacheRRsets(io.cache, response.answer, io.now());
        if (io.cache && soa) cachePut(io.cache, { name: last, type: q.type, records: [], negative: 'NXDOMAIN', expiresAt: io.now() + soaMinimum(soa) * 1000 });
        answer.push(...response.answer);
        return done('NXDOMAIN', response.authority);
      }
      if (response.answer.length) {
        if (io.cache) cacheRRsets(io.cache, response.answer, io.now());
        answer.push(...response.answer);
        const final = response.answer.some(r => r.name === last && r.type === q.type);
        steps.push({ server, question: q, zone, result: 'answer', detail: response.answer.map(r => `${r.type} ${r.value}`).join(', '), response });
        if (final || q.type === 'CNAME') return done('NOERROR');
        name = last; restarted = true; break;
      }
      const ns = response.authority.filter(r => r.type === 'NS');
      if (ns.length && !response.aa) {
        const cut = ns[0].name;
        if (!isSubdomain(cut, zone) || cut === zone || !isSubdomain(name, cut)) {
          steps.push({ server, question: q, zone, result: 'error', detail: `不正な委任（${cut}）。ループを避けるため中止`, response });
          return done('SERVFAIL');
        }
        if (io.cache) { cacheRRsets(io.cache, ns, io.now()); cacheRRsets(io.cache, response.additional, io.now()); }
        let next = response.additional.filter(r => r.type === 'A' && ns.some(n => n.value === r.name)).map(r => r.value);
        steps.push({ server, question: q, zone, result: 'referral', detail: `${cut} の権威サーバーへ委任: ${ns.map(r => r.value).join(', ')}${next.length ? '' : '（glueなし: NSサーバーのIPアドレスが添えられていない）'}`, response });
        if (!next.length && depth < 4) {
          for (const target of ns.map(r => r.value)) {
            const sub = resolveIterative({ name: target, type: 'A' }, rootHints, io, depth + 1, budget);
            steps.push(...sub.steps);
            next = sub.answer.filter(r => r.type === 'A').map(r => r.value);
            if (next.length) break;
          }
        }
        if (!next.length) return done('SERVFAIL');
        servers = next; zone = cut;
        continue;
      }
      steps.push({ server, question: q, zone, result: 'nodata', detail: 'NOERROR / NODATA: 名前はあるが該当タイプのレコードがありません', response });
      const soa = response.authority.find(r => r.type === 'SOA');
      if (io.cache && soa) cachePut(io.cache, { name, type: q.type, records: [], negative: 'NODATA', expiresAt: io.now() + soaMinimum(soa) * 1000 });
      return done('NOERROR', response.authority);
    }
    if (!restarted) return done('SERVFAIL');
  }
  return done('SERVFAIL');
}

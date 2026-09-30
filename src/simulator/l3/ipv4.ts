import ipaddr from 'ipaddr.js';

export function ipv4(value: string): number {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value) || !ipaddr.IPv4.isValid(value)) {
    throw new Error(`IPv4アドレスが不正です: ${value}（0〜255の数を4つ、ドットで区切ります。先頭に0は付けません。例: 192.168.1.10）`);
  }
  return ipaddr.IPv4.parse(value).octets.reduce((n, octet) => (n * 256 + octet) >>> 0, 0);
}
export const dotted = (n: number) => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
export const bits = (n: number) => [24, 16, 8, 0].map(s => ((n >>> s) & 255).toString(2).padStart(8, '0')).join('.');

export function cidr(value: string) {
  const [address, prefixText, extra] = value.split('/');
  if (extra !== undefined || !/^(0|[1-9]\d?)$/.test(prefixText ?? '')) throw new Error('CIDR形式で入力してください（例: 192.168.1.10/24）');
  const ip = ipv4(address);
  const prefix = Number(prefixText);
  if (prefix > 32) throw new Error('プレフィックス長（/の後ろの数）は0〜32です');
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  return { address, ip, prefix, mask, network, broadcast, canonical: `${dotted(network)}/${prefix}`,
    hostCount: prefix >= 31 ? 2 ** (32 - prefix) : 2 ** (32 - prefix) - 2,
    firstHost: dotted(prefix >= 31 ? network : network + 1),
    lastHost: dotted(prefix >= 31 ? broadcast : broadcast - 1) };
}
export function contains(network: string, address: string) {
  const range = cidr(network);
  return ((ipv4(address) & range.mask) >>> 0) === range.network;
}
export function interfaceAddress(value: string) {
  const result = cidr(value);
  if (result.prefix < 31 && (result.ip === result.network || result.ip === result.broadcast)) {
    throw new Error(`${value} はネットワークアドレスかブロードキャストアドレスのため、機器に割り当てられません（使えるのは ${result.firstHost}〜${result.lastHost}）`);
  }
  if (result.ip === 0 || result.ip >= 0xe0000000 || (result.ip >>> 24) === 127) {
    throw new Error(`${value} は 0.0.0.0・ループバック（127.x.x.x）・224.0.0.0以上（マルチキャスト・予約済み）のいずれかのため使えません。通常のユニキャストIPv4アドレスを使ってください`);
  }
  return value;
}
/** Host part of an interface address ("10.0.0.1/24" → "10.0.0.1"). */
export const ipOf = (address?: string) => address?.split('/')[0];
export function overlaps(a: string, b: string) {
  const x = cidr(a); const y = cidr(b);
  return x.network <= y.broadcast && y.network <= x.broadcast;
}
/** Is this a valid dotted IPv4 (no throw)? */
export function isIpv4(value: string) { try { ipv4(value); return true; } catch { return false; } }

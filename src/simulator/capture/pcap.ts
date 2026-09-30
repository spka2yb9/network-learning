/** Minimal pcap / pcapng reader and pcap writer (DataView, no dependency). */
export interface PcapPacket { time: number; bytes: number[]; originalLength: number }
export interface PcapFile { format: 'pcap' | 'pcapng'; packets: PcapPacket[]; warnings: string[] }

export const PCAP_LIMITS = { maxBytes: 20 * 1024 * 1024, maxPackets: 20_000, maxPacketLength: 262_144 };
const fakeEthernet = (type: number, source = [0, 0, 0, 0, 0, 0]) => [0, 0, 0, 0, 0, 0, ...source.slice(0, 6), (type >> 8) & 255, type & 255];

/** Normalize supported link types to Ethernet II so one decoder handles everything. */
function toEthernet(linkType: number, data: Uint8Array): number[] | undefined {
  const bytes = Array.from(data);
  if (linkType === 1) return bytes;
  if (linkType === 113 && bytes.length >= 16) return [...fakeEthernet((bytes[14] << 8) | bytes[15], bytes.slice(6, 12)), ...bytes.slice(16)]; // Linux cooked (SLL)
  if (linkType === 276 && bytes.length >= 20) return [...fakeEthernet((bytes[0] << 8) | bytes[1], bytes.slice(12, 18)), ...bytes.slice(20)]; // SLL2
  if ((linkType === 101 || linkType === 228 || linkType === 229) && bytes.length) return [...fakeEthernet((bytes[0] >> 4) === 6 ? 0x86dd : 0x0800), ...bytes]; // raw IP
  return undefined;
}

export function parsePcap(buffer: ArrayBuffer): PcapFile {
  if (buffer.byteLength > PCAP_LIMITS.maxBytes) throw new Error(`ファイルが大きすぎます（上限 ${PCAP_LIMITS.maxBytes / 1024 / 1024}MB）`);
  if (buffer.byteLength < 24) throw new Error('PCAPファイルとして短すぎます');
  const view = new DataView(buffer);
  const warnings: string[] = [];
  const magic = view.getUint32(0, false);
  if (magic === 0x0a0d0d0a) return parsePcapng(view, warnings);
  let little: boolean; let nano = false;
  if (magic === 0xa1b2c3d4) little = false; else if (magic === 0xd4c3b2a1) little = true;
  else if (magic === 0xa1b23c4d) { little = false; nano = true; } else if (magic === 0x4d3cb2a1) { little = true; nano = true; }
  else throw new Error('pcap / pcapng 形式ではありません（magic number不一致）');
  const linkType = view.getUint32(20, little) & 0x0fffffff;
  const packets: PcapPacket[] = [];
  let o = 24; let unsupported = 0;
  while (o + 16 <= buffer.byteLength) {
    if (packets.length >= PCAP_LIMITS.maxPackets) { warnings.push(`パケット数の上限 ${PCAP_LIMITS.maxPackets} で読み込みを停止しました`); break; }
    const sec = view.getUint32(o, little); const frac = view.getUint32(o + 4, little);
    const incl = view.getUint32(o + 8, little); const orig = view.getUint32(o + 12, little);
    if (incl > PCAP_LIMITS.maxPacketLength || o + 16 + incl > buffer.byteLength) { warnings.push(`オフセット ${o} のレコードが途中で切れています`); break; }
    const eth = toEthernet(linkType, new Uint8Array(buffer, o + 16, incl));
    if (eth) packets.push({ time: sec * 1000 + frac / (nano ? 1e6 : 1e3), bytes: eth, originalLength: orig }); else unsupported++;
    o += 16 + incl;
  }
  if (unsupported) warnings.push(`未対応のリンク層タイプ ${linkType} のため ${unsupported} 件を表示できません（Ethernet / Linux cooked / Raw IPに対応）`);
  return { format: 'pcap', packets, warnings };
}

function parsePcapng(view: DataView, warnings: string[]): PcapFile {
  const packets: PcapPacket[] = [];
  const interfaces: { linkType: number; resolution: number }[] = [];
  let little = true; let o = 0; let unsupported = 0;
  while (o + 12 <= view.byteLength) {
    const type = view.getUint32(o, little);
    if (type === 0x0a0d0d0a) {
      const bom = view.getUint32(o + 8, true);
      if (bom === 0x1a2b3c4d) little = true; else if (bom === 0x4d3c2b1a) little = false; else throw new Error('pcapngのバイト順序が不正です');
      interfaces.length = 0;
    }
    const length = view.getUint32(o + 4, little);
    if (length < 12 || length % 4 || o + length > view.byteLength) { warnings.push(`オフセット ${o} のブロックが不正または途中で切れています`); break; }
    if (type === 1) {
      let resolution = 1e-6;
      for (let p = o + 16; p + 4 <= o + length - 4;) {
        const code = view.getUint16(p, little); const len = view.getUint16(p + 2, little);
        if (code === 0) break;
        if (code === 9 && len >= 1) { const v = view.getUint8(p + 4); resolution = v & 0x80 ? 2 ** -(v & 0x7f) : 10 ** -(v & 0x7f); }
        p += 4 + Math.ceil(len / 4) * 4;
      }
      interfaces.push({ linkType: view.getUint16(o + 8, little), resolution });
    } else if (type === 6 || type === 3) {
      if (packets.length >= PCAP_LIMITS.maxPackets) { warnings.push(`パケット数の上限 ${PCAP_LIMITS.maxPackets} で読み込みを停止しました`); break; }
      const iface = interfaces[type === 6 ? view.getUint32(o + 8, little) : 0];
      const captured = type === 6 ? view.getUint32(o + 20, little) : Math.min(view.getUint32(o + 8, little), length - 16);
      const dataStart = o + (type === 6 ? 28 : 12);
      if (!iface || captured > PCAP_LIMITS.maxPacketLength || dataStart + captured > o + length) { warnings.push(`オフセット ${o} のパケットブロックを読めません`); o += length; continue; }
      const ts = type === 6 ? (view.getUint32(o + 12, little) * 2 ** 32 + view.getUint32(o + 16, little)) * iface.resolution * 1000 : 0;
      const eth = toEthernet(iface.linkType, new Uint8Array(view.buffer, view.byteOffset + dataStart, captured));
      if (eth) packets.push({ time: ts, bytes: eth, originalLength: type === 6 ? view.getUint32(o + 24, little) : captured }); else unsupported++;
    }
    o += length;
  }
  if (unsupported) warnings.push(`未対応のリンク層タイプのため ${unsupported} 件を表示できません`);
  return { format: 'pcapng', packets, warnings };
}

/** Classic little-endian pcap, microsecond timestamps, LINKTYPE_ETHERNET. Opens in Wireshark / tcpdump -r. */
export function writePcap(frames: { time: number; bytes: ArrayLike<number> }[]) {
  const total = 24 + frames.reduce((n, f) => n + 16 + f.bytes.length, 0);
  const out = new Uint8Array(total); const view = new DataView(out.buffer);
  view.setUint32(0, 0xa1b2c3d4, true); view.setUint16(4, 2, true); view.setUint16(6, 4, true);
  view.setUint32(16, 262_144, true); view.setUint32(20, 1, true);
  let o = 24;
  for (const f of frames) {
    const micros = Math.round(f.time * 1000);
    view.setUint32(o, Math.floor(micros / 1e6), true); view.setUint32(o + 4, micros % 1e6, true);
    view.setUint32(o + 8, f.bytes.length, true); view.setUint32(o + 12, f.bytes.length, true);
    out.set(Array.from(f.bytes), o + 16); o += 16 + f.bytes.length;
  }
  return out;
}

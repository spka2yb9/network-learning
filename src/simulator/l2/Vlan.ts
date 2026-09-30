import type { Switchport } from '../core/types';

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';
export const defaultSwitchport = (): Switchport => ({ mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 });

export function validVlan(id: number) { return Number.isInteger(id) && id >= 1 && id <= 4094; }

/** "10,20,30-32" → [10, 20, 30, 31, 32]. "all" → 'all'. */
export function parseVlanList(text: string): number[] | 'all' {
  if (text === 'all') return 'all';
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [a, b] = part.split('-').map(Number);
    const end = b ?? a;
    if (!validVlan(a) || !validVlan(end) || end < a || part.split('-').length > 2) throw new Error(`VLAN一覧が不正です: ${text}（例: 10,20,30-32）`);
    for (let v = a; v <= end; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
export function formatVlanList(list: number[] | 'all') {
  if (list === 'all') return '1-4094';
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(i === j ? `${list[i]}` : `${list[i]}-${list[j]}`);
    i = j;
  }
  return parts.join(',') || 'none';
}
export function vlanAllowed(port: Switchport, vlan: number) {
  if (port.mode === 'access') return port.accessVlan === vlan;
  return port.allowedVlans === 'all' || port.allowedVlans.includes(vlan);
}
/** Classify a received frame into a VLAN, or explain why the port discards it. */
export function ingressVlan(port: Switchport, tag: number | undefined): { vlan: number } | { drop: string } {
  if (port.mode === 'access') {
    // Simplification: access ports discard every 802.1Q-tagged frame (no voice VLAN).
    if (tag !== undefined) return { drop: `アクセスポートにVLAN ${tag} のタグ付きフレームが届いたため破棄。対向がトランク（またはサブインターフェース）になっていないか確認します` };
    return { vlan: port.accessVlan };
  }
  const vlan = tag ?? port.nativeVlan;
  if (!vlanAllowed(port, vlan)) return { drop: `VLAN ${vlan} はこのトランクで許可されていないため破棄（show interfaces trunk / switchport trunk allowed vlan を確認します）` };
  return { vlan };
}
/** 802.1Q tag written on egress. Native VLAN frames leave a trunk untagged. */
export function egressTag(port: Switchport, vlan: number) {
  return port.mode === 'trunk' && vlan !== port.nativeVlan ? vlan : undefined;
}

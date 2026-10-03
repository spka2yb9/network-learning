import type { DeviceState, LagMember, LagStatus, Link, NetworkInterface } from '../core/types';

export const lagId = (group: number) => `po${group}`;
/** Members of `po<group>` that currently carry traffic. */
export const bundled = (d: DeviceState, po: string) => d.lagStatus?.[po]?.members.filter(m => m.flag === 'P').map(m => m.port) ?? [];

type Check = { ok: true; peerDevice: string; peerPort: string; peerGroup: number; bandwidth: number } | { ok: false; flag: 's' | 'D'; reason: string; bandwidth: number; peer?: string };

/**
 * Educational link aggregation, steady state only (no LACPDU timers, rates, system priorities or keys).
 * A member is bundled (P) when its link is up, the two ends' modes can form a channel (on–on, or LACP with
 * at least one active side), the member matches the group's first member (same peer device and peer group,
 * same speed), and the peer end bundles it too.
 */
export function computeLag(devices: DeviceState[], links: Link[]): Map<string, Record<string, LagStatus>> {
  const byId = new Map(devices.map(d => [d.id, d]));
  const key = (d: string, p: string) => `${d}|${p}`;
  const checks = new Map<string, Check>();
  const peerOf = (d: string, p: string) => {
    const l = links.find(x => (x.sourceDevice === d && x.sourceInterface === p) || (x.targetDevice === d && x.targetInterface === p));
    if (!l) return undefined;
    const [device, port] = l.sourceDevice === d && l.sourceInterface === p ? [l.targetDevice, l.targetInterface] : [l.sourceDevice, l.sourceInterface];
    return { link: l, device, port, iface: byId.get(device)?.interfaces.find(i => i.id === port) };
  };
  const members = (d: DeviceState) => d.interfaces.filter((i): i is NetworkInterface & { channelGroup: NonNullable<NetworkInterface['channelGroup']> } => !!i.channelGroup);

  // 1. Each member on its own: carrier and the mode pair.
  for (const d of devices) for (const m of members(d)) {
    const po = d.interfaces.find(i => i.id === lagId(m.channelGroup.group));
    const p = peerOf(d.id, m.id);
    const bandwidth = p?.link.bandwidth ?? 0;
    const down = (reason: string): Check => ({ ok: false, flag: 'D', reason, bandwidth, peer: p && `${p.device} ${p.port}` });
    const suspend = (reason: string): Check => ({ ok: false, flag: 's', reason, bandwidth, peer: p && `${p.device} ${p.port}` });
    let c: Check;
    if (!po?.up) c = down(`${lagId(m.channelGroup.group)} が shutdown されています`);
    else if (!m.up) c = down('このポートが shutdown されています');
    else if (!p) c = down('ケーブルが接続されていません');
    else if (!p.link.up) c = down('リンクが Down しています');
    else if (!p.iface?.up) c = down(`対向の ${p.device} ${p.port} が shutdown されています`);
    else {
      const mine = m.channelGroup.mode; const theirs = p.iface.channelGroup?.mode;
      if (mine === 'on' && theirs === undefined) c = suspend(`対向の ${p.device} ${p.port} は束ねる設定になっていません。static（mode on）は対向を確認しないため、実機ではこの食い違いに気づけず、ループや片側だけの転送の原因になります（シミュレータは不整合として、このメンバーを使いません）`);
      else if (mine === 'on' && theirs !== 'on') c = suspend(`対向はLACP（mode ${theirs}）、こちらは static（mode on）です。static とLACPは組み合わせられません。両端を同じ方式にそろえます`);
      else if (mine !== 'on' && (theirs === undefined || theirs === 'on')) c = suspend(`対向の ${p.device} ${p.port} からLACPDUが届きません（対向でLACPが有効になっていない${theirs === 'on' ? '。対向は static（mode on）で、LACPDUを送らない' : ''}）`);
      else if (mine === 'passive' && theirs === 'passive') c = suspend('両端とも mode passive です。passive は自分からLACPDUを送り始めないため、ネゴシエーションが始まりません（どちらかを active にします）');
      else c = { ok: true, peerDevice: p.device, peerPort: p.port, peerGroup: p.iface.channelGroup!.group, bandwidth };
    }
    checks.set(key(d.id, m.id), c);
  }
  // 2. Members of one group must match its first usable member: same neighbor, same neighbor group, same speed.
  for (const d of devices) {
    for (const group of new Set(members(d).map(m => m.channelGroup.group))) {
      const list = members(d).filter(m => m.channelGroup.group === group);
      const ref = list.map(m => checks.get(key(d.id, m.id))!).find(c => c.ok) as Extract<Check, { ok: true }> | undefined;
      if (!ref) continue;
      for (const m of list) {
        const c = checks.get(key(d.id, m.id))!;
        if (!c.ok || c === ref) continue;
        const reason = c.peerDevice !== ref.peerDevice ? `ほかのメンバーは ${ref.peerDevice} につながっていますが、このポートは ${c.peerDevice} につながっています。1つのLAGは、同じ相手機器とのリンクだけを束ねます（複数の筐体にまたがるMLAG・スタックは扱いません）`
          : c.peerGroup !== ref.peerGroup ? `対向の ${c.peerDevice} ${c.peerPort} は ${lagId(c.peerGroup)} に入っていますが、ほかのメンバーの対向は ${lagId(ref.peerGroup)} です`
          : c.bandwidth !== ref.bandwidth ? `リンク速度（${c.bandwidth} Mbps）が、ほかのメンバー（${ref.bandwidth} Mbps）と違います。メンバーの速度はそろえます`
          : undefined;
        if (reason) checks.set(key(d.id, m.id), { ok: false, flag: 's', reason, bandwidth: c.bandwidth, peer: `${c.peerDevice} ${c.peerPort}` });
      }
    }
  }
  // 3. A link is part of a bundle only when both of its ends bundle it.
  for (let changed = true, round = 0; changed && round < 4; round++) {
    changed = false;
    for (const [k, c] of checks) {
      if (!c.ok) continue;
      const peer = checks.get(key(c.peerDevice, c.peerPort));
      if (peer?.ok) continue;
      checks.set(k, { ok: false, flag: 's', reason: `対向の ${c.peerDevice} ${c.peerPort} 側で束ねられていません（${peer?.reason ?? '対向は channel-group に入っていません'}）`, bandwidth: c.bandwidth, peer: `${c.peerDevice} ${c.peerPort}` });
      changed = true;
    }
  }
  const result = new Map<string, Record<string, LagStatus>>();
  for (const d of devices) {
    const status: Record<string, LagStatus> = {};
    for (const po of d.interfaces.filter(i => i.kind === 'port-channel')) {
      const group = Number(po.id.slice(2));
      const list: LagMember[] = members(d).filter(m => m.channelGroup.group === group).map(m => {
        const c = checks.get(key(d.id, m.id))!;
        return c.ok ? { port: m.id, flag: 'P', reason: `${c.peerDevice} ${c.peerPort} と束ねています`, bandwidth: c.bandwidth, peer: `${c.peerDevice} ${c.peerPort}` }
          : { port: m.id, flag: c.flag, reason: c.reason, bandwidth: c.bandwidth, peer: c.peer };
      });
      const capacity = list.filter(m => m.flag === 'P').reduce((s, m) => s + m.bandwidth, 0);
      status[po.id] = { group, protocol: members(d).some(m => m.channelGroup.group === group && m.channelGroup.mode === 'on') ? 'static' : 'LACP', up: po.up && capacity > 0, members: list, capacity };
    }
    result.set(d.id, status);
  }
  return result;
}

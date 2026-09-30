import type { Edge, Node } from '@xyflow/react';
import { byId, subnetExposure, subnetRouteTable, type AwsModel } from '../../aws/model';
import type { IconName } from '../Icon';
import type { AwsIconKind } from './AwsIcon';

/*
 * Size-driven layout for the AWS diagram. Every node gets an explicit width/height (CSS clips text to
 * that box), groups are sized bottom-up from their children, and each group reserves a header band that
 * children never enter. Group labels are separate "header" nodes stacked above the edges, and edges carry
 * no free-floating text — so text can't be covered by other nodes or lines. `layoutProblems` verifies it.
 */
export type ResData = { label: string; sub?: string; icon: IconName; awsIcon?: AwsIconKind; tone: string; hot?: boolean };
export type GroupData = { tone: string; hot?: boolean };
export type HeaderData = { label: string; sub?: string; tone: string; group: string; hot?: boolean };

export const RES_W = 220, RES_H = 50, GAP = 12, PAD = 14;
const HEAD = { vpc: 50, az: 30, subnet: 46 };
const SUB_W = RES_W + PAD * 2;
const AZ_W = SUB_W + PAD * 2;
const Z = { resource: 40, header: 50 };
const size = (w: number, h: number) => ({ width: w, height: h, style: { width: w, height: h } });

export function awsLayout(m: AwsModel, highlight: ReadonlySet<string> = new Set()) {
  const nodes: Node[] = []; const edges: Edge[] = [];
  const hot = (id: string) => highlight.has(id);
  const res = (id: string, parentId: string | undefined, x: number, y: number, data: Omit<ResData, 'hot'>) =>
    nodes.push({ id, type: 'res', ...(parentId ? { parentId, extent: 'parent' as const } : {}), position: { x, y }, zIndex: Z.resource, ...size(RES_W, RES_H), data: { ...data, hot: hot(id) } });
  const group = (id: string, parentId: string | undefined, x: number, y: number, w: number, h: number, head: number, label: string, sub: string | undefined, tone: string) => {
    nodes.push({ id, type: 'area', ...(parentId ? { parentId, extent: 'parent' as const } : {}), position: { x, y }, ...size(w, h), selectable: false, data: { tone, hot: hot(id) } });
    nodes.push({ id: `${id}::header`, type: 'header', parentId: id, extent: 'parent', position: { x: 2, y: 2 }, zIndex: Z.header, ...size(w - 4, head - 2), draggable: false, data: { label, sub, tone, group: id, hot: hot(id) } });
  };
  const edge = (id: string, source: string, target: string, sourceHandle: string, targetHandle: string, style: Edge['style']) =>
    edges.push({ id, source, target, sourceHandle, targetHandle, type: 'smoothstep', style });

  const internetY = -(RES_H + 80);
  if (m.vpcs.length || m.internetGateways.length) res('internet', undefined, PAD, internetY, { label: 'Internet', icon: 'cloud', awsIcon: 'internet', tone: 'internet' });
  const placedLbs = new Set<string>();
  const peeringGap = m.peerings.length ? 240 : 120;
  let vx = 0;
  for (const vpc of m.vpcs) {
    const subnets = m.subnets.filter(s => s.vpcId === vpc.id);
    const azs = [...new Set(subnets.map(s => s.az))].sort();
    const inside = (sid: string) => [
      ...m.instances.filter(i => i.subnetId === sid).map(i => ({ id: i.id, label: i.name, sub: `${i.privateIp}${i.publicIp ? ` / ${i.publicIp}` : ''} · ${i.role}`, icon: (i.role === 'db' ? 'server' : 'pc') as IconName, awsIcon: 'ec2' as const, tone: i.role })),
      ...m.natGateways.filter(n => n.subnetId === sid).map(n => ({ id: n.id, label: n.name, sub: `NAT Gateway · ${n.publicIp ?? 'Elastic IPなし'}`, icon: 'switch' as IconName, awsIcon: 'nat' as const, tone: 'nat' })),
    ];
    const subnetH = (sid: string) => { const n = inside(sid).length; return HEAD.subnet + (n ? n * RES_H + (n - 1) * GAP : 8) + PAD; };
    const azSubnets = (az: string) => subnets.filter(s => s.az === az).sort((a, b) => Number(subnetExposure(m, b).public) - Number(subnetExposure(m, a).public) || a.name.localeCompare(b.name));
    const azH = azs.map(az => HEAD.az + azSubnets(az).reduce((h, s, i) => h + subnetH(s.id) + (i ? GAP : 0), 0) + PAD);
    const azAreaW = azs.length ? azs.length * AZ_W + (azs.length - 1) * GAP * 2 : 0;

    // VPC-level parts (IGW, load balancers, endpoints, VGW) sit in a band under the VPC header, wrapping into rows.
    const igw = m.internetGateways.find(g => g.vpcId === vpc.id);
    const lbs = m.loadBalancers.filter(l => !placedLbs.has(l.id) && l.subnetIds.some(id => subnets.some(s => s.id === id)));
    lbs.forEach(l => placedLbs.add(l.id));
    const band: { id: string; data: Omit<ResData, 'hot'> }[] = [
      ...(igw ? [{ id: igw.id, data: { label: igw.name, sub: 'Internet Gateway', icon: 'globe' as IconName, awsIcon: 'igw' as const, tone: 'igw' } }] : []),
      ...lbs.map(lb => ({ id: lb.id, data: { label: lb.name, sub: `${lb.type === 'application' ? 'ALB' : 'NLB'} · ${lb.scheme === 'internet-facing' ? '公開' : '内部'} · ${lb.listeners.map(l => `${l.port}→${l.targetPort}`).join(' ')}`, icon: 'layers' as IconName, awsIcon: (lb.type === 'application' ? 'alb' : 'nlb') as AwsIconKind, tone: 'lb' } })),
      ...m.endpoints.filter(e => e.vpcId === vpc.id).map(e => ({ id: e.id, data: { label: e.name, sub: `Gateway endpoint · ${e.service.toUpperCase()}`, icon: 'link' as IconName, awsIcon: 'vpce' as const, tone: 'endpoint' } })),
      ...m.vpnGateways.filter(g => g.vpcId === vpc.id).map(g => ({ id: g.id, data: { label: g.name, sub: `VGW · ${g.onPremCidrs.join(', ') || 'オンプレミスの経路なし'}`, icon: 'lock' as IconName, awsIcon: 'vgw' as const, tone: 'vgw' } })),
    ];
    const slot = RES_W + GAP * 2;
    const perRow = Math.max(1, Math.floor((Math.max(azAreaW, 3 * slot) + GAP * 2) / slot));
    const bandRows = Math.ceil(band.length / perRow);
    const bandH = bandRows ? bandRows * RES_H + (bandRows - 1) * GAP : 0;
    const bandW = band.length ? Math.min(band.length, perRow) * slot - GAP * 2 : 0;
    const azTop = HEAD.vpc + bandH + (bandH ? GAP * 2 : 0);
    const width = Math.max(azAreaW, bandW, RES_W) + PAD * 2;
    const height = azTop + Math.max(0, ...azH) + PAD + (azs.length ? 0 : GAP);

    group(vpc.id, undefined, vx, 0, width, height, HEAD.vpc, `VPC ${vpc.name}`, `${vpc.cidr} · ${vpc.id}`, 'vpc');
    band.forEach((b, i) => res(b.id, vpc.id, PAD + (i % perRow) * slot, HEAD.vpc + Math.floor(i / perRow) * (RES_H + GAP), b.data));
    if (igw) edge(`e-inet-${igw.id}`, 'internet', igw.id, 'bottom', 'top', { stroke: '#5b7fc7', strokeWidth: 2 });
    for (const lb of lbs) {
      if (lb.scheme === 'internet-facing' && igw) edge(`e-${igw.id}-${lb.id}`, igw.id, lb.id, 'right', 'left', { stroke: '#5b7fc7', strokeDasharray: '4 3' });
      const targets = new Set(lb.listeners.flatMap(l => l.targetIds));
      for (const t of targets) if (byId(m.instances, t)) edge(`e-${lb.id}-${t}`, lb.id, t, 'bottom', 'top', { stroke: '#b2587f' });
    }

    azs.forEach((az, ci) => {
      const azId = `${vpc.id}-${az}`;
      group(azId, vpc.id, PAD + ci * (AZ_W + GAP * 2), azTop, AZ_W, azH[ci], HEAD.az, az, undefined, 'az');
      let y = HEAD.az;
      for (const s of azSubnets(az)) {
        const h = subnetH(s.id); const pub = subnetExposure(m, s).public; const rt = subnetRouteTable(m, s);
        group(s.id, azId, PAD, y, SUB_W, h, HEAD.subnet, `${s.name}（${pub ? 'Public' : 'Private'}）`, `${s.cidr} · RT ${rt?.name ?? '-'}`, pub ? 'public' : 'private');
        inside(s.id).forEach((r, ri) => res(r.id, s.id, PAD, HEAD.subnet + ri * (RES_H + GAP), r));
        const dflt = rt?.routes.find(r => r.destination === '0.0.0.0/0');
        if (dflt?.target.startsWith('nat-') && byId(m.natGateways, dflt.target) && m.subnets.some(x => x.id === byId(m.natGateways, dflt.target)!.subnetId && x.vpcId === vpc.id))
          edge(`e-rt-${s.id}`, s.id, dflt.target, 'top', 'bottom', { stroke: '#d08a3c', strokeDasharray: '5 4' });
        if (dflt?.target.startsWith('igw-') && byId(m.internetGateways, dflt.target)?.vpcId === vpc.id)
          edge(`e-rt-${s.id}`, s.id, dflt.target, 'top', 'bottom', { stroke: '#5b7fc7', strokeDasharray: '5 4' });
        y += h + GAP;
      }
    });
    vx += width + peeringGap;
  }
  // Peering: VPCs stand side by side, so the edge runs through the gap between them; its short label fits there.
  for (const p of m.peerings) if (byId(m.vpcs, p.requesterVpcId) && byId(m.vpcs, p.accepterVpcId))
    edges.push({ id: `e-${p.id}`, source: p.requesterVpcId, target: p.accepterVpcId, sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', label: `${p.name}（${p.status === 'active' ? 'active' : '未承認'}）`,
      labelStyle: { fontSize: 11 }, labelBgPadding: [6, 3], labelBgStyle: { fill: '#fff' }, style: { stroke: '#7a6bc2', strokeWidth: 2, strokeDasharray: p.status === 'active' ? undefined : '6 4' } });
  m.internetGateways.filter(g => !g.vpcId).forEach((g, i) => res(g.id, undefined, PAD + (i + 1) * (RES_W + GAP * 3), internetY, { label: g.name, sub: 'IGW（どのVPCにも未アタッチ）', icon: 'globe', awsIcon: 'igw', tone: 'warn' }));
  return { nodes, edges };
}

/** Absolute rectangles and every overlap/containment problem of a layout (used by tests; empty = nothing is covered). */
export function layoutProblems(nodes: Node[]) {
  const byNode = new Map(nodes.map(n => [n.id, n]));
  const abs = (n: Node): { x: number; y: number } => { const p = n.parentId ? abs(byNode.get(n.parentId)!) : { x: 0, y: 0 }; return { x: p.x + n.position.x, y: p.y + n.position.y }; };
  const rect = (n: Node) => ({ ...abs(n), w: n.width ?? 0, h: n.height ?? 0 });
  const problems: string[] = [];
  const siblings = new Map<string, Node[]>();
  for (const n of nodes) { const k = n.parentId ?? ''; siblings.set(k, [...(siblings.get(k) ?? []), n]); }
  for (const list of siblings.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = rect(list[i]), b = rect(list[j]);
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) problems.push(`overlap: ${list[i].id} × ${list[j].id}`);
  }
  for (const n of nodes) if (n.parentId) {
    const c = rect(n), p = rect(byNode.get(n.parentId)!);
    if (c.x < p.x || c.y < p.y || c.x + c.w > p.x + p.w || c.y + c.h > p.y + p.h) problems.push(`outside parent: ${n.id} in ${n.parentId}`);
  }
  return problems;
}

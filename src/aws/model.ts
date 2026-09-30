import { cidr, contains, dotted, ipv4, overlaps } from '../simulator/l3/ipv4';

/**
 * Educational model of AWS VPC networking. Never talks to AWS.
 * Covers routing, gateways, security groups (stateful) and network ACLs (stateless).
 */
export type AwsProtocol = 'tcp' | 'udp' | 'icmp' | '-1';
export interface Vpc { id: string; name: string; cidr: string }
export interface Subnet { id: string; name: string; vpcId: string; cidr: string; az: string; routeTableId?: string; naclId?: string }
export interface AwsRoute { destination: string; target: string }
export interface RouteTable { id: string; name: string; vpcId: string; main: boolean; routes: AwsRoute[] }
export interface InternetGateway { id: string; name: string; vpcId?: string }
export interface NatGateway { id: string; name: string; subnetId: string; publicIp?: string }
export interface SgRule { protocol: AwsProtocol; fromPort: number; toPort: number; cidr?: string; sourceSg?: string; description?: string }
export interface SecurityGroup { id: string; name: string; vpcId: string; ingress: SgRule[]; egress: SgRule[] }
export interface NaclEntry { ruleNumber: number; egress: boolean; protocol: AwsProtocol; fromPort: number; toPort: number; cidr: string; action: 'allow' | 'deny' }
export interface NetworkAcl { id: string; name: string; vpcId: string; isDefault: boolean; entries: NaclEntry[] }
export interface Instance {
  id: string; name: string; subnetId: string; privateIp: string; publicIp?: string;
  securityGroupIds: string[];
  role: 'web' | 'app' | 'db' | 'bastion' | 'generic';
  listening: { protocol: 'tcp' | 'udp'; port: number }[];
}
export interface LbListener { protocol: 'HTTP' | 'HTTPS' | 'TCP'; port: number; targetPort: number; targetIds: string[] }
export interface LoadBalancer { id: string; name: string; type: 'application' | 'network'; scheme: 'internet-facing' | 'internal'; subnetIds: string[]; securityGroupIds: string[]; listeners: LbListener[] }
export interface Peering { id: string; name: string; requesterVpcId: string; accepterVpcId: string; status: 'active' | 'pending-acceptance' }
export interface VpcEndpoint { id: string; name: string; vpcId: string; service: 's3' | 'dynamodb'; type: 'Gateway'; routeTableIds: string[] }
export interface VpnGateway { id: string; name: string; vpcId?: string; onPremCidrs: string[] }
export interface AwsModel {
  version: 1;
  region: string;
  vpcs: Vpc[];
  subnets: Subnet[];
  routeTables: RouteTable[];
  internetGateways: InternetGateway[];
  natGateways: NatGateway[];
  securityGroups: SecurityGroup[];
  networkAcls: NetworkAcl[];
  instances: Instance[];
  loadBalancers: LoadBalancer[];
  peerings: Peering[];
  endpoints: VpcEndpoint[];
  vpnGateways: VpnGateway[];
}
export const emptyModel = (): AwsModel => ({ version: 1, region: 'ap-northeast-1', vpcs: [], subnets: [], routeTables: [], internetGateways: [], natGateways: [], securityGroups: [], networkAcls: [], instances: [], loadBalancers: [], peerings: [], endpoints: [], vpnGateways: [] });
/** AWS publishes prefix lists for S3 etc.; the simulator uses one symbolic range. */
export const servicePrefix = { s3: { list: 'pl-s3', cidr: '52.219.0.0/16' }, dynamodb: { list: 'pl-dynamodb', cidr: '52.94.0.0/16' } } as const;

export const byId = <T extends { id: string }>(list: T[], id?: string) => list.find(x => x.id === id);
export function subnetRouteTable(m: AwsModel, s: Subnet) {
  return byId(m.routeTables, s.routeTableId) ?? m.routeTables.find(r => r.vpcId === s.vpcId && r.main);
}
export function subnetNacl(m: AwsModel, s: Subnet) {
  return byId(m.networkAcls, s.naclId) ?? m.networkAcls.find(a => a.vpcId === s.vpcId && a.isDefault);
}
/** Routes including the implicit, non-removable `local` route. */
export function effectiveRoutes(m: AwsModel, rt: RouteTable): AwsRoute[] {
  const vpc = byId(m.vpcs, rt.vpcId)!;
  return [{ destination: vpc.cidr, target: 'local' }, ...rt.routes];
}
/** Longest-prefix match. Prefix-list destinations (pl-...) are resolved to their symbolic CIDR. */
export function lookupRoute(m: AwsModel, rt: RouteTable, ip: string) {
  const expand = (d: string) => d === servicePrefix.s3.list ? servicePrefix.s3.cidr : d === servicePrefix.dynamodb.list ? servicePrefix.dynamodb.cidr : d;
  return effectiveRoutes(m, rt).filter(r => contains(expand(r.destination), ip)).sort((a, b) => cidr(expand(b.destination)).prefix - cidr(expand(a.destination)).prefix)[0];
}
/** "Public" is a routing property, not a label: 0.0.0.0/0 (or any route) → an attached IGW. */
export function subnetExposure(m: AwsModel, s: Subnet) {
  const rt = subnetRouteTable(m, s);
  if (!rt) return { public: false, reason: 'ルートテーブルが関連付けられていません（VPCのメインルートテーブルもありません）' };
  const igwRoute = rt.routes.find(r => r.target.startsWith('igw-'));
  if (!igwRoute) return { public: false, reason: `${rt.name} に Internet Gateway（igw-…）への経路がないため、プライベートサブネットです` };
  const igw = byId(m.internetGateways, igwRoute.target);
  if (!igw || igw.vpcId !== s.vpcId) return { public: false, reason: `経路のターゲット ${igwRoute.target} がこのVPCにアタッチされていないため、経路が使えません（行き先のない「ブラックホール」の経路）` };
  return { public: true, reason: `${rt.name} の ${igwRoute.destination} → ${igw.id} により、インターネットと直接通信できるパブリックサブネットです` };
}
export const usableHosts = (c: string) => Math.max(0, 2 ** (32 - cidr(c).prefix) - 5);
/** AWS reserves the first four and the last address of every subnet. */
export function reservedAddresses(c: string) {
  const r = cidr(c);
  return [0, 1, 2, 3].map(i => dotted(r.network + i)).concat(dotted(r.broadcast));
}

export function validateModel(m: AwsModel): string[] {
  const errors: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
  const ids = new Set<string>();
  const all = [...m.vpcs, ...m.subnets, ...m.routeTables, ...m.internetGateways, ...m.natGateways, ...m.securityGroups, ...m.networkAcls, ...m.instances, ...m.loadBalancers, ...m.peerings, ...m.endpoints, ...m.vpnGateways];
  for (const r of all) { check(/^[a-z]+-[a-z0-9-]+$/.test(r.id), `IDの形式が正しくありません: ${r.id}（「種類-英小文字と数字」の形にします。例: subnet-app-a）`); check(!ids.has(r.id), `IDが重複しています: ${r.id}（IDはリソースごとに別のものにします）`); ids.add(r.id); }
  const safe = (f: () => void, message: string) => { try { f(); } catch { errors.push(message); } };
  for (const v of m.vpcs) safe(() => { const c = cidr(v.cidr); check(c.prefix >= 16 && c.prefix <= 28, `${v.name}: VPCのCIDRには /16（65,536個）〜 /28（16個）を指定します（現在: ${v.cidr}）`); check(c.canonical === v.cidr, `${v.name}: CIDR ${v.cidr} は、範囲の先頭のアドレス（ネットワークアドレス）で書きます。${c.canonical} にしてください`); }, `${v.name}: CIDRの書き方が正しくありません（例: 10.0.0.0/16）`);
  for (const s of m.subnets) safe(() => {
    const vpc = byId(m.vpcs, s.vpcId);
    const c = cidr(s.cidr);
    check(vpc, `${s.name}: 所属先のVPC ${s.vpcId} が見つかりません`);
    check(c.prefix >= 16 && c.prefix <= 28, `${s.name}: サブネットのCIDRには /16〜/28 を指定します（現在: ${s.cidr}）`);
    check(c.canonical === s.cidr, `${s.name}: CIDR ${s.cidr} は、範囲の先頭のアドレス（ネットワークアドレス）で書きます。${c.canonical} にしてください`);
    if (vpc) check(contains(vpc.cidr, dotted(c.network)) && cidr(s.cidr).prefix >= cidr(vpc.cidr).prefix, `${s.name}: ${s.cidr} はVPC ${vpc.cidr} の範囲外です。サブネットには、VPCのCIDRを分割した範囲を指定します`);
    for (const o of m.subnets) if (o !== s && o.vpcId === s.vpcId && overlaps(o.cidr, s.cidr) && o.id < s.id) errors.push(`${s.name} と ${o.name} のCIDRが重複しています（${s.cidr} / ${o.cidr}）。同じVPCのサブネットどうしは、アドレスの範囲を重ねられません`);
    if (s.routeTableId) check(byId(m.routeTables, s.routeTableId)?.vpcId === s.vpcId, `${s.name}: ルートテーブル ${s.routeTableId} が見つからないか、別のVPCのものです。同じVPCのルートテーブルを選んでください`);
    if (s.naclId) check(byId(m.networkAcls, s.naclId)?.vpcId === s.vpcId, `${s.name}: ネットワークACL（NACL）${s.naclId} が見つからないか、別のVPCのものです。同じVPCのNACLを選んでください`);
    check(/^[a-z]{2}-[a-z]+-\d[a-z]$/.test(s.az), `${s.name}: アベイラビリティゾーン（AZ）の名前が正しくありません（例: ap-northeast-1a）`);
  }, `${s.name}: CIDRの書き方が正しくありません（例: 10.0.1.0/24）`);
  for (const rt of m.routeTables) {
    check(byId(m.vpcs, rt.vpcId), `${rt.name}: 所属先のVPCが見つかりません`);
    const seen = new Set<string>();
    for (const r of rt.routes) {
      check(!seen.has(r.destination), `${rt.name}: 宛先 ${r.destination} の経路が重複しています。1つのルートテーブルには、同じ宛先の経路を1つだけ書きます`); seen.add(r.destination);
      if (!Object.values(servicePrefix).some(p => p.list === r.destination)) safe(() => cidr(r.destination), `${rt.name}: 宛先 ${r.destination} がCIDRの形になっていません（例: 0.0.0.0/0。プレフィックスリストは pl-s3 / pl-dynamodb だけが使えます）`);
      const target = all.find(x => x.id === r.target);
      check(target, `${rt.name}: 経路のターゲット ${r.target} が見つかりません。存在するIGW・NAT Gatewayなどを指定してください`);
      if (r.target.startsWith('nat-')) check(byId(m.subnets, byId(m.natGateways, r.target)?.subnetId)?.vpcId === rt.vpcId, `${rt.name}: 別のVPCのNAT Gatewayは、経路のターゲットに指定できません`);
    }
    check(m.routeTables.filter(x => x.vpcId === rt.vpcId && x.main).length === 1 || !rt.main, `${rt.vpcId}: メインルートテーブルは、VPCごとに1つだけです`);
  }
  for (const v of m.vpcs) check(m.routeTables.some(r => r.vpcId === v.id && r.main), `${v.name}: メインルートテーブル（ルートテーブルを関連付けていないサブネットが使う、既定のルートテーブル）がありません`);
  for (const igw of m.internetGateways) check(!igw.vpcId || byId(m.vpcs, igw.vpcId), `${igw.name}: アタッチ先のVPCが見つかりません`);
  for (const v of m.vpcs) check(m.internetGateways.filter(g => g.vpcId === v.id).length <= 1, `${v.name}: 1つのVPCにアタッチできるInternet Gatewayは1つだけです`);
  for (const n of m.natGateways) { check(byId(m.subnets, n.subnetId), `${n.name}: 配置先のサブネットが見つかりません`); if (n.publicIp) safe(() => ipv4(n.publicIp!), `${n.name}: Elastic IPのアドレスの形式が正しくありません`); }
  for (const sg of m.securityGroups) for (const r of [...sg.ingress, ...sg.egress]) {
    check(r.cidr || r.sourceSg, `${sg.name}: ルールには、通信の相手をCIDRか別のSG（SG参照）で指定する必要があります`);
    if (r.cidr) safe(() => cidr(r.cidr!), `${sg.name}: CIDR ${r.cidr} の書き方が正しくありません`);
    if (r.sourceSg) check(byId(m.securityGroups, r.sourceSg), `${sg.name}: ルールで参照しているSG ${r.sourceSg} が見つかりません`);
    if (r.protocol === 'tcp' || r.protocol === 'udp') check(r.fromPort >= 0 && r.toPort <= 65535 && r.fromPort <= r.toPort, `${sg.name}: ポートの範囲が正しくありません（0〜65535 の中で、開始 ≦ 終了にします）`);
  }
  for (const a of m.networkAcls) {
    const nums = new Set<string>();
    for (const e of a.entries) {
      check(Number.isInteger(e.ruleNumber) && e.ruleNumber >= 1 && e.ruleNumber <= 32766, `${a.name}: ルール番号には 1〜32766 を指定します`);
      check(!nums.has(`${e.egress}|${e.ruleNumber}`), `${a.name}: 同じ方向（インバウンド / アウトバウンド）で、ルール番号 ${e.ruleNumber} が重複しています`); nums.add(`${e.egress}|${e.ruleNumber}`);
      safe(() => cidr(e.cidr), `${a.name}: CIDR ${e.cidr} の書き方が正しくありません`);
    }
  }
  const used = new Set<string>();
  for (const i of m.instances) {
    const s = byId(m.subnets, i.subnetId);
    check(s, `${i.name}: 配置先のサブネットが見つかりません`);
    if (s) safe(() => {
      ipv4(i.privateIp);
      check(contains(s.cidr, i.privateIp), `${i.name}: ${i.privateIp} はサブネット ${s.cidr} の範囲外です。サブネットの範囲内のアドレスにしてください`);
      check(!reservedAddresses(s.cidr).includes(i.privateIp), `${i.name}: ${i.privateIp} はAWSの予約アドレスです（各サブネットの先頭の4つと最後の1つは使えません）。別のアドレスにしてください`);
    }, `${i.name}: プライベートIPの形式が正しくありません`);
    check(!used.has(i.privateIp), `${i.name}: プライベートIP ${i.privateIp} が、ほかのインスタンスと重複しています`); used.add(i.privateIp);
    for (const g of i.securityGroupIds) check(byId(m.securityGroups, g)?.vpcId === s?.vpcId, `${i.name}: セキュリティグループ ${g} が見つからないか、別のVPCのものです。インスタンスと同じVPCのSGを指定してください`);
    if (i.publicIp) safe(() => ipv4(i.publicIp!), `${i.name}: パブリックIPの形式が正しくありません`);
  }
  for (const lb of m.loadBalancers) {
    const subnets = lb.subnetIds.map(id => byId(m.subnets, id));
    check(subnets.every(Boolean), `${lb.name}: 指定したサブネットが見つかりません`);
    if (lb.type === 'application') check(new Set(subnets.map(s => s?.az)).size >= 2, `${lb.name}: ALBには、2つ以上のアベイラビリティゾーン（AZ）のサブネットを指定する必要があります`);
    check(new Set(subnets.map(s => s?.az)).size === subnets.length, `${lb.name}: ロードバランサーに指定できるサブネットは、1つのAZにつき1つだけです`);
    for (const l of lb.listeners) for (const t of l.targetIds) check(byId(m.instances, t), `${lb.name}: ターゲット ${t} が見つかりません`);
  }
  for (const p of m.peerings) {
    const a = byId(m.vpcs, p.requesterVpcId); const b = byId(m.vpcs, p.accepterVpcId);
    check(a && b && a !== b, `${p.name}: ピアリングでつなぐVPCが正しくありません（存在する、別々の2つのVPCを指定します）`);
    if (a && b) check(!overlaps(a.cidr, b.cidr), `${p.name}: 2つのVPCのCIDRが重なっているため、ピアリングできません（${a.cidr} / ${b.cidr}）。アドレスの範囲が重ならないVPCどうしでつなぎます`);
  }
  for (const e of m.endpoints) check(byId(m.vpcs, e.vpcId) && e.routeTableIds.every(r => byId(m.routeTables, r)?.vpcId === e.vpcId), `${e.name}: 所属先のVPCが見つからないか、別のVPCのルートテーブルを指定しています`);
  return errors;
}

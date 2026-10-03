import { cidr, contains, dotted } from '../simulator/l3/ipv4';
import { byId, lookupRoute, servicePrefix, subnetExposure, subnetNacl, subnetRouteTable, type AwsModel, type SgRule, type Subnet } from './model';

export type AwsEndpoint = { kind: 'internet'; ip: string } | { kind: 'instance'; id: string } | { kind: 'lb'; id: string } | { kind: 'service'; service: 's3' | 'dynamodb' } | { kind: 'onprem'; ip: string };
export type Direction = 'request' | 'response';
export interface AwsHop { direction: Direction; component: string; resource: string; verdict: 'pass' | 'block' | 'info'; detail: string }
export interface AwsAnalysis { reachable: boolean; hops: AwsHop[]; blocked?: AwsHop; summary: string }
type Proto = 'tcp' | 'udp' | 'icmp';
interface Flow { protocol: Proto; src: string; srcPort: number; dst: string; dstPort: number }
interface Node { id: string; name: string; kind: 'instance' | 'lb' | 'nat' | 'outside'; ip: string; subnet?: Subnet; sgIds: string[]; listens?: (p: Proto, port: number) => boolean }

/** Protocol -1 means all protocols; AWS ignores the port range then. */
/** Client ephemeral port used for return traffic (inside AWS' recommended 1024-65535 NACL range). */
export const EPHEMERAL = 50000;
const reverse = (f: Flow): Flow => ({ protocol: f.protocol, src: f.dst, srcPort: f.dstPort, dst: f.src, dstPort: f.srcPort });
const portText = (f: Flow) => f.protocol === 'icmp' ? 'ICMP' : `${f.protocol.toUpperCase()} ${f.src}:${f.srcPort} → ${f.dst}:${f.dstPort}`;
const protoMatch = (rule: string, p: Proto) => rule === '-1' || rule === p;
const portMatch = (from: number, to: number, p: Proto, port: number) => p === 'icmp' || (port >= from && port <= to);
const ruleText = (r: SgRule, dir: 'ingress' | 'egress') => `${r.protocol === '-1' ? 'All' : r.protocol.toUpperCase()} ${r.protocol === 'tcp' || r.protocol === 'udp' ? (r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}-${r.toPort}`) : ''} ${dir === 'egress' ? 'to' : 'from'} ${r.cidr ?? r.sourceSg}`.replace(/\s+/g, ' ');

class Trace {
  hops: AwsHop[] = [];
  blocked?: AwsHop;
  step(direction: Direction, component: string, resource: string, ok: boolean | 'info', detail: string) {
    const hop: AwsHop = { direction, component, resource, verdict: ok === 'info' ? 'info' : ok ? 'pass' : 'block', detail };
    this.hops.push(hop);
    if (ok === false && !this.blocked) this.blocked = hop;
    return ok !== false;
  }
}

export function lbNodeIp(s: Subnet) { return dotted(cidr(s.cidr).network + 4); }
function nodeOf(m: AwsModel, e: AwsEndpoint, near?: Subnet): Node | undefined {
  if (e.kind === 'instance') {
    const i = byId(m.instances, e.id); if (!i) return undefined;
    return { id: i.id, name: i.name, kind: 'instance', ip: i.privateIp, subnet: byId(m.subnets, i.subnetId), sgIds: i.securityGroupIds, listens: (p, port) => i.listening.some(l => l.protocol === p && l.port === port) };
  }
  if (e.kind === 'lb') {
    const lb = byId(m.loadBalancers, e.id); if (!lb) return undefined;
    const subnets = lb.subnetIds.map(id => byId(m.subnets, id)!).filter(Boolean);
    const subnet = subnets.find(s => s.az === near?.az) ?? subnets[0];
    return { id: lb.id, name: lb.name, kind: 'lb', ip: subnet ? lbNodeIp(subnet) : '0.0.0.0', subnet, sgIds: lb.securityGroupIds, listens: (p, port) => p === 'tcp' && lb.listeners.some(l => l.port === port) };
  }
  return undefined;
}
function sgCheck(t: Trace, m: AwsModel, node: Node, dir: 'ingress' | 'egress', flow: Flow, peer: Node, direction: Direction) {
  const label = dir === 'ingress' ? 'インバウンド' : 'アウトバウンド';
  if (node.kind === 'lb' && !node.sgIds.length) return t.step(direction, 'Security Group', node.name, 'info', 'このロードバランサーにはセキュリティグループ（SG）が付いていないため、SGの評価を省略します（NLBはSGなしで作れます。実際のAWSでは、ALBには必ずSGが付きます）');
  if (direction === 'response') return t.step(direction, 'Security Group', node.sgIds.join(', ') || node.name, 'info', `SGはステートフル（行きの通信を覚えている）なので、許可した通信の戻りは${label}ルールに関係なく通します`);
  const peerIp = dir === 'ingress' ? flow.src : flow.dst;
  for (const id of node.sgIds) {
    const sg = byId(m.securityGroups, id); if (!sg) continue;
    const rule = sg[dir].find(r => protoMatch(r.protocol, flow.protocol) && (r.protocol === '-1' || portMatch(r.fromPort, r.toPort, flow.protocol, flow.dstPort)) && ((r.cidr && contains(r.cidr, peerIp)) || (r.sourceSg && peer.sgIds.includes(r.sourceSg))));
    if (rule) return t.step(direction, 'Security Group', `${sg.name}（${sg.id}）`, true, `${label}ルール「${ruleText(rule, dir)}」に一致するので許可します`);
  }
  const what = flow.protocol === 'icmp' ? 'ICMP' : `${flow.protocol.toUpperCase()} ${flow.dstPort}`;
  return t.step(direction, 'Security Group', node.sgIds.map(id => byId(m.securityGroups, id)?.name ?? id).join(', ') || '(なし)', false,
    `${node.sgIds.length ? `${node.sgIds.join(', ')} の` : ''}${label}ルールに、${portText(flow)} を許可するものがありません。SGには許可ルールしか書けず、どれにも一致しない通信は拒否されます。${label}ルールで、${dir === 'ingress' ? `送信元 ${peerIp} からの ${what}` : `宛先 ${peerIp} への ${what}`} を許可してください${dir === 'ingress' && peer.sgIds.length ? `（送信元のSG ${peer.sgIds.join(', ')} を指定するルールでも許可できます。SG参照なら、相手のIPアドレスが変わってもルールを直さずに済みます）` : ''}`);
}
function naclCheck(t: Trace, m: AwsModel, subnet: Subnet, egress: boolean, flow: Flow, direction: Direction) {
  const acl = subnetNacl(m, subnet);
  if (!acl) return t.step(direction, 'Network ACL', subnet.name, false, `${subnet.name} に関連付けられたネットワークACL（NACL）がありません。サブネットにNACLを関連付けてください（実際のAWSでは、どのサブネットも必ず1つのNACLに関連付けられます）`);
  const peerIp = egress ? flow.dst : flow.src;
  const entry = acl.entries.filter(e => e.egress === egress).sort((a, b) => a.ruleNumber - b.ruleNumber)
    .find(e => protoMatch(e.protocol, flow.protocol) && (e.protocol === '-1' || portMatch(e.fromPort, e.toPort, flow.protocol, flow.dstPort)) && contains(e.cidr, peerIp));
  const side = egress ? 'アウトバウンド' : 'インバウンド';
  const where = `${acl.name}（${subnet.name} の${side}）`;
  const icmp = flow.protocol === 'icmp';
  const stateless = direction === 'response' ? `NACLはステートレス（行きの通信を覚えていない）なので、戻りの通信も改めてルールで判定されます。${icmp ? `${side}でも ICMP を許可する必要があります` : `${side}に、戻りの宛先ポート ${flow.dstPort} を含むエフェメラルポート（1024〜65535）を許可するルールが必要です`}` : '';
  if (!entry) return t.step(direction, 'Network ACL', where, false, `${acl.name}（${acl.id}）の${side}に ${portText(flow)} を許可するルールがなく、最後の * ルールで拒否されました。${stateless || `${side}に、${egress ? `宛先 ${peerIp} への` : `送信元 ${peerIp} からの`} ${icmp ? 'ICMP' : `${flow.protocol.toUpperCase()} ${flow.dstPort}`} を許可するルールを追加してください`}`);
  const text = `ルール ${entry.ruleNumber} ${entry.action.toUpperCase()} ${entry.protocol === '-1' ? 'All' : entry.protocol.toUpperCase()} ${entry.protocol === 'tcp' || entry.protocol === 'udp' ? `${entry.fromPort}-${entry.toPort}` : ''} ${entry.cidr}`.replace(/\s+/g, ' ');
  return t.step(direction, 'Network ACL', where, entry.action === 'allow', entry.action === 'allow' ? `${portText(flow)} は「${text}」に一致するので許可します`
    : `${portText(flow)} は「${text}」に一致したため拒否されました。NACLは番号の小さいルールから順に評価し、最初に一致したルールで決まります。この通信を通すなら、このDENYより小さい番号に許可ルールを置くか、DENYルールを見直してください${stateless ? `。${stateless}` : ''}`);
}
/** Traffic leaving `node` towards `peer` (SG egress + NACL outbound when crossing a subnet boundary). */
function leave(t: Trace, m: AwsModel, node: Node, flow: Flow, peer: Node, direction: Direction) {
  if (node.kind !== 'nat' && node.kind !== 'outside' && !sgCheck(t, m, node, 'egress', flow, peer, direction)) return false;
  if (node.subnet && node.subnet.id !== peer.subnet?.id && !naclCheck(t, m, node.subnet, true, flow, direction)) return false;
  return true;
}
function enter(t: Trace, m: AwsModel, node: Node, flow: Flow, peer: Node, direction: Direction) {
  if (node.subnet && node.subnet.id !== peer.subnet?.id && !naclCheck(t, m, node.subnet, false, flow, direction)) return false;
  if (node.kind !== 'nat' && node.kind !== 'outside' && !sgCheck(t, m, node, 'ingress', flow, peer, direction)) return false;
  return true;
}
function route(t: Trace, m: AwsModel, node: Node, dst: string, direction: Direction) {
  const rt = node.subnet && subnetRouteTable(m, node.subnet);
  if (!rt) { t.step(direction, 'Route Table', node.name, false, `${node.name} が使えるルートテーブルがありません。サブネットにルートテーブルを関連付けるか、VPCのメインルートテーブルを確認してください`); return undefined; }
  const r = lookupRoute(m, rt, dst);
  if (!r) { t.step(direction, 'Route Table', `${rt.name}（${node.subnet!.name}）`, false, direction === 'response'
    ? `${rt.name}（${rt.id}）に、戻りの通信の宛先 ${dst} に一致する経路がありません。行きの経路だけでなく、帰りの経路も必要です（例: ピアリングなら相手のVPC側のルートテーブルにも、こちらのVPCのCIDR → pcx- の経路を追加します）`
    : `${rt.name}（${rt.id}）に、宛先 ${dst} に一致する経路がありません。VPCの外へ送るには、local 以外の経路（0.0.0.0/0 → IGW や NAT Gateway、相手VPCのCIDR → ピアリングなど）が必要です`); return undefined; }
  t.step(direction, 'Route Table', `${rt.name}（${node.subnet!.name}）`, true, `宛先 ${dst} は経路 ${r.destination} に一致 → ターゲット ${r.target} へ送ります`);
  return r.target;
}
function listen(t: Trace, node: Node, flow: Flow) {
  if (node.kind === 'lb' && flow.protocol !== 'tcp') return t.step('request', 'Load Balancer', node.name, false, `${node.name} は ${flow.protocol.toUpperCase()} の通信を受け付けません。ロードバランサーが扱うのはリスナー（TCP / HTTP / HTTPS）で待ち受ける通信だけで、ping（ICMP）にも応答しません`);
  if (flow.protocol === 'icmp' || !node.listens) return t.step('request', node.kind === 'lb' ? 'Load Balancer' : 'Instance', node.name, 'info', 'ICMP（ping など）にはOSが応答するため、待ち受けの設定は関係ありません');
  const ok = node.listens(flow.protocol, flow.dstPort);
  return t.step('request', node.kind === 'lb' ? 'Load Balancer' : 'Instance', node.name, ok, ok
    ? `${node.name} は ${flow.protocol}/${flow.dstPort} で待ち受けています`
    : node.kind === 'lb' ? `${node.name} にポート ${flow.dstPort} のリスナー（待ち受けの設定）がないため、接続を受け付けません。リスナーを追加してください`
      : `${node.name} は ${flow.protocol}/${flow.dstPort} で待ち受けていません。通信は届いていますが、接続は拒否されます（TCPなら Connection refused）。アプリがこのポートで動いているか（VPC Designerでは EC2 の「待ち受け」、Terraformでは Listen タグ）を確認してください`);
}
function igwFor(t: Trace, m: AwsModel, subnet: Subnet, direction: Direction, target?: string) {
  const igw = m.internetGateways.find(g => g.vpcId === subnet.vpcId);
  if (!igw) return t.step(direction, 'Internet Gateway', subnet.vpcId, false, `VPC ${subnet.vpcId} にアタッチ（取り付け）されたInternet Gateway（IGW）がありません。IGWを作成し、このVPCにアタッチしてください`);
  if (target && target !== igw.id) return t.step(direction, 'Internet Gateway', target, false, `経路のターゲット ${target} は、このVPCにアタッチされたIGW（${igw.id}）ではありません。経路のターゲットを ${igw.id} にしてください`);
  return t.step(direction, 'Internet Gateway', `${igw.name}（${igw.id}）`, true, direction === 'request' ? 'VPCとインターネットの出入口です。パブリックIPとプライベートIPを1対1で変換します' : '戻りの通信も、パブリックIPとプライベートIPを1対1で変換して通します');
}

/** Two-way VPC-internal path, optionally across a peering connection. */
function internalLeg(t: Trace, m: AwsModel, src: Node, dst: Node, flow: Flow, viaNlb = false): boolean {
  if (!leave(t, m, src, flow, dst, 'request')) return false;
  const target = route(t, m, src, dst.ip, 'request'); if (!target) return false;
  const srcVpc = src.subnet!.vpcId; const dstVpc = dst.subnet?.vpcId;
  const peering = (direction: Direction, id: string) => {
    const p = byId(m.peerings, id);
    const ok = p && p.status === 'active' && [p.requesterVpcId, p.accepterVpcId].includes(srcVpc) && [p.requesterVpcId, p.accepterVpcId].includes(dstVpc!);
    const back = direction === 'response';
    return t.step(direction, 'VPC Peering', id, !!ok, ok ? back ? `戻りの通信も、ピアリング ${id} を通って送信元のVPCへ戻ります` : `ピアリング ${id} を通って、相手のVPCへ送ります` : p?.status !== 'active' ? `ピアリング ${id} がまだ承認されていません（状態が active ではありません）。受け入れ側（アクセプタ）で承認して active にしてください`
      : back ? `戻りの通信の経路が向いているピアリング ${id} は、このVPC（${dstVpc}）と送信元のVPC（${srcVpc}）を直接つなぐものではありません。ピアリングで通信できるのは直接つないだ2つのVPCの間だけで、別のVPCを経由した通信（推移的ルーティング）はできません。${dst.name} のサブネットのルートテーブルで、送信元への経路を2つのVPCをつなぐピアリングに向けてください`
        : `ピアリング ${id} は、このVPCと宛先のVPC（${dstVpc}）を直接つなぐものではありません。ピアリングで通信できるのは直接つないだ2つのVPCの間だけで、別のVPCを経由した通信（推移的ルーティング）はできません`);
  };
  if (target === 'local') { if (dstVpc !== srcVpc) return t.step('request', 'Route Table', src.name, false, `宛先 ${dst.ip} は別のVPC（${dstVpc}）にありますが、このVPCとCIDRが重なっているため local 経路に一致しました。local 経路で届くのは同じVPCの中だけです。CIDRが重なるVPCどうしはピアリングもできないため、アドレスの設計を見直してください`); }
  else if (target.startsWith('pcx-')) { if (!peering('request', target)) return false; }
  else return t.step('request', 'Route Table', src.name, false, `宛先 ${dst.ip} への経路のターゲットが ${target} になっているため、宛先に届きません。同じVPCなら local、別のVPCならピアリング（pcx-）へ向ける経路が必要です`);
  if (!enter(t, m, dst, flow, src, 'request')) return false;
  if (!listen(t, dst, flow)) return false;
  const back = reverse(flow);
  if (!leave(t, m, dst, back, src, 'response')) return false;
  if (viaNlb) return t.step('response', 'Load Balancer', src.name, 'info', 'NLBが戻りの通信を受け取り、クライアントへ返します。NLBはクライアントのIPをそのままターゲットに届けるので、ターゲットのSGとNACLは、クライアントのIPを前提に許可しておく必要があります（NACLは戻りの通信も）');
  const rTarget = route(t, m, dst, src.ip, 'response'); if (!rTarget) return false;
  if (rTarget !== 'local' && !rTarget.startsWith('pcx-')) return t.step('response', 'Route Table', dst.name, false, `戻りの通信の経路が ${rTarget} を向いているため、送信元 ${src.ip} へ戻れません（行きと帰りで経路が違う「非対称」な状態）。${dst.name} のサブネットのルートテーブルで、送信元への経路を見直してください`);
  if (rTarget === 'local' && srcVpc !== dstVpc) return t.step('response', 'Route Table', dst.name, false, `戻りの通信が local 経路に一致しましたが、送信元 ${src.ip} は別のVPCにあります（2つのVPCのCIDRが重なっています）。local 経路で届くのは同じVPCの中だけです`);
  if (rTarget.startsWith('pcx-') && !peering('response', rTarget)) return false;
  return enter(t, m, src, back, dst, 'response');
}
/** Instance → outside the VPC (Internet, AWS service, on-premises). */
function outboundLeg(t: Trace, m: AwsModel, src: Node, dstIp: string, flow: Flow, kind: 'internet' | 'service' | 'onprem'): boolean {
  const outside: Node = { id: 'outside', name: dstIp, kind: 'outside', ip: dstIp, sgIds: [] };
  if (!leave(t, m, src, flow, outside, 'request')) return false;
  const target = route(t, m, src, dstIp, 'request'); if (!target) return false;
  const back = reverse(flow);
  const inst = byId(m.instances, src.id);
  if (target.startsWith('igw-')) {
    if (!inst?.publicIp) return t.step('request', 'Internet Gateway', target, false, `${src.name} にパブリックIP（またはElastic IP）がないため、IGWで変換できず、インターネットに出られません。パブリックIPを付けるか、プライベートサブネットのまま NAT Gateway 経由で出るようにします`);
    if (!igwFor(t, m, src.subnet!, 'request', target)) return false;
    t.step('request', kind === 'service' ? 'AWS Service' : 'Internet', dstIp, 'info', kind === 'service' ? 'インターネット経由で、サービスの公開された窓口（パブリックエンドポイント）に届きます。Gateway型VPCエンドポイントを使うと、インターネットを通らずに届きます' : `送信元をパブリックIP ${inst.publicIp} に変換して、インターネットへ出ます`);
    if (!igwFor(t, m, src.subnet!, 'response', target)) return false;
    return enter(t, m, src, back, outside, 'response');
  }
  if (target.startsWith('nat-')) {
    const nat = byId(m.natGateways, target)!; const natSubnet = byId(m.subnets, nat.subnetId)!;
    const natNode: Node = { id: nat.id, name: nat.name, kind: 'nat', ip: dotted(cidr(natSubnet.cidr).network + 5), subnet: natSubnet, sgIds: [] };
    if (natSubnet.id !== src.subnet!.id && !naclCheck(t, m, natSubnet, false, flow, 'request')) return false;
    if (!t.step('request', 'NAT Gateway', `${nat.name}（${nat.id}）`, !!nat.publicIp, nat.publicIp ? `送信元 ${src.ip}:${flow.srcPort} を ${nat.publicIp}:${EPHEMERAL} に変換します（PAT：多数のサーバーで1つのアドレスを共有するNAT）` : `${nat.name} にElastic IPが割り当てられていません。インターネット向け（パブリック）のNAT Gatewayには、Elastic IPが必要です`)) return false;
    const exposure = subnetExposure(m, natSubnet);
    if (!t.step('request', 'NAT Gateway', natSubnet.name, exposure.public, exposure.public ? `NAT Gatewayはパブリックサブネット ${natSubnet.name} にあります` : `NAT Gatewayを置いたサブネット ${natSubnet.name} がパブリックではありません（${exposure.reason}）。NAT Gateway自身もIGWへ出る必要があるため、パブリックサブネットに置きます`)) return false;
    const natFlow: Flow = { ...flow, src: natNode.ip, srcPort: EPHEMERAL };
    if (!naclCheck(t, m, natSubnet, true, natFlow, 'request')) return false;
    const natTarget = route(t, m, natNode, dstIp, 'request'); if (!natTarget) return false;
    if (!natTarget.startsWith('igw-')) return t.step('request', 'Route Table', natSubnet.name, false, `NAT Gatewayのサブネット ${natSubnet.name} からの経路が、IGWではなく ${natTarget} を向いています。0.0.0.0/0 → IGW の経路が必要です`);
    if (!igwFor(t, m, natSubnet, 'request', natTarget)) return false;
    t.step('request', kind === 'service' ? 'AWS Service' : 'Internet', dstIp, 'info', `送信元 ${nat.publicIp} としてインターネットへ出ます${kind === 'service' ? '。AWSのサービス宛ての通信もNAT Gatewayを通るため、処理したデータ量に応じた料金（データ処理料金）がかかります。Gateway型VPCエンドポイントを使うと、NAT Gatewayを通らずに届きます' : ''}`);
    if (!igwFor(t, m, natSubnet, 'response')) return false;
    if (!naclCheck(t, m, natSubnet, false, reverse(natFlow), 'response')) return false;
    t.step('response', 'NAT Gateway', nat.name, true, `NAT Gatewayが変換を覚えているので、戻りの通信の宛先 ${nat.publicIp}:${EPHEMERAL} を元の ${src.ip}:${flow.srcPort} に戻します`);
    if (natSubnet.id !== src.subnet!.id && !naclCheck(t, m, natSubnet, true, back, 'response')) return false;
    return enter(t, m, src, back, natNode, 'response');
  }
  if (target.startsWith('vpce-')) {
    const e = byId(m.endpoints, target);
    const ok = !!e && e.vpcId === src.subnet!.vpcId && kind === 'service' && contains(servicePrefix[e.service].cidr, dstIp);
    if (!t.step('request', 'VPC Endpoint', target, ok, ok ? `Gateway型VPCエンドポイント ${target} を通って ${e!.service.toUpperCase()} へ届きます（インターネットやNAT Gatewayを通りません）` : e && e.vpcId !== src.subnet!.vpcId ? `エンドポイント ${target} は別のVPC（${e.vpcId}）のものです。Gateway型エンドポイントは、作成したVPCのルートテーブルからしか使えません` : `エンドポイント ${target} では、宛先 ${dstIp} に届きません。Gateway型エンドポイントで届くのは、対象サービス（S3 / DynamoDB）のアドレスだけです`)) return false;
    return enter(t, m, src, back, outside, 'response');
  }
  if (target.startsWith('vgw-')) {
    const g = byId(m.vpnGateways, target);
    const ok = !!g && g.vpcId === src.subnet!.vpcId && g.onPremCidrs.some(c => contains(c, dstIp));
    if (!t.step('request', 'VPN Gateway', target, ok, ok ? 'Site-to-Site VPN（インターネット越しに拠点とVPCを暗号化してつなぐ仕組み）でオンプレミスへ送ります（トンネルの中の動きは、VPN / BGP の章のシミュレータで確かめます）' : g?.vpcId !== src.subnet!.vpcId ? `VPN Gateway ${target} がこのVPCにアタッチされていません。アタッチ先をこのVPCにしてください` : `VPN Gateway ${target} が知っているオンプレミスの経路に、宛先 ${dstIp} が含まれていません（オンプレミス側から経路が伝わって（伝搬されて）いません）。VPN Gatewayの「オンプレミスから伝搬される経路」を確認してください`)) return false;
    return enter(t, m, src, back, outside, 'response');
  }
  if (target.startsWith('pcx-')) return t.step('request', 'VPC Peering', target, false, `ピアリング ${target} で届くのは、相手のVPCの中の宛先だけです。相手のVPCを経由して、インターネットや別のネットワークへ出ることはできません（推移的ルーティングは不可）`);
  return t.step('request', 'Route Table', target, false, `経路のターゲット ${target} では、宛先 ${dstIp} に届きません`);
}
function lbTargets(t: Trace, m: AwsModel, lbId: string, port: number, clientIp?: string) {
  const lb = byId(m.loadBalancers, lbId)!;
  const listener = lb.listeners.find(l => l.port === port)!;
  const results = listener.targetIds.map(id => {
    const sub = new Trace();
    const target = nodeOf(m, { kind: 'instance', id })!;
    const lbNode = nodeOf(m, { kind: 'lb', id: lb.id }, target.subnet)!;
    // ALB opens a new connection from its node address; NLB preserves the client address.
    const nlb = lb.type === 'network' && !!clientIp;
    const flow: Flow = { protocol: 'tcp', src: nlb ? clientIp! : lbNode.ip, srcPort: EPHEMERAL, dst: target.ip, dstPort: listener.targetPort };
    const ok = internalLeg(sub, m, nlb ? { ...lbNode, ip: clientIp!, sgIds: lbNode.sgIds } : lbNode, target, flow, nlb);
    return { id, ok, sub };
  });
  const healthy = results.filter(r => r.ok);
  const tag = (id: string) => (h: AwsHop): AwsHop => ({ ...h, resource: `${h.resource} [→ ${byId(m.instances, id)?.name}]` });
  for (const r of results) t.hops.push(...r.sub.hops.map(tag(r.id)));
  // The root cause is inside the first failing target leg, not the load balancer itself.
  if (!healthy.length && results[0]?.sub.blocked) t.blocked ??= tag(results[0].id)(results[0].sub.blocked);
  t.step('request', 'Load Balancer', lb.name, healthy.length > 0, `ターゲット ${healthy.length}/${results.length} 台が正常です（ヘルスチェックの代わりに、ターゲットまで往復で届くかで判定）${healthy.length === results.length ? ''
    : healthy.length ? '。正常なターゲットだけに振り分けます' : results.length ? '。どのターゲットにも届かないため、クライアントにはエラー（504 Gateway Timeout や 502 Bad Gateway など）が返ります。上の各ターゲットへの判定で、止まった場所を確認してください'
      : '。ターゲットが登録されていないため、クライアントには 503 Service Unavailable が返ります'}`);
  return healthy.length > 0;
}

/** Never throws: a design with broken references (reported by validateModel) must not crash the UI. */
export function analyzePath(m: AwsModel, source: AwsEndpoint, destination: AwsEndpoint, protocol: Proto = 'tcp', port = 443): AwsAnalysis {
  try { return analyze(m, source, destination, protocol, port); } catch {
    const hop: AwsHop = { direction: 'request', component: 'Validation', resource: '-', verdict: 'block', detail: '設計に矛盾（存在しないサブネット・VPC・ターゲットへの参照や、CIDRの書き方の誤りなど）があるため、分析を続けられませんでした' };
    return { reachable: false, hops: [hop], blocked: hop, summary: '分析できません: 設計の検証エラーを先に直してから、もう一度分析してください' };
  }
}
function analyze(m: AwsModel, source: AwsEndpoint, destination: AwsEndpoint, protocol: Proto, port: number): AwsAnalysis {
  const t = new Trace();
  const done = (ok: boolean): AwsAnalysis => ({ reachable: ok && !t.blocked, hops: t.hops, blocked: t.blocked,
    summary: ok && !t.blocked ? '到達可能: 行き（往路）と帰り（復路）の両方で通信が成立します' : `到達不能: ${t.blocked?.component}（${t.blocked?.resource}）で止まりました — ${t.blocked?.detail}` });
  if (source.kind === 'internet') {
    const client: Node = { id: 'internet', name: `Internet ${source.ip}`, kind: 'outside', ip: source.ip, sgIds: [] };
    t.step('request', 'Internet', source.ip, 'info', `インターネットのクライアント ${source.ip}:${EPHEMERAL} から接続します`);
    if (destination.kind === 'instance') {
      const inst = byId(m.instances, destination.id); const node = nodeOf(m, destination);
      if (!inst || !node?.subnet) return done(t.step('request', 'Instance', destination.id, false, `インスタンス ${destination.id} が見つかりません`));
      if (!t.step('request', 'Instance', inst.name, !!inst.publicIp, inst.publicIp ? `パブリックIP ${inst.publicIp} 宛てに送ります` : `${inst.name} にパブリックIP（またはElastic IP）がないため、インターネットからは宛先として指定できません（プライベートIPはインターネットから届きません）。公開したい場合は、パブリックサブネットでパブリックIPを付けるか、ロードバランサーを経由させます`)) return done(false);
      if (!igwFor(t, m, node.subnet, 'request')) return done(false);
      const flow: Flow = { protocol, src: source.ip, srcPort: EPHEMERAL, dst: inst.privateIp, dstPort: port };
      if (!naclCheck(t, m, node.subnet, false, flow, 'request') || !sgCheck(t, m, node, 'ingress', flow, client, 'request') || !listen(t, node, flow)) return done(false);
      const back = reverse(flow);
      if (!sgCheck(t, m, node, 'egress', back, client, 'response') || !naclCheck(t, m, node.subnet, true, back, 'response')) return done(false);
      const target = route(t, m, node, source.ip, 'response'); if (!target) return done(false);
      if (!target.startsWith('igw-')) return done(t.step('response', 'Route Table', node.subnet.name, false, `戻りの通信が ${target} へ向かうため、IGWでの1対1の変換を通らず、クライアントに応答が届きません（行きと帰りで経路が違う「非対称」な状態）。${node.subnet.name} のルートテーブルに 0.0.0.0/0 → IGW が必要です`));
      return done(igwFor(t, m, node.subnet, 'response', target));
    }
    if (destination.kind === 'lb') {
      const lb = byId(m.loadBalancers, destination.id);
      if (!lb) return done(t.step('request', 'Load Balancer', destination.id, false, `ロードバランサー ${destination.id} が見つかりません`));
      if (!t.step('request', 'Load Balancer', lb.name, lb.scheme === 'internet-facing', lb.scheme === 'internet-facing' ? 'internet-facing（インターネット向け）のロードバランサーです。インターネットから名前解決できる名前（パブリックDNS名）で公開されます' : `${lb.name} は internal（VPCの内側向け）なので、インターネットからは接続できません。公開するにはスキームを internet-facing にします（実際のAWSでは作成後に変更できないため、作り直します）`)) return done(false);
      const listener = lb.listeners.find(l => l.port === port);
      if (!t.step('request', 'Load Balancer', lb.name, !!listener && protocol === 'tcp', !listener ? `${lb.name} にポート ${port} のリスナー（待ち受けの設定）がありません。リスナーを追加するか、接続するポートを確認してください`
        : protocol !== 'tcp' ? `ポート ${port} のリスナーは ${listener.protocol} なので、${protocol.toUpperCase()} の通信は受け付けません。${lb.type === 'application' ? 'ALBが扱えるのは HTTP / HTTPS（TCPの上で動く通信）だけです' : 'TCPリスナーが受け付けるのはTCPの通信だけです'}` : `ポート ${port} のリスナー（待ち受けの設定）で受け付けます`)) return done(false);
      const subnets = lb.subnetIds.map(id => byId(m.subnets, id)!);
      const publicSubnet = subnets.find(s => subnetExposure(m, s).public);
      if (!t.step('request', 'Load Balancer', lb.name, !!publicSubnet, publicSubnet ? `${publicSubnet.name} はパブリックサブネットです（インターネットとやり取りできます）` : `${lb.name} を置いたサブネットが、どれもパブリックではありません（${subnetExposure(m, subnets[0]).reason}）。internet-facing のロードバランサーは、アタッチ済みのIGWへの経路（0.0.0.0/0 → igw-…）があるパブリックサブネットに置く必要があります`)) return done(false);
      if (!igwFor(t, m, publicSubnet!, 'request')) return done(false);
      const node = { ...nodeOf(m, destination, publicSubnet)!, subnet: publicSubnet, ip: lbNodeIp(publicSubnet!) };
      const flow: Flow = { protocol: 'tcp', src: source.ip, srcPort: EPHEMERAL, dst: node.ip, dstPort: port };
      if (!naclCheck(t, m, publicSubnet!, false, flow, 'request') || !sgCheck(t, m, node, 'ingress', flow, client, 'request')) return done(false);
      if (!lbTargets(t, m, lb.id, port, source.ip)) return done(false);
      const back = reverse(flow);
      if (!sgCheck(t, m, node, 'egress', back, client, 'response') || !naclCheck(t, m, publicSubnet!, true, back, 'response')) return done(false);
      const target = route(t, m, node, source.ip, 'response'); if (!target) return done(false);
      return done(igwFor(t, m, publicSubnet!, 'response', target));
    }
    return done(t.step('request', 'Internet', '-', false, '送信元がインターネットのときは、宛先にインスタンスかロードバランサーを選んでください'));
  }
  const src = nodeOf(m, source);
  if (!src?.subnet) return done(t.step('request', 'Source', 'source' in source ? String(source) : '-', false, '送信元が見つかりません。サブネットに属するインスタンスかロードバランサーを選んでください'));
  if (destination.kind === 'instance' || destination.kind === 'lb') {
    const dst = nodeOf(m, destination, src.subnet);
    if (!dst?.subnet) return done(t.step('request', 'Destination', '-', false, '宛先が見つかりません。サブネットに属するインスタンスかロードバランサーを選んでください'));
    const flow: Flow = { protocol, src: src.ip, srcPort: EPHEMERAL, dst: dst.ip, dstPort: port };
    if (!internalLeg(t, m, src, dst, flow)) return done(false);
    if (destination.kind === 'lb' && !lbTargets(t, m, destination.id, port, src.ip)) return done(false);
    return done(true);
  }
  const dstIp = destination.kind === 'service' ? dotted(cidr(servicePrefix[destination.service].cidr).network + 10) : destination.ip;
  const flow: Flow = { protocol, src: src.ip, srcPort: EPHEMERAL, dst: dstIp, dstPort: port };
  return done(outboundLeg(t, m, src, dstIp, flow, destination.kind === 'service' ? 'service' : destination.kind === 'onprem' ? 'onprem' : 'internet'));
}

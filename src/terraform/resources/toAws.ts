import type { Cloud, CloudResource } from '../engine';
import type { Value } from '../evaluator/evaluate';
import { emptyModel, type AwsModel, type AwsProtocol, type AwsRoute, type Instance } from '../../aws/model';
import { allowAllNacl } from '../../aws/scenarios';

const s = (v: Value | undefined) => typeof v === 'string' ? v : undefined;
const list = (v: Value | undefined) => Array.isArray(v) ? v : [];
const obj = (v: Value) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, Value>;
const name = (r: CloudResource) => s(obj(r.attributes.tags ?? {}).Name) ?? s(r.attributes.name) ?? r.id;
const proto = (p: Value): AwsProtocol => { const x = String(p).toLowerCase(); return x === '-1' || x === 'all' ? '-1' : x === '6' ? 'tcp' : x === '17' ? 'udp' : x === '1' ? 'icmp' : (x as AwsProtocol); };
const roleDefaults: Record<Instance['role'], Instance['listening']> = { web: [{ protocol: 'tcp', port: 80 }, { protocol: 'tcp', port: 443 }], app: [{ protocol: 'tcp', port: 8080 }], db: [{ protocol: 'tcp', port: 5432 }], bastion: [{ protocol: 'tcp', port: 22 }], generic: [] };

/**
 * Convert the simulated cloud (resources Terraform or the "console" created) into the VPC model
 * used by the diagram and the reachability analyzer.
 * Simulator convention: EC2 tags Role (web/app/db/bastion) and Listen ("8080" or "tcp/8080,tcp/22") describe what the OS listens on.
 */
export function cloudToAws(cloud: Cloud): AwsModel {
  const m = emptyModel();
  const all = Object.values(cloud.resources);
  const of = (type: string) => all.filter(r => r.type === type);
  for (const v of of('aws_vpc')) {
    const a = v.attributes;
    m.vpcs.push({ id: v.id, name: name(v), cidr: String(a.cidr_block) });
    m.routeTables.push({ id: String(a.main_route_table_id), name: `${name(v)}-main`, vpcId: v.id, main: true, routes: [] });
    m.networkAcls.push({ id: String(a.default_network_acl_id), name: `${name(v)}-default-acl`, vpcId: v.id, isDefault: true, entries: allowAllNacl() });
    m.securityGroups.push({ id: String(a.default_security_group_id), name: 'default', vpcId: v.id, ingress: [{ protocol: '-1', fromPort: 0, toPort: 65535, sourceSg: String(a.default_security_group_id) }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] });
  }
  for (const r of of('aws_subnet')) m.subnets.push({ id: r.id, name: name(r), vpcId: String(r.attributes.vpc_id), cidr: String(r.attributes.cidr_block), az: s(r.attributes.availability_zone) ?? 'ap-northeast-1a' });
  for (const r of of('aws_internet_gateway')) m.internetGateways.push({ id: r.id, name: name(r), vpcId: s(r.attributes.vpc_id) });
  for (const r of of('aws_nat_gateway')) m.natGateways.push({ id: r.id, name: name(r), subnetId: String(r.attributes.subnet_id), publicIp: s(r.attributes.public_ip) });
  const target = (a: Record<string, Value>) => s(a.gateway_id) ?? s(a.nat_gateway_id) ?? s(a.vpc_peering_connection_id) ?? s(a.vpc_endpoint_id) ?? s(a.transit_gateway_id) ?? 'unknown';
  for (const r of of('aws_route_table')) m.routeTables.push({ id: r.id, name: name(r), vpcId: String(r.attributes.vpc_id), main: false,
    routes: list(r.attributes.route).map(x => ({ destination: String(obj(x).cidr_block), target: target(obj(x)) })) });
  for (const r of of('aws_main_route_table_association')) for (const rt of m.routeTables) if (rt.vpcId === r.attributes.vpc_id) rt.main = rt.id === r.attributes.route_table_id;
  for (const r of of('aws_route')) {
    const rt = m.routeTables.find(t => t.id === r.attributes.route_table_id);
    if (rt) rt.routes.push({ destination: String(r.attributes.destination_cidr_block), target: target(r.attributes) } satisfies AwsRoute);
  }
  for (const r of of('aws_route_table_association')) { const sub = m.subnets.find(x => x.id === r.attributes.subnet_id); if (sub) sub.routeTableId = String(r.attributes.route_table_id); }
  const sgRules = (blocks: Value | undefined) => list(blocks).flatMap(b => {
    const x = obj(b);
    const base = { protocol: proto(x.protocol), fromPort: Number(x.from_port), toPort: Number(x.to_port), description: s(x.description) };
    return [...list(x.cidr_blocks).map(c => ({ ...base, cidr: String(c) })), ...list(x.security_groups).map(g => ({ ...base, sourceSg: String(g) }))];
  });
  for (const r of of('aws_security_group')) m.securityGroups.push({ id: r.id, name: s(r.attributes.name) ?? name(r), vpcId: String(r.attributes.vpc_id), ingress: sgRules(r.attributes.ingress), egress: sgRules(r.attributes.egress) });
  for (const r of of('aws_security_group_rule')) {
    const sg = m.securityGroups.find(x => x.id === r.attributes.security_group_id); if (!sg) continue;
    const base = { protocol: proto(r.attributes.protocol), fromPort: Number(r.attributes.from_port), toPort: Number(r.attributes.to_port) };
    const rules = [...list(r.attributes.cidr_blocks).map(c => ({ ...base, cidr: String(c) })), ...(s(r.attributes.source_security_group_id) ? [{ ...base, sourceSg: String(r.attributes.source_security_group_id) }] : [])];
    (r.attributes.type === 'egress' ? sg.egress : sg.ingress).push(...rules);
  }
  for (const r of of('aws_network_acl')) {
    const entries = (blocks: Value | undefined, egress: boolean) => list(blocks).map(b => { const x = obj(b); return { ruleNumber: Number(x.rule_no), egress, protocol: proto(x.protocol), fromPort: Number(x.from_port), toPort: Number(x.to_port), cidr: String(x.cidr_block), action: String(x.action).toLowerCase() === 'deny' ? 'deny' as const : 'allow' as const }; });
    m.networkAcls.push({ id: r.id, name: name(r), vpcId: String(r.attributes.vpc_id), isDefault: false, entries: [...entries(r.attributes.ingress, false), ...entries(r.attributes.egress, true)] });
    for (const id of list(r.attributes.subnet_ids)) { const sub = m.subnets.find(x => x.id === id); if (sub) sub.naclId = r.id; }
  }
  /** Without explicit SGs, AWS attaches the VPC's default SG (only traffic from itself is allowed in). */
  const defaultSg = (subnetId: Value | undefined) => { const vpcId = m.subnets.find(x => x.id === subnetId)?.vpcId; const sg = m.vpcs.some(v => v.id === vpcId) && all.find(v => v.id === vpcId)?.attributes.default_security_group_id; return sg ? [String(sg)] : []; };
  for (const r of of('aws_instance')) {
    const tags = obj(r.attributes.tags ?? {});
    const role = (['web', 'app', 'db', 'bastion'].includes(String(tags.Role)) ? tags.Role : 'generic') as Instance['role'];
    const listen = s(tags.Listen) ? s(tags.Listen)!.split(',').map(x => { const [p, port] = x.includes('/') ? x.split('/') : ['tcp', x]; return { protocol: (p === 'udp' ? 'udp' : 'tcp') as 'tcp' | 'udp', port: Number(port) }; }) : roleDefaults[role];
    const sgs = list(r.attributes.vpc_security_group_ids).map(String);
    m.instances.push({ id: r.id, name: name(r), subnetId: String(r.attributes.subnet_id), privateIp: String(r.attributes.private_ip), publicIp: s(r.attributes.public_ip), securityGroupIds: sgs.length ? sgs : defaultSg(r.attributes.subnet_id), role, listening: listen });
  }
  const tgs = of('aws_lb_target_group');
  for (const r of of('aws_lb')) {
    const listeners = of('aws_lb_listener').filter(l => l.attributes.load_balancer_arn === r.attributes.arn).map(l => {
      const tgArn = s(obj(list(l.attributes.default_action)[0] ?? {}).target_group_arn);
      const tg = tgs.find(t => t.attributes.arn === tgArn);
      const attachments = of('aws_lb_target_group_attachment').filter(a => a.attributes.target_group_arn === tgArn);
      return { protocol: String(l.attributes.protocol).toUpperCase() as 'HTTP' | 'HTTPS' | 'TCP', port: Number(l.attributes.port), targetPort: Number(tg?.attributes.port ?? l.attributes.port), targetIds: attachments.map(a => String(a.attributes.target_id)) };
    });
    const sgs = list(r.attributes.security_groups).map(String);
    m.loadBalancers.push({ id: r.id, name: s(r.attributes.name) ?? name(r), type: r.attributes.load_balancer_type === 'network' ? 'network' : 'application', scheme: r.attributes.internal ? 'internal' : 'internet-facing',
      subnetIds: list(r.attributes.subnets).map(String), securityGroupIds: sgs.length || r.attributes.load_balancer_type === 'network' ? sgs : defaultSg(list(r.attributes.subnets)[0]), listeners });
  }
  for (const r of of('aws_vpc_peering_connection')) m.peerings.push({ id: r.id, name: name(r), requesterVpcId: String(r.attributes.vpc_id), accepterVpcId: String(r.attributes.peer_vpc_id), status: r.attributes.accept_status === 'active' ? 'active' : 'pending-acceptance' });
  for (const r of of('aws_vpc_endpoint')) {
    const service = String(r.attributes.service_name).endsWith('.dynamodb') ? 'dynamodb' as const : 's3' as const;
    const routeTableIds = list(r.attributes.route_table_ids).map(String);
    m.endpoints.push({ id: r.id, name: name(r), vpcId: String(r.attributes.vpc_id), service, type: 'Gateway', routeTableIds });
    // AWS adds the prefix-list route to each associated route table automatically.
    for (const rt of m.routeTables.filter(t => routeTableIds.includes(t.id))) rt.routes.push({ destination: `pl-${service}`, target: r.id });
  }
  for (const r of of('aws_vpn_gateway')) m.vpnGateways.push({ id: r.id, name: name(r), vpcId: s(r.attributes.vpc_id), onPremCidrs: [] });
  return m;
}

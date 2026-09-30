/** The explicitly supported subset of the AWS provider (educational, not the real provider schema). */
export type AttrType = 'string' | 'number' | 'bool' | 'list' | 'map';
export interface AttrSpec { type: AttrType; required?: boolean; forceNew?: boolean; default?: unknown }
export interface BlockSpec { attrs: Record<string, AttrSpec>; required?: string[] }
export interface ResourceSpec { prefix: string; attrs: Record<string, AttrSpec>; blocks?: Record<string, BlockSpec>; computed: string[]; summary: string }

const tags: AttrSpec = { type: 'map' };
const s = (required = false, forceNew = false): AttrSpec => ({ type: 'string', required, forceNew });
const n = (required = false, forceNew = false): AttrSpec => ({ type: 'number', required, forceNew });
const b = (d?: boolean): AttrSpec => ({ type: 'bool', default: d });
const l = (required = false, forceNew = false): AttrSpec => ({ type: 'list', required, forceNew });
const rule: BlockSpec = { attrs: { from_port: n(true), to_port: n(true), protocol: s(true), cidr_blocks: l(), security_groups: l(), description: s() }, required: ['from_port', 'to_port', 'protocol'] };
const naclRule: BlockSpec = { attrs: { rule_no: n(true), action: s(true), protocol: s(true), from_port: n(true), to_port: n(true), cidr_block: s(true) }, required: ['rule_no', 'action', 'protocol', 'from_port', 'to_port', 'cidr_block'] };
const routeTargets = { gateway_id: s(), nat_gateway_id: s(), vpc_peering_connection_id: s(), vpc_endpoint_id: s(), transit_gateway_id: s() };

export const resourceSchema: Record<string, ResourceSpec> = {
  aws_vpc: { prefix: 'vpc', summary: 'VPC', attrs: { cidr_block: s(true, true), enable_dns_support: b(true), enable_dns_hostnames: b(false), tags }, computed: ['id', 'arn', 'main_route_table_id', 'default_network_acl_id', 'default_security_group_id'] },
  aws_subnet: { prefix: 'subnet', summary: 'サブネット', attrs: { vpc_id: s(true, true), cidr_block: s(true, true), availability_zone: s(false, true), map_public_ip_on_launch: b(false), tags }, computed: ['id', 'arn'] },
  aws_internet_gateway: { prefix: 'igw', summary: 'Internet Gateway', attrs: { vpc_id: s(), tags }, computed: ['id', 'arn'] },
  aws_eip: { prefix: 'eipalloc', summary: 'Elastic IP', attrs: { domain: s(false, true), tags }, computed: ['id', 'public_ip', 'allocation_id'] },
  aws_nat_gateway: { prefix: 'nat', summary: 'NAT Gateway', attrs: { allocation_id: s(true, true), subnet_id: s(true, true), tags }, computed: ['id', 'public_ip'] },
  aws_route_table: { prefix: 'rtb', summary: 'ルートテーブル', attrs: { vpc_id: s(true, true), tags }, blocks: { route: { attrs: { cidr_block: s(true), ...routeTargets }, required: ['cidr_block'] } }, computed: ['id', 'arn'] },
  aws_route: { prefix: 'r', summary: '経路', attrs: { route_table_id: s(true, true), destination_cidr_block: s(true, true), ...routeTargets }, computed: ['id'] },
  aws_route_table_association: { prefix: 'rtbassoc', summary: 'ルートテーブルの関連付け', attrs: { subnet_id: s(true, true), route_table_id: s(true) }, computed: ['id'] },
  aws_main_route_table_association: { prefix: 'rtbassoc', summary: 'メインルートテーブルの変更', attrs: { vpc_id: s(true, true), route_table_id: s(true) }, computed: ['id'] },
  aws_security_group: { prefix: 'sg', summary: 'セキュリティグループ', attrs: { name: s(false, true), description: s(false, true), vpc_id: s(true, true), tags }, blocks: { ingress: rule, egress: rule }, computed: ['id', 'arn'] },
  aws_security_group_rule: { prefix: 'sgrule', summary: 'セキュリティグループのルール', attrs: { type: s(true, true), security_group_id: s(true, true), from_port: n(true, true), to_port: n(true, true), protocol: s(true, true), cidr_blocks: l(false, true), source_security_group_id: s(false, true), description: s() }, computed: ['id'] },
  aws_network_acl: { prefix: 'acl', summary: 'ネットワークACL', attrs: { vpc_id: s(true, true), subnet_ids: l(), tags }, blocks: { ingress: naclRule, egress: naclRule }, computed: ['id', 'arn'] },
  aws_instance: { prefix: 'i', summary: 'EC2インスタンス', attrs: { ami: s(true, true), instance_type: s(true), subnet_id: s(true, true), vpc_security_group_ids: l(), private_ip: s(false, true), associate_public_ip_address: { type: 'bool', forceNew: true }, user_data: s(), tags }, computed: ['id', 'arn', 'private_ip', 'public_ip'] },
  aws_lb: { prefix: 'lb', summary: 'ロードバランサー', attrs: { name: s(false, true), internal: { type: 'bool', forceNew: true, default: false }, load_balancer_type: { type: 'string', forceNew: true, default: 'application' }, subnets: l(true), security_groups: l(), tags }, computed: ['id', 'arn', 'dns_name'] },
  aws_lb_target_group: { prefix: 'tg', summary: 'ターゲットグループ', attrs: { name: s(false, true), port: n(true, true), protocol: s(true, true), vpc_id: s(true, true), tags }, computed: ['id', 'arn'] },
  aws_lb_target_group_attachment: { prefix: 'tgattach', summary: 'ターゲットの登録', attrs: { target_group_arn: s(true, true), target_id: s(true, true), port: n(false, true) }, computed: ['id'] },
  aws_lb_listener: { prefix: 'listener', summary: 'リスナー', attrs: { load_balancer_arn: s(true, true), port: n(true), protocol: s(true), certificate_arn: s() }, blocks: { default_action: { attrs: { type: s(true), target_group_arn: s() }, required: ['type'] } }, computed: ['id', 'arn'] },
  aws_vpc_peering_connection: { prefix: 'pcx', summary: 'VPCピアリング', attrs: { vpc_id: s(true, true), peer_vpc_id: s(true, true), auto_accept: b(false), tags }, computed: ['id', 'accept_status'] },
  aws_vpc_endpoint: { prefix: 'vpce', summary: 'VPCエンドポイント', attrs: { vpc_id: s(true, true), service_name: s(true, true), vpc_endpoint_type: { type: 'string', forceNew: true, default: 'Gateway' }, route_table_ids: l(), tags }, computed: ['id', 'prefix_list_id'] },
  aws_vpn_gateway: { prefix: 'vgw', summary: 'VPN Gateway', attrs: { vpc_id: s(), tags }, computed: ['id'] },
};
export const dataSchema: Record<string, { attrs: Record<string, AttrSpec>; values: Record<string, unknown> }> = {
  aws_availability_zones: { attrs: { state: s() }, values: { names: ['ap-northeast-1a', 'ap-northeast-1c', 'ap-northeast-1d'], id: 'ap-northeast-1' } },
  aws_ami: { attrs: { most_recent: b(), owners: l(), name_regex: s() }, values: { id: 'ami-0a1b2c3d4e5f60718', name: 'al2023-ami (PATH simulated image)' } },
  aws_region: { attrs: {}, values: { name: 'ap-northeast-1', id: 'ap-northeast-1' } },
};

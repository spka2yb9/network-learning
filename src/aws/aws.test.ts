import { describe, expect, it } from 'vitest';
import { analyzePath } from './analyzer';
import { byId, reservedAddresses, subnetExposure, usableHosts, validateModel } from './model';
import { baseVpc, singleWeb, threeTier } from './scenarios';
import { TerraformWorkspace } from '../terraform/engine';
import { threeTierFiles } from '../terraform/examples';

const internet = { kind: 'internet' as const, ip: '198.51.100.77' };

describe('AWS model', () => {
  it('reference architecture validates cleanly', () => expect(validateModel(threeTier())).toEqual([]));
  it('"public" is decided by routes to an attached IGW, not by the name', () => {
    const m = threeTier();
    expect(subnetExposure(m, byId(m.subnets, 'subnet-public-a')!).public).toBe(true);
    expect(subnetExposure(m, byId(m.subnets, 'subnet-app-a')!).public).toBe(false);
    m.internetGateways[0].vpcId = undefined;
    expect(subnetExposure(m, byId(m.subnets, 'subnet-public-a')!).reason).toContain('アタッチ');
  });
  it('reserves five addresses per subnet', () => {
    expect(usableHosts('10.0.1.0/24')).toBe(251);
    expect(reservedAddresses('10.0.1.0/24')).toEqual(['10.0.1.0', '10.0.1.1', '10.0.1.2', '10.0.1.3', '10.0.1.255']);
  });
  it('rejects invalid designs with explanations', () => {
    const m = threeTier();
    m.subnets.push({ id: 'subnet-bad', name: 'bad', vpcId: 'vpc-main', cidr: '10.1.0.0/24', az: 'ap-northeast-1a' });
    m.subnets.push({ id: 'subnet-dup', name: 'dup', vpcId: 'vpc-main', cidr: '10.0.1.128/25', az: 'ap-northeast-1a' });
    m.instances.push({ id: 'i-bad', name: 'bad-ip', subnetId: 'subnet-app-a', privateIp: '10.0.11.1', securityGroupIds: ['sg-app'], role: 'app', listening: [] });
    m.loadBalancers[0].subnetIds = ['subnet-public-a'];
    const errors = validateModel(m).join('\n');
    expect(errors).toContain('範囲外');
    expect(errors).toContain('重複');
    expect(errors).toContain('予約アドレス');
    expect(errors).toContain('2つ以上');
  });
});

describe('Reachability analyzer', () => {
  it('Internet → ALB → private app is reachable in the reference design', () => {
    const r = analyzePath(threeTier(), internet, { kind: 'lb', id: 'alb-web' }, 'tcp', 443);
    expect(r.reachable).toBe(true);
    expect(r.hops.map(h => h.component)).toEqual(expect.arrayContaining(['Internet Gateway', 'Network ACL', 'Security Group', 'Load Balancer', 'Route Table']));
    expect(r.hops.some(h => h.direction === 'response' && h.detail.includes('ステートフル'))).toBe(true);
  });
  it('the private app is not reachable directly from the Internet', () => {
    const r = analyzePath(threeTier(), internet, { kind: 'instance', id: 'i-app-a' }, 'tcp', 8080);
    expect(r.reachable).toBe(false);
    expect(r.blocked?.detail).toContain('パブリックIP');
  });
  it('missing 0.0.0.0/0 → IGW makes the ALB subnets private', () => {
    const r = analyzePath(threeTier(false), internet, { kind: 'lb', id: 'alb-web' }, 'tcp', 443);
    expect(r.reachable).toBe(false);
    expect(r.blocked?.component).toBe('Load Balancer');
    expect(r.blocked?.detail).toContain('パブリックではありません');
  });
  it('security group referencing: app → db allowed, ALB → db denied', () => {
    const m = threeTier();
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-c' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432).reachable).toBe(true);
    m.instances.push({ id: 'i-bastion', name: 'bastion', subnetId: 'subnet-public-a', privateIp: '10.0.1.50', publicIp: '198.51.100.9', securityGroupIds: ['sg-alb'], role: 'bastion', listening: [] });
    const r = analyzePath(m, { kind: 'instance', id: 'i-bastion' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432);
    expect(r.blocked?.component).toBe('Security Group');
    expect(r.blocked?.resource).toContain('db-sg');
  });
  it('SG is stateful: empty egress does not block responses', () => {
    const m = threeTier();
    expect(m.securityGroups.find(s => s.id === 'sg-db')!.egress).toEqual([]);
    const r = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432);
    expect(r.reachable).toBe(true);
  });
  it('NACL is stateless: missing ephemeral outbound rule blocks the response', () => {
    const m = threeTier();
    m.networkAcls.push({ id: 'acl-db', name: 'db-acl', vpcId: 'vpc-main', isDefault: false, entries: [
      { ruleNumber: 100, egress: false, protocol: 'tcp', fromPort: 5432, toPort: 5432, cidr: '10.0.0.0/16', action: 'allow' },
    ] });
    m.subnets.find(s => s.id === 'subnet-db-a')!.naclId = 'acl-db';
    const r = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432);
    expect(r.reachable).toBe(false);
    expect(r.blocked?.direction).toBe('response');
    expect(r.blocked?.detail).toContain('ステートレス');
    m.networkAcls.at(-1)!.entries.push({ ruleNumber: 100, egress: true, protocol: 'tcp', fromPort: 1024, toPort: 65535, cidr: '10.0.0.0/16', action: 'allow' });
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432).reachable).toBe(true);
  });
  it('NACL rules are evaluated in rule-number order', () => {
    const m = singleWeb();
    m.internetGateways.push({ id: 'igw-main', name: 'igw', vpcId: 'vpc-main' });
    m.routeTables[0].routes.push({ destination: '0.0.0.0/0', target: 'igw-main' });
    m.networkAcls[0].entries.push({ ruleNumber: 50, egress: false, protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '198.51.100.0/24', action: 'deny' });
    const r = analyzePath(m, internet, { kind: 'instance', id: 'i-web' }, 'tcp', 80);
    expect(r.blocked?.detail).toContain('ルール 50 DENY');
  });
  it('private instances reach the Internet through a NAT Gateway in a public subnet', () => {
    const m = threeTier();
    const ok = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443);
    expect(ok.reachable).toBe(true);
    expect(ok.hops.some(h => h.component === 'NAT Gateway' && h.detail.includes('203.0.113.10'))).toBe(true);
    m.natGateways[0].subnetId = 'subnet-app-a';
    const bad = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443);
    expect(bad.blocked?.component).toBe('NAT Gateway');
    expect(bad.blocked?.detail).toContain('パブリックではありません');
  });
  it('the isolated DB subnet has no Internet route', () => {
    const r = analyzePath(threeTier(), { kind: 'instance', id: 'i-db-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443);
    expect(r.blocked?.component).toBe('Security Group');
    const m = threeTier(); m.securityGroups.find(s => s.id === 'sg-db')!.egress = [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }];
    expect(analyzePath(m, { kind: 'instance', id: 'i-db-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443).blocked?.component).toBe('Route Table');
  });
  it('an instance with a public IP in a subnet routed to NAT cannot serve the Internet (asymmetric)', () => {
    const m = singleWeb();
    m.internetGateways.push({ id: 'igw-main', name: 'igw', vpcId: 'vpc-main' });
    const r = analyzePath(m, internet, { kind: 'instance', id: 'i-web' }, 'tcp', 80);
    expect(r.blocked?.component).toBe('Route Table');
    m.routeTables[0].routes.push({ destination: '0.0.0.0/0', target: 'igw-main' });
    expect(analyzePath(m, internet, { kind: 'instance', id: 'i-web' }, 'tcp', 80).reachable).toBe(true);
    expect(analyzePath(m, internet, { kind: 'instance', id: 'i-web' }, 'tcp', 22).blocked?.component).toBe('Security Group');
  });
  it('VPC peering requires active peering and routes on both sides; no transit', () => {
    const m = threeTier();
    m.vpcs.push({ id: 'vpc-shared', name: 'shared', cidr: '10.1.0.0/16' });
    m.routeTables.push({ id: 'rtb-shared', name: 'shared-rt', vpcId: 'vpc-shared', main: true, routes: [] });
    m.networkAcls.push({ id: 'acl-shared', name: 'shared-acl', vpcId: 'vpc-shared', isDefault: true, entries: [{ ruleNumber: 100, egress: false, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' }, { ruleNumber: 100, egress: true, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' }] });
    m.subnets.push({ id: 'subnet-shared', name: 'shared-a', vpcId: 'vpc-shared', cidr: '10.1.1.0/24', az: 'ap-northeast-1a' });
    m.securityGroups.push({ id: 'sg-shared', name: 'shared-sg', vpcId: 'vpc-shared', ingress: [{ protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '10.0.0.0/16' }], egress: [] });
    m.instances.push({ id: 'i-shared', name: 'shared-api', subnetId: 'subnet-shared', privateIp: '10.1.1.10', securityGroupIds: ['sg-shared'], role: 'app', listening: [{ protocol: 'tcp', port: 443 }] });
    m.peerings.push({ id: 'pcx-1', name: 'prod-shared', requesterVpcId: 'vpc-main', accepterVpcId: 'vpc-shared', status: 'active' });
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: '10.1.0.0/16', target: 'pcx-1' });
    const oneWay = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-shared' }, 'tcp', 443);
    expect(oneWay.blocked?.direction).toBe('response');
    m.routeTables.find(r => r.id === 'rtb-shared')!.routes.push({ destination: '10.0.0.0/16', target: 'pcx-1' });
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-shared' }, 'tcp', 443).reachable).toBe(true);
    m.peerings[0].status = 'pending-acceptance';
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-shared' }, 'tcp', 443).blocked?.component).toBe('VPC Peering');
    m.vpcs[1].cidr = '10.0.0.0/16';
    expect(validateModel(m).join()).toContain('ピアリング');
  });
  it('the response path must use an active peering that connects the two VPCs', () => {
    const m = threeTier();
    for (const [n, c] of [['b', '10.1'], ['c', '10.2']]) { const v = baseVpc(n, `${c}.0.0/16`, n); m.vpcs.push(...v.vpcs); m.routeTables.push(...v.routeTables); m.networkAcls.push(...v.networkAcls); m.securityGroups.push(...v.securityGroups); }
    m.subnets.push({ id: 'subnet-b', name: 'b', vpcId: 'vpc-b', cidr: '10.1.1.0/24', az: 'ap-northeast-1a' });
    m.instances.push({ id: 'i-b', name: 'b', subnetId: 'subnet-b', privateIp: '10.1.1.10', securityGroupIds: ['sg-b-default'], role: 'app', listening: [{ protocol: 'tcp', port: 443 }] });
    m.securityGroups.find(s => s.id === 'sg-b-default')!.ingress.push({ protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '10.0.0.0/16' });
    m.peerings.push({ id: 'pcx-ab', name: 'ab', requesterVpcId: 'vpc-main', accepterVpcId: 'vpc-b', status: 'active' }, { id: 'pcx-cb', name: 'cb', requesterVpcId: 'vpc-c', accepterVpcId: 'vpc-b', status: 'active' });
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: '10.1.0.0/16', target: 'pcx-ab' });
    m.routeTables.find(r => r.id === 'rtb-b-main')!.routes.push({ destination: '10.0.0.0/16', target: 'pcx-cb' });
    const run = () => analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-b' }, 'tcp', 443);
    expect(run().blocked).toMatchObject({ direction: 'response', component: 'VPC Peering', resource: 'pcx-cb' });
    Object.assign(m.peerings[1], { requesterVpcId: 'vpc-main', status: 'pending-acceptance' });
    expect(run().blocked?.detail).toContain('承認されていません');
    m.routeTables.find(r => r.id === 'rtb-b-main')!.routes[0].target = 'pcx-ab';
    expect(run().reachable).toBe(true);
  });
  it('S3 via NAT costs money; a Gateway endpoint keeps it inside AWS', () => {
    const m = threeTier();
    const viaNat = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'service', service: 's3' }, 'tcp', 443);
    expect(viaNat.reachable).toBe(true);
    expect(viaNat.hops.some(h => h.detail.includes('データ処理料金'))).toBe(true);
    m.endpoints.push({ id: 'vpce-s3', name: 's3-endpoint', vpcId: 'vpc-main', service: 's3', type: 'Gateway', routeTableIds: ['rtb-private'] });
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: 'pl-s3', target: 'vpce-s3' });
    const viaEndpoint = analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'service', service: 's3' }, 'tcp', 443);
    expect(viaEndpoint.reachable).toBe(true);
    expect(viaEndpoint.hops.some(h => h.component === 'VPC Endpoint')).toBe(true);
    expect(viaEndpoint.hops.some(h => h.component === 'NAT Gateway')).toBe(false);
  });
  it('ALB target that does not listen is reported as unhealthy', () => {
    const m = threeTier();
    m.instances.find(i => i.id === 'i-app-a')!.listening = [];
    const r = analyzePath(m, internet, { kind: 'lb', id: 'alb-web' }, 'tcp', 443);
    expect(r.reachable).toBe(true);
    expect(r.hops.some(h => h.detail.includes('1/2'))).toBe(true);
    m.instances.find(i => i.id === 'i-app-c')!.listening = [];
    expect(analyzePath(m, internet, { kind: 'lb', id: 'alb-web' }, 'tcp', 443).reachable).toBe(false);
  });
  it('NLB preserves the client IP, so the target SG must allow the client range', () => {
    const m = threeTier();
    m.loadBalancers.push({ id: 'nlb-api', name: 'api-nlb', type: 'network', scheme: 'internet-facing', subnetIds: ['subnet-public-a'], securityGroupIds: [], listeners: [{ protocol: 'TCP', port: 443, targetPort: 8080, targetIds: ['i-app-a'] }] });
    const r = analyzePath(m, internet, { kind: 'lb', id: 'nlb-api' }, 'tcp', 443);
    expect(r.reachable).toBe(false);
    expect(r.blocked?.resource).toContain('app-sg');
    m.securityGroups.find(s => s.id === 'sg-app')!.ingress.push({ protocol: 'tcp', fromPort: 8080, toPort: 8080, cidr: '0.0.0.0/0' });
    expect(analyzePath(m, internet, { kind: 'lb', id: 'nlb-api' }, 'tcp', 443).reachable).toBe(true);
  });
  it('an internal NLB preserves the instance client IP; an ALB does not', () => {
    const m = threeTier();
    m.securityGroups.find(s => s.id === 'sg-db')!.ingress = [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, cidr: '10.0.12.0/24' }];
    m.loadBalancers.push({ id: 'nlb-db', name: 'db-nlb', type: 'network', scheme: 'internal', subnetIds: ['subnet-app-a'], securityGroupIds: [], listeners: [{ protocol: 'TCP', port: 5432, targetPort: 5432, targetIds: ['i-db-a'] }] });
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-c' }, { kind: 'lb', id: 'nlb-db' }, 'tcp', 5432).reachable).toBe(true);
    Object.assign(m.loadBalancers[1], { type: 'application', subnetIds: ['subnet-app-a', 'subnet-app-c'], securityGroupIds: ['sg-main-default'] });
    m.instances.find(i => i.id === 'i-app-c')!.securityGroupIds.push('sg-main-default');
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-c' }, { kind: 'lb', id: 'nlb-db' }, 'tcp', 5432).blocked?.resource).toContain('db-sg');
  });
  it('a load balancer listener does not serve UDP', () => {
    const r = analyzePath(threeTier(), internet, { kind: 'lb', id: 'alb-web' }, 'udp', 443);
    expect(r.blocked).toMatchObject({ component: 'Load Balancer', detail: expect.stringContaining('UDP') });
  });
  it('broken references are validation errors and never crash the analyzer', () => {
    const m = threeTier();
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: 'pl-12345', target: 'igw-main' });
    expect(validateModel(m).join()).toContain('pl-12345');
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443).summary).toContain('検証エラー');
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.pop();
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: 'pl-s3', target: 'nat-a' });
    expect(validateModel(m)).toEqual([]);
    m.subnets = m.subnets.filter(s => s.id !== 'subnet-public-a'); m.instances = m.instances.filter(i => i.id !== 'i-app-a');
    expect(validateModel(m).join()).toMatch(/nat-a.*見つかりません/);
    for (const [from, to] of [[{ kind: 'instance', id: 'i-app-c' }, internet], [internet, { kind: 'lb', id: 'alb-web' }], [{ kind: 'instance', id: 'i-app-c' }, { kind: 'lb', id: 'alb-web' }]] as const)
      expect(analyzePath(m, from, to, 'tcp', 443).reachable).toBe(false);
    m.vpcs = []; m.routeTables = m.routeTables.filter(r => r.id !== 'rtb-public');
    expect(validateModel(m).join()).toContain('ルートテーブル rtb-public が見つからない');
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-c' }, { kind: 'instance', id: 'i-db-a' }, 'tcp', 5432).reachable).toBe(false);
  });
  it('Terraform: an ALB without security_groups gets the VPC default SG', () => {
    const files = threeTierFiles(); files['compute.tf'] = files['compute.tf'].replace(/\n\s*security_groups\s*=.*/, '');
    const w = new TerraformWorkspace({ files }); w.run('init'); w.run('apply -auto-approve');
    const m = w.awsModel(); const alb = m.loadBalancers[0];
    expect(alb.securityGroupIds).toEqual([m.securityGroups.find(s => s.name === 'default')!.id]);
    expect(analyzePath(m, internet, { kind: 'lb', id: alb.id }, 'tcp', 443).blocked?.component).toBe('Security Group');
  });
  it('VPN gateway routes to on-premises only when attached and propagated', () => {
    const m = threeTier();
    m.vpnGateways.push({ id: 'vgw-1', name: 'office-vpn', vpcId: 'vpc-main', onPremCidrs: ['192.168.10.0/24'] });
    m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: '192.168.10.0/24', target: 'vgw-1' });
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'onprem', ip: '192.168.10.10' }, 'tcp', 22).reachable).toBe(true);
    m.vpnGateways[0].onPremCidrs = [];
    expect(analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'onprem', ip: '192.168.10.10' }, 'tcp', 22).blocked?.component).toBe('VPN Gateway');
  });
});

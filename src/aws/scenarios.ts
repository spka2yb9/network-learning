import { emptyModel, type AwsModel, type NaclEntry } from './model';

export const allowAllNacl = (): NaclEntry[] => [
  { ruleNumber: 100, egress: false, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' },
  { ruleNumber: 100, egress: true, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' },
];
/** Minimal VPC: main route table (local only), default NACL (allow all), default SG. */
export function baseVpc(name = 'main', cidr = '10.0.0.0/16', idSuffix = 'main'): AwsModel {
  const m = emptyModel();
  m.vpcs.push({ id: `vpc-${idSuffix}`, name, cidr });
  m.routeTables.push({ id: `rtb-${idSuffix}-main`, name: `${name}-main`, vpcId: `vpc-${idSuffix}`, main: true, routes: [] });
  m.networkAcls.push({ id: `acl-${idSuffix}-default`, name: `${name}-default-acl`, vpcId: `vpc-${idSuffix}`, isDefault: true, entries: allowAllNacl() });
  m.securityGroups.push({ id: `sg-${idSuffix}-default`, name: 'default', vpcId: `vpc-${idSuffix}`, ingress: [{ protocol: '-1', fromPort: 0, toPort: 65535, sourceSg: `sg-${idSuffix}-default` }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] });
  return m;
}
/**
 * Capstone-style three-tier network in two AZs:
 * Internet → IGW → ALB (public) → app EC2 (private) → DB (isolated), NAT Gateway for outbound updates.
 */
export function threeTier(ready = true): AwsModel {
  const m = baseVpc('prod');
  const vpcId = 'vpc-main';
  const az = ['ap-northeast-1a', 'ap-northeast-1c'];
  for (const [i, zone] of az.entries()) {
    const s = zone.slice(-1);
    m.subnets.push({ id: `subnet-public-${s}`, name: `public-${s}`, vpcId, cidr: `10.0.${i + 1}.0/24`, az: zone, routeTableId: 'rtb-public' });
    m.subnets.push({ id: `subnet-app-${s}`, name: `app-${s}`, vpcId, cidr: `10.0.${i + 11}.0/24`, az: zone, routeTableId: 'rtb-private' });
    m.subnets.push({ id: `subnet-db-${s}`, name: `db-${s}`, vpcId, cidr: `10.0.${i + 21}.0/24`, az: zone });
  }
  m.internetGateways.push({ id: 'igw-main', name: 'prod-igw', vpcId });
  m.natGateways.push({ id: 'nat-a', name: 'nat-a', subnetId: 'subnet-public-a', publicIp: '203.0.113.10' });
  m.routeTables.push({ id: 'rtb-public', name: 'public-rt', vpcId, main: false, routes: ready ? [{ destination: '0.0.0.0/0', target: 'igw-main' }] : [] });
  m.routeTables.push({ id: 'rtb-private', name: 'private-rt', vpcId, main: false, routes: [{ destination: '0.0.0.0/0', target: 'nat-a' }] });
  m.securityGroups.push(
    { id: 'sg-alb', name: 'alb-sg', vpcId, ingress: [{ protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0' }, { protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0' }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] },
    { id: 'sg-app', name: 'app-sg', vpcId, ingress: [{ protocol: 'tcp', fromPort: 8080, toPort: 8080, sourceSg: 'sg-alb' }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] },
    { id: 'sg-db', name: 'db-sg', vpcId, ingress: [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, sourceSg: 'sg-app' }], egress: [] },
  );
  m.instances.push(
    { id: 'i-app-a', name: 'app-a', subnetId: 'subnet-app-a', privateIp: '10.0.11.10', securityGroupIds: ['sg-app'], role: 'app', listening: [{ protocol: 'tcp', port: 8080 }] },
    { id: 'i-app-c', name: 'app-c', subnetId: 'subnet-app-c', privateIp: '10.0.12.10', securityGroupIds: ['sg-app'], role: 'app', listening: [{ protocol: 'tcp', port: 8080 }] },
    { id: 'i-db-a', name: 'db-primary', subnetId: 'subnet-db-a', privateIp: '10.0.21.10', securityGroupIds: ['sg-db'], role: 'db', listening: [{ protocol: 'tcp', port: 5432 }] },
  );
  m.loadBalancers.push({ id: 'alb-web', name: 'web-alb', type: 'application', scheme: 'internet-facing', subnetIds: ['subnet-public-a', 'subnet-public-c'], securityGroupIds: ['sg-alb'],
    listeners: [{ protocol: 'HTTPS', port: 443, targetPort: 8080, targetIds: ['i-app-a', 'i-app-c'] }, { protocol: 'HTTP', port: 80, targetPort: 8080, targetIds: ['i-app-a', 'i-app-c'] }] });
  return m;
}
/** A single public web server — the smallest "Public Subnet" lesson. Not `ready`: no IGW yet (the lab's starting point). */
export function singleWeb(ready = false): AwsModel {
  const m = baseVpc('lab');
  if (ready) { m.internetGateways.push({ id: 'igw-main', name: 'lab-igw', vpcId: 'vpc-main' }); m.routeTables[0].routes.push({ destination: '0.0.0.0/0', target: 'igw-main' }); }
  m.subnets.push({ id: 'subnet-web', name: 'web-subnet', vpcId: 'vpc-main', cidr: '10.0.1.0/24', az: 'ap-northeast-1a' });
  m.securityGroups.push({ id: 'sg-web', name: 'web-sg', vpcId: 'vpc-main', ingress: [{ protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0' }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] });
  m.instances.push({ id: 'i-web', name: 'web', subnetId: 'subnet-web', privateIp: '10.0.1.10', publicIp: '198.51.100.20', securityGroupIds: ['sg-web'], role: 'web', listening: [{ protocol: 'tcp', port: 80 }] });
  return m;
}

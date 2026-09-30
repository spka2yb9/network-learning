import { describe, expect, it } from 'vitest';
import { awsLayout, layoutProblems } from './awsLayout';
import { baseVpc, singleWeb, threeTier } from '../../aws/scenarios';
import { emptyModel, type AwsModel } from '../../aws/model';
import { awsLabs, terraformLabs } from '../../labs/cloud';
import { TerraformWorkspace } from '../../terraform/engine';

function crowded(): AwsModel {
  const m = threeTier();
  for (let i = 0; i < 5; i++) m.loadBalancers.push({ ...structuredClone(m.loadBalancers[0]), id: `alb-extra-${i}`, name: `extra-${i}-with-a-rather-long-load-balancer-name` });
  for (let i = 0; i < 4; i++) m.instances.push({ id: `i-many-${i}`, name: `worker-${i}`, subnetId: 'subnet-app-a', privateIp: `10.0.11.${20 + i}`, securityGroupIds: ['sg-app'], role: 'app', listening: [] });
  m.endpoints.push({ id: 'vpce-s3', name: 's3-endpoint', vpcId: 'vpc-main', service: 's3', type: 'Gateway', routeTableIds: ['rtb-private'] });
  m.vpnGateways.push({ id: 'vgw-1', name: 'office-vgw', vpcId: 'vpc-main', onPremCidrs: ['192.168.10.0/24', '192.168.20.0/24'] });
  const other = baseVpc('shared', '10.1.0.0/16', 'shared');
  m.vpcs.push(...other.vpcs); m.routeTables.push(...other.routeTables); m.networkAcls.push(...other.networkAcls); m.securityGroups.push(...other.securityGroups);
  m.subnets.push({ id: 'subnet-shared-a', name: 'shared-a', vpcId: 'vpc-shared', cidr: '10.1.1.0/24', az: 'ap-northeast-1a' });
  m.peerings.push({ id: 'pcx-1', name: 'prod-shared', requesterVpcId: 'vpc-main', accepterVpcId: 'vpc-shared', status: 'pending-acceptance' });
  m.internetGateways.push({ id: 'igw-spare', name: 'spare-igw' });
  return m;
}
const models: [string, () => AwsModel][] = [
  ['empty', emptyModel], ['base', () => baseVpc()], ['singleWeb', singleWeb], ['threeTier', () => threeTier()], ['threeTier (no IGW route)', () => threeTier(false)], ['crowded', crowded],
  ...awsLabs.flatMap(l => [[`${l.id} start`, () => l.build()], [`${l.id} solved`, () => { const m = l.build(); l.solve(m); return m; }]] as [string, () => AwsModel][]),
  ...terraformLabs.map(l => [`${l.id} solved`, () => { const ws = new TerraformWorkspace(l.build()); l.solve(ws); return ws.awsModel(); }] as [string, () => AwsModel]),
];

describe('AWS diagram layout never lets nodes cover each other', () => {
  for (const [name, build] of models) it(name, () => {
    const { nodes, edges } = awsLayout(build());
    expect(layoutProblems(nodes)).toEqual([]);
    // Every edge endpoint exists, and only peering edges carry a text label (which sits in the gap between VPCs).
    const ids = new Set(nodes.map(n => n.id));
    for (const e of edges) { expect(ids.has(e.source) && ids.has(e.target)).toBe(true); if (e.label) expect(e.id.startsWith('e-pcx')).toBe(true); }
    // Group labels are drawn above edges and resources above group backgrounds.
    for (const n of nodes) { if (n.type === 'header') expect(n.zIndex).toBeGreaterThan(40); if (n.type === 'res') expect(n.zIndex).toBe(40); }
  });
});

import { useState } from 'react';
import { aws } from '../../application/CloudController';
import { byId, reservedAddresses, subnetExposure, usableHosts, type AwsModel, type AwsProtocol, type Instance, type SgRule } from '../../aws/model';
import { useUI } from '../../stores/ui';
import { Icon } from '../Icon';
import { RemoveButton, Section } from '../TopologyEditor/properties/common';

const rid = (prefix: string) => `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
const AZS = ['ap-northeast-1a', 'ap-northeast-1c', 'ap-northeast-1d'];
type Kind = 'vpc' | 'subnet' | 'rt' | 'igw' | 'nat' | 'sg' | 'nacl' | 'ec2' | 'lb' | 'pcx' | 'vpce' | 'vgw';
export const resourceKinds: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'vpc', label: 'VPC', hint: 'AWSの中に作る、自分専用の仮想ネットワーク' },
  { kind: 'subnet', label: 'Subnet', hint: 'VPCのアドレス範囲を分けたもの。必ず1つのAZに属します' },
  { kind: 'rt', label: 'Route Table', hint: 'サブネットから出るパケットの行き先を決める経路表' },
  { kind: 'igw', label: 'Internet Gateway', hint: 'VPCとインターネットをつなぐ出入口。1つのVPCに1つ付けます' },
  { kind: 'nat', label: 'NAT Gateway', hint: 'プライベートサブネットからインターネットへ出るための中継役。外から始まる接続は通しません' },
  { kind: 'sg', label: 'Security Group', hint: 'インスタンスなどに付けるステートフルなファイアウォール。許可ルールだけを書きます' },
  { kind: 'nacl', label: 'Network ACL', hint: 'サブネットの境界で働くステートレスなフィルタ。許可と拒否を番号順に評価します' },
  { kind: 'ec2', label: 'EC2', hint: 'AWSの仮想サーバー（インスタンス）' },
  { kind: 'lb', label: 'Load Balancer', hint: '届いた通信を複数のインスタンスに振り分けます（ALB / NLB）' },
  { kind: 'pcx', label: 'VPC Peering', hint: '2つのVPCを1対1でつなぎます（VPCが2つ必要）' },
  { kind: 'vpce', label: 'VPC Endpoint', hint: 'インターネットを通らずに S3 / DynamoDB へ届けるための部品（Gateway型）' },
  { kind: 'vgw', label: 'VPN Gateway', hint: 'オンプレミスとVPNでつなぐときの、VPC側の出入口（仮想プライベートゲートウェイ）' },
];
/** Add a resource with safe defaults; the learner then edits it. */
export function addResource(kind: Kind) {
  let created = '';
  aws.mutate(m => {
    const vpc = m.vpcs[0];
    const need = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
    switch (kind) {
      case 'vpc': { const n = m.vpcs.length; const id = rid('vpc'); m.vpcs.push({ id, name: `vpc-${n + 1}`, cidr: `10.${n * 10 + 20}.0.0/16` }); m.routeTables.push({ id: rid('rtb'), name: `vpc-${n + 1}-main`, vpcId: id, main: true, routes: [] }); m.networkAcls.push({ id: rid('acl'), name: `vpc-${n + 1}-default-acl`, vpcId: id, isDefault: true, entries: [{ ruleNumber: 100, egress: false, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' }, { ruleNumber: 100, egress: true, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' }] }); created = id; break; }
      case 'subnet': { need(vpc, '先にVPCを作成してください（左の「VPC」ボタン）'); const base = vpc.cidr.split('.').slice(0, 2).join('.'); const used = new Set(m.subnets.map(s => s.cidr)); let i = 1; while (used.has(`${base}.${i}.0/24`)) i++; created = rid('subnet'); m.subnets.push({ id: created, name: `subnet-${i}`, vpcId: vpc.id, cidr: `${base}.${i}.0/24`, az: AZS[(i - 1) % 2] }); break; }
      case 'rt': need(vpc, '先にVPCを作成してください（左の「VPC」ボタン）'); created = rid('rtb'); m.routeTables.push({ id: created, name: `rt-${m.routeTables.length + 1}`, vpcId: vpc.id, main: false, routes: [] }); break;
      case 'igw': created = rid('igw'); m.internetGateways.push({ id: created, name: `igw-${m.internetGateways.length + 1}`, vpcId: m.vpcs.find(v => !m.internetGateways.some(g => g.vpcId === v.id))?.id }); break;
      case 'nat': need(m.subnets[0], '先にサブネットを作成してください（左の「Subnet」ボタン）'); created = rid('nat'); m.natGateways.push({ id: created, name: `nat-${m.natGateways.length + 1}`, subnetId: (m.subnets.find(s => subnetExposure(m, s).public) ?? m.subnets[0]).id, publicIp: `203.0.113.${20 + m.natGateways.length}` }); break;
      case 'sg': need(vpc, '先にVPCを作成してください（左の「VPC」ボタン）'); created = rid('sg'); m.securityGroups.push({ id: created, name: `sg-${m.securityGroups.length + 1}`, vpcId: vpc.id, ingress: [], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] }); break;
      case 'nacl': need(vpc, '先にVPCを作成してください（左の「VPC」ボタン）'); created = rid('acl'); m.networkAcls.push({ id: created, name: `acl-${m.networkAcls.length + 1}`, vpcId: vpc.id, isDefault: false, entries: [] }); break;
      case 'ec2': { const s = m.subnets[0]; need(s, '先にサブネットを作成してください（左の「Subnet」ボタン）'); const prefix = s.cidr.split('.').slice(0, 3).join('.'); const used = new Set(m.instances.map(i => i.privateIp)); let h = 10; while (used.has(`${prefix}.${h}`)) h++; created = rid('i'); m.instances.push({ id: created, name: `ec2-${m.instances.length + 1}`, subnetId: s.id, privateIp: `${prefix}.${h}`, securityGroupIds: m.securityGroups.filter(g => g.vpcId === s.vpcId).slice(0, 1).map(g => g.id), role: 'app', listening: [{ protocol: 'tcp', port: 8080 }] }); break; }
      case 'lb': { const subs = m.subnets.slice(0, 2); need(subs.length, '先にサブネットを作成してください（左の「Subnet」ボタン）'); created = rid('alb'); m.loadBalancers.push({ id: created, name: `alb-${m.loadBalancers.length + 1}`, type: 'application', scheme: 'internet-facing', subnetIds: subs.map(s => s.id), securityGroupIds: [], listeners: [{ protocol: 'HTTPS', port: 443, targetPort: 8080, targetIds: [] }] }); break; }
      case 'pcx': need(m.vpcs.length >= 2, 'VPC Peering にはVPCが2つ必要です。先にもう1つVPCを追加してください'); created = rid('pcx'); m.peerings.push({ id: created, name: `peering-${m.peerings.length + 1}`, requesterVpcId: m.vpcs[0].id, accepterVpcId: m.vpcs[1].id, status: 'active' }); break;
      case 'vpce': need(vpc, '先にVPCを作成してください（左の「VPC」ボタン）'); created = rid('vpce'); m.endpoints.push({ id: created, name: `s3-endpoint-${m.endpoints.length + 1}`, vpcId: vpc.id, service: 's3', type: 'Gateway', routeTableIds: [] }); break;
      case 'vgw': created = rid('vgw'); m.vpnGateways.push({ id: created, name: `vgw-${m.vpnGateways.length + 1}`, vpcId: vpc?.id, onPremCidrs: ['192.168.10.0/24'] }); break;
    }
  });
  return created;
}
const F = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="aws-field">{label}{children}</label>;
// While the learner is typing, the CIDR may be invalid; the error list explains it, so this note must not throw.
const hostsNote = (c: string) => { try { return `インスタンスに使えるアドレスは ${usableHosts(c)} 個です（${reservedAddresses(c).join(', ')} はAWSが予約）。`; } catch { return 'CIDRの形式が正しくありません（例: 10.0.1.0/24）。'; } };
const Input = ({ value, onChange, aria, type = 'text' }: { value: string | number; onChange: (v: string) => void; aria: string; type?: string }) => {
  const [draft, setDraft] = useState(String(value));
  return <input aria-label={aria} type={type} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== String(value)) onChange(draft); }} onKeyDown={e => { if (e.key === 'Enter') onChange(draft); }}/>;
};
function MultiCheck({ options, value, onChange }: { options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="multi-check">{options.map(o => <label key={o.id} className="check"><input type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(v => v !== o.id))}/>{o.label}</label>)}</div>;
}
function SgRules({ rules, onChange, sgs, title }: { rules: SgRule[]; onChange: (r: SgRule[]) => void; sgs: { id: string; name: string }[]; title: string }) {
  const [draft, setDraft] = useState<{ protocol: AwsProtocol; from: string; to: string; source: string }>({ protocol: 'tcp', from: '443', to: '443', source: '0.0.0.0/0' });
  return <div className="rule-block"><strong className="small-title">{title}</strong>
    <ol className="rule-list">{rules.map((r, i) => <li key={i}><code>{r.protocol === '-1' ? 'All' : r.protocol} {r.protocol === 'tcp' || r.protocol === 'udp' ? `${r.fromPort}-${r.toPort}` : ''} {r.cidr ?? sgs.find(g => g.id === r.sourceSg)?.name ?? r.sourceSg}</code><RemoveButton label="ルールを削除" onClick={() => onChange(rules.filter((_, j) => j !== i))}/></li>)}{!rules.length && <li className="implicit">（ルールなし = すべて拒否）</li>}</ol>
    <div className="rule-add"><select aria-label="プロトコル" value={draft.protocol} onChange={e => setDraft({ ...draft, protocol: e.target.value as AwsProtocol })}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option><option value="-1">All</option></select>
      <input aria-label="開始ポート" className="narrow" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })}/><input aria-label="終了ポート" className="narrow" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })}/>
      <select aria-label="送信元の種類" value={draft.source.startsWith('sg-') ? draft.source : 'cidr'} onChange={e => setDraft({ ...draft, source: e.target.value === 'cidr' ? '0.0.0.0/0' : e.target.value })}><option value="cidr">CIDR</option>{sgs.map(g => <option key={g.id} value={g.id}>SG: {g.name}</option>)}</select>
      {!draft.source.startsWith('sg-') && <input aria-label="CIDR" value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })}/>}
      <button type="button" className="button small secondary" onClick={() => onChange([...rules, { protocol: draft.protocol, fromPort: Number(draft.from) || 0, toPort: Number(draft.to) || 0, ...(draft.source.startsWith('sg-') ? { sourceSg: draft.source } : { cidr: draft.source }) }])}><Icon name="plus" size={12}/>追加</button></div></div>;
}
/** Edit the resource with this id (any type). */
export function ResourceForm({ id }: { id: string }) {
  useUI(s => s.revision);
  const m = aws.model;
  const set = (fn: (m: AwsModel) => void) => aws.mutate(fn);
  const del = (fn: (m: AwsModel) => void) => { set(fn); aws.selected = ''; useUI.getState().changed(); };
  const vpcOpts = m.vpcs.map(v => <option key={v.id} value={v.id}>{v.name}</option>);
  const vpc = byId(m.vpcs, id); const sub = byId(m.subnets, id); const rt = byId(m.routeTables, id); const igw = byId(m.internetGateways, id); const nat = byId(m.natGateways, id);
  const sg = byId(m.securityGroups, id); const acl = byId(m.networkAcls, id); const ec2 = byId(m.instances, id); const lb = byId(m.loadBalancers, id); const pcx = byId(m.peerings, id); const vpce = byId(m.endpoints, id); const vgw = byId(m.vpnGateways, id);
  const targets = [...m.internetGateways.map(g => ({ id: g.id, label: `IGW ${g.name}` })), ...m.natGateways.map(n => ({ id: n.id, label: `NAT ${n.name}` })), ...m.peerings.map(p => ({ id: p.id, label: `Peering ${p.name}` })), ...m.endpoints.map(e => ({ id: e.id, label: `Endpoint ${e.name}` })), ...m.vpnGateways.map(g => ({ id: g.id, label: `VGW ${g.name}` }))];
  const [route, setRoute] = useState({ destination: '0.0.0.0/0', target: '' });
  const [entry, setEntry] = useState({ n: '100', egress: 'false', protocol: 'tcp' as AwsProtocol, from: '443', to: '443', cidr: '0.0.0.0/0', action: 'allow' });
  if (vpc) return <div className="aws-form"><h4>VPC</h4><F label="名前"><Input aria="VPC名" value={vpc.name} onChange={v => set(x => { byId(x.vpcs, id)!.name = v; })}/></F><F label="CIDR（/16〜/28）"><Input aria="VPC CIDR" value={vpc.cidr} onChange={v => set(x => { byId(x.vpcs, id)!.cidr = v; })}/></F>
    <p className="tiny muted">VPC全体のアドレス範囲です。後でほかのVPCや社内とつなぐときに困らないよう、重ならない範囲を選びます（例: 10.0.0.0/16）。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.vpcs = x.vpcs.filter(v => v.id !== id); x.routeTables = x.routeTables.filter(r => r.vpcId !== id); x.networkAcls = x.networkAcls.filter(a => a.vpcId !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (sub) { const exp = subnetExposure(m, sub); return <div className="aws-form"><h4>Subnet <span className={`tag-mini ${exp.public ? '' : 'warn'}`}>{exp.public ? 'Public' : 'Private'}</span></h4><p className="tiny muted">{exp.reason}</p>
    <F label="名前"><Input aria="サブネット名" value={sub.name} onChange={v => set(x => { byId(x.subnets, id)!.name = v; })}/></F><F label="VPC"><select value={sub.vpcId} onChange={e => set(x => { byId(x.subnets, id)!.vpcId = e.target.value; })}>{vpcOpts}</select></F>
    <F label="CIDR"><Input aria="サブネットCIDR" value={sub.cidr} onChange={v => set(x => { byId(x.subnets, id)!.cidr = v; })}/></F><p className="tiny muted">{hostsNote(sub.cidr)}</p>
    <F label="AZ（Availability Zone）"><select value={sub.az} onChange={e => set(x => { byId(x.subnets, id)!.az = e.target.value; })}>{AZS.map(a => <option key={a}>{a}</option>)}</select></F>
    <F label="ルートテーブル"><select aria-label="関連付けるルートテーブル" value={sub.routeTableId ?? ''} onChange={e => set(x => { byId(x.subnets, id)!.routeTableId = e.target.value || undefined; })}><option value="">メインルートテーブル（明示的な関連付けなし）</option>{m.routeTables.filter(r => r.vpcId === sub.vpcId && !r.main).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></F>
    <F label="ネットワークACL"><select aria-label="関連付けるNACL" value={sub.naclId ?? ''} onChange={e => set(x => { byId(x.subnets, id)!.naclId = e.target.value || undefined; })}><option value="">デフォルトNACL</option>{m.networkAcls.filter(a => a.vpcId === sub.vpcId && !a.isDefault).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></F>
    <button className="button small text-danger" onClick={() => del(x => { x.subnets = x.subnets.filter(s => s.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>; }
  if (rt) return <div className="aws-form"><h4>Route Table {rt.main && <span className="tag-mini">main</span>}</h4><F label="名前"><Input aria="ルートテーブル名" value={rt.name} onChange={v => set(x => { byId(x.routeTables, id)!.name = v; })}/></F>
    <table className="mini-table"><tbody><tr><td>{m.vpcs.find(v => v.id === rt.vpcId)?.cidr}</td><td>local</td><td className="muted tiny">（自動で作られ、削除できません）</td></tr>{rt.routes.map((r, i) => <tr key={i}><td>{r.destination}</td><td>{targets.find(t => t.id === r.target)?.label ?? r.target}</td><td><RemoveButton label={`${r.destination} を削除`} onClick={() => set(x => { byId(x.routeTables, id)!.routes.splice(i, 1); })}/></td></tr>)}</tbody></table>
    <div className="rule-add"><input aria-label="宛先CIDR" value={route.destination} onChange={e => setRoute({ ...route, destination: e.target.value })}/><select aria-label="ターゲット" value={route.target} onChange={e => setRoute({ ...route, target: e.target.value })}><option value="">ターゲットを選択</option>{targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      <button className="button small secondary" onClick={() => set(x => { if (!route.target) throw new Error('経路の送り先（ターゲット）を選んでください'); byId(x.routeTables, id)!.routes.push({ ...route }); })}><Icon name="plus" size={12}/>経路を追加</button></div>
    <p className="tiny muted">宛先CIDRとターゲット（送り先の部品）を選んで経路を追加します。宛先に一致する経路が複数あれば、いちばん長く一致するもの（Longest Prefix Match）が使われます。</p>
    <p className="tiny muted">サブネットとの関連付けは、各サブネットの設定で選びます。このルートテーブルを使っているサブネット: {m.subnets.filter(s => s.routeTableId === id || (!s.routeTableId && rt.main && s.vpcId === rt.vpcId)).map(s => s.name).join(', ') || 'なし'}</p>
    {!rt.main && <button className="button small text-danger" onClick={() => del(x => { x.routeTables = x.routeTables.filter(r => r.id !== id); x.subnets.forEach(s => { if (s.routeTableId === id) s.routeTableId = undefined; }); })}><Icon name="trash" size={14}/>削除</button>}</div>;
  if (igw) return <div className="aws-form"><h4>Internet Gateway</h4><F label="名前"><Input aria="IGW名" value={igw.name} onChange={v => set(x => { byId(x.internetGateways, id)!.name = v; })}/></F><F label="アタッチ先VPC"><select aria-label="IGWのアタッチ先" value={igw.vpcId ?? ''} onChange={e => set(x => { byId(x.internetGateways, id)!.vpcId = e.target.value || undefined; })}><option value="">（デタッチ: どのVPCにも付けない）</option>{vpcOpts}</select></F>
    <p className="tiny muted">VPCに付けただけでは、サブネットはパブリックになりません。サブネットのルートテーブルに「0.0.0.0/0 → このIGW」の経路を追加し、インスタンスにパブリックIPを付けると、インターネットと直接通信できます（SGとNACLの許可も必要です）。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.internetGateways = x.internetGateways.filter(g => g.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (nat) return <div className="aws-form"><h4>NAT Gateway</h4><F label="名前"><Input aria="NAT名" value={nat.name} onChange={v => set(x => { byId(x.natGateways, id)!.name = v; })}/></F><F label="配置サブネット"><select aria-label="NATの配置サブネット" value={nat.subnetId} onChange={e => set(x => { byId(x.natGateways, id)!.subnetId = e.target.value; })}>{m.subnets.map(s => <option key={s.id} value={s.id}>{s.name} ({subnetExposure(m, s).public ? 'Public' : 'Private'})</option>)}</select></F>
    <F label="Elastic IP（固定のパブリックIP）"><Input aria="Elastic IP" value={nat.publicIp ?? ''} onChange={v => set(x => { byId(x.natGateways, id)!.publicIp = v || undefined; })}/></F>
    <p className="tiny muted">NAT Gatewayはパブリックサブネットに置き、Elastic IPを付けます。使うときは、プライベートサブネットのルートテーブルに「0.0.0.0/0 → このNAT」の経路を追加します。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.natGateways = x.natGateways.filter(n => n.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (sg) return <div className="aws-form"><h4>Security Group <span className="tag-mini">stateful</span></h4><F label="名前"><Input aria="SG名" value={sg.name} onChange={v => set(x => { byId(x.securityGroups, id)!.name = v; })}/></F>
    <SgRules title="インバウンド（入ってくる通信・許可のみ）" rules={sg.ingress} sgs={m.securityGroups} onChange={r => set(x => { byId(x.securityGroups, id)!.ingress = r; })}/>
    <SgRules title="アウトバウンド（出ていく通信・許可のみ）" rules={sg.egress} sgs={m.securityGroups} onChange={r => set(x => { byId(x.securityGroups, id)!.egress = r; })}/>
    <p className="tiny muted">SGはステートフル（通信の状態を覚える）です。許可した通信の戻りは、反対方向のルールがなくても通ります。ルールは順番に関係なくすべて評価され、どれにも一致しない通信は拒否されます。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.securityGroups = x.securityGroups.filter(g => g.id !== id); x.instances.forEach(i => { i.securityGroupIds = i.securityGroupIds.filter(g => g !== id); }); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (acl) return <div className="aws-form"><h4>Network ACL <span className="tag-mini warn">stateless</span></h4><F label="名前"><Input aria="NACL名" value={acl.name} onChange={v => set(x => { byId(x.networkAcls, id)!.name = v; })}/></F>
    {(['false', 'true'] as const).map(eg => <div key={eg} className="rule-block"><strong className="small-title">{eg === 'false' ? 'インバウンド' : 'アウトバウンド'}（番号の小さい順に評価し、最初に一致したルールで決定）</strong><table className="mini-table"><tbody>{acl.entries.filter(e => String(e.egress) === eg).sort((a, b) => a.ruleNumber - b.ruleNumber).map(e => <tr key={`${e.ruleNumber}`}><td>{e.ruleNumber}</td><td>{e.protocol === '-1' ? 'All' : e.protocol}</td><td>{e.protocol === 'tcp' || e.protocol === 'udp' ? `${e.fromPort}-${e.toPort}` : ''}</td><td>{e.cidr}</td><td className={e.action === 'deny' ? 'deny' : 'allow'}>{e.action}</td><td><RemoveButton label="エントリを削除" onClick={() => set(x => { const a = byId(x.networkAcls, id)!; a.entries = a.entries.filter(y => !(y.egress === e.egress && y.ruleNumber === e.ruleNumber)); })}/></td></tr>)}<tr><td>*</td><td>All</td><td/><td>0.0.0.0/0</td><td className="deny">deny</td><td/></tr></tbody></table></div>)}
    <div className="rule-add"><input aria-label="ルール番号" className="narrow" value={entry.n} onChange={e => setEntry({ ...entry, n: e.target.value })}/><select aria-label="方向" value={entry.egress} onChange={e => setEntry({ ...entry, egress: e.target.value })}><option value="false">IN</option><option value="true">OUT</option></select>
      <select aria-label="NACLプロトコル" value={entry.protocol} onChange={e => setEntry({ ...entry, protocol: e.target.value as AwsProtocol })}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option><option value="-1">All</option></select>
      <input aria-label="NACL開始ポート" className="narrow" value={entry.from} onChange={e => setEntry({ ...entry, from: e.target.value })}/><input aria-label="NACL終了ポート" className="narrow" value={entry.to} onChange={e => setEntry({ ...entry, to: e.target.value })}/>
      <input aria-label="NACL CIDR" value={entry.cidr} onChange={e => setEntry({ ...entry, cidr: e.target.value })}/><select aria-label="許可/拒否" value={entry.action} onChange={e => setEntry({ ...entry, action: e.target.value })}><option value="allow">allow</option><option value="deny">deny</option></select>
      <button className="button small secondary" onClick={() => set(x => { const list = byId(x.networkAcls, id)!.entries; if (list.some(e => e.ruleNumber === Number(entry.n) && String(e.egress) === entry.egress)) throw new Error(`ルール番号 ${entry.n} はすでに使われています（AWSでも、同じ向きで番号は重複できません）`); list.push({ ruleNumber: Number(entry.n), egress: entry.egress === 'true', protocol: entry.protocol, fromPort: Number(entry.from) || 0, toPort: Number(entry.to) || 0, cidr: entry.cidr, action: entry.action as 'allow' | 'deny' }); })}><Icon name="plus" size={12}/>追加</button></div>
    <p className="tiny muted">NACLはステートレス（通信の状態を覚えない）です。戻りの通信も、反対方向のルールで許可が必要です。戻りの宛先は、接続を始めた側が一時的に選ぶエフェメラルポートなので、1024-65535 を許可するのが一般的です。最後の * は、どのルールにも一致しなかった通信を拒否する既定のルールです。</p>
    {!acl.isDefault && <button className="button small text-danger" onClick={() => del(x => { x.networkAcls = x.networkAcls.filter(a => a.id !== id); x.subnets.forEach(s => { if (s.naclId === id) s.naclId = undefined; }); })}><Icon name="trash" size={14}/>削除</button>}</div>;
  if (ec2) return <div className="aws-form"><h4>EC2</h4><F label="名前"><Input aria="インスタンス名" value={ec2.name} onChange={v => set(x => { byId(x.instances, id)!.name = v; })}/></F>
    <F label="サブネット"><select aria-label="インスタンスのサブネット" value={ec2.subnetId} onChange={e => set(x => { byId(x.instances, id)!.subnetId = e.target.value; })}>{m.subnets.map(s => <option key={s.id} value={s.id}>{s.name} {s.cidr}</option>)}</select></F>
    <F label="プライベートIP"><Input aria="プライベートIP" value={ec2.privateIp} onChange={v => set(x => { byId(x.instances, id)!.privateIp = v; })}/></F>
    <F label="パブリックIP / EIP（空欄 = なし）"><Input aria="パブリックIP" value={ec2.publicIp ?? ''} onChange={v => set(x => { byId(x.instances, id)!.publicIp = v || undefined; })}/></F>
    <F label="役割（Role）"><select aria-label="役割" value={ec2.role} onChange={e => set(x => { const i = byId(x.instances, id)!; i.role = e.target.value as Instance['role']; })}>{['web', 'app', 'db', 'bastion', 'generic'].map(r => <option key={r}>{r}</option>)}</select></F>
    <F label="OSが待ち受けるポート（例: tcp/8080, tcp/22）"><Input aria="待ち受けポート" value={ec2.listening.map(l => `${l.protocol}/${l.port}`).join(', ')} onChange={v => set(x => { byId(x.instances, id)!.listening = v.split(',').map(t => t.trim()).filter(Boolean).map(t => { const [p, port] = t.includes('/') ? t.split('/') : ['tcp', t]; return { protocol: p === 'udp' ? 'udp' : 'tcp', port: Number(port) }; }); })}/></F>
    <F label="セキュリティグループ"><MultiCheck options={m.securityGroups.filter(g => g.vpcId === byId(m.subnets, ec2.subnetId)?.vpcId).map(g => ({ id: g.id, label: g.name }))} value={ec2.securityGroupIds} onChange={v => set(x => { byId(x.instances, id)!.securityGroupIds = v; })}/></F>
    <button className="button small text-danger" onClick={() => del(x => { x.instances = x.instances.filter(i => i.id !== id); x.loadBalancers.forEach(l => l.listeners.forEach(li => { li.targetIds = li.targetIds.filter(t => t !== id); })); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (lb) return <div className="aws-form"><h4>Load Balancer</h4><F label="名前"><Input aria="LB名" value={lb.name} onChange={v => set(x => { byId(x.loadBalancers, id)!.name = v; })}/></F>
    <F label="種類"><select value={lb.type} onChange={e => set(x => { byId(x.loadBalancers, id)!.type = e.target.value as 'application' | 'network'; })}><option value="application">ALB（L7・HTTP / HTTPS）</option><option value="network">NLB（L4・TCP / UDP、クライアントIPを保持）</option></select></F>
    <F label="スキーム"><select value={lb.scheme} onChange={e => set(x => { byId(x.loadBalancers, id)!.scheme = e.target.value as 'internet-facing' | 'internal'; })}><option value="internet-facing">internet-facing（インターネットから受ける）</option><option value="internal">internal（VPCの中だけ）</option></select></F>
    <F label="サブネット（AZごとに1つ。ALBは2つ以上のAZが必要）"><MultiCheck options={m.subnets.map(s => ({ id: s.id, label: `${s.name} (${s.az.slice(-1)})` }))} value={lb.subnetIds} onChange={v => set(x => { byId(x.loadBalancers, id)!.subnetIds = v; })}/></F>
    <F label="セキュリティグループ"><MultiCheck options={m.securityGroups.map(g => ({ id: g.id, label: g.name }))} value={lb.securityGroupIds} onChange={v => set(x => { byId(x.loadBalancers, id)!.securityGroupIds = v; })}/></F>
    {lb.listeners.map((l, i) => <div key={i} className="rule-block"><strong className="small-title">リスナー {l.protocol} :{l.port} → ターゲット :{l.targetPort}</strong><p className="tiny muted">左がLBで受けるポート、右が転送先（ターゲット）のポートです。下で転送先のインスタンスを選びます。</p>
      <div className="rule-add"><input aria-label="リスナーポート" className="narrow" defaultValue={l.port} onBlur={e => { if (Number(e.target.value) !== l.port) set(x => { byId(x.loadBalancers, id)!.listeners[i].port = Number(e.target.value); }); }}/><input aria-label="ターゲットポート" className="narrow" defaultValue={l.targetPort} onBlur={e => { if (Number(e.target.value) !== l.targetPort) set(x => { byId(x.loadBalancers, id)!.listeners[i].targetPort = Number(e.target.value); }); }}/></div>
      <MultiCheck options={m.instances.map(t => ({ id: t.id, label: t.name }))} value={l.targetIds} onChange={v => set(x => { byId(x.loadBalancers, id)!.listeners[i].targetIds = v; })}/></div>)}
    <button className="button small text-danger" onClick={() => del(x => { x.loadBalancers = x.loadBalancers.filter(l => l.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (pcx) return <div className="aws-form"><h4>VPC Peering</h4><F label="名前"><Input aria="ピアリング名" value={pcx.name} onChange={v => set(x => { byId(x.peerings, id)!.name = v; })}/></F>
    <F label="リクエスタ（申請する側）"><select value={pcx.requesterVpcId} onChange={e => set(x => { byId(x.peerings, id)!.requesterVpcId = e.target.value; })}>{vpcOpts}</select></F><F label="アクセプタ（承認する側）"><select value={pcx.accepterVpcId} onChange={e => set(x => { byId(x.peerings, id)!.accepterVpcId = e.target.value; })}>{vpcOpts}</select></F>
    <F label="状態"><select aria-label="ピアリングの状態" value={pcx.status} onChange={e => set(x => { byId(x.peerings, id)!.status = e.target.value as 'active' | 'pending-acceptance'; })}><option value="pending-acceptance">pending-acceptance（承認待ち・通信できない）</option><option value="active">active（承認済み）</option></select></F>
    <p className="tiny muted">通信するには、状態を active にしたうえで、両方のVPCのルートテーブルに「相手VPCのCIDR → このピアリング」の経路を追加します。片側だけでは返事が戻りません。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.peerings = x.peerings.filter(p => p.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (vpce) return <div className="aws-form"><h4>VPC Endpoint（Gateway）</h4><F label="サービス"><select value={vpce.service} onChange={e => set(x => { const ep = byId(x.endpoints, id)!; ep.service = e.target.value as 's3' | 'dynamodb'; x.routeTables.forEach(r => r.routes.forEach(y => { if (y.target === id) y.destination = `pl-${ep.service}`; })); })}><option value="s3">S3</option><option value="dynamodb">DynamoDB</option></select></F>
    <F label="経路を追加するルートテーブル"><MultiCheck options={m.routeTables.filter(r => r.vpcId === vpce.vpcId).map(r => ({ id: r.id, label: r.name }))} value={vpce.routeTableIds} onChange={v => set(x => { const e = byId(x.endpoints, id)!; e.routeTableIds = v; for (const r of x.routeTables.filter(t => t.vpcId === e.vpcId)) { r.routes = r.routes.filter(y => y.target !== id); if (v.includes(r.id)) r.routes.push({ destination: `pl-${e.service}`, target: id }); } })}/></F>
    <p className="tiny muted">選んだルートテーブルに、サービス宛ての経路（宛先はプレフィックスリスト pl-…）が自動で追加されます。そのサブネットからは、NATやインターネットを通らずにサービスへ届きます。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.endpoints = x.endpoints.filter(e => e.id !== id); x.routeTables.forEach(r => { r.routes = r.routes.filter(y => y.target !== id); }); })}><Icon name="trash" size={14}/>削除</button></div>;
  if (vgw) return <div className="aws-form"><h4>VPN Gateway</h4><F label="アタッチ先VPC"><select value={vgw.vpcId ?? ''} onChange={e => set(x => { byId(x.vpnGateways, id)!.vpcId = e.target.value || undefined; })}><option value="">（デタッチ）</option>{vpcOpts}</select></F>
    <F label="VPN側から伝わるオンプレミスの経路（CIDRをカンマ区切り）"><Input aria="オンプレミスCIDR" value={vgw.onPremCidrs.join(', ')} onChange={v => set(x => { byId(x.vpnGateways, id)!.onPremCidrs = v.split(',').map(t => t.trim()).filter(Boolean); })}/></F>
    <p className="tiny muted">このモデルでは、ルートテーブルにも「オンプレミスのCIDR → このVGW」の経路を追加して使います。トンネルやBGPの中身は、「VPN / BGP」章のネットワークシミュレータで扱います。</p>
    <button className="button small text-danger" onClick={() => del(x => { x.vpnGateways = x.vpnGateways.filter(g => g.id !== id); })}><Icon name="trash" size={14}/>削除</button></div>;
  return <p className="muted tiny">設定を変えたいリソースを選んでください。構成図の部品をクリックするか、左の一覧から選びます。新しく作るときは、左のボタンで追加します。</p>;
}
export function ResourceList({ onSelect, selected }: { onSelect: (id: string) => void; selected: string }) {
  useUI(s => s.revision);
  const m = aws.model;
  const groups: [string, { id: string; name: string }[]][] = [['VPC', m.vpcs], ['Subnet', m.subnets], ['Route Table', m.routeTables], ['Internet Gateway', m.internetGateways], ['NAT Gateway', m.natGateways], ['Security Group', m.securityGroups], ['Network ACL', m.networkAcls], ['EC2', m.instances], ['Load Balancer', m.loadBalancers], ['Peering', m.peerings], ['Endpoint', m.endpoints], ['VPN Gateway', m.vpnGateways]];
  return <div className="resource-list">{groups.filter(([, l]) => l.length).map(([g, list]) => <Section key={g} title={g} count={list.length}><ul>{list.map(r => <li key={r.id}><button className={selected === r.id ? 'active' : ''} onClick={() => onSelect(r.id)}>{r.name}<small>{r.id}</small></button></li>)}</ul></Section>)}</div>;
}

import { useMemo, useState } from 'react';
import { analyzePath } from '../../aws/analyzer';
import { threeTier } from '../../aws/scenarios';
import type { AwsModel } from '../../aws/model';
import { TerraformWorkspace } from '../../terraform/engine';
import { starterFiles } from '../../terraform/examples';
import AwsDiagram from '../Aws/AwsDiagram';
import { Icon } from '../Icon';

export const breaks: { id: string; label: string; apply: (m: AwsModel) => void }[] = [
  { id: 'igw', label: 'public-rt から 0.0.0.0/0 → IGW を削除', apply: m => { m.routeTables.find(r => r.id === 'rtb-public')!.routes = []; } },
  { id: 'albsg', label: 'alb-sg の 443 許可を削除', apply: m => { const sg = m.securityGroups.find(s => s.id === 'sg-alb')!; sg.ingress = sg.ingress.filter(r => r.fromPort !== 443); } },
  { id: 'appsg', label: 'app-sg の ALB からの 8080 許可を削除', apply: m => { m.securityGroups.find(s => s.id === 'sg-app')!.ingress = []; } },
  { id: 'nacl', label: 'public サブネットのNACLで戻り（エフェメラルポート）を拒否', apply: m => {
    m.networkAcls.push({ id: 'acl-public', name: 'public-acl', vpcId: 'vpc-main', isDefault: false, entries: [
      { ruleNumber: 100, egress: false, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' },
      { ruleNumber: 90, egress: true, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '10.0.0.0/16', action: 'allow' },
      { ruleNumber: 100, egress: true, protocol: 'tcp', fromPort: 1024, toPort: 65535, cidr: '0.0.0.0/0', action: 'deny' },
      { ruleNumber: 200, egress: true, protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' }] });
    m.subnets.filter(s => s.name.startsWith('public')).forEach(s => { s.naclId = 'acl-public'; });
  } },
];
/** Three-tier VPC: break one layer of AWS networking and follow the two-way analysis. */
export function AwsDemo() {
  const [off, setOff] = useState<string[]>([]);
  const { model, result } = useMemo(() => {
    const m = threeTier(); breaks.filter(b => off.includes(b.id)).forEach(b => b.apply(m));
    return { model: m, result: analyzePath(structuredClone(m), { kind: 'internet', ip: '198.51.100.77' }, { kind: 'lb', id: 'alb-web' }, 'tcp', 443) };
  }, [off]);
  const highlight = [...new Set(result.hops.flatMap(h => [...h.resource.matchAll(/(vpc|subnet|igw|nat|sg|acl|i|alb|rtb)-[a-z0-9-]+/g)].map(m => m[0])))];
  return <div className="visual-card"><div className="tool-heading"><Icon name="cloud"/><div><h3>インターネット → ALB → アプリ、往復で確かめる</h3><p>2つのAZ（独立したデータセンター群）にまたがる3層構成です。チェックを入れた設定が壊れます。1つずつ壊して、到達性分析が往路（往）と復路（復）のどこで止まるかを見ましょう。</p></div></div>
    <div className="check-list">{breaks.map(b => <label key={b.id} className="toggle"><input type="checkbox" checked={off.includes(b.id)} onChange={e => setOff(e.target.checked ? [...off, b.id] : off.filter(x => x !== b.id))}/>{b.label}</label>)}</div>
    <div className="aws-demo"><div className="aws-demo-diagram"><AwsDiagram model={model} highlight={highlight}/></div>
      <div><p className={result.reachable ? 'success-text' : 'error-text'}>{result.summary}</p>
        <ol className="hop-list">{result.hops.map((h, i) => <li key={i} className={`${h.verdict} ${h === result.blocked ? 'blocked' : ''}`}><span className="dir">{h.direction === 'request' ? '往' : '復'}</span><div><strong>{h.component}</strong> <code>{h.resource}</code><p>{h.detail}</p></div></li>)}</ol></div></div>
    <p className="muted tiny">SGはステートフル（戻りは自動で許可）、NACLはステートレス（戻りのエフェメラルポートも明示的に許可が必要）。これは実際のAWSと同じ考え方ですが、分析の表示や範囲は教育用です。</p></div>;
}

export const edits: { id: string; label: string; apply: (f: Record<string, string>) => void }[] = [
  { id: 'none', label: '変更なし', apply: () => {} },
  { id: 'tag', label: 'project を path-prod に', apply: f => { f['variables.tf'] = f['variables.tf'].replace('default = "path"', 'default = "path-prod"'); } },
  { id: 'cidr', label: 'vpc_cidr を 10.1.0.0/16 に', apply: f => { f['variables.tf'] = f['variables.tf'].replace('10.0.0.0/16', '10.1.0.0/16'); } },
  { id: 'subnet', label: 'サブネットを追加', apply: f => { f['main.tf'] += '\nresource "aws_subnet" "public" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n'; } },
];
const symbol = { create: '+', update: '~', replace: '-/+', delete: '-', noop: ' ' };
/** Reading `terraform plan`: create / update in-place / replace, from a workspace that already applied the starter code. */
export function TerraformPlanDemo() {
  const [edit, setEdit] = useState('none');
  const { plan, text } = useMemo(() => {
    const ws = new TerraformWorkspace({ files: starterFiles() });
    ws.run('init'); ws.run('apply -auto-approve');
    const files = { ...ws.files }; edits.find(e => e.id === edit)!.apply(files); ws.files = files;
    return { plan: ws.buildPlan('plan'), text: ws.run('plan') };
  }, [edit]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="code"/><div><h3>plan を読む：作る・直す・作り直す</h3><p>VPCを1つ apply 済みのワークスペースです。コードを1か所変えると、plan の記号が変わります。</p></div></div>
    <div className="segmented wide">{edits.map(e => <button key={e.id} className={edit === e.id ? 'active' : ''} onClick={() => setEdit(e.id)}>{e.label}</button>)}</div>
    <ul className="plan-summary">{plan.changes.map(c => <li key={c.address} className={`act-${c.action}`}><code>{symbol[c.action]}</code> <strong>{c.address}</strong> {c.action === 'replace' ? `— ${c.forceNew.join(', ')} は変更できないため作り直し（IDが変わる）` : c.action === 'update' ? `— ${c.changed.join(', ')} をその場で変更` : c.action === 'create' ? `— 新規作成${c.dependencies.length ? `（${c.dependencies.join(', ')} の後）` : ''}` : c.action === 'noop' ? '— 変更なし' : ''}</li>)}</ul>
    <pre className="tf-plan">{text}</pre>
    <p className="muted tiny">-/+ は「削除してから作成」。本番のVPCやDBでは、中身ごと消える重大な変更です。apply の前に必ず plan の記号を読みましょう。出力は教育用シミュレーションで、実際の Terraform の表示とは細部が異なります。</p></div>;
}

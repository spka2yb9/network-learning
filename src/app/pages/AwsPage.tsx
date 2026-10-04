import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aws } from '../../application/CloudController';
import { analyzePath, type AwsAnalysis, type AwsEndpoint } from '../../aws/analyzer';
import type { AwsModel } from '../../aws/model';
import { labById } from '../../labs';
import { useUI } from '../../stores/ui';
import AwsDiagram from '../../components/Aws/AwsDiagram';
import AwsIcon from '../../components/Aws/AwsIcon';
import { addResource, resourceKinds, ResourceForm, ResourceList } from '../../components/Aws/AwsEditor';
import LabBrief from '../../components/Lab/LabBrief';
import { Icon } from '../../components/Icon';
import DesignControls from '../../components/DesignControls';
import Modal from '../../components/Modal';
import { awsTemplates } from '../../application/designs';
import { startTour, useFirstVisitTour } from '../../components/Tour';

function parseEndpoint(key: string): AwsEndpoint {
  const [kind, value] = key.split(':');
  if (kind === 'internet' || kind === 'onprem') return { kind, ip: value };
  if (kind === 'service') return { kind, service: value as 's3' | 'dynamodb' };
  return { kind: kind as 'instance' | 'lb', id: value };
}
export function Analyzer({ model, onResult }: { model: AwsModel; onResult?: (r?: AwsAnalysis) => void }) {
  const options = useMemo(() => [
    { key: 'internet:198.51.100.77', label: 'Internet（198.51.100.77）' },
    ...model.loadBalancers.map(l => ({ key: `lb:${l.id}`, label: `LB ${l.name}` })),
    ...model.instances.map(i => ({ key: `instance:${i.id}`, label: `EC2 ${i.name}（${i.role}）` })),
  ], [model]);
  const [src, setSrc] = useState(options[0].key);
  // From the Internet only an EC2 or a load balancer is a valid destination (the analyzer rejects the rest).
  const destinations = [...options.filter(o => !o.key.startsWith('internet')), ...(src.startsWith('internet') ? [] : [{ key: 'internet:198.51.100.10', label: 'Internet（198.51.100.10）' }, { key: 'service:s3', label: 'Amazon S3' }, { key: 'onprem:192.168.10.10', label: 'オンプレミス 192.168.10.10' }])];
  const defaultDst = destinations.find(d => d.key.startsWith('lb'))?.key ?? destinations[0]?.key ?? '';
  const [dst, setDst] = useState(defaultDst);
  // A defaulted destination comes with the port it actually serves (e.g. the Web template's EC2 listens on 80 only).
  const portOf = (key: string) => { const [kind, id] = key.split(':'); return String((kind === 'lb' ? model.loadBalancers.find(l => l.id === id)?.listeners[0]?.port : model.instances.find(i => i.id === id)?.listening[0]?.port) ?? 443); };
  const [proto, setProto] = useState<'tcp' | 'udp' | 'icmp'>('tcp'); const [port, setPort] = useState(() => portOf(defaultDst));
  const [result, setResult] = useState<AwsAnalysis>();
  useEffect(() => { setResult(undefined); onResult?.(undefined); }, [model]);
  useEffect(() => { if (!options.some(o => o.key === src)) setSrc(options[0].key); }, [model]);
  useEffect(() => { if (!destinations.some(o => o.key === dst)) { setDst(defaultDst); setPort(portOf(defaultDst)); } }, [model, src]);
  const run = () => { const r = analyzePath(structuredClone(model), parseEndpoint(src), parseEndpoint(dst), proto, Number(port)); setResult(r); onResult?.(r); };
  return <div className="aws-analyzer"><div className="section-label"><Icon name="search" size={16}/> REACHABILITY ANALYZER（到達性の分析・教育用）</div>
    <p className="tiny muted">送信元・宛先・プロトコル・ポートを選んで実行すると、ルートテーブル・NACL・SG・待ち受けポートを順にたどり、行き（往）と帰り（復）の両方で通信が届くかを判定します。</p>
    <div className="analyzer-form"><label>送信元<select aria-label="分析の送信元" value={src} onChange={e => setSrc(e.target.value)}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
      <label>宛先<select aria-label="分析の宛先" value={dst} onChange={e => setDst(e.target.value)}>{destinations.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
      <label>プロトコル<select aria-label="分析のプロトコル" value={proto} onChange={e => setProto(e.target.value as 'tcp' | 'udp' | 'icmp')}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label>
      <label>ポート<input aria-label="分析のポート" value={port} onChange={e => setPort(e.target.value)}/></label>
      <button className="button small" onClick={run} disabled={!dst}><Icon name="play" size={13}/>分析</button></div>
    {!dst && <p className="tiny muted">宛先にできるEC2やロードバランサーがまだありません。追加すると分析できます。</p>}
    {result && <><p className={result.reachable ? 'success-text' : 'error-text'}>{result.summary}</p>
      <ol className="hop-list">{result.hops.map((h, i) => <li key={i} className={`${h.verdict} ${h === result.blocked ? 'blocked' : ''}`}><span className="dir">{h.direction === 'request' ? '往' : '復'}</span><div><strong>{h.component}</strong> <code>{h.resource}</code><p>{h.detail}</p></div></li>)}</ol>
      <p className="tiny muted">往（行き）と復（帰り）の両方を評価します。帰りの宛先ポートは、接続を始めた側が一時的に選ぶエフェメラルポートで、ここでは 50000 に固定しています。止まった行があれば、その部品の設定を見直してください。実際の AWS Reachability Analyzer とは、表示や対象範囲が異なります。</p></>}
  </div>;
}

/** `labId`: embedded in a chapter's Simulation tab (no page header of its own). */
export default function AwsPage({ labId: embedded }: { labId?: string }) {
  useUI(s => s.revision);
  const route = useParams(); const labId = embedded ?? route.labId;
  const [ready, setReady] = useState(false);
  const [analysis, setAnalysis] = useState<AwsAnalysis>();
  const [confirm, setConfirm] = useState(false);
  const [templateRequest, setTemplateRequest] = useState<string>();
  const definition = labId ? labById(labId) : undefined;
  useFirstVisitTour('aws', ready && !labId);
  useEffect(() => { let alive = true; setReady(false); void aws.open(labId && definition?.workspace === 'aws' ? labId : 'aws-playground').then(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, [labId]);
  if (labId && definition?.workspace !== 'aws') return <div className="not-found"><h1>このラボは見つかりませんでした。</h1><Link className="button" to="/labs">ラボ一覧へ</Link></div>;
  if (!ready) return <div className="loading-screen">VPCを準備しています…</div>;
  const errors = aws.errors();
  const highlight = analysis ? [...new Set(analysis.hops.flatMap(h => [...h.resource.matchAll(/(vpc|subnet|igw|nat|sg|acl|i|alb|nlb|lb|pcx|vpce|vgw|rtb)-[a-z0-9-]+/g)].map(m => m[0])))] : [];
  const select = (id: string) => { aws.selected = id; useUI.getState().changed(); };
  return <div className="aws-page">
    {!embedded && <div className="page-breadcrumb"><Link to="/">ホーム</Link><Icon name="chevron" size={12}/>{aws.lab ? <><Link to="/labs">ラボ</Link><Icon name="chevron" size={12}/><span>{aws.lab.title}</span></> : <span>AWS VPC Designer</span>}<button className="toolbar-button tour-button" onClick={() => startTour('aws')} title="画面の使い方を順番に案内します"><Icon name="bulb" size={16}/><span>操作ガイド</span></button></div>}
    {!aws.lab && <div className="page-heading"><div><div className="eyebrow">AWS VPC · EDUCATIONAL MODEL</div><h1>VPC Designer</h1><p>AWSのネットワーク（VPC）を、ブラウザの中で組み立てる教育用モデルです。実際のAWSには接続しません。左の RESOURCES で部品を追加し、構成図か一覧で選んで、右の PROPERTIES で設定します。下の到達性アナライザで、通信が行きと帰りの両方で届くかを確かめられます。</p></div><span className="badge"><Icon name="cloud" size={14}/> AWSアカウント不要</span></div>}
    {aws.lab && <LabBrief lab={aws.lab} assessment={aws.assessment} onAssess={() => aws.assess()} onExample={() => aws.reset(true)}/>}
    {!aws.lab && <DesignControls kind="aws" info={aws.design} templates={awsTemplates} snapshot={() => aws.model}
      onNew={name => aws.createDesign(name)} onTemplate={id => aws.loadTemplate(id)} onNamed={info => aws.setDesign(info)}
      onLoad={r => aws.load(r.data as AwsModel, { name: r.name, template: r.template, savedId: r.id })}
      templateRequest={templateRequest} onRequestHandled={() => setTemplateRequest(undefined)}/>}
    <div className="aws-workspace">
      <aside className="aws-side"><div className="section-label">RESOURCES</div>
        <div className="aws-add">{resourceKinds.map(k => <button key={k.kind} className="button small secondary" title={k.hint} onClick={() => { const id = addResource(k.kind); if (id) select(id); }}><AwsIcon kind={k.kind} size={22}/>{k.label}<Icon name="plus" size={12}/></button>)}</div>
        <ResourceList selected={aws.selected} onSelect={select}/>
        <div className="toolbar-actions"><button className="toolbar-button" title="この画面の最初の構成に戻します" onClick={() => setConfirm(true)}><Icon name="reset" size={15}/><span>リセット</span></button>
          <button className="toolbar-button" title="今の設計をJSONファイルとして保存します" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(aws.model, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `path-aws-${aws.id}.json`; a.click(); URL.revokeObjectURL(url); }}><Icon name="download" size={15}/><span>書き出し</span></button></div>
      </aside>
      <main className="aws-main">{!aws.model.vpcs.length && <p className="hint-box">まだVPCがありません。左の RESOURCES で「VPC」を押して追加しましょう。</p>}<AwsDiagram model={aws.model} highlight={highlight} onSelect={select}/>
        {errors.length > 0 && <div className="aws-errors" role="alert"><strong><Icon name="alert" size={15}/> 設計の検証エラー: 実際のAWSでは作成できない構成です。次の点を直してください</strong><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
        <Analyzer model={aws.model} onResult={setAnalysis}/></main>
      <aside className="aws-props"><div className="section-label">PROPERTIES</div><ResourceForm key={`${aws.selected}`} id={aws.selected}/></aside>
    </div>
    <div className="simulation-note"><Icon name="bulb" size={16}/><span>AWSネットワークを学ぶための教育用モデルで、実際のAWSとは細部が異なります。Transit Gateway・PrivateLink・Route 53・IPv6・クォータ（作成できる数の上限）などは扱いません。料金やサービスの詳細は、AWSの公式ドキュメントで確認してください。</span>{!aws.lab && <button title="ALB・アプリ・DBを2つのAZに分けた構成を読み込みます（今の設計は置き換わります）" onClick={() => setTemplateRequest('three-tier')}>3層構成の例を開く</button>}</div>
    {confirm && <Modal labelledBy="aws-reset-title" onClose={() => setConfirm(false)}><h2 id="aws-reset-title">最初の構成に戻しますか？</h2><p>今の設計は消えます。{!aws.lab && '残したい場合は、キャンセルして先に「名前を付けて保存」してください。'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(false)}>キャンセル</button><button className="button" onClick={() => { aws.reset(false); setConfirm(false); }}>戻す</button></div></Modal>}
  </div>;
}

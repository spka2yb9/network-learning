import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { terraform } from '../../application/CloudController';
import { labById } from '../../labs';
import { useUI } from '../../stores/ui';
import AwsDiagram from '../../components/Aws/AwsDiagram';
import { Analyzer } from './AwsPage';
import LabBrief from '../../components/Lab/LabBrief';
import { Icon } from '../../components/Icon';
import DesignControls from '../../components/DesignControls';
import Modal from '../../components/Modal';
import { terraformTemplates } from '../../application/designs';
import type { WorkspaceSnapshot } from '../../terraform/engine';
import { startTour, useFirstVisitTour } from '../../components/Tour';

const CodeEditor = lazy(() => import('../../components/CodeEditor/CodeEditor'));
const commands = ['init', 'fmt', 'validate', 'plan', 'apply', 'destroy', 'output', 'state list', 'graph'];
const commandHelp: Record<string, string> = {
  init: 'プロバイダ（AWSと話すプラグイン）とモジュールを準備します。最初に1回実行します',
  fmt: 'コードの書式（インデントや = の位置）を標準の形に整えます',
  validate: '構文と参照が正しいかを確かめます（クラウドには問い合わせません）',
  plan: '何が作成・変更・削除されるかを表示します。まだ何も実行しません',
  apply: 'plan を表示し、承認（yes）すると実行します',
  destroy: 'Terraformが管理しているリソースをすべて削除します（承認が必要）',
  output: 'output ブロックの値を表示します',
  'state list': 'state に記録されているリソースの一覧を表示します',
  graph: 'state に記録された依存関係を DOT 形式で表示します',
};

function DependencyGraph() {
  useUI(s => s.revision);
  const plan = useMemo(() => { try { return terraform.ws.buildPlan('validate'); } catch { return undefined; } }, [useUI.getState().revision]);
  if (!plan || plan.diagnostics.some(d => d.severity === 'error')) return <p className="muted tiny">コードにエラーがあるため、依存関係を表示できません。terraform validate を実行して、エラーの場所と内容を確認してください。</p>;
  const changes = plan.changes;
  if (!changes.length) return <p className="muted tiny">resource ブロックがまだありません。コードにリソースを書くと、作る順番がここに表示されます。</p>;
  const depth = new Map<string, number>();
  const d = (a: string, seen = new Set<string>()): number => {
    if (depth.has(a)) return depth.get(a)!; if (seen.has(a)) return 0; seen.add(a);
    const c = changes.find(x => x.address === a); const v = 1 + Math.max(0, ...(c?.dependencies ?? []).map(dep => { const t = changes.find(x => x.address === dep || x.address.startsWith(`${dep}[`)); return t ? d(t.address, seen) : 0; }));
    depth.set(a, v); return v;
  };
  changes.forEach(c => d(c.address));
  const levels = [...new Set(changes.map(c => depth.get(c.address)!))].sort((a, b) => a - b);
  return <div className="dep-graph">{levels.map(l => <div key={l} className="dep-level"><span className="dep-level-label">{l}</span>{changes.filter(c => depth.get(c.address) === l).map(c => <div key={c.address} className="dep-node" title={c.dependencies.length ? `先に必要なもの: ${c.dependencies.join(', ')}` : 'ほかのリソースに依存していません'}><code>{c.address}</code>{c.dependencies.length > 0 && <small>← {c.dependencies.map(x => x.replace(/^module\.[\w-]+\./, '')).join(', ')}</small>}</div>)}</div>)}
    <p className="muted tiny">各列の上の数字は、作る順番の段です。コードの参照（aws_vpc.main.id など）から決まる依存を「暗黙の依存関係」、depends_on で書いた依存を「明示的な依存関係」と呼びます。1の列から順に作成し、削除は逆の順番です。実際のTerraformでは、依存のないものどうしは並行して処理されます。</p></div>;
}

/** `labId`: embedded in a chapter's Simulation tab (no page header of its own). */
export default function TerraformPage({ labId: embedded }: { labId?: string }) {
  const revision = useUI(s => s.revision);
  const route = useParams(); const labId = embedded ?? route.labId;
  const [ready, setReady] = useState(false); const [cmd, setCmd] = useState(''); const [newFile, setNewFile] = useState('');
  const [side, setSide] = useState<'diagram' | 'graph' | 'state' | 'analyze'>('diagram');
  const [resetOpen, setResetOpen] = useState(false);
  const definition = labId ? labById(labId) : undefined;
  useFirstVisitTour('terraform', ready && !labId);
  useEffect(() => { let alive = true; setReady(false); void terraform.open(labId && definition?.workspace === 'terraform' ? labId : 'tf-playground').then(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, [labId]);
  // A new object on every call would reset the reachability result on any re-render (e.g. typing a command).
  const model = useMemo(() => terraform.ws.awsModel(), [terraform.ws, revision]);
  if (labId && definition?.workspace !== 'terraform') return <div className="not-found"><h1>このラボは見つかりませんでした。</h1><Link className="button" to="/labs">ラボ一覧へ</Link></div>;
  if (!ready) return <div className="loading-screen">ワークスペースを準備しています…</div>;
  const ws = terraform.ws;
  const files = Object.keys(ws.files).sort();
  const out = terraform.output;
  return <div className="terraform-page">
    {!embedded && <div className="page-breadcrumb"><Link to="/">ホーム</Link><Icon name="chevron" size={12}/>{terraform.lab ? <><Link to="/labs">ラボ</Link><Icon name="chevron" size={12}/><span>{terraform.lab.title}</span></> : <span>Terraform Lab</span>}<button className="toolbar-button tour-button" onClick={() => startTour('terraform')} title="画面の使い方を順番に案内します"><Icon name="bulb" size={16}/><span>操作ガイド</span></button></div>}
    {!terraform.lab && <div className="page-heading"><div><div className="eyebrow">INFRASTRUCTURE AS CODE · EDUCATIONAL SIMULATOR</div><h1>Terraform Lab</h1><p>HCLでインフラのコードを書き、terraform plan で「何が変わるか」を読み、apply でブラウザ内の「シミュレートされたAWS」に反映します。本物の Terraform CLI や AWS Provider は動かさず、実際のAWSには何も作られません。</p></div><span className="badge"><Icon name="code" size={14}/> HCLの一部に対応</span></div>}
    {terraform.lab && <LabBrief lab={terraform.lab} assessment={terraform.assessment} onAssess={() => terraform.assess()} onExample={() => terraform.reset(true)}/>}
    {!terraform.lab && <DesignControls kind="terraform" info={terraform.design} templates={terraformTemplates} snapshot={() => terraform.ws.snapshot()}
      onNew={name => terraform.createDesign(name)} onTemplate={id => terraform.loadTemplate(id)} onNamed={info => terraform.setDesign(info)}
      onLoad={r => terraform.load(r.data as WorkspaceSnapshot, { name: r.name, template: r.template, savedId: r.id })}/>}
    <div className="tf-workspace">
      <section className="tf-editor">
        <div className="file-tabs">{files.map(f => <span key={f} className={`file-tab ${terraform.activeFile === f ? 'active' : ''}`}><button onClick={() => { terraform.activeFile = f; useUI.getState().changed(); }}><Icon name="file" size={13}/>{f}</button>{files.length > 1 && <button aria-label={`${f} を削除`} className="file-close" onClick={() => { if (window.confirm(`${f} を削除しますか？`)) terraform.removeFile(f); }}>×</button>}</span>)}
          <form className="new-file" onSubmit={e => { e.preventDefault(); if (newFile) { terraform.addFile(newFile.trim()); setNewFile(''); } }}><input aria-label="新しいファイル名" placeholder="新しいファイル（例: network.tf, modules/net/main.tf）" value={newFile} onChange={e => setNewFile(e.target.value)}/><button className="icon-button" aria-label="ファイルを追加"><Icon name="plus" size={14}/></button></form></div>
        <Suspense fallback={<div className="empty-state">エディタを読み込み中…</div>}><CodeEditor key={`${terraform.id}-${terraform.revision}-${terraform.activeFile}`} ariaLabel={`${terraform.activeFile} の編集`} value={ws.files[terraform.activeFile] ?? ''} onChange={v => terraform.edit(terraform.activeFile, v)}/></Suspense>
        <div className="tf-commands">{commands.map(c => <button key={c} className={`button small ${c === 'apply' ? '' : 'secondary'}`} title={commandHelp[c]} onClick={() => terraform.run(c)}>{c === 'state list' ? 'state list' : `terraform ${c}`}</button>)}
          <form onSubmit={e => { e.preventDefault(); if (cmd.trim()) { terraform.run(cmd.trim()); setCmd(''); } }}><input aria-label="terraform コマンド" placeholder="そのほかのコマンドを入力して Enter（例: state show aws_vpc.main / import aws_vpc.legacy vpc-0legacy01）" value={cmd} onChange={e => setCmd(e.target.value)}/></form></div>
        {ws.pending && <div className="tf-confirm"><strong>apply を実行しますか？</strong> 下に表示された plan を読み、作成（+）・変更（~）・削除（-）・作り直し（-/+）が意図どおりか確認してから承認してください。<button className="button small" onClick={() => terraform.confirm(true)}>yes: 実行する</button><button className="button small secondary" onClick={() => terraform.confirm(false)}>no: 中止</button></div>}
        <div className="tf-output" aria-live="polite">{out.length ? out.slice(-6).map((o, i) => <div key={i}><div className="tf-prompt">$ {o.command}</div><pre>{o.text}</pre></div>) : <p className="muted tiny">まず「terraform init」を押しましょう。続けて validate → plan → apply の順に試せます。出力は教育用シミュレーションで、実際の Terraform CLI の表示とは細部が異なります。</p>}</div>
        <div className="tf-events"><span className="muted tiny">運用で起きることを試す:</span><button className="button small ghost" title="apply済みのSGに、AWSコンソールから 22番（SSH）の許可を手作業で追加します。次の plan で、コードと実物のずれ（ドリフト）として表示されます" onClick={() => terraform.simulateDrift()}><Icon name="alert" size={13}/>コンソールで誰かがSGを変更（ドリフト）</button><button className="button small ghost" title={ws.lock ? 'チームメイトの apply が終わり、ロックが外れた状態にします' : 'チームメイトが apply 中で、state がロックされた状態を再現します。ロック中は plan・apply・destroy・import がエラーになります'} onClick={() => terraform.toggleLock()}><Icon name="lock" size={13}/>{ws.lock ? 'チームメイトのロックを解除' : 'チームメイトが apply 中（stateロック）'}</button>
          <button className="button small ghost" onClick={() => setResetOpen(true)}><Icon name="reset" size={13}/>初期状態に戻す</button></div>
      </section>
      <section className="tf-side">
        <div className="segmented"><button className={side === 'diagram' ? 'active' : ''} onClick={() => setSide('diagram')}>構成図（apply後の実物）</button><button className={side === 'graph' ? 'active' : ''} onClick={() => setSide('graph')}>依存関係</button><button className={side === 'state' ? 'active' : ''} onClick={() => setSide('state')}>state</button><button className={side === 'analyze' ? 'active' : ''} onClick={() => setSide('analyze')}>到達性</button></div>
        {side === 'diagram' && (model.vpcs.length ? <AwsDiagram model={model}/> : <div className="empty-state">まだVPCがありません。terraform apply を実行すると、シミュレートされたAWSに作られたVPCがここに描かれます。</div>)}
        {side === 'graph' && <DependencyGraph/>}
        {side === 'state' && <div className="tf-state"><p className="tiny muted">serial（stateの版番号） {ws.state.serial} · Terraformが管理 {Object.keys(ws.state.resources).length} 件 · クラウド上の実物 {Object.keys(ws.cloud.resources).length} 件{ws.lock ? ' · ロック中' : ''}</p>
          {!Object.keys(ws.state.resources).length && <p className="tiny muted">state はまだ空です。terraform apply でリソースを作ると、コード上のアドレスと実物のIDの対応がここに記録されます。</p>}
          <table className="mini-table"><tbody>{Object.values(ws.state.resources).map(r => <tr key={r.address}><td><code>{r.address}</code></td><td>{r.id}</td></tr>)}{Object.values(ws.cloud.resources).filter(r => !Object.values(ws.state.resources).some(s => s.id === r.id)).map(r => <tr key={r.id} className="unmanaged"><td><em>（Terraformの管理外）{r.type}</em></td><td>{r.id}</td></tr>)}</tbody></table></div>}
        {side === 'analyze' && (model.vpcs.length ? <Analyzer model={model}/> : <div className="empty-state">まだVPCがありません。terraform apply でネットワークを作ると、ここで通信が届くかを確かめられます。</div>)}
      </section>
    </div>
    {resetOpen && <Modal labelledBy="tf-reset-title" onClose={() => setResetOpen(false)}><h2 id="tf-reset-title">ワークスペースを初期状態に戻しますか？</h2><p>ファイル・state・シミュレートされたクラウドが、すべて最初の状態に戻ります。書き換えたコードも元に戻ります。</p><div className="modal-actions"><button className="button secondary" onClick={() => setResetOpen(false)}>キャンセル</button><button className="button" onClick={() => { terraform.reset(false); setResetOpen(false); }}>戻す</button></div></Modal>}
  </div>;
}

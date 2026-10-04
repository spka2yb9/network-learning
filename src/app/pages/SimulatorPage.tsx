import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { lab, PLAYGROUND } from '../../application/LabController';
import { templates } from '../../application/templates';
import { labById } from '../../labs';
import { useUI, type BottomTab, type InspectorTab } from '../../stores/ui';
import { hostKinds } from '../../simulator/core/types';
import { isIpv4 } from '../../simulator/l3/ipv4';
import TopologyEditor, { kindLabel, paletteKinds } from '../../components/TopologyEditor/TopologyEditor';
import Properties from '../../components/TopologyEditor/Properties';
import StatePanel from '../../components/TopologyEditor/StatePanel';
import DiagnosePanel from '../../components/TopologyEditor/DiagnosePanel';
import PacketDebugger, { EventList } from '../../components/PacketViewer/PacketDebugger';
import PacketViewer from '../../components/PacketViewer/PacketViewer';
import LabBrief from '../../components/Lab/LabBrief';
import { Icon, type IconName } from '../../components/Icon';
import DesignControls from '../../components/DesignControls';
import Modal from '../../components/Modal';
import { startTour, useFirstVisitTour } from '../../components/Tour';

const Terminal = lazy(() => import('../../components/Terminal/Terminal'));
type Action = 'ping' | 'traceroute' | 'curl' | 'dig';
/** The lab's target, else the first address of a host other than the source. */
const defaultTarget = () => {
  const source = lab.lab?.source ?? useUI.getState().selectedDevice;
  const host = lab.network.snapshot().devices.find(d => hostKinds.includes(d.kind) && d.id !== source && d.interfaces.some(i => i.address));
  return lab.lab?.target ?? host?.interfaces.find(i => i.address)?.address?.split('/')[0] ?? '192.168.2.10';
};

function SendBar() {
  const deviceId = useUI(s => s.selectedDevice);
  const snapshot = lab.network.snapshot();
  const [action, setAction] = useState<Action>('ping');
  const [target, setTarget] = useState(defaultTarget);
  useEffect(() => setTarget(lab.labId === PLAYGROUND ? target : defaultTarget()), [lab.labId]);
  const device = snapshot.devices.find(d => d.id === deviceId);
  const linux = device && hostKinds.includes(device.kind);
  const run = () => {
    if (!deviceId) return;
    if (action === 'ping' && !linux) { lab.execute(deviceId, `ping ${target} repeat 1`); }
    else if (action === 'ping') lab.execute(deviceId, `ping ${target}`);
    else if (action === 'traceroute') lab.execute(deviceId, linux ? `traceroute -I ${target}` : `traceroute ${target}`);
    else if (action === 'curl') { if (!linux) { useUI.setState({ notice: 'curl はPCかServer（Linux）から実行できます。送信元デバイスを切り替えてください。' }); return; } lab.execute(deviceId, `curl ${/^https?:\/\//.test(target) ? target : `http://${target}`}`); }
    else { if (!linux) { useUI.setState({ notice: 'dig はPCかServer（Linux）から実行できます。送信元デバイスを切り替えてください。' }); return; } lab.execute(deviceId, `dig ${target}`); }
    useUI.setState({ inspectorTab: 'debug', bottomTab: useUI.getState().bottomTab === 'terminal' ? 'events' : useUI.getState().bottomTab });
  };
  return <div className="send-packet-bar"><span><Icon name="play" size={15}/> SEND</span>
    <select aria-label="送信元デバイス" value={deviceId} onChange={e => useUI.setState({ selectedDevice: e.target.value, selectedLink: '' })}>{snapshot.devices.map(d => <option key={d.id}>{d.id}</option>)}</select>
    <select aria-label="通信の種類" value={action} onChange={e => setAction(e.target.value as Action)}><option value="ping">ping</option><option value="traceroute">traceroute</option><option value="curl">curl</option><option value="dig">dig</option></select>
    <Icon name="arrow" size={16}/>
    <form onSubmit={e => { e.preventDefault(); run(); }}><input aria-label={action === 'ping' ? 'ping 宛先IPv4' : '宛先'} value={target} onChange={e => setTarget(e.target.value)} placeholder={action === 'curl' ? 'https://www.example.com/' : action === 'dig' ? 'www.example.com' : '192.168.2.10'}/>
      <button className="button small" disabled={!deviceId || (action === 'ping' && !isIpv4(target) && !linux)}><Icon name="play" size={13}/>{action}</button></form></div>;
}

/** `labId`: embedded in a chapter's Simulation tab (no page header of its own). */
export default function SimulatorPage({ labId: embedded }: { labId?: string }) {
  const revision = useUI(s => s.revision); const deviceId = useUI(s => s.selectedDevice); const tab = useUI(s => s.bottomTab); const rightTab = useUI(s => s.inspectorTab);
  const route = useParams(); const labId = embedded ?? route.labId; const [params, setParams] = useSearchParams();
  const [resetMode, setResetMode] = useState<'exercise' | 'example' | 'empty' | { template: string }>();
  const [importError, setImportError] = useState(''); const [ready, setReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const definition = labId ? labById(labId) : undefined;
  // ?template= links (from lessons): an edited draft is only replaced after the same confirmation as the template menu.
  const openTemplate = (template: string | null) => {
    if (!template || !templates[template]) return;
    if (lab.design.modified) setResetMode({ template }); else lab.reset({ template });
    setParams({}, { replace: true });
  };
  useEffect(() => {
    let alive = true; setReady(false);
    void lab.open(labId && definition?.workspace === 'network' ? labId : PLAYGROUND).then(() => {
      if (!alive) return;
      if (!labId) openTemplate(params.get('template'));
      setReady(true);
    });
    return () => { alive = false; };
  }, [labId]);
  // Also react to ?template= when the simulator is already open (e.g. a template link followed from this page).
  // Not on `ready`: the link that opened the page was handled above. `ready` is stale for a render after leaving a lab.
  const templateParam = params.get('template');
  useEffect(() => {
    if (ready && !labId && lab.labId === PLAYGROUND) openTemplate(templateParam);
  }, [templateParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useFirstVisitTour('playground', ready && !labId);
  if (labId && definition?.workspace !== 'network') return <div className="not-found"><h1>このラボは見つかりませんでした。</h1><Link className="button" to="/labs">ラボ一覧へ</Link></div>;
  if (!ready) return <div className="loading-screen">ワークスペースを準備しています…</div>;
  const current = lab.lab;
  const snapshot = lab.network.snapshot();
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(lab.network.snapshot(), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `path-${current?.id ?? 'routing'}-lab.json`.replace('path-routing-01-lab', 'path-routing-lab'); anchor.click(); URL.revokeObjectURL(url);
  };
  // Labels break only at <wbr> (see .inspector-tabs in styles.css), so they always read 機器 / 設定 regardless of panel width.
  const tabs: { id: InspectorTab; name: ReactNode; icon: IconName; hint: string }[] = [{ id: 'config', name: <>機器<wbr/>設定</>, icon: 'settings', hint: '選んだ機器のIP・経路・VLANなどを設定します' }, { id: 'state', name: '状態', icon: 'layers', hint: 'ARPキャッシュや経路表など、機器の今の状態を見ます' }, { id: 'debug', name: 'Debugger', icon: 'packet', hint: '記録した通信を1ステップずつ再生します' }, { id: 'diagnose', name: <>切り<wbr/>分け</>, icon: 'search', hint: '下の層から順に、どこで止まるかを自動で確かめます' }];
  return <div className="simulator-page">
    {!embedded && <div className="page-breadcrumb"><Link to="/">ホーム</Link><Icon name="chevron" size={12}/>{current ? <><Link to="/labs">ラボ</Link><Icon name="chevron" size={12}/><span>{current.title}</span></> : <span>Playground</span>}</div>}
    {!current && <div className="page-heading"><div><div className="eyebrow">YOUR NETWORK WORKSPACE</div><h1>ネットワーク・プレイグラウンド</h1><p>機器を置いてケーブルでつなぎ、設定してから、パケットの流れを追いかけます。ツールバーの「テンプレートを開く」から、できあがった構成で始めることもできます。</p></div><span className="badge"><span className="status-dot"/> Browser simulation</span></div>}
    {current && <LabBrief lab={current} assessment={lab.assessment} onAssess={() => lab.assess()} onExample={() => lab.reset('example')}/>}
    {!current && <DesignControls kind="network" info={lab.design} templates={templates} snapshot={() => lab.network.snapshot()}
      onNew={name => { lab.reset('empty'); void lab.setDesign({ ...lab.design, name: name.trim() || '無題の構成' }); }}
      onTemplate={id => lab.reset({ template: id })} onNamed={info => lab.setDesign(info)}
      onLoad={r => lab.loadDesign(r.data, { name: r.name, template: r.template, savedId: r.id })}
      templateRequest={typeof resetMode === 'object' ? resetMode.template : undefined} onRequestHandled={() => setResetMode(undefined)}/>}
    <div className="workspace">
      <div className="workspace-toolbar"><div className="workspace-name"><Icon name="network" size={17}/><strong>{current ? current.id : lab.design.name}</strong><span className="file-dot"/> <small>{snapshot.devices.length} devices</small></div>
        <div className="toolbar-actions">
          <button className="toolbar-button" onClick={() => startTour('playground')} title="画面の使い方を順番に案内します"><Icon name="bulb" size={16}/><span>操作ガイド</span></button>
          <button className="toolbar-button" onClick={download} title="ラボを書き出す"><Icon name="download" size={16}/><span>書き出し</span></button>
          <button className="toolbar-button" onClick={() => fileInput.current?.click()} title="書き出したJSONファイルからラボを読み込む"><Icon name="upload" size={16}/><span>読み込み</span></button>
          <button className="toolbar-button" onClick={() => setResetMode('exercise')} title="最初の構成に戻す"><Icon name="reset" size={16}/><span>リセット</span></button></div></div>
      <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try { if (file.size > 2_000_000) throw new Error('ファイルが大きすぎます（上限2MB）'); lab.importLab(await file.text()); setImportError(''); } catch (error) { setImportError((error as Error).message); }
        e.target.value = '';
      }}/>
      {importError && <div className="error-text" role="alert">{importError}</div>}
      <div className="workspace-main"><div className="device-palette"><span>DEVICES</span>{paletteKinds.map(kind => <button key={kind} draggable onDragStart={e => e.dataTransfer.setData('application/path-device', kind)} onClick={() => lab.addDevice(kind)} title={`${kindLabel[kind]}を追加（ドラッグも可能）`}><Icon name={kind === 'internet' ? 'cloud' : kind} size={23}/><small>{kindLabel[kind].replace(' / ISP', '')}</small><i>+</i></button>)}{current && <><div className="palette-divider"/><button onClick={() => setResetMode('empty')} title="空のラボを作る"><Icon name="plus" size={23}/><small>New lab</small></button></>}</div>
        <div className="workspace-canvas"><TopologyEditor/><SendBar/></div>
        <aside className="workspace-inspector"><div className="inspector-tabs">{tabs.map(t => <button key={t.id} title={t.hint} className={rightTab === t.id ? 'active' : ''} onClick={() => useUI.setState({ inspectorTab: t.id })}><Icon name={t.icon} size={15}/><span>{t.name}</span></button>)}</div>
          {rightTab === 'config' ? <Properties/> : rightTab === 'state' ? <StatePanel/> : rightTab === 'debug' ? <PacketDebugger/> : <DiagnosePanel key={lab.workspaceRevision}/>}</aside>
      </div>
      <div className="bottom-tabs"><div>{([{ id: 'terminal', name: 'Terminal', icon: 'terminal', hint: '選んだ機器にコマンドを入力します（CLI）' }, { id: 'capture', name: 'Packet Capture', icon: 'packet', hint: 'リンクを通ったフレームの記録（Wiresharkのような表示）' }, { id: 'events', name: 'Event Log', icon: 'layers', hint: '通信中に起きたことを順番に並べた一覧' }] as { id: BottomTab; name: string; icon: IconName; hint: string }[]).map(item => <button key={item.id} title={item.hint} className={tab === item.id ? 'active' : ''} onClick={() => useUI.setState({ bottomTab: item.id })}><Icon name={item.icon} size={15}/>{item.name}{item.id === 'capture' && lab.cli.captures.length > 0 && <span>{lab.cli.captures.length}</span>}</button>)}</div><select aria-label="Terminal 機器選択" value={deviceId} onChange={e => useUI.setState({ selectedDevice: e.target.value, selectedLink: '' })}>{snapshot.devices.map(d => <option key={d.id}>{d.id}</option>)}</select></div>
      <div className={`workspace-bottom ${tab === 'terminal' ? 'terminal-bottom' : ''}`}>{tab === 'terminal' ? <Suspense fallback={<div className="empty-state">Terminalを読み込み中…</div>}><Terminal key={`${lab.labId}-${lab.workspaceRevision}-${deviceId}-${snapshot.devices.length}`} deviceId={deviceId}/></Suspense> : tab === 'capture' ? <PacketViewer/> : <EventList/>}</div>
      <div className="workspace-status"><span><span className="status-dot"/> Simulator ready</span><span>{lab.result ? `${lab.result.success ? (lab.result.events.some(e => e.type === 'PACKET_RECEIVED' && e.packet?.protocol === 'ICMP' && e.packet.type === 'echo-reply') ? '✓ Echo Reply received' : '✓ 成功') : '通信失敗'} · ${lab.result.events.length} events` : '機器を選んで設定し、SEND から ping などを実行してみましょう'}</span><span>{snapshot.devices.length} devices / revision {revision}</span></div>
    </div>
    <div className="simulation-note"><Icon name="bulb" size={16}/><span>教育用のシミュレーションです。本物のOS・ネットワーク・機器にはつながりません。Ethernet / VLAN / STP / IPv4 / ARP / ICMP / TCP / UDP / DNS / TLS（簡易）/ NAT / ACL / Firewall / OSPF風 / BGP / IPsec（簡易）の動きを、ARPキャッシュなどの状態も含めてブラウザの中で再現しています（一部は簡略化）。</span>{!current && <button onClick={() => setResetMode({ template: 'routing' })}>完成例を開く</button>}</div>
    {resetMode && typeof resetMode !== 'object' && <Modal labelledBy="reset-title" onClose={() => setResetMode(undefined)}><div className="modal-icon"><Icon name="reset" size={28}/></div><h2 id="reset-title">{resetMode === 'empty' ? '新しいラボを始めますか？' : '最初の構成に戻しますか？'}</h2><p>今の構成は置き換わります。残したい場合は、先に「書き出し」でJSONファイルに保存してください。学習の進み具合は消えません。</p><div className="modal-actions"><button className="button secondary" onClick={() => setResetMode(undefined)}>キャンセル</button><button className="button secondary" onClick={download}>書き出し</button><button className="button" onClick={() => { lab.reset(resetMode); setResetMode(undefined); }}>切り替える</button></div></Modal>}
  </div>;
}

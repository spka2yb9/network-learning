import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, ConnectionMode, useReactFlow, type Connection, type NodeProps, type Node, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import type { DeviceKind, DeviceState } from '../../simulator/core/types';
import { Icon } from '../Icon';
import { freeSpot, separate } from '../diagram/overlap';

export const kindLabel: Record<DeviceKind, string> = { pc: 'PC', server: 'Server', router: 'Router', switch: 'L2 Switch', l3switch: 'L3 Switch', firewall: 'Firewall', internet: 'Internet / ISP' };
export const paletteKinds: DeviceKind[] = ['pc', 'server', 'router', 'switch', 'l3switch', 'firewall', 'internet'];
const domainColors = ['#3d9a7b', '#d08a3c', '#5b7fc7', '#b2587f', '#7a6bc2', '#4c9ab0'];
/** Space kept between devices (room for the link label between facing port labels). */
const NODE_GAP = 36;
/** On-screen extent of a node including anything that sticks out of it (port labels, handles), in flow units. */
function visualExtent(el: HTMLElement, zoom: number) {
  const base = el.getBoundingClientRect();
  let l = base.left, t = base.top, r = base.right, b = base.bottom;
  el.querySelectorAll('*').forEach(c => { const x = c.getBoundingClientRect(); if (x.width || x.height) { l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); } });
  return { dx: (l - base.left) / zoom, dy: (t - base.top) / zoom, w: (r - l) / zoom, h: (b - t) / zoom };
}

type DeviceNode = Node<{ device: DeviceState; active: boolean; selectedDevice: boolean; flip: boolean; domain?: number }, 'device'>;
function DeviceCard({ data }: NodeProps<DeviceNode>) {
  const { device, active, selectedDevice } = data;
  const ports = device.interfaces.filter(i => (i.kind ?? 'ethernet') === 'ethernet');
  const many = ports.length > 3;
  const half = Math.ceil(ports.length / 2);
  const logical = device.interfaces.filter(i => i.kind && i.kind !== 'ethernet' && i.address);
  const anyUp = ports.some(p => p.up) || !ports.length;
  // Only a single-port device moves its port to face its peer; otherwise port 0 would overlap port 1 on the right.
  const left = (index: number) => index === 0 && !(data.flip && ports.length === 1);
  const vlanOf = (port: typeof ports[number]) => port.switchport ? (port.switchport.mode === 'trunk' ? 'T' : String(port.switchport.accessVlan)) : '';
  const labelOf = (port: typeof ports[number]) => { const vlan = vlanOf(port); return port.id.replace('g0/', '') + (vlan && vlan !== '1' ? vlan : ''); };
  // Port labels get space of their own so they never cover the device's text (see .many-ports / --pad-* in styles.css):
  // many ports → a label row above and below, each slot one label wide plus a gap; otherwise → a gutter on each side that has ports.
  const widest = (list: typeof ports) => Math.max(0, ...list.map(p => labelOf(p).length));
  const gutter = (list: typeof ports) => widest(list) ? `calc(${widest(list)}ch + 12px)` : undefined;
  const space = many ? { '--port-row': `${(half + 1) * (widest(ports) + 1)}ch` } : { '--pad-l': gutter(ports.filter((_, i) => left(i))), '--pad-r': gutter(ports.filter((_, i) => !left(i))) };
  return <div className={`device-node kind-${device.kind} ${active ? 'packet-active' : ''} ${selectedDevice ? 'device-selected' : ''} ${many ? 'many-ports' : ''}`} style={{ ...space, ...(data.domain !== undefined ? { boxShadow: `0 0 0 4px ${domainColors[data.domain % domainColors.length]}55`, borderColor: domainColors[data.domain % domainColors.length] } : {}) } as CSSProperties}>
    <div className={`device-symbol ${device.kind}`}><Icon name={device.kind === 'internet' ? 'cloud' : device.kind} size={28}/><span className={`status-dot ${anyUp ? '' : 'down'}`}/></div>
    <strong>{device.id}</strong><span className="device-type">{kindLabel[device.kind]}</span>
    <div className="node-addresses">{[...ports, ...logical].filter(i => i.address).slice(0, 4).map(i => <span key={i.id}>{logical.includes(i) ? `${i.id} ` : ''}{i.address}</span>)}</div>
    {ports.map((port, index) => {
      const pos = many ? (index < half ? Position.Top : Position.Bottom) : left(index) ? Position.Left : Position.Right;
      const style = many ? { left: `${((index % half) + 1) * (100 / (half + 1))}%`, top: pos === Position.Top ? 0 : undefined, background: port.up ? '#399982' : '#c86b64' }
        : { top: index === 2 ? '83%' : '42%', background: port.up ? '#399982' : '#c86b64' };
      const vlan = vlanOf(port);
      return <div key={port.id}>
        <Handle type="source" id={port.id} position={pos} style={style} title={`${port.id} · ${port.up ? 'Up' : 'Down'}${port.switchport ? ` · ${port.switchport.mode === 'trunk' ? 'trunk' : `VLAN ${port.switchport.accessVlan}`}` : ''}`}/>
        <span className={`port-label ${many ? (pos === Position.Top ? 'top' : 'bottom') : left(index) ? 'left' : 'right'}`} style={many ? { left: style.left } : { top: style.top }}>{port.id.replace('g0/', '')}{vlan && vlan !== '1' ? <em>{vlan}</em> : null}</span>
      </div>;
    })}
  </div>;
}
const nodeTypes = { device: DeviceCard };
function Editor({ compact = false }: { compact?: boolean }) {
  const revision = useUI(s => s.revision);
  const selectedDevice = useUI(s => s.selectedDevice);
  const selectedLink = useUI(s => s.selectedLink);
  const selectedEvent = useUI(s => s.selectedEvent);
  const domainView = useUI(s => s.domainView);
  const flow = useReactFlow();
  const snapshot = useMemo(() => lab.network.snapshot(), [revision]);
  const lags = useMemo(() => lab.network.lagState(), [revision]);
  // Re-fit when the set of devices or the workspace changes (lab / template switch, reset, import); the fitView prop only fits on mount.
  const ids = snapshot.devices.map(d => d.id).join();
  const workspace = lab.workspaceRevision;
  useEffect(() => { const t = requestAnimationFrame(() => void flow.fitView({ padding: 0.2 })); return () => cancelAnimationFrame(t); }, [ids, workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  // Devices must never cover each other. Once every node is measured, overlapping devices are pushed apart
  // (on a new network: all of them; afterwards: only newly added ones, so the learner's layout stays put).
  const wrapper = useRef<HTMLDivElement>(null);
  const known = useRef<{ network: unknown; ids: Set<string> }>(undefined);
  const measure = useCallback(() => {
    const zoom = flow.getZoom();
    return flow.getNodes().flatMap(n => {
      const el = wrapper.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (!el) return [];  // measured from the DOM: in this controlled flow, node objects don't carry `measured`
      const e = visualExtent(el, zoom);
      return [{ id: n.id, x: n.position.x + e.dx, y: n.position.y + e.dy, w: e.w, h: e.h, dx: e.dx, dy: e.dy }];
    });
  }, [flow]);
  useEffect(() => {
    if (compact) return;
    let frame = 0, tries = 0;
    const run = () => {
      const boxes = measure();
      // Wait (a few frames) until every device is rendered in the DOM, then check once.
      if (boxes.length !== snapshot.devices.length) { if (tries++ < 30) frame = requestAnimationFrame(run); return; }
      const prev = known.current?.network === lab.network ? known.current.ids : undefined;
      known.current = { network: lab.network, ids: new Set(boxes.map(b => b.id)) };
      const moves = separate(boxes, NODE_GAP, prev ? new Set(boxes.filter(b => prev.has(b.id)).map(b => b.id)) : undefined);
      if (!moves.size) return;
      for (const [id, p] of moves) { const b = boxes.find(x => x.id === id)!; lab.moveDevice(id, { x: p.x - b.dx, y: p.y - b.dy }); }
      requestAnimationFrame(() => void flow.fitView({ padding: 0.2 }));
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [ids, workspace, compact]); // eslint-disable-line react-hooks/exhaustive-deps
  // A device dropped onto another one slides to the nearest free spot.
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    const boxes = measure(); const me = boxes.find(b => b.id === node.id);
    if (!me) return;
    const spot = freeSpot(me, boxes.filter(b => b.id !== node.id), NODE_GAP);
    if (spot.x !== me.x || spot.y !== me.y) lab.moveDevice(node.id, { x: spot.x - me.dx, y: spot.y - me.dy });
  }, [measure]);
  // React Flow's delete key handler is document-wide. Delete acts only right after a device or cable here was clicked
  // (a clicked cable is re-rendered and loses focus, so the last pointerdown decides) or while one has keyboard focus.
  const onCanvasItem = (el: Element | null | undefined) => !!wrapper.current?.contains(el?.closest('.react-flow__node, .react-flow__edge') ?? null);
  const armed = useRef(false);
  useEffect(() => {
    const down = (e: PointerEvent) => { armed.current = onCanvasItem(e.target as Element); };
    document.addEventListener('pointerdown', down, true); return () => document.removeEventListener('pointerdown', down, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const event = lab.result?.events[selectedEvent];
  const domains = useMemo(() => {
    if (!domainView || compact) return new Map<string, number>();
    // Color each device by the broadcast domains its L3 interfaces belong to.
    const map = new Map<string, number>(); let next = 0; const seen = new Set<string>();
    for (const d of snapshot.devices) for (const i of d.interfaces) {
      if (!i.address || seen.has(`${d.id}|${i.id}`) || i.kind === 'tunnel' || i.kind === 'loopback') continue;
      let members: { device: string; interface: string }[] = [];
      try { members = lab.network.broadcastDomain(d.id, i.id); } catch { members = []; }
      const color = next++;
      for (const m of [{ device: d.id, interface: i.id }, ...members]) { seen.add(`${m.device}|${m.interface}`); if (!map.has(m.device)) map.set(m.device, color); }
    }
    return map;
  }, [domainView, snapshot, compact]);
  const nodes: DeviceNode[] = snapshot.devices.map(device => {
    const link = snapshot.links.find(l => l.sourceDevice === device.id || l.targetDevice === device.id);
    const peerId = link && (link.sourceDevice === device.id ? link.targetDevice : link.sourceDevice);
    const peer = snapshot.devices.find(d => d.id === peerId);
    // React Flow's selection is what Delete removes: only the device, and only while no cable is selected.
    return { id: device.id, type: 'device', position: device.position, selected: device.id === selectedDevice && !selectedLink && !compact,
      data: { device, active: event?.deviceId === device.id, selectedDevice: device.id === selectedDevice && !compact, flip: !peer || peer.position.x > device.position.x, domain: domains.get(device.id) } };
  });
  const speed = (mbps: number) => mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`;
  /** A cable that is a LAG member: which port-channel, whether it is bundled, and the bundle's size. */
  const memberOf = (device: string, port: string) => {
    const g = snapshot.devices.find(d => d.id === device)?.interfaces.find(i => i.id === port)?.channelGroup;
    const st = g && lags[device]?.[`po${g.group}`];
    if (!g || !st) return undefined;
    const used = st.members.filter(m => m.flag === 'P').length; const idle = st.members.length - used;
    // Parallel member cables sit close together: only the first member carries the label, summarizing the whole bundle.
    const label = st.members[0]?.port !== port ? '' : used ? `po${g.group} = ${used}×${speed(st.members.find(m => m.flag === 'P')!.bandwidth)}${idle ? `（${idle}本 未使用）` : ''}` : `po${g.group} Down（${idle}本 未使用）`;
    return { bundled: st.members.find(m => m.port === port)?.flag === 'P', label };
  };
  const edges = snapshot.links.map(link => {
    const hot = event?.linkId === link.id;
    const m = memberOf(link.sourceDevice, link.sourceInterface) ?? memberOf(link.targetDevice, link.targetInterface);
    // LAG members: bundled ones are thick blue, unbundled ones dashed orange.
    const lagLabel = m?.label;
    return { id: link.id, source: link.sourceDevice, target: link.targetDevice, sourceHandle: link.sourceInterface, targetHandle: link.targetInterface,
      label: !link.up ? 'Link Down' : compact ? '' : hot && event?.vlan !== undefined ? `VLAN ${event.vlan}` : lagLabel ?? speed(link.bandwidth), type: 'smoothstep',
      animated: link.up && hot, selected: link.id === selectedLink,
      style: { stroke: !link.up ? '#c56c61' : hot ? '#199a7b' : link.id === selectedLink ? '#476f9e' : m ? (m.bundled ? '#5b7fc7' : '#d08a3c') : '#94b4aa', strokeWidth: hot || link.id === selectedLink || m?.bundled ? 3 : 2, strokeDasharray: !link.up || (m && !m.bundled) ? '5 5' : undefined },
      labelStyle: { fill: '#415c50', fontSize: 14 }, labelBgStyle: { fill: '#f8faf7' } };
  });
  const connect = useCallback((c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    // Not crypto.randomUUID(): it is missing over plain HTTP (npm run dev --host opened from another device on the LAN).
    lab.mutate(n => n.connect({ id: `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, sourceDevice: c.source, sourceInterface: c.sourceHandle!, targetDevice: c.target, targetInterface: c.targetHandle!, up: true, bandwidth: 1000, latency: 1 }));
  }, []);
  const onNodesChange = useCallback((changes: NodeChange<DeviceNode>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) lab.moveDevice(c.id, c.position, true);
      if (c.type === 'select' && c.selected) useUI.setState({ selectedDevice: c.id, selectedLink: '' });
      if (c.type === 'remove') lab.mutate(n => n.removeDevice(c.id));
    }
  }, []);
  return <div ref={wrapper} className={`topology ${compact ? 'compact' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={e => {
    e.preventDefault(); const kind = e.dataTransfer.getData('application/path-device') as DeviceKind;
    if (!compact && paletteKinds.includes(kind)) lab.addDevice(kind, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }}>
    <div className="canvas-label"><span className="status-dot"/> {compact ? lab.lab?.title ?? 'PLAYGROUND' : 'LOGICAL TOPOLOGY'}<span>{snapshot.devices.length} devices · {snapshot.links.length} links</span></div>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={compact ? undefined : onNodesChange} onNodeDragStop={compact ? undefined : onNodeDragStop}
      onEdgesDelete={compact ? undefined : edges => { edges.forEach(e => lab.mutate(n => n.removeLink(e.id))); useUI.setState({ selectedLink: '' }); }}
      onBeforeDelete={async () => onCanvasItem(document.activeElement) || armed.current && document.activeElement === document.body}
      onConnect={compact ? undefined : connect} connectionMode={ConnectionMode.Loose}
      onNodeClick={(_, node) => { if (!compact) useUI.setState({ selectedDevice: node.id, selectedLink: '', inspectorTab: useUI.getState().inspectorTab === 'debug' ? 'debug' : useUI.getState().inspectorTab }); }}
      onEdgeClick={(_, edge) => { if (!compact) useUI.setState({ selectedLink: edge.id, inspectorTab: 'config' }); }}
      onEdgeDoubleClick={(_, edge) => { if (!compact) lab.mutate(n => n.setLinkState(edge.id, !snapshot.links.find(l => l.id === edge.id)!.up)); }}
      fitView fitViewOptions={{ padding: compact ? 0.2 : 0.2 }} minZoom={0.15} maxZoom={1.5} nodesDraggable={!compact} nodesConnectable={!compact}
      elementsSelectable={!compact} deleteKeyCode={compact ? null : ['Backspace', 'Delete']} panOnDrag={!compact} zoomOnScroll={!compact} zoomOnDoubleClick={false}>
      <Background color="#c7d8d1" gap={20} size={1} variant={BackgroundVariant.Dots}/>
      {!compact && <Controls showInteractive={false}/>}
    </ReactFlow>
    <div className="canvas-legend"><span><i className="legend-line"/> Link Up</span><span><i className="legend-line down"/> Link Down</span>{!compact && Object.values(lags).some(x => Object.keys(x).length) && <span><i className="legend-line lag"/> LAG</span>}
      {!compact && <><label className="legend-toggle" title="ブロードキャストが届く範囲（同じネットワーク）ごとに、機器を色分けします"><input type="checkbox" checked={domainView} onChange={e => useUI.setState({ domainView: e.target.checked })}/>ブロードキャストドメインを色分け</label><span>ポートからポートへドラッグして配線 · ケーブルをクリックで選択 · ダブルクリックでリンクの Down / Up を切り替え</span></>}</div>
  </div>;
}
export default function TopologyEditor(props: { compact?: boolean }) { return <ReactFlowProvider><Editor {...props}/></ReactFlowProvider>; }

import { useEffect, useId, useRef, useState } from 'react';
import { visuals, type Visual, type VisualNode } from './visuals';
import './theory-visual.css';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Clip arrows at the edge of the node cards, including diagonal connections. */
function endpoints(a: VisualNode, b: VisualNode) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.min(65 / Math.max(Math.abs(dx), 1), 32 / Math.max(Math.abs(dy), 1));
  return { x1: a.x + dx * t, y1: a.y + dy * t, x2: b.x - dx * t, y2: b.y - dy * t };
}

function Graph({ visual, step, animate, marker }: { visual: Visual; step: number; animate: boolean; marker: string }) {
  const current = visual.steps[step];
  return <svg className="tv-svg" viewBox="0 0 660 300" role="img" aria-label={`${visual.title}：${current.label}`}>
    <title>{current.text}</title>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
    {visual.groups?.map(g => <g key={g.label} className="tv-group"><rect x={g.x} y={g.y} width={g.width} height={g.height} rx="14"/><text x={g.x + 14} y={g.y + 23}>{g.label}</text></g>)}
    {visual.edges?.map((edge, i) => {
      const a = visual.nodes!.find(n => n.id === edge.from)!, b = visual.nodes!.find(n => n.id === edge.to)!;
      const { x1, x2, y1, y2 } = endpoints(a, b);
      const active = current.edges?.includes(i);
      const blocked = current.blockedEdges?.includes(i);
      // Reverse-direction teaching steps share the same wire. Only draw the active direction.
      const reverseActive = visual.edges!.some((other, j) => other.from === edge.to && other.to === edge.from && current.edges?.includes(j));
      if (!active && reverseActive) return null;
      const path = `M ${x1} ${y1} L ${x2} ${y2}`;
      return <g key={i} className={`tv-edge ${active ? 'is-active' : ''} ${blocked ? 'is-blocked' : ''}`}>
        <path d={path} markerStart={visual.bidirectional ? `url(#${marker})` : undefined} markerEnd={`url(#${marker})`}/>
        {edge.label && <g><rect x={(x1 + x2) / 2 - 44} y={(y1 + y2) / 2 - 11} width="88" height="22" rx="5"/><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 5} textAnchor="middle">{edge.label}</text></g>}
        {active && animate && <circle r="5" className="tv-packet"><animateMotion dur="1.8s" repeatCount="indefinite" path={path}/></circle>}
        {blocked && <g className="tv-block-mark"><rect x={(x1 + x2) / 2 - 10} y={(y1 + y2) / 2 - 11} width="20" height="22" rx="4"/><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 5} textAnchor="middle">×</text></g>}
      </g>;
    })}
    {visual.nodes?.map(node => <g key={node.id} className={`tv-node ${current.nodes?.includes(node.id) ? 'is-active' : ''} ${current.blockedNodes?.includes(node.id) ? 'is-blocked' : ''}`}>
      <rect x={node.x - 65} y={node.y - 32} width="130" height="64" rx="10"/>
      <text x={node.x} y={node.y - 4} textAnchor="middle">{node.label}</text>
      <text className="tv-node-detail" x={node.x} y={node.y + 17} textAnchor="middle">{node.detail}</text>
      {current.blockedNodes?.includes(node.id) && <text className="tv-block-label" x={node.x} y={node.y - 42} textAnchor="middle">× 利用不可</text>}
    </g>)}
  </svg>;
}

function Sequence({ visual, step, animate, marker }: { visual: Visual; step: number; animate: boolean; marker: string }) {
  const lanes = visual.lanes!, messages = visual.messages!;
  const height = 95 + messages.length * 45;
  const x = (index: number) => 70 + index * 520 / (lanes.length - 1);
  return <svg className="tv-svg" viewBox={`0 0 660 ${height}`} role="img" aria-label={`${visual.title}：${visual.steps[step].label}`}>
    <title>{visual.steps[step].text}</title>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
    {lanes.map((lane, i) => <g key={lane} className="tv-lane"><rect x={x(i) - 55} y="10" width="110" height="36" rx="8"/><text x={x(i)} y="33" textAnchor="middle">{lane}</text><line x1={x(i)} y1="48" x2={x(i)} y2={height - 15}/></g>)}
    {messages.map((message, i) => {
      const y = 95 + i * 45, from = x(message.from), to = x(message.to);
      const path = `M ${from} ${y} H ${to}`;
      return <g key={i} className={`tv-message ${i === step ? 'is-active' : ''} ${i > step ? 'is-future' : ''}`}>
        <path d={path} markerEnd={`url(#${marker})`}/>
        <text x={(from + to) / 2} y={y - 9} textAnchor="middle">{i + 1}. {message.label}</text>
        {i === step && animate && <circle r="5" className="tv-packet"><animateMotion dur="1.8s" repeatCount="indefinite" path={path}/></circle>}
      </g>;
    })}
  </svg>;
}

function Layers({ visual, step }: { visual: Visual; step: number }) {
  const inspecting = visual === visuals['capture-layers'];
  const layers = visual.layers!;
  const nest = (i: number): React.ReactNode => {
    const layer = layers[i];
    return <div className={`tv-layer tv-layer-${i} ${step === i ? 'is-active' : ''}`} key={layer.label}>
      <div className="tv-layer-label"><strong>{layer.label}</strong><span>{layer.detail}</span></div>
      {inspecting ? i < layers.length - 1 && nest(i + 1) : i > 0 && nest(i - 1)}
    </div>;
  };
  return <div className="tv-layers" aria-label={inspecting ? 'Ethernetの内側にIPv4、その内側にTCP、その内側にHTTP' : `${visual.title}：${visual.steps[step].label}`}>{nest(inspecting ? 0 : step)}</div>;
}

const prefixes = [24, 26, 27, 28];
const routes = ['0.0.0.0/0', '192.168.0.0/16', '192.168.2.0/24', '192.168.2.128/25', '192.168.3.0/24'];
function Subnet({ step }: { step: number }) {
  const prefix = prefixes[step], size = 2 ** (32 - prefix), network = Math.floor(70 / size) * size, broadcast = network + size - 1;
  return <div className="tv-subnet">
    <div className="tv-bit-legend"><span>ネットワーク部：{prefix}ビット</span><span>ホスト部：{32 - prefix}ビット</span></div>
    <div className="tv-octets" aria-label={`192.168.10.70/${prefix}のビット表示`}>
      {[192, 168, 10, 70].map((octet, i) => <div className="tv-octet" key={i}><strong>{octet}</strong><div>{octet.toString(2).padStart(8, '0').split('').map((bit, j) => <span key={j} className={i * 8 + j < prefix ? 'tv-network-bit' : 'tv-host-bit'}>{bit}</span>)}</div></div>)}
    </div>
    <dl className="tv-facts"><div><dt>ネットワーク</dt><dd>192.168.10.{network}/{prefix}</dd></div><div><dt>使えるホスト</dt><dd>.{network + 1} 〜 .{broadcast - 1}（{size - 2}台）</dd></div><div><dt>ブロードキャスト</dt><dd>192.168.10.{broadcast}</dd></div><div><dt>サブネットマスク</dt><dd>255.255.255.{256 - size}</dd></div></dl>
  </div>;
}

function Vlsm({ step }: { step: number }) {
  const allocations = [{ name: '営業', size: 64, range: '.0〜.63', prefix: 26 }, { name: '開発', size: 32, range: '.64〜.95', prefix: 27 }, { name: '総務', size: 16, range: '.96〜.111', prefix: 28 }];
  const used = allocations.slice(0, step + 1).reduce((sum, a) => sum + a.size, 0);
  return <div className="tv-vlsm"><div className="tv-address-scale"><span>.0</span><span>192.168.10.0/24</span><span>.255</span></div>
    <div className="tv-allocation" aria-label={`256アドレス中${used}アドレスを割り当て済み`}>{allocations.slice(0, step + 1).map((a, i) => <div key={a.name} className={`tv-allocation-${i}`} style={{ flexGrow: a.size }} title={`${a.name} /${a.prefix} ${a.range}`}>{i + 1}</div>)}<div className="tv-unallocated" style={{ flexGrow: 256 - used }}>未割当</div></div>
    <dl className="tv-facts">{allocations.slice(0, step + 1).map((a, i) => <div key={a.name}><dt>{i + 1}. {a.name} /{a.prefix}</dt><dd>{a.range} · {a.size}個</dd></div>)}<div><dt>未割当</dt><dd>.{used}〜.255 · {256 - used}個</dd></div></dl>
    <p className="tv-small">未割当の範囲は、必ずしも1つのCIDRで表せるとは限りません。</p>
  </div>;
}

function RouteTable({ step }: { step: number }) {
  const matches = [[0, 1, 2], [0, 1, 2, 3], [0, 1, 4], [0]][step];
  const selected = [2, 3, 4, 0][step];
  return <div className="tv-table-wrap"><table className="tv-table"><thead><tr><th>経路</th><th>一致する長さ</th><th>判定</th></tr></thead><tbody>{routes.map((route, i) => <tr key={route} className={i === selected ? 'is-selected' : ''}><td>{route}</td><td><div className="tv-prefix-track"><span style={{ width: `${Number(route.split('/')[1]) / 32 * 100}%` }}/></div>/{route.split('/')[1]}</td><td>{i === selected ? '✓ 採用' : matches.includes(i) ? '一致' : '不一致'}</td></tr>)}</tbody></table></div>;
}

function Rules({ step }: { step: number }) {
  const selected = [1, 0, 2][step];
  return <div className="tv-table-wrap"><table className="tv-table"><thead><tr><th>順番</th><th>条件</th><th>動作</th><th>判定</th></tr></thead><tbody>{[['192.168.1.20から', 'DENY'], ['宛先 TCP/80', 'ALLOW'], ['すべて', 'DENY']].map(([condition, action], i) => <tr key={condition} className={i === selected ? 'is-selected' : ''}><td>{i + 1}</td><td>{condition}</td><td>{action}</td><td>{i === selected ? '✓ ここで決定' : i < selected ? '不一致' : '評価しない'}</td></tr>)}</tbody></table></div>;
}

function Comparison({ visual, step }: { visual: Visual; step: number }) {
  const current = visual.steps[step];
  return <div className="tv-table-wrap"><table className="tv-table tv-comparison"><caption className="sr-only">{visual.title}：{current.label}</caption><thead><tr>{visual.columns!.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{current.table!.map((row, i) => <tr key={i} className={current.focusRow === i ? 'is-selected' : ''}>{row.map((cell, j) => <td key={j}>{j === 0 && current.focusRow === i && <span className="tv-focus-label">注目</span>}{cell}</td>)}</tr>)}</tbody></table></div>;
}

function Bars({ visual, step }: { visual: Visual; step: number }) {
  const { max, unit, limit } = visual.scale!;
  return <div className="tv-bars">
    <div className="tv-address-scale"><span>0 {unit}</span><span>長さは量に比例</span><span>{max} {unit}</span></div>
    {limit !== undefined && <p className="tv-limit-caption">破線：経路MTU {limit} {unit}</p>}
    {visual.steps[step].bars!.map(bar => {
      const total = bar.parts.reduce((sum, part) => sum + part.value, 0);
      const overflow = limit !== undefined && total > limit;
      return <div className={`tv-bar-row ${overflow ? 'is-overflow' : ''}`} key={bar.label}>
        <div className="tv-bar-heading"><strong>{bar.label}</strong><span>{total} {unit}</span></div>
        <div className="tv-bar-track" role="img" aria-label={`${bar.label}：${bar.parts.map(p => `${p.label} ${p.value} ${unit}`).join(' + ')}、合計${total} ${unit}。${bar.note}`}>
          {bar.parts.map((part, i) => <span className={`tv-bar-part tv-allocation-${i}`} key={part.label} style={{ width: `${part.value / max * 100}%` }}/>) }
          {limit !== undefined && <span className="tv-limit-line" style={{ left: `${limit / max * 100}%` }}/>} 
        </div>
        <ul className="tv-bar-legend">{bar.parts.map((part, i) => <li key={part.label}><i className={`tv-allocation-${i}`} aria-hidden="true"/>{part.label}：{part.value} {unit}</li>)}</ul>
        <p className="tv-bar-note">{overflow ? '× ' : ''}{bar.note}</p>
      </div>;
    })}
  </div>;
}

const seriesColors = ['#176b56', '#3e6aa8', '#c0782f'];
/** Line graph. `reveal` clips the lines at an x value; while playing, the clip grows from the previous step's value. */
function Chart({ visual, step, animate, marker }: { visual: Visual; step: number; animate: boolean; marker: string }) {
  const { x, y, series, limit } = visual.chart!;
  const current = visual.steps[step], previous = visual.steps[step - 1];
  const left = 64, right = 640, top = 34, bottom = 250;
  const sx = (v: number) => left + v / x.max * (right - left), sy = (v: number) => bottom - v / y.max * (bottom - top);
  const width = sx(current.reveal ?? x.max) - left, from = sx(previous?.reveal ?? 0) - left;
  const mark = current.mark, flip = mark && sx(mark.x) > 520;
  return <><svg className="tv-svg tv-chart" viewBox="0 0 660 300" role="img" aria-label={`${visual.title}：${current.label}`}>
    <title>{current.text}</title>
    <defs><clipPath id={marker}><rect x={left - 4} y="0" height="300" width={width + 8}>{animate && width > from && <animate key={step} attributeName="width" from={from + 8} to={width + 8} dur="1.2s" fill="freeze"/>}</rect></clipPath></defs>
    {y.ticks.map(t => <g key={t} className="tv-grid"><line x1={left} x2={right} y1={sy(t)} y2={sy(t)}/><text x={left - 8} y={sy(t) + 4} textAnchor="end">{t}</text></g>)}
    {x.ticks.map(t => <text key={t} className="tv-tick" x={sx(t)} y={bottom + 18} textAnchor="middle">{t}</text>)}
    <path className="tv-axis" d={`M ${left} ${top - 10} V ${bottom} H ${right}`}/>
    <text className="tv-axis-label" x={left - 8} y="16">{y.label}</text>
    <text className="tv-axis-label" x={right} y={bottom + 40} textAnchor="end">{x.label}</text>
    {limit && <g className="tv-chart-limit"><line x1={left} x2={right} y1={sy(limit.y)} y2={sy(limit.y)}/><text x={right} y={sy(limit.y) - 6} textAnchor="end">{limit.label}</text></g>}
    <g clipPath={`url(#${marker})`}>{series.map((line, i) => <polyline key={line.label} className="tv-series" stroke={seriesColors[i]} points={line.points.map(([px, py]) => `${sx(px)},${sy(py)}`).join(' ')}/>)}</g>
    {mark && <g className="tv-chart-mark"><line x1={sx(mark.x)} x2={sx(mark.x)} y1={sy(mark.y)} y2={bottom}/><circle cx={sx(mark.x)} cy={sy(mark.y)} r="6"/><text x={sx(mark.x) + (flip ? -10 : 10)} y={Math.max(sy(mark.y) - 10, top)} textAnchor={flip ? 'end' : 'start'}>{mark.label}</text></g>}
  </svg>
  {series.length > 1 && <ul className="tv-bar-legend tv-chart-legend">{series.map((line, i) => <li key={line.label}><i style={{ background: seriesColors[i], borderColor: seriesColors[i] }} aria-hidden="true"/>{line.label}</li>)}</ul>}
  </>;
}

function Player({ visual, id }: { visual: Visual; id: string }) {
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const figure = useRef<HTMLElement>(null);
  const current = visual.steps[step];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (step === visual.steps.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [playing, step, visual]);
  // Stop work when the reader switches tabs or scrolls the illustration out of view.
  useEffect(() => {
    const visibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) setPlaying(false); });
    if (figure.current) observer.observe(figure.current);
    return () => { document.removeEventListener('visibilitychange', visibility); observer.disconnect(); };
  }, []);
  const select = (index: number) => { setPlaying(false); setStep(index); };
  const graphic = { visual, step, animate: playing && !reduced, marker: `tv-arrow-${uid}` };
  return <figure ref={figure} className="theory-visual" data-visual={id} aria-labelledby={`tv-title-${uid}`}>
    <figcaption><span className="tv-eyebrow">VISUAL GUIDE <span>図で理解する</span></span><strong id={`tv-title-${uid}`}>{visual.title}</strong><p>{visual.intro}</p></figcaption>
    {['graph', 'sequence', 'routes', 'rules', 'compare', 'chart'].includes(visual.kind) && <p className="tv-scroll-hint">↔ 図は左右にスクロールできます</p>}
    <div className="tv-stage" tabIndex={0} role="region" aria-label={`${visual.title}の図。横長の図は左右にスクロールできます`}>
      {visual.kind === 'graph' && <Graph {...graphic}/>}
      {visual.kind === 'sequence' && <Sequence {...graphic}/>}
      {visual.kind === 'layers' && <Layers visual={visual} step={step}/>}
      {visual.kind === 'subnet' && <Subnet step={step}/>}
      {visual.kind === 'vlsm' && <Vlsm step={step}/>}
      {visual.kind === 'routes' && <RouteTable step={step}/>}
      {visual.kind === 'rules' && <Rules step={step}/>}
      {visual.kind === 'compare' && <Comparison visual={visual} step={step}/>}
      {visual.kind === 'bars' && <Bars visual={visual} step={step}/>}
      {visual.kind === 'chart' && <Chart {...graphic}/>}
    </div>
    <div className="tv-step-picker" role="group" aria-label="図のステップ">{visual.steps.map((item, i) => <button key={i} type="button" aria-pressed={step === i} onClick={() => select(i)}><span>{String(i + 1).padStart(2, '0')}</span>{item.label}</button>)}</div>
    <div className="tv-explanation" aria-live="polite" aria-atomic="true"><strong>{current.label}</strong><p>{current.text}</p>
      {current.facts && <dl className="tv-facts">{current.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    </div>
    <div className="tv-controls"><button type="button" className="tv-play" onClick={() => { if (playing) setPlaying(false); else { if (step === visual.steps.length - 1) setStep(0); setPlaying(true); } }}>{playing ? '一時停止' : '▶ 再生'}</button><button type="button" aria-label="図を最初に戻す" onClick={() => select(0)}>↺ 最初へ</button><span>{step + 1} / {visual.steps.length}</span><button type="button" aria-label="図の前のステップ" disabled={step === 0} onClick={() => select(step - 1)}>← 前へ</button><button type="button" aria-label="図の次のステップ" disabled={step === visual.steps.length - 1} onClick={() => select(step + 1)}>次へ →</button></div>
    <details className="tv-transcript"><summary>図の説明をまとめて読む</summary><ol>{visual.steps.map((item, i) => <li key={i}><strong>{item.label}</strong> — {item.text}</li>)}</ol></details>
  </figure>;
}

export default function TheoryVisual({ id }: { id: string }) {
  const visual = visuals[id];
  return visual ? <Player key={id} visual={visual} id={id}/> : null;
}

import { useId } from 'react';
import { diagrams } from './diagrams';
import './theory-diagram.css';

export interface DiagramCard { label: string; detail?: string; tone?: 'blue' | 'amber'; children?: DiagramCard[] }
export interface DiagramNode extends DiagramCard { id: string; column: number; row: number }
export type Diagram = { title: string; note?: string } & (
  | { kind: 'packet'; rows: { label: string; fields: DiagramCard[] }[] }
  | { kind: 'flow'; paths: { label?: string; steps: DiagramCard[] }[] }
  | { kind: 'tree'; roots: DiagramCard[] }
  | { kind: 'network'; nodes: DiagramNode[]; links: { from: string; to: string; label?: string; directed?: boolean; blocked?: boolean }[] }
  | { kind: 'bits'; rows: { label: string; value: number[]; prefix?: number }[] }
);

function Card({ card }: { card: DiagramCard }) {
  return <div className={`td-card td-${card.tone ?? 'green'}`}><strong>{card.label}</strong>{card.detail && <span>{card.detail}</span>}
    {card.children && <div className="td-nested">{card.children.map((child, i) => <Card card={child} key={i}/>)}</div>}
  </div>;
}

function Tree({ cards }: { cards: DiagramCard[] }) {
  return <ul className="td-tree">{cards.map((card, i) => <li key={i}><Card card={{ ...card, children: undefined }}/>{card.children && <Tree cards={card.children}/>}</li>)}</ul>;
}

function Network({ diagram, marker }: { diagram: Extract<Diagram, { kind: 'network' }>; marker: string }) {
  // Turn long paths downward so the reader can see every endpoint in the article column.
  const columns = Math.max(...diagram.nodes.map(n => n.column)) + 1;
  const rows = Math.max(...diagram.nodes.map(n => n.row)) + 1;
  const vertical = columns > 3;
  const width = (vertical ? rows : columns) * 220;
  const height = (vertical ? columns : rows) * 140;
  const position = (n: DiagramNode) => ({ x: (vertical ? n.row : n.column) * 220 + 110, y: (vertical ? n.column : n.row) * 140 + 70 });
  return <>
    <p className="td-note td-network-hint">接続線と、その下の一覧を対応させて読めます。横長の図は左右にスクロールできます。</p>
    <div className="td-network-scroll" tabIndex={0} role="region" aria-label={`${diagram.title}の接続図。横にスクロールできます`}>
      <svg className="td-network" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width, maxWidth: width }} role="img" aria-label={diagram.title}>
        <title>{diagram.nodes.map(n => `${n.label} ${n.detail ?? ''}`).join('、')}</title>
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
        {diagram.links.map((link, i) => {
          const a = position(diagram.nodes.find(n => n.id === link.from)!);
          const b = position(diagram.nodes.find(n => n.id === link.to)!);
          const dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.min(88 / Math.max(Math.abs(dx), 1), 50 / Math.max(Math.abs(dy), 1));
          return <g key={i} className={link.blocked ? 'td-link td-blocked' : 'td-link'}>
            <path d={`M ${a.x + dx * t} ${a.y + dy * t} L ${b.x - dx * t} ${b.y - dy * t}`} markerEnd={link.directed ? `url(#${marker})` : undefined}/>
            {link.blocked && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} textAnchor="middle">×</text>}
          </g>;
        })}
        {diagram.nodes.map(node => {
          const p = position(node);
          return <foreignObject key={node.id} x={p.x - 88} y={p.y - 50} width="176" height="100"><Card card={node}/></foreignObject>;
        })}
      </svg>
    </div>
    <ul className="td-connections" aria-label="接続の一覧">{diagram.links.map((link, i) => <li key={i}><strong>{diagram.nodes.find(n => n.id === link.from)!.label} {link.blocked ? '×' : link.directed ? '→' : '—'} {diagram.nodes.find(n => n.id === link.to)!.label}</strong>{link.label && <span>{link.label}</span>}</li>)}</ul>
  </>;
}

export default function TheoryDiagram({ id }: { id: string }) {
  const uid = useId();
  const diagram: Diagram | undefined = diagrams[id];
  if (!diagram) return null;
  return <figure className="theory-diagram" data-diagram={id} aria-labelledby={`td-${uid}`}>
    <figcaption id={`td-${uid}`}><span>図解</span>{diagram.title}</figcaption>
    {diagram.kind === 'packet' && <div className="td-packets">{diagram.rows.map((row, i) => <div className="td-packet-row" key={i}><p className="td-row-label">{row.label}</p><div className="td-field-scroll" tabIndex={0} role="region" aria-label={`${row.label}：左から順に並ぶフィールド`}><div className="td-fields">{row.fields.map((field, j) => <Card card={field} key={j}/>)}</div></div></div>)}<p className="td-note">左から順に並びます。区画の幅は実際のバイト数に比例しません。横にスクロールできます。</p></div>}
    {diagram.kind === 'flow' && <div className="td-flows">{diagram.paths.map((path, i) => <div key={i}>{path.label && <p className="td-row-label">{path.label}</p>}<ol className="td-flow">{path.steps.map((step, j) => <li key={j}><span className="td-step-number" aria-hidden="true">{String(j + 1).padStart(2, '0')}</span><Card card={step}/></li>)}</ol></div>)}</div>}
    {diagram.kind === 'tree' && <Tree cards={diagram.roots}/>}
    {diagram.kind === 'network' && <Network diagram={diagram} marker={`td-arrow-${uid}`}/>}
    {diagram.kind === 'bits' && <div className="td-bit-rows">{diagram.rows.map((row, i) => <div key={i}><p className="td-row-label">{row.label}</p><div className="td-octets">{row.value.map((octet, j) => <div key={j}><strong>{octet}</strong><div className="td-bits">{octet.toString(2).padStart(8, '0').split('').map((bit, k) => <span key={k} className={row.prefix === undefined || j * 8 + k < row.prefix ? 'td-bit-network' : 'td-bit-host'}>{bit}<small>{128 >> k}</small></span>)}</div></div>)}</div>{row.prefix !== undefined && <p className="td-note">緑：ネットワーク部 {row.prefix}ビット ／ オレンジ：ホスト部 {row.value.length * 8 - row.prefix}ビット</p>}</div>)}<p className="td-note">各ビットの下の数字は桁の重みです。</p></div>}
    {diagram.note && <p className="td-note td-footer">{diagram.note}</p>}
  </figure>;
}

import { useMemo, useState } from 'react';
import ipaddr from 'ipaddr.js';
import { cidr, dotted } from '../../simulator/l3/ipv4';
import { gradeAllocation, planVlsm, practice, type Need } from '../../lessons/vlsm';
import SubnetCalculator from './SubnetCalculator';
import { Icon } from '../Icon';

export function CidrVisualizer() {
  const [block, setBlock] = useState('192.168.10.0/24'); const [prefix, setPrefix] = useState(26);
  let parsed: ReturnType<typeof cidr> | undefined; let error = '';
  try { parsed = cidr(block); if (prefix < parsed.prefix || prefix > 30) error = `プレフィックスは /${parsed.prefix}〜/30 で選びます`; } catch (e) { error = (e as Error).message; }
  const size = 2 ** (32 - prefix);
  const count = parsed && !error ? Math.min(64, 2 ** (prefix - parsed.prefix)) : 0;
  return <div className="visual-card"><div className="tool-heading"><Icon name="globe"/><div><h3>CIDRビジュアライザ</h3><p>大きなアドレスブロックを、同じ大きさのサブネットに分けた様子です。スライダーでプレフィックス長を変えると、各サブネットの先頭がブロックサイズ（アドレスの数）の倍数になっていることがわかります。</p></div></div>
    <div className="inline-form"><label>ブロック<input aria-label="分割するブロック" value={block} onChange={e => setBlock(e.target.value)}/></label><label>分割後 /{prefix}<input aria-label="分割後のプレフィックス" type="range" min={parsed?.prefix ?? 16} max={30} value={prefix} onChange={e => setPrefix(Number(e.target.value))}/></label></div>
    {error ? <p className="error-text">{error}</p> : <><p className="tiny">/{prefix} = {size} アドレス（ホスト {size - 2}）× {2 ** (prefix - parsed!.prefix)} 個{count < 2 ** (prefix - parsed!.prefix) ? '（先頭64個を表示）' : ''}</p>
      <div className="cidr-bar">{Array.from({ length: count }, (_, i) => <div key={i} className="cidr-block" style={{ flexBasis: `${100 / Math.min(count, 16)}%` }}><strong>{dotted(parsed!.network + i * size)}/{prefix}</strong><small>{dotted(parsed!.network + i * size + 1)}〜{dotted(parsed!.network + (i + 1) * size - 2)}</small></div>)}</div></>}</div>;
}
export function VlsmPlanner() {
  const [block, setBlock] = useState('192.168.10.0/24');
  const [rows, setRows] = useState<Need[]>([{ name: '営業', hosts: 51 }, { name: '開発', hosts: 26 }, { name: '総務', hosts: 11 }, { name: 'ルータ間', hosts: 2 }]);
  const plan = useMemo(() => { try { return planVlsm(block, rows.filter(r => r.name && r.hosts > 0)); } catch (e) { return { allocations: [], free: '', error: (e as Error).message }; } }, [block, rows]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="layers"/><div><h3>VLSMプランナー</h3><p>用途ごとの必要台数（Gatewayを含む）を入れると、大きい用途から順に、境界のそろった位置へ割り当てます。台数を変えて、割り当てがどう変わるか見てみましょう。</p></div></div>
    <label>アドレスブロック<input aria-label="VLSMのブロック" value={block} onChange={e => setBlock(e.target.value)}/></label>
    <table className="mini-table"><thead><tr><th>用途</th><th>必要台数</th><th/></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td><input aria-label={`用途${i + 1}`} value={r.name} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/></td><td><input aria-label={`台数${i + 1}`} type="number" min={1} value={r.hosts} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, hosts: Number(e.target.value) } : x))}/></td><td><button className="icon-button" aria-label="行を削除" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="close" size={13}/></button></td></tr>)}</tbody></table>
    <button className="button small secondary" onClick={() => setRows([...rows, { name: `用途${rows.length + 1}`, hosts: 10 }])}><Icon name="plus" size={12}/>行を追加</button>
    {plan.error ? <p className="error-text">{plan.error}</p> : <table className="mini-table vlsm"><thead><tr><th>用途</th><th>台数</th><th>割り当て</th><th>ホスト範囲</th><th>ブロードキャスト</th><th>使用可能</th></tr></thead><tbody>{plan.allocations.map(a => <tr key={a.name}><td>{a.name}</td><td>{a.hosts}</td><td><code>{a.network}</code></td><td>{a.first}〜{a.last}</td><td>{a.broadcast}</td><td>{a.usable}</td></tr>)}</tbody></table>}
    {!plan.error && <p className="tiny">未使用: {plan.free}</p>}</div>;
}
export function PracticeQuestions() {
  const [seed, setSeed] = useState(1); const q = practice(seed);
  const [a, setA] = useState({ network: '', broadcast: '', hosts: '' }); const [checked, setChecked] = useState(false);
  const ok = (k: keyof typeof a) => a[k].trim() === q[k];
  return <div className="visual-card"><div className="tool-heading"><Icon name="target"/><div><h3>練習問題</h3><p>表示されたアドレスから、ネットワークアドレス・ブロードキャストアドレス・使えるホスト数を計算して入力します。「次の問題」で何度でも練習できます。</p></div></div>
    <p className="practice-q"><code>{q.question}</code></p>
    <form className="mastery-form" onSubmit={e => { e.preventDefault(); setChecked(true); }}>{(['network', 'broadcast', 'hosts'] as const).map(k => <label key={k}>{{ network: 'ネットワークアドレス', broadcast: 'ブロードキャスト（/31・/32は最後のアドレス）', hosts: '使用可能なホスト数' }[k]}<input aria-label={`練習 ${k}`} value={a[k]} onChange={e => { setA({ ...a, [k]: e.target.value }); setChecked(false); }}/>{checked && <small className={ok(k) ? 'success-text' : 'error-text'}>{ok(k) ? '正解' : `答え: ${q[k]}`}</small>}</label>)}
      <div className="quiz-actions"><button className="button small">答え合わせ</button><button type="button" className="button small secondary" onClick={() => { setSeed(seed + 1); setA({ network: '', broadcast: '', hosts: '' }); setChecked(false); }}>次の問題</button></div></form></div>;
}
export const puzzle = { block: '172.20.8.0/22', needs: [{ name: '営業部', hosts: 201 }, { name: '開発部', hosts: 120 }, { name: '総務部', hosts: 52 }, { name: '会議室Wi-Fi', hosts: 27 }, { name: '管理用', hosts: 11 }] };
export function AllocationPuzzle({ onPass }: { onPass?: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<ReturnType<typeof gradeAllocation>>();
  return <div className="visual-card"><div className="tool-heading"><Icon name="flag"/><div><h3>アドレス割り当てパズル</h3><p>この会社には5つの用途があります。<code>{puzzle.block}</code> から、無駄なく重複なく割り当ててください（台数はGatewayを含む）。</p></div></div>
    <form className="mastery-form" onSubmit={e => { e.preventDefault(); const c = gradeAllocation(puzzle.block, puzzle.needs, answers); setChecks(c); if (c.every(x => x.pass)) onPass?.(); }}>
      {puzzle.needs.map(n => <label key={n.name}>{n.name}（{n.hosts}台）<input aria-label={`${n.name} のCIDR`} placeholder="172.20.8.0/24" value={answers[n.name] ?? ''} onChange={e => setAnswers({ ...answers, [n.name]: e.target.value })}/></label>)}
      <button className="button small">判定する<Icon name="check" size={14}/></button></form>
    {checks && <div className="assessment">{checks.map(c => <span key={c.label} className={c.pass ? 'passed' : 'not-passed'}><Icon name={c.pass ? 'check' : 'close'} size={14}/>{c.label}</span>)}</div>}
    <p className="muted tiny">答えは1つではありません。大きい部署から、ブロックサイズの倍数の位置に置くと考えやすくなります。</p></div>;
}
export function Ipv6Analyzer() {
  const [value, setValue] = useState('2001:0db8:0000:0000:0000:ff00:0042:8329/64');
  let out: { expanded: string; compressed: string; kind: string; prefix?: number; network?: string } | undefined; let error = '';
  try {
    const [addr, p] = value.trim().split('/');
    const a = ipaddr.IPv6.parse(addr);
    const range = a.range();
    const kind = ({ unspecified: '未指定 ::', loopback: 'ループバック ::1', linkLocal: 'リンクローカル fe80::/10', uniqueLocal: 'ユニークローカル（ULA）fc00::/7', multicast: 'マルチキャスト ff00::/8', ipv4Mapped: 'IPv4射影アドレス', rfc6145: 'IPv4変換', rfc6052: 'IPv4埋め込み', '6to4': '6to4', teredo: 'Teredo', reserved: 'ドキュメント用など予約（2001:db8::/32 等）', unicast: 'グローバルユニキャスト 2000::/3' } as Record<string, string>)[range] ?? range;
    const prefix = p === undefined ? undefined : Number(p);
    if (prefix !== undefined && (!Number.isInteger(prefix) || prefix < 0 || prefix > 128)) throw new Error('プレフィックスは0〜128です');
    const network = prefix !== undefined ? ipaddr.IPv6.networkAddressFromCIDR(`${addr}/${prefix}`).toString() : undefined;
    out = { expanded: a.parts.map(x => x.toString(16).padStart(4, '0')).join(':'), compressed: a.toString(), kind, prefix, network };
  } catch (e) { error = e instanceof Error && e.message.includes('ipaddr') ? 'IPv6アドレスとして解釈できません' : (e as Error).message; }
  return <div className="visual-card"><div className="tool-heading"><Icon name="globe"/><div><h3>IPv6アドレスアナライザ</h3><p>IPv6アドレスは、128ビットを16ビットずつ8つのグループに分け、16進数で書きます。各グループの先頭の0は省略でき、0だけのグループが続く部分は :: にまとめられます（:: は1回だけ）。アドレスを書き換えて、完全表記と省略表記を比べましょう。</p></div></div>
    <label>IPv6アドレス（/プレフィックス可）<input aria-label="IPv6アドレス" value={value} onChange={e => setValue(e.target.value)} spellCheck={false}/></label>
    {error ? <p className="error-text">{error}</p> : out && <dl className="packet-summary"><dt>完全表記</dt><dd><code>{out.expanded}</code></dd><dt>省略表記（RFC 5952）</dt><dd><code>{out.compressed}</code></dd><dt>種類</dt><dd>{out.kind}</dd>{out.network && <><dt>ネットワーク</dt><dd><code>{out.network}/{out.prefix}</code></dd><dt>インターフェースID</dt><dd>{128 - out.prefix!} ビット{out.prefix === 64 ? '（LANの標準 /64）' : ''}</dd></>}</dl>}
    <p className="muted tiny">IPv6にはブロードキャストがなく、近隣探索（NDP）でMACアドレスを調べます。このシミュレータでIPv6を扱うのは、この分析ツールだけです（IPv6パケットの転送はできません）。</p></div>;
}
export default function SubnetTools() {
  const [tab, setTab] = useState(0);
  const tabs = ['計算機', 'CIDR', 'VLSM', '練習問題', 'パズル', 'IPv6'];
  return <div className="tools"><div className="segmented wide">{tabs.map((t, i) => <button key={t} className={tab === i ? 'active' : ''} onClick={() => setTab(i)}>{t}</button>)}</div>
    {tab === 0 && <SubnetCalculator/>}{tab === 1 && <CidrVisualizer/>}{tab === 2 && <VlsmPlanner/>}{tab === 3 && <PracticeQuestions/>}
    {tab === 4 && <AllocationPuzzle/>}{tab === 5 && <Ipv6Analyzer/>}</div>;
}

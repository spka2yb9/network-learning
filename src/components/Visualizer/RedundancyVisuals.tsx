import { useMemo, useState } from 'react';
import { NetworkSimulator, type StreamResult } from '../../simulator/core/NetworkSimulator';
import type { LagMode, LoadBalance } from '../../simulator/core/types';
import { build, iperf } from '../../simulator/scenarios/build';
import { designScenario, ecmpScenario, lagScenario, type DesignOptions, type DiamondRouting } from '../../simulator/scenarios/chapters';
import { checkLink, media, portTypes } from '../../lessons/media';
import { speedText } from '../../cli/common';
import { Icon } from '../Icon';

const SRV = '10.20.0.10';
const between = (n: NetworkSimulator, a: string, b: string) => n.snapshot().links.filter(l => (l.sourceDevice === a && l.targetDevice === b) || (l.sourceDevice === b && l.targetDevice === a));
const flowName = (i: number) => `Flow ${String.fromCharCode(65 + i)}`;
const flowText = (s: StreamResult) => `TCP ${s.from}:${s.sourcePort ?? '?'} → ${s.to}:${s.port}`;
const colors = { P: '#5b7fc7', s: '#d08a3c', D: '#c56c61' } as const;

// ---------------------------------------------------------------- ④ link speed and media
/** One flow is limited by the slowest link on its path, whatever the other links can do. */
export function LinkSpeedView() {
  const [speeds, setSpeeds] = useState([10_000, 1000, 10_000]);
  const [gigabytes, setGigabytes] = useState(10);
  const stream = useMemo(() => build([
    { id: 'PC', kind: 'pc', at: [0, 0], ip: { eth0: '10.0.0.1/24' } }, { id: 'SW1', kind: 'switch', at: [0, 0] }, { id: 'SW2', kind: 'switch', at: [0, 0] },
    { id: 'SRV', kind: 'server', at: [0, 0], ip: { eth0: '10.0.0.2/24' }, set: d => { d.services = [iperf()]; } },
  ], [['PC', 'eth0', 'SW1', 'g0/1', speeds[0]], ['SW1', 'g0/2', 'SW2', 'g0/2', speeds[1]], ['SW2', 'g0/1', 'SRV', 'eth0', speeds[2]]]).throughput([{ from: 'PC', to: '10.0.0.2' }]).streams[0], [speeds]);
  const names = ['PC – SW1', 'SW1 – SW2', 'SW2 – SRV'];
  const seconds = stream.rate ? gigabytes * 8 * 1000 / stream.rate : 0;
  return <div className="visual-card"><div className="tool-heading"><Icon name="layers"/><div><h3>リンク速度とボトルネック</h3><p>Mbps・Gbps は「1秒間に運べるビット数」です（1 Gbps = 1,000 Mbps）。途中に遅いリンクが1本でもあると、そこが1つの転送の上限（ボトルネック）になります。各リンクの速度を変えて、iperf3 と同じ計算で確かめましょう。</p></div></div>
    <div className="inline-form">{names.map((name, i) => <label key={name}>{name}<select aria-label={`${name} の速度`} value={speeds[i]} onChange={e => setSpeeds(speeds.map((v, j) => j === i ? Number(e.target.value) : v))}>{[100, 1000, 10_000, 25_000, 40_000, 100_000].map(v => <option key={v} value={v}>{speedText(v)}</option>)}</select></label>)}</div>
    <p className="tiny"><code>PC ─{speedText(speeds[0])}─ SW1 ─{speedText(speeds[1])}─ SW2 ─{speedText(speeds[2])}─ SRV</code></p>
    <table className="mini-table"><thead><tr><th>リンク（送信側のポート）</th><th>速度</th><th/></tr></thead><tbody>{stream.hops.map((h, i) => <tr key={h.linkId} className={h.bandwidth === stream.limit ? 'win' : ''}><td>{names[i]}（{h.device} {h.interfaceId}）</td><td>{speedText(h.bandwidth)}</td><td>{h.bandwidth === stream.limit ? '← ボトルネック' : ''}</td></tr>)}</tbody></table>
    <p>1本の転送の上限: <strong>{speedText(stream.rate)}</strong>（速度の足し算ではなく、最も遅いリンクで決まります）</p>
    <div className="inline-form"><label>送るファイルの大きさ（GB＝ギガバイト）<input aria-label="ファイルサイズ" type="number" min={1} max={10_000} value={gigabytes} onChange={e => setGigabytes(Math.max(1, Number(e.target.value) || 1))}/></label></div>
    <p className="tiny">{gigabytes} GB ＝ {gigabytes * 8} Gb（ギガビット。1バイト＝8ビット）。{speedText(stream.rate)} で送ると、理論上 約 {seconds < 120 ? `${seconds.toFixed(1)} 秒` : `${(seconds / 60).toFixed(1)} 分`}。</p>
    <p className="muted tiny">帯域（bandwidth）はリンクが運べる最大の速さ、スループット（throughput）は実際に出た速さです。スループットはボトルネックの帯域を超えません。ここでの値はリンク速度だけから求めた理論上限で、実際はヘッダのオーバーヘッド・再送・混雑の分だけ下がります。</p></div>;
}
/** A port, a module (or cable) and the other end must match: form factor, speed and medium. */
export function MediaCompat() {
  const [a, setA] = useState('sfp+'); const [ma, setMa] = useState('10gsr'); const [b, setB] = useState('sfp+'); const [mb, setMb] = useState('10glr');
  const port = (id: string) => portTypes.find(p => p.id === id)!; const med = (id: string) => media.find(m => m.id === id)!;
  const result = checkLink(port(a), med(ma), port(b), med(mb));
  const side = (label: string, p: string, setP: (v: string) => void, m: string, setM: (v: string) => void) => <div><h4>{label}</h4>
    <label>ポート<select aria-label={`${label} のポート`} value={p} onChange={e => setP(e.target.value)}>{portTypes.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <label>挿すもの（モジュール・ケーブル）<select aria-label={`${label} のモジュール`} value={m} onChange={e => setM(e.target.value)}>{media.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label></div>;
  return <div className="visual-card"><div className="tool-heading"><Icon name="link"/><div><h3>ポート・モジュール・ケーブルの組み合わせ</h3><p>ポートには形（RJ45・SFP・SFP+・SFP28・QSFP+・QSFP28）と対応する速度があり、何でも挿してつながるわけではありません。両端のポートと、挿すモジュール・ケーブルを選んで、リンクできるかを確かめましょう。型番を覚える必要はありません。「形・速度・媒体（銅線／光／DAC）が両端でそろうか」を見ます。</p></div></div>
    <div className="two-col">{side('A側', a, setA, ma, setMa)}{side('B側', b, setB, mb, setMb)}</div>
    <div className={`compat-result ${result.ok ? 'ok' : 'ng'}`} role="status"><strong>{result.ok ? `リンクできます: ${speedText(result.speed!)}` : 'リンクできません'}</strong>{result.reasons.map(r => <div key={r}>・{r}</div>)}</div>
    <p className="muted tiny">教育用に単純化した対応表です。実機では、スロットが対応するモジュールの種類（低速モジュールを使えるか）、ベンダーの互換性リスト、ブレイクアウト（1つのQSFPを4本に分ける）などが機器ごとに異なります。光は「マルチモード（SR）は短距離・シングルモード（LR）は長距離」で、両端を同じ規格にそろえます。DACはモジュールとケーブルが一体の短距離用です。</p></div>;
}

// ---------------------------------------------------------------- ④ link aggregation
export type PeerMode = LagMode | 'none';
/** LAG demo: SW2's mode, member links up/down and the hash inputs decide what is bundled and where 8 flows go. */
export function lagRun(up: [boolean, boolean], peer: PeerMode, method: LoadBalance) {
  const n = lagScenario({ lag: true });
  if (method !== 'src-dst-mixed-ip-port') n.update('SW1', d => { d.lagLoadBalance = method; });
  n.update('SW2', d => {
    if (peer === 'none') d.interfaces = d.interfaces.filter(i => i.kind !== 'port-channel').map(({ channelGroup: _, ...i }) => i);
    else for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = peer;
  });
  between(n, 'SW1', 'SW2').forEach((l, i) => n.setLinkState(l.id, up[i]));
  const t = n.throughput([0, 1, 2, 3].flatMap(() => [{ from: 'PC1', to: '192.168.10.13' }, { from: 'PC2', to: '192.168.20.14' }]));
  return { status: n.lagState().SW1.po1, t, member: (s: StreamResult) => s.hops.find(h => h.device === 'SW1' && h.lag)?.interfaceId };
}
export function LagView() {
  const [up, setUp] = useState<[boolean, boolean]>([true, true]);
  const [peer, setPeer] = useState<PeerMode>('passive');
  const [method, setMethod] = useState<LoadBalance>('src-dst-mixed-ip-port');
  const { status, t, member } = useMemo(() => lagRun(up, peer, method), [up, peer, method]);
  const flag = (i: number) => status.members[i]?.flag ?? 'D';
  const line = (i: number, y: number) => <g key={i}><line x1={120} y1={y} x2={360} y2={y} stroke={colors[flag(i)]} strokeWidth={flag(i) === 'P' ? 4 : 2} strokeDasharray={flag(i) === 'P' ? undefined : '6 5'}/>
    <text x={128} y={y - 6} fontSize={12} fill="#4d5f74">g0/{7 + i}</text><text x={312} y={y - 6} fontSize={12} fill="#4d5f74">g0/{7 + i}</text>
    <text x={240} y={y + 16} fontSize={11} textAnchor="middle" fill={colors[flag(i)]}>{flag(i) === 'P' ? '束ねて使用中（P）' : flag(i) === 's' ? 'suspended（s）' : 'down（D）'}</text></g>;
  const single = Math.max(0, ...status.members.filter(m => m.flag === 'P').map(m => m.bandwidth));
  return <div className="visual-card"><div className="tool-heading"><Icon name="switch"/><div><h3>Link Aggregation：2本の物理リンクと、1つの論理リンク</h3><p>SW1とSW2の間の2本のケーブル（メンバー）を、LACPで1つの論理リンク <strong>po1</strong>（Port-channel）として扱います。STPやVLANの設定から見えるのは po1 だけです。対向（SW2）のモードやケーブルの状態を変えて、何が束ねられ、8本のフローがどのメンバーを通るかを見ましょう。</p></div></div>
    <svg className="lag-figure" viewBox="0 0 480 160" role="img" aria-label="SW1とSW2の間の2本のメンバーと、論理リンクpo1">
      <rect x={20} y={45} width={100} height={70} rx={10} fill="#eef5e9" stroke="#9ab89a"/><text x={70} y={85} textAnchor="middle" fontSize={15} fill="#35553f">SW1</text>
      <rect x={360} y={45} width={100} height={70} rx={10} fill="#eef5e9" stroke="#9ab89a"/><text x={410} y={85} textAnchor="middle" fontSize={15} fill="#35553f">SW2</text>
      <rect x={140} y={30} width={200} height={100} rx={22} fill="none" stroke={status.up ? colors.P : colors.D} strokeDasharray="4 4"/>
      <text x={240} y={22} textAnchor="middle" fontSize={13} fill={status.up ? colors.P : colors.D}>po1（論理リンク）: {status.up ? `Up・合計 ${speedText(status.capacity)}` : 'Down'}</text>
      {line(0, 62)}{line(1, 104)}
    </svg>
    <div className="inline-form">{[0, 1].map(i => <label key={i} className="toggle"><input type="checkbox" checked={up[i]} onChange={e => setUp(up.map((v, j) => j === i ? e.target.checked : v) as [boolean, boolean])}/>g0/{7 + i} のケーブル Up</label>)}
      <label>SW2 のモード<select aria-label="SW2のLAGモード" value={peer} onChange={e => setPeer(e.target.value as PeerMode)}><option value="active">active（LACP）</option><option value="passive">passive（LACP）</option><option value="on">on（static）</option><option value="none">束ねる設定なし</option></select></label>
      <label>SW1 のメンバーの選び方<select aria-label="SW1のload-balance" value={method} onChange={e => setMethod(e.target.value as LoadBalance)}><option value="src-dst-mixed-ip-port">IP＋ポート（5-tuple）</option><option value="src-dst-ip">IPだけ</option><option value="src-dst-mac">MACだけ</option></select></label></div>
    {status.members.some(m => m.flag !== 'P') && <ul className="plain tiny">{status.members.filter(m => m.flag !== 'P').map(m => <li key={m.port}>{m.port}: {m.reason}</li>)}</ul>}
    <table className="mini-table flow-table"><thead><tr><th>フロー</th><th>ハッシュの入力（5-tuple）</th><th>SW1が選んだメンバー</th><th>速さ（理論値）</th></tr></thead>
      <tbody>{t.streams.map((s, i) => <tr key={i}><td>{flowName(i)}</td><td><code>{flowText(s)}</code></td><td className={!s.ok ? 'fail' : member(s) === 'g0/7' ? 'p1' : 'p2'}>{s.ok ? member(s) : '届かない'}</td><td>{s.ok ? speedText(s.rate) : '—'}</td></tr>)}</tbody></table>
    <p className="tiny">8本の合計: <strong>{speedText(t.total)}</strong> ／ 論理リンクの容量（aggregate）: {speedText(status.capacity)} ／ 1本のフローの上限: {single ? speedText(single) : '—'}（メンバー1本分）</p>
    <p className="muted tiny">メンバーの選び方は、ハッシュに入れる値の違いです。「MACだけ」にすると、同じ2台の間のフローはすべて同じメンバーに集まり、束ねても速くなりません。実機のハッシュの計算方法と既定値は、機器ごとに異なります。</p></div>;
}

// ---------------------------------------------------------------- ③ ECMP
export function ecmpRun(routing: DiamondRouting, fail: 'none' | 'R1-R2' | 'R2-R4') {
  const n = ecmpScenario(routing);
  if (fail !== 'none') { const [a, b] = fail.split('-'); for (const l of between(n, a, b)) n.setLinkState(l.id, false); }
  const t = n.throughput([0, 1, 2, 3, 4, 5].map(() => ({ from: 'PC1', to: SRV })));
  // R1's egress decides the path, also for a flow that is lost further on (g0/1 → R2, g0/2 → R3).
  const path = (s: StreamResult) => ({ 'g0/1': 'R2', 'g0/2': 'R3' } as Record<string, string>)[s.hops.find(h => h.device === 'R1')?.interfaceId ?? ''];
  return { t, path, routes: n.installed('R1').filter(r => r.destination === '10.20.0.0/24') };
}
export function EcmpView() {
  const [routing, setRouting] = useState<DiamondRouting>('static');
  const [fail, setFail] = useState<'none' | 'R1-R2' | 'R2-R4'>('none');
  const { t, path, routes } = useMemo(() => ecmpRun(routing, fail), [routing, fail]);
  const lost = t.streams.filter(s => !s.ok).length;
  return <div className="visual-card"><div className="tool-heading"><Icon name="router"/><div><h3>ECMP：同じコストの経路を、フローごとに使い分ける</h3><p>PC1 – R1 – (R2 / R3) – R4 – SRV。R1から見て、R2経由とR3経由は同じ段数・同じ速さです。6本のTCP接続（Flow A〜F）を流し、R1がそれぞれをどちらへ送ったかを見ましょう。送信元ポートが違えば別のフローで、ハッシュの結果も変わります。</p></div></div>
    <div className="inline-form"><label>経路の作り方<select aria-label="経路の作り方" value={routing} onChange={e => setRouting(e.target.value as DiamondRouting)}><option value="single">単一経路（R2経由だけ）</option><option value="static">静的ルート2本（ECMP）</option><option value="ospf">OSPF（ECMP）</option></select></label>
      <label>故障<select aria-label="故障させるリンク" value={fail} onChange={e => setFail(e.target.value as typeof fail)}><option value="none">なし</option><option value="R1-R2">R1–R2（R1の隣）</option><option value="R2-R4">R2–R4（R1から2つ先）</option></select></label></div>
    <div className="two-col"><div><h4>R1: show ip route 10.20.0.0</h4><pre className="tiny">{routes.length ? `10.20.0.0/24\n${routes.map(r => `  via ${r.nextHop}（${r.kind === 'ospf' ? 'OSPF' : 'Static'} [${r.preference}/${r.metric}]）`).join('\n')}` : '経路なし'}</pre>
      <p className="tiny">{routes.length > 1 ? '同じ宛先に、同じAD・同じメトリックのNext Hopが2つ → ECMP。' : 'Next Hop は1つ（単一経路）。'}</p></div>
      <div><table className="mini-table flow-table"><thead><tr><th>フロー</th><th>ハッシュの入力</th><th>経路</th></tr></thead>
        <tbody>{t.streams.map((s, i) => <tr key={i}><td>{flowName(i)}</td><td><code>{flowText(s)}</code></td><td className={!s.ok ? 'fail' : path(s) === 'R2' ? 'r2' : 'r3'}>{path(s) ? `R1 → ${path(s)} → R4` : '—'}{s.ok ? '' : ' ✗ 届かない'}</td></tr>)}</tbody></table></div></div>
    <p className="tiny">{lost ? `${lost}本のフローが届きませんでした。${routing === 'static' && fail === 'R2-R4' ? 'R1から見るとR2は隣で、R1–R2は正常です。静的ルートは2つ先の故障を知らないので、ハッシュでR2経由を選んだフローだけが失われます（一部だけ失敗する、分かりにくい障害）。' : ''}`
      : fail !== 'none' && routing !== 'single' ? '故障した経路は候補から外れ、すべてのフローが残りの経路へ移りました。' : routing === 'single' ? 'すべてのフローがR2経由です（R3側は使われていません）。' : '同じフローは常に同じ経路、別のフローは別の経路を通ることがあります。1つのフローが2本に分かれることはありません。'}</p>
    <p className="muted tiny">per-packet（パケットごとに交互）に振り分けると、到着順が入れ替わってTCPの性能が落ちるため、多くの機器はフロー単位（per-flow）で振り分けます。故障の検出と経路の切り替え（収束）は、シミュレータでは一瞬ですが、実機では検出方法（リンクダウン・OSPFのタイマー・BFDなど）に応じた時間がかかります。</p></div>;
}

// ---------------------------------------------------------------- ⑨ LACP vs ECMP, redundancy design
/** The same flows cross a LAG (L2, one neighbor) and ECMP (L3, two different next-hop routers). */
export function LagVsEcmp() {
  const t = useMemo(() => designScenario({ lag: true, routing: 'ospf' }).throughput([0, 1, 2].flatMap(() => [{ from: 'PC1', to: SRV }, { from: 'PC2', to: SRV }])), []);
  return <div className="visual-card"><div className="tool-heading"><Icon name="network"/><div><h3>LACPとECMPの違いを、パケットの通り道で見る</h3><p>PC1・PC2 – SW1 ═(po1: 2本)═ SW2 – R1 – (R2 / R3) – R4 – SRV。同じ6本のフローが、SW1では <strong>LAGのメンバー</strong>を、R1では <strong>ECMPのNext Hop</strong>を、それぞれハッシュで選びます。</p></div></div>
    <table className="mini-table flow-table"><thead><tr><th>フロー</th><th>ハッシュの入力</th><th>SW1: po1 のメンバー（L2）</th><th>R1: Next Hop（L3）</th></tr></thead>
      <tbody>{t.streams.map((s, i) => { const m = s.hops.find(h => h.device === 'SW1' && h.lag); const r = s.hops.find(h => h.device === 'R1');
        return <tr key={i}><td>{flowName(i)}</td><td><code>{flowText(s)}</code></td><td className={m?.interfaceId === 'g0/7' ? 'p1' : 'p2'}>{m?.interfaceId}（相手はどちらも SW2）</td><td className={r?.interfaceId === 'g0/1' ? 'r2' : 'r3'}>{r?.interfaceId === 'g0/1' ? 'R2（10.0.12.2）' : 'R3（10.0.13.3）'}</td></tr>; })}</tbody></table>
    <table className="mini-table"><thead><tr><th/><th>LACP（Link Aggregation）</th><th>ECMP</th></tr></thead><tbody>
      <tr><td>何をまとめる？</td><td>同じ相手機器との間の、複数の物理リンク → 1つの論理リンク</td><td>異なるNext Hopを通る、複数のL3経路</td></tr>
      <tr><td>層</td><td>L2（Ethernetのリンク）。L3のPort-channelもある</td><td>L3（経路表）</td></tr>
      <tr><td>どこに見える？</td><td>show etherchannel summary、interface po1。経路表・STPには po1 が1つだけ</td><td>show ip route で、同じ宛先に複数の Next Hop</td></tr>
      <tr><td>通過するとき</td><td>MACアドレス・TTLは変わらない（同じ相手へ届く）</td><td>選んだルータ宛てにMACが付け替わり、TTLが1減る</td></tr>
      <tr><td>1本壊れたら</td><td>論理リンクはUpのまま、容量が減る（STPは再計算しない）</td><td>その Next Hop が候補から消え、残りの経路へ（ルーティングが検出できれば）</td></tr>
      <tr><td>1つのフロー</td><td>メンバー1本分まで</td><td>1経路分まで</td></tr></tbody></table>
    <p className="muted tiny">どちらもフロー単位のハッシュで振り分けるので、使い方は似て見えます。違いは「束ねる相手が同じ1台か、別々の機器か」です。R2とR3は別の機器なのでLAGでは束ねられず、ECMPで使います。</p>
    <p className="muted tiny">表では、SW1のメンバーとR1の経路の選び方がそろって見えます。どちらも同じハッシュ関数に同じフローの値を入れているためです（ハッシュの偏り＝polarization）。実機では、機器ごとに違う種（シード）でハッシュを計算するなどして、この偏りを避けることがあります。</p></div>;
}
export const redundancyDesigns: { id: string; label: string; options: DesignOptions; role: string }[] = [
  { id: 'single', label: '① 1本道（ケーブル1本・経路1つ）', options: { cables: 1, routing: 'single' }, role: '予備がありません。どれか1つ壊れると止まります。' },
  { id: 'loop', label: '② ケーブルを2本にした（STPを無効）', options: { cables: 2, stp: false, routing: 'single' }, role: '2本目がL2のループを作り、ブロードキャストストームになります。実機ではネットワーク全体が止まる、逆効果の「冗長化」です。' },
  { id: 'stp', label: '③ ケーブル2本＋STP', options: { cables: 2, routing: 'single' }, role: '2本目はSTPで待機します。障害には備えられますが、容量は増えません。' },
  { id: 'lag', label: '④ ケーブル2本をLACPで束ねる', options: { cables: 2, lag: true, routing: 'single' }, role: '2本とも使います（容量と障害対策の両方）。ただしルータ側はまだ1経路です。' },
  { id: 'static', label: '⑤ ④＋静的ルートのECMP', options: { cables: 2, lag: true, routing: 'static' }, role: 'R2・R3の両方を使いますが、R1から2つ先の故障は静的ルートでは検出できず、一部のフローが失われます。' },
  { id: 'ospf', label: '⑥ ④＋OSPFのECMP', options: { cables: 2, lag: true, routing: 'ospf' }, role: 'L2はLACP、L3はOSPFのECMP。残る単一障害点は、PCがつながるSW1、Gateway側のSW2・R1、SRV側のR4です。' },
];
const failurePoints: { label: string; apply: (n: NetworkSimulator) => boolean }[] = [
  ...['g0/7', 'g0/8'].map((port, i) => ({ label: `SW1–SW2（${i + 1}本目）`, apply: (n: NetworkSimulator) => { const l = between(n, 'SW1', 'SW2').find(x => x.sourceInterface === port); if (l) n.setLinkState(l.id, false); return !!l; } })),
  ...[['SW2', 'R1'], ['R1', 'R2'], ['R1', 'R3'], ['R2', 'R4'], ['R3', 'R4']].map(([a, b]) => ({ label: `${a}–${b}`, apply: (n: NetworkSimulator) => { for (const l of between(n, a, b)) n.setLinkState(l.id, false); return true; } })),
  ...['SW1', 'SW2', 'R1', 'R2', 'R3', 'R4'].map(id => ({ label: id, apply: (n: NetworkSimulator) => { n.update(id, d => { for (const i of d.interfaces) i.up = false; }); return true; } })),
];
/** Fail each element in turn: what still works (SPOF analysis), plus the capacity of the healthy design. */
export function analyzeDesign(o: DesignOptions) {
  const works = (n: NetworkSimulator) => { const r = n.throughput([0, 1].flatMap(() => [{ from: 'PC1', to: SRV }, { from: 'PC2', to: SRV }])); return { ok: r.success, storm: r.events.some(e => e.type === 'BROADCAST_STORM'), total: r.total }; };
  // Build once; every failure case starts from a copy (one recompute instead of rebuilding the topology).
  const snapshot = designScenario(o).snapshot();
  const fresh = () => NetworkSimulator.fromSnapshot(snapshot);
  const base = works(fresh());
  const capacity = fresh().throughput([0, 1, 2, 3].flatMap(() => [{ from: 'PC1', to: SRV }, { from: 'PC2', to: SRV }])).total;
  const results = failurePoints.map(f => { const n = fresh(); if (!f.apply(n)) return { label: f.label, state: 'n/a' as const }; const w = works(n); return { label: f.label, state: w.ok && !w.storm ? 'ok' as const : 'down' as const }; });
  return { ok: base.ok && !base.storm, storm: base.storm, capacity, results, spof: results.filter(r => r.state === 'down').map(r => r.label) };
}
export function RedundancyView() {
  const [id, setId] = useState('single');
  const design = redundancyDesigns.find(d => d.id === id)!;
  const a = useMemo(() => analyzeDesign(design.options), [design]);
  return <div className="visual-card"><div className="tool-heading"><Icon name="alert"/><div><h3>単一障害点を探す：線を増やせば冗長になる？</h3><p>PC1・PC2 – SW1 – SW2 – R1 – (R2 / R3) – R4 – SRV。構成を選ぶと、機器とリンクを1つずつ壊して（シミュレータで実際に通信して）、通信が続くかを調べます。止まる箇所が単一障害点（SPOF）です。</p></div></div>
    <div className="inline-form"><label>構成<select aria-label="冗長化の構成" value={id} onChange={e => setId(e.target.value)}>{redundancyDesigns.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label></div>
    <p className="tiny"><strong>{a.storm ? '平常時からブロードキャストストームが発生しています。' : a.ok ? `平常時: 通信できます。PC1・PC2から8本のフローの合計 ${speedText(a.capacity)}。` : '平常時から通信できません。'}</strong> {design.role}</p>
    <table className="mini-table"><thead><tr><th>壊すもの</th><th>結果</th></tr></thead><tbody>{a.results.map(r => <tr key={r.label} className={r.state === 'down' ? 'lose' : ''}><td>{r.label}</td><td>{r.state === 'n/a' ? '—（この構成にはない）' : r.state === 'ok' ? '✓ 通信が続く' : '✗ 止まる（単一障害点）'}</td></tr>)}</tbody></table>
    <p className="tiny">単一障害点: {a.spof.join('、') || 'なし'}</p>
    <p className="muted tiny">冗長化は「リンク」「機器」「経路」のどれを二重にするかで、必要な仕組みが違います（L2の並列リンク → STP・LACP、別々の機器を通る経路 → ルーティング・ECMP）。PCのNICや Gateway を二重にするには、NICの冗長化やFHRP（このシミュレータでは扱いません）が必要で、費用とのトレードオフになります。</p></div>;
}

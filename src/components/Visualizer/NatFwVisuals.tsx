import { useReducer, useRef, useState } from 'react';
import { firewallScenario, natScenario } from '../../simulator/scenarios/chapters';
import { evaluateRules, formatRule, ruleMatches } from '../../simulator/services/FirewallEngine';
import { contains, isIpv4 } from '../../simulator/l3/ipv4';
import type { Packet, SimulationEvent } from '../../simulator/core/types';
import { Icon } from '../Icon';

/** PAT: many private hosts share one global address, distinguished by the translated source port. */
export function NatTable() {
  const [pat, setPat] = useState(true);
  const net = useRef(natScenario(true)); const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [log, setLog] = useState<{ title: string; ok: boolean; reason: string; events: SimulationEvent[] }>();
  const n = net.current;
  const run = (from: string) => { const r = n.http(from, 'http://198.51.100.80/'); setLog({ title: `${from} → 198.51.100.80:80`, ok: r.success, reason: r.status ? `HTTP ${r.status}` : r.reason, events: r.events.filter(e => e.type === 'NAT_TRANSLATED') }); refresh(); };
  const toggle = (on: boolean) => { setPat(on); net.current = natScenario(on); setLog(undefined); refresh(); };
  const table = n.device('R1').natTable ?? [];
  return <div className="visual-card"><div className="tool-heading"><Icon name="router"/><div><h3>NAT（PAT）の変換表</h3><p>R1 は 192.168.1.0/24 からの通信の送信元を 203.0.113.2 に書き換えます。ISPは 192.168.1.0/24 への経路を持たないので、NATがないと戻りのパケットが届きません。PATを有効にしてPC1・PC2から通信し、外側のアドレスはどちらも 203.0.113.2 になり、ポート番号で区別されることを確かめましょう。</p></div></div>
    <div className="quiz-actions"><label className="toggle"><input type="checkbox" checked={pat} onChange={e => toggle(e.target.checked)}/>R1 で PAT を有効化</label>
      <button className="button small secondary" onClick={() => run('PC1')}>PC1 から Webへ</button><button className="button small secondary" onClick={() => run('PC2')}>PC2 から Webへ</button>
      <button className="button small secondary" onClick={() => { n.clearNat('R1'); refresh(); }}><Icon name="trash" size={13}/>変換表をクリア</button></div>
    {log && <><p className={log.ok ? 'success-text' : 'error-text'}>{log.title}: {log.reason}</p><ol className="event-steps">{log.events.map(e => <li key={e.id} className="fwd"><strong>{e.deviceId}</strong> {e.before} ⇒ {e.after}<small>{e.message}</small></li>)}</ol>{!log.events.length && <p className="tiny">NAT変換は発生していません。送信元 192.168.1.x のまま出ていき、応答は戻れません。</p>}</>}
    <table className="mini-table"><thead><tr><th>Pro</th><th>Inside local</th><th>Inside global</th><th>Outside</th><th>残り</th></tr></thead><tbody>{table.map((t, i) => <tr key={i}><td>{t.protocol}</td><td>{t.insideLocal}:{t.insideLocalPort}</td><td>{t.insideGlobal}:{t.insideGlobalPort}</td><td>{t.outside}:{t.outsidePort}</td><td>{Math.round((t.expiresAt - n.now()) / 1000)} 秒</td></tr>)}</tbody></table>
    {!table.length && <p className="muted tiny">変換表は空です。上のボタンで通信すると、行が追加されます。</p>}
    <p className="muted tiny">表の見方はCisco IOSの <code>show ip nat translations</code> に合わせています。ポートの割り当て方や保持時間は実機・OSごとに異なります。</p></div>;
}

const ifaces = { 'g0/0': 'outside', 'g0/1': 'inside', 'g0/2': 'dmz' } as const;
const egressFor = (dst: string): keyof typeof ifaces => contains('10.0.1.0/24', dst) ? 'g0/1' : contains('10.0.2.0/24', dst) ? 'g0/2' : 'g0/0';
/** First-match rule evaluation using the simulator's own matcher. */
export function RuleEvaluator() {
  const rules = firewallScenario(true).device('FW').firewall!.rules;
  const [enabled, setEnabled] = useState(rules.map(() => true));
  const [p, setP] = useState({ protocol: 'tcp' as 'tcp' | 'udp' | 'icmp', source: '198.51.100.50', destination: '10.0.2.80', port: '22', in: 'g0/0' as keyof typeof ifaces });
  const valid = isIpv4(p.source) && isIpv4(p.destination) && Number(p.port) >= 1 && Number(p.port) <= 65535;
  const packet: Packet | undefined = !valid ? undefined : p.protocol === 'icmp' ? { id: 0, protocol: 'ICMP', type: 'echo-request', identifier: 1, sequence: 1, source: p.source, destination: p.destination, ttl: 64 }
    : p.protocol === 'tcp' ? { id: 0, protocol: 'TCP', source: p.source, destination: p.destination, ttl: 64, sourcePort: 50000, destinationPort: Number(p.port), flags: ['SYN'], seq: 0, ack: 0, window: 65535 }
    : { id: 0, protocol: 'UDP', source: p.source, destination: p.destination, ttl: 64, sourcePort: 50000, destinationPort: Number(p.port) };
  const active = rules.filter((_, i) => enabled[i]);
  const ctx = { inInterface: p.in, outInterface: valid ? egressFor(p.destination) : 'g0/0' };
  const decision = packet && evaluateRules(active, 'deny', packet, ctx);
  return <div className="visual-card"><div className="tool-heading"><Icon name="firewall"/><div><h3>ファイアウォールのルール評価</h3><p>ルールは上から順に評価され、<strong>最初に一致したもの</strong>で決まります。どれにも一致しなければ、最後の暗黙の拒否（default deny）で止まります。送信元・宛先・ポートを変えたり、ルールのチェックを外したりして、結果の変化を見ましょう。</p></div></div>
    <div className="inline-form"><label>プロトコル<select aria-label="評価するプロトコル" value={p.protocol} onChange={e => setP({ ...p, protocol: e.target.value as 'tcp' })}><option>tcp</option><option>udp</option><option>icmp</option></select></label>
      <label>送信元<input aria-label="評価する送信元" value={p.source} onChange={e => setP({ ...p, source: e.target.value.trim() })}/></label>
      <label>宛先<input aria-label="評価する宛先" value={p.destination} onChange={e => setP({ ...p, destination: e.target.value.trim() })}/></label>
      {p.protocol !== 'icmp' && <label>宛先ポート<input aria-label="評価する宛先ポート" value={p.port} onChange={e => setP({ ...p, port: e.target.value })}/></label>}
      <label>受信IF<select aria-label="受信インターフェース" value={p.in} onChange={e => setP({ ...p, in: e.target.value as 'g0/0' })}>{Object.entries(ifaces).map(([k, v]) => <option key={k} value={k}>{k}（{v}）</option>)}</select></label></div>
    <table className="mini-table rules"><thead><tr><th>有効</th><th>ルール</th><th>この通信</th></tr></thead><tbody>
      {rules.map((r, i) => { const m = packet && enabled[i] && ruleMatches(r, packet, ctx); const win = decision?.rule === r; return <tr key={r.seq} className={win ? 'win' : m ? 'lose' : 'miss'}><td><input type="checkbox" aria-label={`ルール${r.seq}を有効化`} checked={enabled[i]} onChange={e => setEnabled(enabled.map((x, j) => j === i ? e.target.checked : x))}/></td><td><code>{formatRule(r)}</code></td><td>{!enabled[i] ? '無効' : win ? `一致 → ${r.action}` : m ? '一致（ただし上のルールで決定済み）' : '一致しない'}</td></tr>; })}
      <tr className={decision && !decision.rule ? 'win' : 'miss'}><td/><td><code>（暗黙）deny ip any any</code></td><td>{decision && !decision.rule ? '一致 → deny' : ''}</td></tr></tbody></table>
    {decision ? <p className={decision.action === 'permit' ? 'success-text' : 'error-text'}>結果: {decision.action === 'permit' ? '許可' : '拒否'}（出力IF {ctx.outInterface}／{ifaces[ctx.outInterface]}）</p> : <p className="error-text">アドレスまたはポートが正しくありません</p>}
    <p className="muted tiny">このFWはステートフルです。許可した通信の戻りはコネクション追跡（conntrack）で自動的に通るため、戻り方向のルールは不要です。ポート22（SSH）は外部から許可されていない例です。宛先はNAT変換後（10.0.2.80）で評価します。</p></div>;
}

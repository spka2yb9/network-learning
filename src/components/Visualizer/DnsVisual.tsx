import { useReducer, useRef, useState } from 'react';
import { dnsScenario } from '../../simulator/scenarios/chapters';
import type { DnsLookupResult } from '../../simulator/core/NetworkSimulator';
import type { DnsType, SimulationEvent } from '../../simulator/core/types';
import { Icon } from '../Icon';

const roles: Record<string, string> = { PC1: 'PC1（スタブリゾルバ）', RESOLVER: '再帰リゾルバ（社内）', ROOT: 'ルートサーバー', TLD: '.com TLDサーバー', AUTH: 'example.com の権威DNSサーバー' };
const cls = (e: SimulationEvent) => e.type === 'DNS_CACHE' ? 'r-cache' : e.deviceId === 'PC1' || (e.type === 'DNS_RESPONSE' && e.deviceId === 'RESOLVER') ? 'client' : e.message.includes('referral') ? 'r-referral' : e.message.includes('NXDOMAIN') ? 'r-nxdomain' : e.type === 'DNS_RESPONSE' ? 'r-answer' : '';
/** Recursive resolution with a real cache: the first lookup walks root → TLD → authoritative, the second is answered from cache until TTL expires. */
export default function DnsResolution() {
  const net = useRef(dnsScenario()); const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [name, setName] = useState('www.example.com'); const [type, setType] = useState<DnsType>('A');
  const [result, setResult] = useState<DnsLookupResult>();
  const n = net.current;
  const cache = n.device('RESOLVER').dnsCache ?? [];
  const dnsEvents = result?.events.filter(e => e.type === 'DNS_QUERY' || e.type === 'DNS_RESPONSE' || e.type === 'DNS_CACHE') ?? [];
  const lookup = () => { setResult(n.dnsLookup('PC1', name, type)); refresh(); };
  return <div className="visual-card"><div className="tool-heading"><Icon name="globe"/><div><h3>名前解決の旅</h3><p>PC1 は再帰リゾルバに「最後まで調べて」と頼み（再帰問い合わせ）、リゾルバがルート → TLD → 権威DNSサーバーの順に聞いて回ります（反復問い合わせ）。「問い合わせ」を2回押して、2回目はキャッシュから答える様子を確かめましょう。</p></div></div>
    <div className="inline-form"><label>名前<input aria-label="問い合わせる名前" value={name} onChange={e => setName(e.target.value)}/></label>
      <label>タイプ<select aria-label="レコードタイプ" value={type} onChange={e => setType(e.target.value as DnsType)}>{(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'] as DnsType[]).map(t => <option key={t}>{t}</option>)}</select></label>
      <button className="button small" onClick={lookup}><Icon name="play" size={13}/>問い合わせ</button></div>
    <div className="segmented">{['www.example.com', 'shop.example.com', 'nope.example.com'].map(v => <button key={v} className={name === v ? 'active' : ''} onClick={() => setName(v)}>{v}</button>)}</div>
    {result && <><ol className="dns-steps">{dnsEvents.map(e => <li key={e.id} className={cls(e)}><strong>{roles[e.deviceId] ?? e.deviceId}{e.type === 'DNS_QUERY' ? ' が問い合わせ' : e.type === 'DNS_CACHE' ? ' のキャッシュ' : ' が応答'}</strong><span>{e.message.replace(/^[A-Z0-9]+(: | → )/, m => m.endsWith('→ ') ? '→ ' : '')}</span></li>)}</ol>
      <p className="tiny">{dnsEvents.some(e => e.type === 'DNS_CACHE') ? 'キャッシュから答えたので、ルート・TLD・権威サーバーへの問い合わせは発生しませんでした。' : `リゾルバから外部への問い合わせ: ${dnsEvents.filter(e => e.type === 'DNS_QUERY' && e.deviceId === 'RESOLVER').length} 回`}{result.message ? '' : ` / ${result.reason}`}</p></>}
    <div className="section-label">リゾルバのキャッシュ（シミュレータ内の時刻 {Math.round(n.now() / 1000)} 秒）</div>
    <table className="mini-table"><thead><tr><th>名前</th><th>タイプ</th><th>内容</th><th>残りTTL</th></tr></thead><tbody>{cache.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.type}</td><td>{c.negative ?? c.records.map(r => r.value).join(', ')}</td><td>{Math.max(0, Math.round((c.expiresAt - n.now()) / 1000))} 秒</td></tr>)}</tbody></table>
    {!cache.length && <p className="muted tiny">まだ空です。「問い合わせ」を押すと、答えがここに記録されます。</p>}
    <div className="quiz-actions"><button className="button small secondary" onClick={() => { n.advanceTime(300_000); refresh(); }}><Icon name="clock" size={13}/>5分進める</button><button className="button small secondary" onClick={() => { n.clearDnsCache('RESOLVER'); refresh(); }}><Icon name="trash" size={13}/>キャッシュを消す</button></div>
    <p className="muted tiny">「5分進める」で時間を進めると、TTLが切れた記録は使われなくなります。存在しない名前（nope.example.com など）も、SOAのminimum（ここでは300秒）の間「存在しない」ことがキャッシュされます（ネガティブキャッシュ、RFC 2308）。</p></div>;
}

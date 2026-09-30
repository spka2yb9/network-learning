import { useState } from 'react';
import { bits, cidr, dotted } from '../../simulator/l3/ipv4';
import { Icon } from '../Icon';

export default function SubnetCalculator() {
  const [value, setValue] = useState('192.168.10.70/27');
  let result: ReturnType<typeof cidr> | undefined; let error = '';
  try { result = cidr(value); } catch (e) { error = (e as Error).message; }
  return <div className="subnet-tool"><div className="tool-heading"><Icon name="globe"/><div><h3>IPアドレスを、ビットで読む。</h3><p>IPとMASK（サブネットマスク）をビットごとにANDすると、ネットワークアドレスになります。アドレスやプレフィックス長を書き換えて、結果の変化を見てみましょう。</p></div></div><label>IPv4 / CIDR<input aria-label="計算するCIDR" value={value} onChange={e => setValue(e.target.value)} spellCheck={false}/></label>{error && <p className="error-text">{error}</p>}{result && <><div className="bit-rows">{[{ name: 'IP', n: result.ip }, { name: 'MASK', n: result.mask }, { name: 'AND', n: result.network }].map(row => <div className={`bit-row ${row.name === 'AND' ? 'bit-result' : ''}`} key={row.name}><strong>{row.name}</strong><code>{bits(row.n).split('').map((char, index) => <span key={index} className={char === '.' ? 'bit-dot' : index - Math.floor(index / 9) < result!.prefix ? 'network-bit' : 'host-bit'}>{char}</span>)}</code><span>{dotted(row.n)}</span></div>)}</div><div className="bit-legend"><span><i/>ネットワーク部（{result.prefix}ビット）</span><span><i/>ホスト部（{32 - result.prefix}ビット）</span></div><div className="subnet-results"><div><small>NETWORK</small><strong>{result.canonical}</strong></div><div><small>{result.prefix >= 31 ? 'LAST ADDRESS' : 'BROADCAST'}</small><strong>{dotted(result.broadcast)}</strong></div><div><small>HOST RANGE</small><strong>{result.firstHost} – {result.lastHost}</strong></div><div><small>USABLE HOSTS</small><strong>{result.hostCount.toLocaleString()}</strong></div></div>{result.prefix >= 31 && <p className="muted tiny">/31はルータ間などの1対1の接続用（2つのアドレスを両方使えます）、/32は1台だけを表します。</p>}</>}</div>;
}

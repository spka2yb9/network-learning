import { useState } from 'react';
import { routingScenario } from '../../simulator/scenarios/routing';
import type { PingResult } from '../../simulator/core/types';
import { Icon } from '../Icon';
import { describePacket } from '../PacketViewer/PacketDebugger';
export default function PacketJourney() {
  const [result, setResult] = useState<PingResult>(); const [step, setStep] = useState(0);
  const frames = result?.events.filter(e => e.type === 'FRAME_SENT') ?? [];
  const event = frames[step];
  return <div className="journey"><div className="tool-heading"><Icon name="packet"/><div><h3>ひとつのpingを、Hopごとに追う。</h3><p>静的ルートを設定済みの小さな構成（PC1 – R1 – R2 – PC2）で ping を1回送ります。「次のHop」で進めながら、ルータを通るたびにMACアドレスが付け替えられてTTLが1減り、IPアドレスは変わらないことを確かめましょう。帰りのEcho Replyも続けて見られます。</p></div><button className="button small" onClick={() => { setResult(routingScenario(true).ping('PC1', '192.168.2.10')); setStep(0); }}><Icon name="play" size={14}/>通信を実行</button></div>
    <div className="journey-path">{['PC1', 'R1', 'R2', 'PC2'].map((id, index) => <div className={event?.deviceId === id ? 'active' : ''} key={id}><span><Icon name={index === 0 || index === 3 ? 'pc' : 'router'} size={28}/></span><strong>{id}</strong>{index < 3 && <i>→</i>}</div>)}</div>
    {event ? <><div className="journey-controls"><button className="button secondary small" disabled={step === 0} onClick={() => setStep(step - 1)}>前へ</button><span>{event.packet ? describePacket(event.packet) : 'ARP'} · {step + 1} / {frames.length}</span><button className="button small" disabled={step === frames.length - 1} onClick={() => setStep(step + 1)}>次のHop<Icon name="step" size={14}/></button></div><div className="encapsulation"><details open><summary>Ethernet <code>{event.sourceMac} → {event.destinationMac}</code></summary>{event.packet ? <details open><summary>IPv4 <code>{event.packet.source} → {event.packet.destination}</code><span>TTL {event.packet.ttl}</span></summary><details open><summary>{describePacket(event.packet)}</summary><p>Echo Requestを受け取った宛先は、送信元へEcho Replyを返します。ルータを通るたびにMACアドレスは付け替えられ、TTLは1ずつ減ります。</p></details></details> : <p>ARP: 次のホップのMACアドレスを問い合わせるフレームです（IPパケットは入っていません）。</p>}</details></div></> : <div className="empty-state">「通信を実行」を押すと、シミュレータが実際に送ったフレームを1つずつ表示します。</div>}
  </div>;
}

import { useState } from 'react';
import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { AllocationPuzzle } from './SubnetTools';
import PacketJourney from './PacketJourney';
import { Icon } from '../Icon';

type Question = { label: string; answer: string };
const forms: Record<string, { intro: string; success: string; questions: Question[] }> = {
  'tcp-ip': { intro: '上の「通信を実行」を押すと、PC1（192.168.1.10、Default Gateway は R1 の 192.168.1.1）から PC2（192.168.2.10）へ ping が流れます。「次のHop」で1フレームずつ進め、表示された値を読み取って答えてください。覚えている知識ではなく、観測した値で答えます。数字とIPアドレスは半角で入力し、3つすべて一致すると合格です。', success: '正解です。観測した値で説明できました。', questions: [
    { label: 'PC2 が受け取った Echo Request の TTL', answer: '62' },
    { label: 'PC2 が受け取った Echo Request の送信元IP', answer: '192.168.1.10' },
    { label: 'PC1 が最初にARPで問い合わせたIPアドレス', answer: '192.168.1.1' }] },
  subnet: { intro: 'ホスト 192.168.20.100/26 について、計算機を使わずに答えてください（紙に2進数を書いてもかまいません）。/26 のブロックの大きさから、100 がどの範囲に入るかを考えます。アドレスは 10.0.0.1 のような形で、数は半角数字で入力します。3つすべて正しいと前半が合格です。', success: '正解です。ビットの境界から計算できました。', questions: [
    { label: 'ネットワークアドレス', answer: '192.168.20.64' },
    { label: '最後の使用可能ホスト', answer: '192.168.20.126' },
    { label: '使用可能なホスト数', answer: '62' }] },
};
function Form({ id, onPass }: { id: string; onPass: () => void }) {
  const f = forms[id];
  const [values, setValues] = useState<string[]>(f.questions.map(() => ''));
  const [checked, setChecked] = useState(false);
  const ok = f.questions.map((q, i) => values[i].trim() === q.answer);
  return <form className="mastery-form" onSubmit={e => { e.preventDefault(); setChecked(true); if (ok.every(Boolean)) onPass(); }}>
    <p>{f.intro}</p>
    {f.questions.map((q, i) => <label key={q.label}>{q.label}<input aria-label={q.label} value={values[i]} onChange={e => { setValues(values.map((v, j) => j === i ? e.target.value : v)); setChecked(false); }}/>{checked && !ok[i] && <small className="error-text">もう一度確かめましょう</small>}</label>)}
    <button className="button">実技回答を確認<Icon name="check" size={15}/></button>
    {checked && ok.every(Boolean) && <p className="success-text">{f.success}</p>}</form>;
}
/** Mastery checks for the two chapters without a network lab: answers come from observation / calculation, graded exactly. */
export default function MasteryForms({ id }: { id: string }) {
  useUI(s => s.revision);
  if (!forms[id]) return null;
  const done = lab.completed.has(`${id}-mastery`);
  const pass = async (part: string) => {
    await lab.markComplete(`${id}-${part}`);
    const parts = id === 'subnet' ? ['form', 'puzzle'] : ['form'];
    if (parts.every(p => lab.completed.has(`${id}-${p}`))) await lab.markComplete(`${id}-mastery`);
  };
  return <div className="activity-panel"><span className="eyebrow">MASTERY CHECK · OBSERVE, THEN ANSWER</span><h2>自分の目で確かめたことを、答えにする。</h2>
    {id === 'tcp-ip' && <PacketJourney/>}
    <Form id={id} onPass={() => void pass('form')}/>
    {id === 'subnet' && <><h3>後半: アドレス設計</h3><p className="muted tiny">前半の計算と、このパズルの両方に合格すると実技完了です。パズルは、書いたCIDRがすべて指定の範囲内か、台数が収まる最小の大きさか、互いに重ならないか、で判定します。</p><AllocationPuzzle onPass={() => void pass('puzzle')}/>
      <p className="tiny">{lab.completed.has('subnet-form') ? '✓ 前半' : '□ 前半'}　{lab.completed.has('subnet-puzzle') ? '✓ 後半' : '□ 後半'}</p></>}
    {done && <p className="success-text">この章の実技を完了しています。</p>}</div>;
}

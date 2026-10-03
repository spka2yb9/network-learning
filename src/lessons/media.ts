/**
 * Educational port / transceiver / cable compatibility (chapter 4 visual). Deliberately small: it teaches that a link needs
 * matching form factor, speed and medium on both ends — not a vendor compatibility list. Real support depends on the device
 * (some cages accept slower modules, some require coded optics, breakout modes vary).
 */
export type FormFactor = 'RJ45' | 'SFP' | 'SFP+' | 'SFP28' | 'QSFP+' | 'QSFP28';
export interface PortType { id: string; label: string; accepts: FormFactor[]; maxSpeed: number }
export interface Medium { id: string; label: string; form: FormFactor; speed: number; kind: 'utp' | 'mmf' | 'smf' | 'dac'; reach: string }

export const portTypes: PortType[] = [
  { id: 'rj45-1g', label: 'RJ45（1000BASE-T まで）', accepts: ['RJ45'], maxSpeed: 1000 },
  { id: 'rj45-10g', label: 'RJ45（10GBASE-T 対応）', accepts: ['RJ45'], maxSpeed: 10_000 },
  { id: 'sfp', label: 'SFP スロット（1G）', accepts: ['SFP'], maxSpeed: 1000 },
  { id: 'sfp+', label: 'SFP+ スロット（10G）', accepts: ['SFP+', 'SFP'], maxSpeed: 10_000 },
  { id: 'sfp28', label: 'SFP28 スロット（25G）', accepts: ['SFP28', 'SFP+'], maxSpeed: 25_000 },
  { id: 'qsfp+', label: 'QSFP+ スロット（40G）', accepts: ['QSFP+'], maxSpeed: 40_000 },
  { id: 'qsfp28', label: 'QSFP28 スロット（100G）', accepts: ['QSFP28', 'QSFP+'], maxSpeed: 100_000 },
];
export const media: Medium[] = [
  { id: 'utp', label: 'UTPケーブル（Cat6A・RJ45）', form: 'RJ45', speed: 10_000, kind: 'utp', reach: '100 m' },
  { id: '1000sx', label: '1000BASE-SX（SFP・マルチモード光）', form: 'SFP', speed: 1000, kind: 'mmf', reach: '約550 m' },
  { id: '10gsr', label: '10GBASE-SR（SFP+・マルチモード光）', form: 'SFP+', speed: 10_000, kind: 'mmf', reach: '約300 m（OM3）' },
  { id: '10glr', label: '10GBASE-LR（SFP+・シングルモード光）', form: 'SFP+', speed: 10_000, kind: 'smf', reach: '約10 km' },
  { id: 'dac10', label: 'SFP+ DAC（10G・モジュールとケーブルが一体）', form: 'SFP+', speed: 10_000, kind: 'dac', reach: '数 m' },
  { id: '25gsr', label: '25GBASE-SR（SFP28・マルチモード光）', form: 'SFP28', speed: 25_000, kind: 'mmf', reach: '約70〜100 m' },
  { id: 'dac25', label: 'SFP28 DAC（25G・一体型）', form: 'SFP28', speed: 25_000, kind: 'dac', reach: '数 m' },
  { id: '40gsr4', label: '40GBASE-SR4（QSFP+・マルチモード光）', form: 'QSFP+', speed: 40_000, kind: 'mmf', reach: '約100〜150 m' },
  { id: '100gsr4', label: '100GBASE-SR4（QSFP28・マルチモード光）', form: 'QSFP28', speed: 100_000, kind: 'mmf', reach: '約70〜100 m' },
  { id: 'dac100', label: 'QSFP28 DAC（100G・一体型）', form: 'QSFP28', speed: 100_000, kind: 'dac', reach: '数 m' },
];
const fiber = { mmf: 'マルチモード', smf: 'シングルモード' } as const;

/** Can port A with medium A talk to port B with medium B, and at what speed? Reasons explain every "no". */
export function checkLink(portA: PortType, mediumA: Medium, portB: PortType, mediumB: Medium): { ok: boolean; speed?: number; reasons: string[] } {
  const reasons: string[] = [];
  for (const [p, m, side] of [[portA, mediumA, 'A'], [portB, mediumB, 'B']] as const) {
    if (!p.accepts.includes(m.form)) reasons.push(`${side}側: ${p.label} には ${m.form} の${m.kind === 'utp' ? 'ケーブル' : 'モジュール'}は挿さりません（形状・規格が違う）`);
  }
  if ((mediumA.kind === 'dac') !== (mediumB.kind === 'dac') || (mediumA.kind === 'dac' && mediumA.id !== mediumB.id)) reasons.push('DACはモジュールとケーブルが一体の部品です。両端が同じ1本のDACである必要があります');
  else if ((mediumA.kind === 'utp') !== (mediumB.kind === 'utp')) reasons.push('片側が銅線（RJ45）、もう片側が光・DACです。媒体が違うので直接はつながりません（メディアコンバーターなどが必要）');
  else if (mediumA.kind !== 'utp' && mediumA.kind !== 'dac') {
    if (mediumA.kind !== mediumB.kind) reasons.push(`両端の光モジュールのファイバーの種類が違います（${fiber[mediumA.kind as 'mmf' | 'smf']} と ${fiber[mediumB.kind as 'mmf' | 'smf']}）。波長と使うファイバーをそろえます`);
    else if (mediumA.id !== mediumB.id) reasons.push(`両端の光モジュールの規格・速度が違います（${mediumA.label} と ${mediumB.label}）。光リンクは、両端を同じ規格のモジュールにそろえます`);
  }
  if (reasons.length) return { ok: false, reasons };
  // Copper negotiates down to what both ports support; optics and DAC run at the module speed if both cages allow it.
  const speed = mediumA.kind === 'utp' ? Math.min(portA.maxSpeed, portB.maxSpeed, mediumA.speed) : mediumA.speed;
  if (speed > Math.min(portA.maxSpeed, portB.maxSpeed)) return { ok: false, reasons: [`モジュールの速度（${speed / 1000} Gbps）に、ポートが対応していません`] };
  return { ok: true, speed, reasons: [mediumA.kind === 'utp' && speed < mediumA.speed ? `銅線（RJ45）はオートネゴシエーションで、両端が対応する速度（${speed >= 1000 ? `${speed / 1000} Gbps` : `${speed} Mbps`}）でリンクします` : `${mediumA.label} でリンクします（到達距離の目安: ${mediumA.reach}）`] };
}

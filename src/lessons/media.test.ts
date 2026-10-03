import { expect, it } from 'vitest';
import { checkLink, media, portTypes } from './media';

const p = (id: string) => portTypes.find(x => x.id === id)!;
const m = (id: string) => media.find(x => x.id === id)!;

it('links only with matching form factor, medium and standard on both ends', () => {
  expect(checkLink(p('sfp+'), m('10gsr'), p('sfp+'), m('10gsr'))).toMatchObject({ ok: true, speed: 10_000 });
  expect(checkLink(p('sfp28'), m('10gsr'), p('sfp+'), m('10gsr'))).toMatchObject({ ok: true, speed: 10_000 });
  expect(checkLink(p('sfp+'), m('10gsr'), p('sfp+'), m('10glr')).reasons[0]).toContain('ファイバーの種類');
  expect(checkLink(p('sfp28'), m('25gsr'), p('sfp+'), m('10gsr')).ok).toBe(false);
  expect(checkLink(p('sfp'), m('10gsr'), p('sfp'), m('10gsr')).reasons[0]).toContain('挿さりません');
  expect(checkLink(p('qsfp28'), m('dac100'), p('qsfp28'), m('dac100'))).toMatchObject({ ok: true, speed: 100_000 });
  expect(checkLink(p('sfp+'), m('dac10'), p('sfp+'), m('10gsr')).reasons[0]).toContain('DAC');
  expect(checkLink(p('rj45-1g'), m('utp'), p('sfp+'), m('10gsr')).ok).toBe(false);
});
it('copper negotiates down to the slower port', () => {
  expect(checkLink(p('rj45-10g'), m('utp'), p('rj45-1g'), m('utp'))).toMatchObject({ ok: true, speed: 1000 });
});

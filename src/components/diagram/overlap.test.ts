import { expect, it } from 'vitest';
import { freeSpot, overlappingPairs, separate, type Box } from './overlap';

const apply = (boxes: Box[], moves: Map<string, { x: number; y: number }>) => boxes.map(b => ({ ...b, ...moves.get(b.id) }));

it('separates overlapping boxes with the requested gap and leaves the others alone', () => {
  const boxes: Box[] = [
    { id: 'a', x: 0, y: 0, w: 190, h: 200 }, { id: 'b', x: 100, y: 40, w: 190, h: 200 }, { id: 'c', x: 90, y: 90, w: 190, h: 200 },
    { id: 'far', x: 2000, y: 2000, w: 190, h: 200 },
  ];
  const moves = separate(boxes, 40);
  expect(moves.has('far')).toBe(false);
  expect(overlappingPairs(apply(boxes, moves), 40)).toEqual([]);
});
it('never moves pinned boxes; only the new one gets out of the way', () => {
  const boxes: Box[] = [{ id: 'old1', x: 0, y: 0, w: 190, h: 200 }, { id: 'old2', x: 240, y: 0, w: 190, h: 200 }, { id: 'new', x: 80, y: 60, w: 190, h: 200 }];
  const moves = separate(boxes, 40, new Set(['old1', 'old2']));
  expect([...moves.keys()]).toEqual(['new']);
  expect(overlappingPairs(apply(boxes, moves), 40)).toEqual([]);
});
it('handles a dense pile (all boxes at the same point)', () => {
  const boxes: Box[] = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, w: 150, h: 150 }));
  expect(overlappingPairs(apply(boxes, separate(boxes, 30)), 30)).toEqual([]);
});
it('freeSpot keeps the position when it is already free, else finds the nearest free one', () => {
  const others: Box[] = [{ id: 'x', x: 0, y: 0, w: 100, h: 100 }];
  expect(freeSpot({ id: 'm', x: 300, y: 0, w: 100, h: 100 }, others, 20)).toEqual({ x: 300, y: 0 });
  const p = freeSpot({ id: 'm', x: 10, y: 10, w: 100, h: 100 }, others, 20);
  expect(overlappingPairs([...others, { id: 'm', ...p, w: 100, h: 100 }], 20)).toEqual([]);
  expect(Math.hypot(p.x - 10, p.y - 10)).toBeLessThan(160);
});

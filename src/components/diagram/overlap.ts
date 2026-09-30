/** Overlap detection / removal for diagrams (pure; used by the topology editor, the AWS diagram and their tests). */
export interface Box { id: string; x: number; y: number; w: number; h: number }
export type Positions = Map<string, { x: number; y: number }>;

/** True when the boxes overlap or are closer than `gap`. */
export const intersects = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function overlappingPairs(boxes: Box[], gap = 0): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (intersects(boxes[i], boxes[j], gap)) out.push([boxes[i].id, boxes[j].id]);
  return out;
}

/** Nearest position (searched on rings of `step`) where `box` keeps `gap` from every box in `others`. */
export function freeSpot(box: Box, others: Box[], gap: number, step = 20): { x: number; y: number } {
  const fits = (x: number, y: number) => others.every(o => o.id === box.id || !intersects({ ...box, x, y }, o, gap));
  if (fits(box.x, box.y)) return { x: box.x, y: box.y };
  for (let r = 1; r < 400; r++) {
    // Walk the square ring of radius r, nearest points first (sides before corners).
    const candidates: [number, number][] = [];
    for (let k = -r; k <= r; k++) candidates.push([k, -r], [k, r], [-r, k], [r, k]);
    candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [dx, dy] of candidates) { const x = box.x + dx * step, y = box.y + dy * step; if (fits(x, y)) return { x, y }; }
  }
  return { x: box.x, y: box.y };
}

/**
 * Remove overlaps with minimal movement: overlapping pairs are pushed apart along the axis of least
 * penetration (both move half, or only the unpinned one). Anything still overlapping after the
 * relaxation rounds is placed at the nearest free spot. Returns only the boxes that moved.
 */
export function separate(boxes: Box[], gap: number, pinned: ReadonlySet<string> = new Set(), rounds = 60): Positions {
  const b = boxes.map(x => ({ ...x }));
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const p = b[i], q = b[j];
      if (!intersects(p, q, gap)) continue;
      const pinP = pinned.has(p.id), pinQ = pinned.has(q.id);
      if (pinP && pinQ) continue;
      const dx = Math.min(p.x + p.w + gap - q.x, q.x + q.w + gap - p.x);
      const dy = Math.min(p.y + p.h + gap - q.y, q.y + q.h + gap - p.y);
      const alongX = dx <= dy;
      const centre = (v: Box) => alongX ? v.x + v.w / 2 : v.y + v.h / 2;
      const sign = Math.sign(centre(q) - centre(p)) || (q.id > p.id ? 1 : -1);
      const d = (alongX ? dx : dy) + 1;
      const [sp, sq] = pinP ? [0, 1] : pinQ ? [1, 0] : [0.5, 0.5];
      if (alongX) { p.x -= sign * d * sp; q.x += sign * d * sq; } else { p.y -= sign * d * sp; q.y += sign * d * sq; }
      moved = true;
    }
    if (!moved) break;
  }
  for (const v of b) { v.x = Math.round(v.x); v.y = Math.round(v.y); }
  // Fallback for dense clusters where pairwise pushing oscillates.
  for (const v of b) {
    if (pinned.has(v.id)) continue;
    if (b.some(o => o !== v && intersects(v, o, gap))) Object.assign(v, freeSpot(v, b.filter(o => o !== v), gap));
  }
  const out: Positions = new Map();
  b.forEach((v, i) => { if (v.x !== boxes[i].x || v.y !== boxes[i].y) out.set(v.id, { x: v.x, y: v.y }); });
  return out;
}

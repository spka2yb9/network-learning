import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { curriculum } from './curriculum';
import { sections } from './theory';
import { visuals } from '../components/TheoryVisual/visuals';

describe('Theory visual content integrity', () => {
  it('gives every chapter diagrams that resolve to known, uniquely placed content', () => {
    const used: string[] = [];
    for (const chapter of curriculum) {
      const text = readFileSync(new URL(`../content/${chapter.dir}/theory.md`, import.meta.url), 'utf8');
      const refs = sections(text).flatMap(section => [...section.body.matchAll(/```theory-visual\n([^\n]+)\n```/g)].map(m => m[1]));
      expect(refs.length, chapter.id).toBeGreaterThanOrEqual(4);
      for (const id of refs) expect(visuals[id], `${chapter.id}: ${id}`).toBeDefined();
      used.push(...refs);
    }
    expect(new Set(used).size).toBe(used.length);
    expect(used.sort()).toEqual(Object.keys(visuals).sort());
  });

  it('has valid graph connections and a caption for every sequence message', () => {
    for (const [id, visual] of Object.entries(visuals)) {
      expect(visual.steps.length, id).toBeGreaterThan(1);
      const nodeIds = visual.nodes?.map(n => n.id) ?? [];
      for (const edge of visual.edges ?? []) {
        expect(nodeIds, id).toContain(edge.from);
        expect(nodeIds, id).toContain(edge.to);
      }
      for (const step of visual.steps) {
        for (const node of step.nodes ?? []) expect(nodeIds, id).toContain(node);
        for (const edge of step.edges ?? []) expect(visual.edges?.[edge], id).toBeDefined();
        for (const node of step.blockedNodes ?? []) expect(nodeIds, id).toContain(node);
        for (const edge of step.blockedEdges ?? []) {
          expect(visual.edges?.[edge], id).toBeDefined();
          expect(step.edges ?? [], `${id}: a blocked edge cannot carry packets`).not.toContain(edge);
        }
        if (visual.kind === 'compare') {
          expect(step.table?.length, id).toBeGreaterThan(0);
          for (const row of step.table!) expect(row.length, id).toBe(visual.columns?.length);
          if (step.focusRow !== undefined) expect(step.table?.[step.focusRow], id).toBeDefined();
        }
        if (visual.kind === 'bars') {
          expect(visual.scale?.max, id).toBeGreaterThan(0);
          expect(step.bars?.length, id).toBeGreaterThan(0);
          for (const bar of step.bars!) {
            for (const part of bar.parts) expect(part.value, id).toBeGreaterThanOrEqual(0);
            expect(bar.parts.reduce((sum, p) => sum + p.value, 0), `${id}: bars must fit their scale`).toBeLessThanOrEqual(visual.scale!.max);
          }
        }
      }
      if (visual.kind === 'graph') {
        const nodes = visual.nodes ?? [];
        for (const node of nodes) {
          expect(node.x >= 65 && node.x <= 595 && node.y >= 32 && node.y <= 268, `${id}: ${node.id} inside the frame`).toBe(true);
          for (const other of nodes) if (other !== node) expect(Math.abs(node.x - other.x) >= 135 || Math.abs(node.y - other.y) >= 70, `${id}: ${node.id} overlaps ${other.id}`).toBe(true);
        }
      }
      if (visual.kind === 'chart') {
        const { x, y, series, limit } = visual.chart!;
        expect(series.length, id).toBeGreaterThan(0);
        expect(series.length, `${id}: three series colors`).toBeLessThanOrEqual(3);
        for (const t of x.ticks) expect(t >= 0 && t <= x.max, id).toBe(true);
        for (const t of y.ticks) expect(t >= 0 && t <= y.max, id).toBe(true);
        for (const line of series) for (const [px, py] of line.points) expect(px >= 0 && px <= x.max && py >= 0 && py <= y.max, `${id}: ${line.label} (${px}, ${py})`).toBe(true);
        if (limit) expect(limit.y >= 0 && limit.y <= y.max, id).toBe(true);
        for (const step of visual.steps) {
          if (step.reveal !== undefined) expect(step.reveal >= 0 && step.reveal <= x.max, id).toBe(true);
          if (step.mark) expect(step.mark.x >= 0 && step.mark.x <= x.max && step.mark.y >= 0 && step.mark.y <= y.max, `${id}: mark`).toBe(true);
        }
      }
      if (visual.kind === 'sequence') {
        expect(visual.messages?.length, id).toBe(visual.steps.length);
        for (const message of visual.messages!) {
          expect(visual.lanes?.[message.from], id).toBeDefined();
          expect(visual.lanes?.[message.to], id).toBeDefined();
        }
      }
    }
  });
});

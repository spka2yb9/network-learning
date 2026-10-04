import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { curriculum } from './curriculum';
import { sections } from './theory';
import { diagrams } from '../components/TheoryVisual/diagrams';

describe('Theory static diagrams', () => {
  it('resolves every reference and leaves no unused diagrams or hand-drawn text diagrams', () => {
    const used: string[] = [];
    for (const chapter of curriculum) {
      const text = readFileSync(new URL(`../content/${chapter.dir}/theory.md`, import.meta.url), 'utf8');
      const refs = sections(text).flatMap(section => [...section.body.matchAll(/```theory-diagram\n([^\n]+)\n```/g)].map(m => m[1]));
      expect(refs.length, chapter.id).toBeGreaterThan(0);
      for (const id of refs) expect(diagrams[id], `${chapter.id}: ${id}`).toBeDefined();
      used.push(...refs);
      for (const block of text.matchAll(/```text\n([\s\S]*?)```/g)) {
        expect(block[1], `${chapter.id}: remaining ASCII diagram`).not.toMatch(/[┌└┐┘├┤─═]|\[.*\|.*\]/);
      }
    }
    expect(new Set(used).size).toBe(used.length);
    expect(used.sort()).toEqual(Object.keys(diagrams).sort());
  });

  it('keeps graph endpoints valid and nodes separate, and bit values within their octets', () => {
    for (const [id, diagram] of Object.entries(diagrams)) {
      if (diagram.kind === 'network') {
        const nodes = diagram.nodes.map(n => n.id);
        expect(new Set(nodes).size, id).toBe(nodes.length);
        const positions = diagram.nodes.map(n => `${n.column}:${n.row}`);
        expect(new Set(positions).size, id).toBe(positions.length);
        for (const link of diagram.links) {
          expect(nodes, id).toContain(link.from);
          expect(nodes, id).toContain(link.to);
          expect(link.from, id).not.toBe(link.to);
        }
      }
      if (diagram.kind === 'bits') for (const row of diagram.rows) {
        expect(row.value.every(n => Number.isInteger(n) && n >= 0 && n < 256), id).toBe(true);
        if (row.prefix !== undefined) expect(row.prefix >= 0 && row.prefix <= row.value.length * 8, id).toBe(true);
      }
    }
  });
});

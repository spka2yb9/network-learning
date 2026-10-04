import { describe, expect, it } from 'vitest';
import { buildGlossary, sections, termCards, termPattern, termsIn } from './theory';

const doc = `## はじめに
導入です。

## 本題
### 小見出し
\`\`\`text
## これは見出しではない
\`\`\`
> **用語：MACアドレス**（Media Access Control address）
> NICごとの**48ビット**の番号。
> 例: \`02:00:00:00:00:01\`

ポートとサポートとIPv4とIPアドレス。
`;

describe('theory format', () => {
  it('splits sections at ## outside code fences and lists ### subsections', () => {
    const s = sections(doc);
    expect(s.map(x => x.title)).toEqual(['はじめに', '本題']);
    expect(s[1].subsections).toEqual(['小見出し']);
    expect(s[1].body).toContain('## これは見出しではない');
    expect(s[0].minutes).toBe(1);
  });
  it('reads term cards as plain text', () => {
    expect(termCards(doc, 'tcp-ip')).toEqual([{ term: 'MACアドレス', reading: '（Media Access Control address）', definition: 'NICごとの48ビットの番号。 例: 02:00:00:00:00:01', chapter: 'tcp-ip', section: 1 }]);
  });
  it('matches whole words, longest first', () => {
    const p = termPattern(['ポート', 'IP', 'IPアドレス', 'MACアドレス'])!;
    expect([...'ポートとサポートとIPv4とIPアドレスとIP。'.matchAll(p)].map(m => m[0])).toEqual(['ポート', 'IPアドレス', 'IP']);
  });
  it('keeps the earliest definition and lists the terms a text defines first', () => {
    const g = buildGlossary([{ id: 'a', text: doc }, { id: 'b', text: doc.replace('NICごと', '別の定義') }]);
    expect(g.get('MACアドレス')!.chapter).toBe('a');
    const g2 = new Map([...g, ['ポート', { term: 'ポート', reading: '', definition: 'x', chapter: 'a', section: 0 }]]);
    expect(termsIn(doc, g2)).toEqual(['MACアドレス', 'ポート']);
  });
});

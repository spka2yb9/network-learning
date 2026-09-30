/**
 * Parser for an explicitly limited HCL subset (educational). Not the official HCL implementation.
 * Supported: blocks with labels, attributes, strings with ${} interpolation, numbers, bools, null,
 * lists, objects, references (a.b[0].c, a.b[*].c), function calls, arithmetic, comparison, && || !, ?:.
 * Not supported: heredocs, for-expressions, dynamic blocks, splat on expressions other than references.
 */
export interface Pos { line: number; column: number; file: string }
export type PathStep = { attr: string } | { index: Expr } | { splat: true };
export type Expr =
  | { kind: 'literal'; value: string | number | boolean | null; pos: Pos }
  | { kind: 'template'; parts: (string | Expr)[]; pos: Pos }
  | { kind: 'list'; items: Expr[]; pos: Pos }
  | { kind: 'object'; entries: { key: string; value: Expr }[]; pos: Pos }
  | { kind: 'ref'; root: string; path: PathStep[]; pos: Pos }
  | { kind: 'call'; name: string; args: Expr[]; pos: Pos }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; pos: Pos }
  | { kind: 'unary'; op: '-' | '!'; expr: Expr; pos: Pos }
  | { kind: 'cond'; test: Expr; yes: Expr; no: Expr; pos: Pos };
export interface Attribute { kind: 'attribute'; name: string; value: Expr; pos: Pos }
export interface Block { kind: 'block'; type: string; labels: string[]; body: Body; pos: Pos }
export type Body = (Attribute | Block)[];

export class HclError extends Error {
  constructor(message: string, public pos: Pos) { super(`${pos.file}:${pos.line}:${pos.column}: ${message}`); }
}
type Tok = { t: 'ident' | 'number' | 'string' | 'punct' | 'nl' | 'eof'; v: string; pos: Pos; parts?: (string | { src: string; pos: Pos })[] };

function lex(src: string, file: string): Tok[] {
  const out: Tok[] = [];
  let i = 0; let line = 1; let col = 1;
  const pos = (): Pos => ({ line, column: col, file });
  const adv = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { adv(); continue; }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) { while (i < src.length && src[i] !== '\n') adv(); continue; }
    if (c === '/' && src[i + 1] === '*') { const p = pos(); adv(2); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv(); if (i >= src.length) throw new HclError('コメント /* が閉じていません（*/ で閉じます）', p); adv(2); continue; }
    if (c === '\n') { out.push({ t: 'nl', v: '\n', pos: pos() }); adv(); continue; }
    if (c === '<' && src[i + 1] === '<') throw new HclError('ヒアドキュメント（<<EOF）は教育用パーサーでは未対応です。1行の文字列（"..."）で書いてください', pos());
    if (/[A-Za-z_]/.test(c)) { const p = pos(); let s = ''; while (i < src.length && /[A-Za-z0-9_-]/.test(src[i])) { s += src[i]; adv(); } out.push({ t: 'ident', v: s, pos: p }); continue; }
    if (/[0-9]/.test(c)) {
      const p = pos(); let s = '';
      while (/[0-9]/.test(src[i] ?? '')) { s += src[i]; adv(); }
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '') && out.at(-1)?.v !== '.') { s += '.'; adv(); while (/[0-9]/.test(src[i] ?? '')) { s += src[i]; adv(); } }
      out.push({ t: 'number', v: s, pos: p }); continue;
    }
    if (c === '"') {
      const p = pos(); adv();
      const parts: (string | { src: string; pos: Pos })[] = []; let buf = '';
      while (true) {
        if (i >= src.length || src[i] === '\n') throw new HclError('文字列が閉じていません（" で閉じます。文字列は1行で書きます）', p);
        if (src[i] === '"') { adv(); break; }
        if (src[i] === '\\' && src[i + 1] === 'u' && /^[0-9A-Fa-f]{4}$/.test(src.slice(i + 2, i + 6))) { buf += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); adv(6); continue; }
        if (src[i] === '\\') { const n = src[i + 1]; buf += n === 'n' ? '\n' : n === 't' ? '\t' : n; adv(2); continue; }
        if (src.startsWith('$${', i)) { buf += '${'; adv(3); continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          if (buf) parts.push(buf); buf = '';
          const ip = pos(); adv(2); let depth = 1; let inner = '';
          while (i < src.length && depth) { if (src[i] === '{') depth++; if (src[i] === '}') depth--; if (depth) inner += src[i]; adv(); if (src[i - 1] === '\n') throw new HclError('${ が閉じていません（} で閉じます）', ip); }
          parts.push({ src: inner, pos: ip }); continue;
        }
        buf += src[i]; adv();
      }
      if (buf || !parts.length) parts.push(buf);
      out.push({ t: 'string', v: '', pos: p, parts }); continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'punct', v: two, pos: pos() }); adv(2); continue; }
    if ('{}[]()=,.:?+-*/%<>!'.includes(c)) { out.push({ t: 'punct', v: c, pos: pos() }); adv(); continue; }
    throw new HclError(`解釈できない文字です: "${c}"（全角の記号や空白が混ざっていないか確認してください）`, pos());
  }
  out.push({ t: 'eof', v: '', pos: pos() });
  return out;
}

const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function parseHcl(src: string, file = 'main.tf'): Body {
  if (src.length > 200_000) throw new HclError('ファイルが大きすぎます（200KBまで）', { line: 1, column: 1, file });
  return parser(lex(src, file)).program();
}

function parser(toks: Tok[]) {
  let k = 0;
  const peek = () => toks[k];
  const next = () => toks[k++];
  const skipNl = () => { while (peek().t === 'nl') k++; };
  const is = (v: string) => peek().t === 'punct' && peek().v === v;
  const expect = (v: string) => { const t = next(); if (t.t !== 'punct' || t.v !== v) throw new HclError(`"${v}" が必要です（"${t.v || t.t}" があります）`, t.pos); return t; };
  function body(end: string | null): Body {
    const items: Body = [];
    while (true) {
      skipNl();
      const t = peek();
      if (end === null && t.t === 'eof') return items;
      if (end !== null && is(end)) return items;
      if (t.t === 'eof') throw new HclError('ブロックが閉じていません（"}" がありません）', t.pos);
      if (t.t !== 'ident') throw new HclError(`属性名またはブロック名が必要です（"${t.v}"）`, t.pos);
      k++;
      if (is('=')) {
        k++;
        const value = expr();
        const after = peek();
        if (after.t !== 'nl' && after.t !== 'eof' && !(end && is(end))) throw new HclError('1行に書ける属性は1つです。属性の後で改行してください', after.pos);
        items.push({ kind: 'attribute', name: t.v, value, pos: t.pos });
        continue;
      }
      const labels: string[] = [];
      while (peek().t === 'string' || peek().t === 'ident') {
        const l = next();
        if (l.t === 'string') { if (l.parts!.some(p => typeof p !== 'string')) throw new HclError('ブロックのラベルに式は使えません（例: resource "aws_vpc" "main"）', l.pos); labels.push(l.parts!.join('')); }
        else labels.push(l.v);
      }
      expect('{');
      const inner = body('}');
      expect('}');
      items.push({ kind: 'block', type: t.v, labels, body: inner, pos: t.pos });
    }
  }
  function expr(): Expr {
    const test = binary(0);
    if (is('?')) { k++; skipNl(); const yes = expr(); skipNl(); expect(':'); skipNl(); const no = expr(); return { kind: 'cond', test, yes, no, pos: test.pos }; }
    return test;
  }
  function binary(min: number): Expr {
    let left = unary();
    while (peek().t === 'punct' && precedence[peek().v] > min) {
      const op = next().v; skipNl();
      const right = binary(precedence[op]);
      left = { kind: 'binary', op, left, right, pos: left.pos };
    }
    return left;
  }
  function unary(): Expr {
    const t = peek();
    if (t.t === 'punct' && (t.v === '-' || t.v === '!')) { k++; return { kind: 'unary', op: t.v, expr: unary(), pos: t.pos }; }
    return postfix(primary());
  }
  function postfix(e: Expr): Expr {
    while (e.kind === 'ref') {
      if (is('.')) {
        k++; const name = next();
        if (name.t === 'ident') e.path.push({ attr: name.v });
        else if (name.t === 'number') e.path.push({ index: { kind: 'literal', value: Number(name.v), pos: name.pos } });
        else if (name.t === 'punct' && name.v === '*') e.path.push({ splat: true });
        else throw new HclError('"." の後に属性名が必要です', name.pos);
      } else if (is('[')) {
        k++;
        if (is('*')) { k++; e.path.push({ splat: true }); } else e.path.push({ index: expr() });
        expect(']');
      } else break;
    }
    return e;
  }
  function list<T>(close: string, item: () => T): T[] {
    const items: T[] = []; skipNl();
    while (!is(close)) { items.push(item()); skipNl(); if (is(',')) { k++; skipNl(); } else break; }
    skipNl(); expect(close);
    return items;
  }
  function primary(): Expr {
    const t = next();
    if (t.t === 'number') return { kind: 'literal', value: Number(t.v), pos: t.pos };
    if (t.t === 'string') {
      const parts = t.parts!.map(p => typeof p === 'string' ? p : parser(lex(p.src, p.pos.file).map(x => ({ ...x, pos: { ...p.pos } }))).single());
      if (parts.length === 1 && typeof parts[0] === 'string') return { kind: 'literal', value: parts[0], pos: t.pos };
      return { kind: 'template', parts, pos: t.pos };
    }
    if (t.t === 'ident') {
      if (t.v === 'true' || t.v === 'false') return { kind: 'literal', value: t.v === 'true', pos: t.pos };
      if (t.v === 'null') return { kind: 'literal', value: null, pos: t.pos };
      if (t.v === 'for') throw new HclError('for 式は教育用パーサーでは未対応です。繰り返しは count と count.index で書いてください', t.pos);
      if (is('(')) { k++; return { kind: 'call', name: t.v, args: list(')', expr), pos: t.pos }; }
      return { kind: 'ref', root: t.v, path: [], pos: t.pos };
    }
    if (t.t === 'punct' && t.v === '(') { skipNl(); const e = expr(); skipNl(); expect(')'); return e; }
    if (t.t === 'punct' && t.v === '[') {
      skipNl();
      if (peek().t === 'ident' && peek().v === 'for') throw new HclError('for 式は教育用パーサーでは未対応です。繰り返しは count と count.index で書いてください', peek().pos);
      return { kind: 'list', items: list(']', expr), pos: t.pos };
    }
    if (t.t === 'punct' && t.v === '{') {
      // Object entries are separated by commas or newlines.
      const entries: { key: string; value: Expr }[] = [];
      while (true) {
        skipNl();
        if (is('}')) break;
        const key = next();
        if (key.t !== 'ident' && key.t !== 'string') throw new HclError('オブジェクトのキーが必要です', key.pos);
        const sep = next(); if (sep.v !== '=' && sep.v !== ':') throw new HclError('キーの後に = が必要です', sep.pos);
        entries.push({ key: key.t === 'string' ? key.parts!.join('') : key.v, value: expr() });
        if (is(',')) k++;
        else if (peek().t !== 'nl' && !is('}')) throw new HclError('オブジェクトの要素はカンマか改行で区切ります', peek().pos);
      }
      expect('}');
      return { kind: 'object', entries, pos: t.pos };
    }
    throw new HclError(`ここには値（式）が必要です（"${t.v || t.t}"）`, t.pos);
  }
  return {
    program: () => body(null),
    single: () => { const e = expr(); if (peek().t !== 'eof') throw new HclError('補間 ${...} の中身が不正です', peek().pos); return e; },
  };
}

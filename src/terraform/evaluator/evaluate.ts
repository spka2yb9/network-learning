import { HclError, parseHcl, type Attribute, type Block, type Body, type Expr, type PathStep, type Pos } from '../parser/parser';
import { dataSchema, resourceSchema, type AttrSpec } from '../resources/schema';
import { cidr, dotted } from '../../simulator/l3/ipv4';

export const UNKNOWN = Object.freeze({ __unknown: true as const });
export type Unknown = typeof UNKNOWN;
export type Value = string | number | boolean | null | Unknown | Value[] | { [key: string]: Value };
export const isUnknown = (v: unknown): v is Unknown => typeof v === 'object' && v !== null && '__unknown' in v;
export const containsUnknown = (v: Value): boolean => isUnknown(v) || (Array.isArray(v) ? v.some(containsUnknown) : typeof v === 'object' && v !== null ? Object.values(v).some(containsUnknown) : false);

export interface Diagnostic { severity: 'error' | 'warning'; summary: string; detail?: string; pos?: Pos }
export class TfError extends Error { constructor(public diagnostic: Diagnostic) { super(diagnostic.summary); } }
const fail = (summary: string, pos?: Pos, detail?: string): never => { throw new TfError({ severity: 'error', summary, detail, pos }); };

export interface Lifecycle { preventDestroy: boolean; createBeforeDestroy: boolean; ignoreChanges: string[] }
export interface ResourceConfig { mode: 'managed' | 'data'; type: string; name: string; block: Block; count?: Expr; dependsOn: Expr[]; lifecycle: Lifecycle }
export interface ModuleCall { name: string; source: string; inputs: Attribute[]; block: Block }
export interface ModuleConfig {
  path: string;
  variables: Map<string, { block: Block; default?: Expr; type?: string }>;
  locals: Map<string, Attribute>;
  resources: Map<string, ResourceConfig>;
  outputs: Map<string, Attribute>;
  modules: Map<string, ModuleCall>;
  providers: Block[];
  terraform: Block[];
}

const attr = (body: Body, name: string) => body.find((x): x is Attribute => x.kind === 'attribute' && x.name === name);
const blocks = (body: Body, type: string) => body.filter((x): x is Block => x.kind === 'block' && x.type === type);

/** Group files by module directory ("" = root, "modules/vpc" = child) and parse them. */
export function loadModules(files: Record<string, string>) {
  const modules = new Map<string, ModuleConfig>();
  const diagnostics: Diagnostic[] = [];
  const dirOf = (f: string) => f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
  for (const [file, src] of Object.entries(files)) {
    if (!file.endsWith('.tf')) continue;
    const dir = dirOf(file);
    const m: ModuleConfig = modules.get(dir) ?? { path: dir, variables: new Map(), locals: new Map(), resources: new Map(), outputs: new Map(), modules: new Map(), providers: [], terraform: [] };
    modules.set(dir, m);
    let body: Body;
    try { body = parseHcl(src, file); } catch (e) { diagnostics.push({ severity: 'error', summary: e instanceof HclError ? e.message.replace(/^[^ ]+ /, '') : String(e), pos: e instanceof HclError ? e.pos : undefined }); continue; }
    for (const item of body) {
      if (item.kind === 'attribute') { diagnostics.push({ severity: 'error', summary: 'ファイルの一番外側（トップレベル）に「名前 = 値」は書けません。resource などのブロックの中に書くか、変数の値なら .tfvars に書きます', pos: item.pos }); continue; }
      const dup = (map: Map<string, unknown>, key: string, what: string) => { if (map.has(key)) diagnostics.push({ severity: 'error', summary: `Duplicate ${what} "${key}"（同じ名前のものが2つあります。どちらかの名前を変えてください）`, pos: item.pos }); };
      const [a, b] = item.labels;
      switch (item.type) {
        case 'terraform': m.terraform.push(item); break;
        case 'provider': m.providers.push(item); if (a !== 'aws') diagnostics.push({ severity: 'error', summary: `provider "${a}" は教育用シミュレータでは未対応です（使えるのは aws だけです）`, pos: item.pos }); break;
        case 'variable': dup(m.variables, a, 'variable'); m.variables.set(a, { block: item, default: attr(item.body, 'default')?.value, type: typeText(attr(item.body, 'type')?.value) }); break;
        case 'locals': for (const x of item.body) if (x.kind === 'attribute') { dup(m.locals, x.name, 'local value'); m.locals.set(x.name, x); } break;
        case 'output': dup(m.outputs, a, 'output'); { const v = attr(item.body, 'value'); if (!v) diagnostics.push({ severity: 'error', summary: `output "${a}" に value がありません（value = ... で、外へ見せる値を書きます）`, pos: item.pos }); else m.outputs.set(a, v); } break;
        case 'module': dup(m.modules, a, 'module'); {
          const source = attr(item.body, 'source')?.value;
          if (!source || source.kind !== 'literal' || typeof source.value !== 'string') { diagnostics.push({ severity: 'error', summary: `module "${a}" の source は文字列で指定します（例: source = "./modules/network"）`, pos: item.pos }); break; }
          m.modules.set(a, { name: a, source: source.value, inputs: item.body.filter((x): x is Attribute => x.kind === 'attribute' && !['source', 'version', 'depends_on'].includes(x.name)), block: item });
        } break;
        case 'resource': case 'data': {
          if (item.labels.length !== 2) { diagnostics.push({ severity: 'error', summary: `${item.type} ブロックには型と名前の2つのラベルが必要です（例: ${item.type} "aws_vpc" "main"）`, pos: item.pos }); break; }
          const key = `${item.type === 'data' ? 'data.' : ''}${a}.${b}`;
          dup(m.resources, key, item.type);
          const lc = blocks(item.body, 'lifecycle')[0];
          const ignore = lc && attr(lc.body, 'ignore_changes')?.value;
          m.resources.set(key, {
            mode: item.type === 'data' ? 'data' : 'managed', type: a, name: b, block: item, count: attr(item.body, 'count')?.value,
            dependsOn: (() => { const d = attr(item.body, 'depends_on')?.value; return d?.kind === 'list' ? d.items : d ? [d] : []; })(),
            lifecycle: { preventDestroy: literalBool(lc && attr(lc.body, 'prevent_destroy')?.value), createBeforeDestroy: literalBool(lc && attr(lc.body, 'create_before_destroy')?.value),
              ignoreChanges: ignore?.kind === 'list' ? ignore.items.map(i => i.kind === 'ref' ? i.root : '').filter(Boolean) : [] },
          });
          break;
        }
        default: diagnostics.push({ severity: 'error', summary: `未対応のブロック "${item.type}" です（このシミュレータで使えるのは terraform / provider / variable / locals / resource / data / output / module）`, pos: item.pos });
      }
    }
  }
  if (!modules.has('')) modules.set('', { path: '', variables: new Map(), locals: new Map(), resources: new Map(), outputs: new Map(), modules: new Map(), providers: [], terraform: [] });
  return { modules, diagnostics };
}
function literalBool(e?: Expr) { return e?.kind === 'literal' && e.value === true; }
function typeText(e?: Expr): string | undefined {
  if (!e) return undefined;
  if (e.kind === 'ref') return e.root;
  if (e.kind === 'call') return `${e.name}(${e.args.map(typeText).join(',')})`;
  return undefined;
}

// ---------------------------------------------------------------- expression evaluation
export interface Scope {
  vars: Record<string, Value>;
  local(name: string, pos: Pos): Value;
  resource(key: string, pos: Pos): Value;
  module(name: string, pos: Pos): Value;
  countIndex?: number;
  path: string;
}
function applyPath(value: Value, steps: PathStep[], scope: Scope, pos: Pos, label: string): Value {
  let v = value;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (isUnknown(v)) return UNKNOWN;
    if ('splat' in s) {
      if (!Array.isArray(v)) v = v === null ? [] : [v];
      return v.map(item => applyPath(item, steps.slice(i + 1), scope, pos, label));
    }
    if ('index' in s) {
      const idx = evaluate(s.index, scope);
      if (isUnknown(idx)) return UNKNOWN;
      if (Array.isArray(v)) {
        if (typeof idx !== 'number' || !Number.isInteger(idx)) fail(`${label}: リストの番号（インデックス）には整数を指定します`, pos);
        if ((idx as number) < 0 || (idx as number) >= v.length) fail(`Invalid index: ${label}[${idx}] は範囲外です（要素数 ${v.length}。番号は 0 から数えます）`, pos);
        v = v[idx as number];
      } else if (v && typeof v === 'object') { v = (v as Record<string, Value>)[String(idx)] ?? fail(`${label} にキー "${idx}" がありません`, pos); }
      else fail(`${label} はリストでもマップでもないため、[ ] で要素を取り出せません`, pos);
      continue;
    }
    if (Array.isArray(v)) fail(`Unsupported attribute: ${label} は count で複数作るため、リストになっています。${label}[0].${s.attr}（1つ目）や ${label}[*].${s.attr}（全部）のように要素を指定します`, pos);
    if (v === null || typeof v !== 'object') fail(`Unsupported attribute: ${label}.${s.attr} は存在しません`, pos);
    const obj = v as Record<string, Value>;
    if (!(s.attr in obj)) fail(`Unsupported attribute: "${s.attr}" という属性はありません（${label}）。属性名の打ち間違いがないか確認してください`, pos);
    v = obj[s.attr]; label = `${label}.${s.attr}`;
  }
  return v;
}
const str = (v: Value, pos: Pos): string => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fail('文字列に変換できない値です（リストやマップは、そのまま文字列に埋め込めません）', pos);
const cidrOf = (fn: string, v: Value, pos: Pos) => { const text = str(v, pos); try { return cidr(text); } catch (e) { return fail(`${fn}: "${text}" は使えません。${(e as Error).message}`, pos); } };
export const functions: Record<string, (args: Value[], pos: Pos) => Value> = {
  cidrsubnet: ([prefix, newbits, netnum], pos) => {
    const c = cidrOf('cidrsubnet', prefix, pos); const nb = Number(newbits); const nn = Number(netnum);
    if (!Number.isInteger(nb) || nb < 0 || c.prefix + nb > 32) fail('cidrsubnet: newbits（延ばすビット数）は 0 以上の整数で、元のプレフィックス長と足して 32 以下にします', pos);
    if (!Number.isInteger(nn) || nn < 0 || nn >= 2 ** nb) fail(`cidrsubnet: netnum ${nn} は ${nb} ビットで表せる範囲（0〜${2 ** nb - 1}）を超えています`, pos);
    const size = 2 ** (32 - c.prefix - nb);
    return `${dotted(c.network + nn * size)}/${c.prefix + nb}`;
  },
  cidrhost: ([prefix, host], pos) => { const c = cidrOf('cidrhost', prefix, pos); const size = c.broadcast - c.network + 1; const h = Number(host) < 0 ? size + Number(host) : Number(host); if (!Number.isInteger(h) || h < 0 || h >= size) fail('cidrhost: ホスト番号が、このプレフィックスの範囲外です（負の数は末尾から数えます。-1 が最後のアドレス）', pos); return dotted(c.network + h); },
  length: ([v], pos) => Array.isArray(v) ? v.length : typeof v === 'string' ? v.length : v && typeof v === 'object' && !isUnknown(v) ? Object.keys(v).length : fail('length: リスト・文字列・マップを指定します', pos),
  element: ([list, i], pos) => Array.isArray(list) && list.length ? list[Number(i) % list.length] : fail('element: 空でないリストを指定します', pos),
  concat: (args, pos) => args.flatMap(a => Array.isArray(a) ? a : fail('concat: リストを指定します', pos)),
  merge: (args, pos) => Object.assign({}, ...args.map(a => a && typeof a === 'object' && !Array.isArray(a) && !isUnknown(a) ? a : fail('merge: マップを指定します', pos))),
  lookup: ([map, key, dflt], pos) => map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, Value>)[str(key, pos)] ?? (dflt === undefined ? fail(`lookup: キー ${key} がありません`, pos) : dflt) : fail('lookup: マップを指定します', pos),
  format: ([f, ...args], pos) => { let i = 0; return str(f, pos).replace(/%[sd%]/g, m => m === '%%' ? '%' : str(args[i++] ?? '', pos)); },
  tostring: ([v], pos) => str(v, pos),
  tonumber: ([v], pos) => { const n = Number(v); return Number.isFinite(n) ? n : fail('tonumber: 数値に変換できません', pos); },
  upper: ([v], pos) => str(v, pos).toUpperCase(),
  lower: ([v], pos) => str(v, pos).toLowerCase(),
  join: ([sep, list], pos) => Array.isArray(list) ? list.map(x => str(x, pos)).join(str(sep, pos)) : fail('join: リストを指定します', pos),
  slice: ([list, a, b], pos) => Array.isArray(list) ? list.slice(Number(a), Number(b)) : fail('slice: リストを指定します', pos),
  range: ([a, b], pos) => { const [start, end] = b === undefined ? [0, Number(a)] : [Number(a), Number(b)]; if (!Number.isInteger(start) || !Number.isInteger(end) || end - start > 256) fail('range: 256個までの整数範囲です', pos); return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i); },
};
export function evaluate(e: Expr, scope: Scope): Value {
  switch (e.kind) {
    case 'literal': return e.value;
    case 'template': {
      const parts = e.parts.map(p => typeof p === 'string' ? p : evaluate(p, scope));
      if (parts.some(isUnknown)) return UNKNOWN;
      return parts.map(p => typeof p === 'string' ? p : str(p, e.pos)).join('');
    }
    case 'list': return e.items.map(i => evaluate(i, scope));
    case 'object': return Object.fromEntries(e.entries.map(x => [x.key, evaluate(x.value, scope)]));
    case 'call': {
      const f = functions[e.name];
      if (!f) fail(`Call to unknown function: ${e.name}()（このシミュレータで使える関数: ${Object.keys(functions).join(', ')}）`, e.pos);
      const args = e.args.map(a => evaluate(a, scope));
      // length() only needs the collection itself to be known (a counted resource's list length is known at plan time).
      if (e.name === 'length' ? isUnknown(args[0]) : args.some(containsUnknown)) return UNKNOWN;
      return f(args, e.pos);
    }
    case 'unary': {
      const v = evaluate(e.expr, scope);
      if (isUnknown(v)) return UNKNOWN;
      return e.op === '-' ? (typeof v === 'number' ? -v : fail('- を付けられるのは数値だけです', e.pos)) : !v;
    }
    case 'binary': {
      const l = evaluate(e.left, scope); const r = evaluate(e.right, scope);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      if (['+', '-', '*', '/', '%'].includes(e.op)) {
        if (typeof l !== 'number' || typeof r !== 'number') fail(`演算子 ${e.op} は数値に使います（文字列の結合は "\${a}\${b}" のように補間を使います）`, e.pos);
        const a = l as number; const b = r as number;
        return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : e.op === '/' ? a / b : a % b;
      }
      if (e.op === '&&') return !!l && !!r;
      if (e.op === '||') return !!l || !!r;
      if (e.op === '==') return JSON.stringify(l) === JSON.stringify(r);
      if (e.op === '!=') return JSON.stringify(l) !== JSON.stringify(r);
      const a = l as number; const b = r as number;
      return e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '<=' ? a <= b : a >= b;
    }
    case 'cond': { const t = evaluate(e.test, scope); if (isUnknown(t)) return UNKNOWN; return evaluate(t ? e.yes : e.no, scope); }
    case 'ref': {
      const [first, ...rest] = e.path;
      const name = first && 'attr' in first ? first.attr : undefined;
      switch (e.root) {
        case 'var': if (!name || !(name in scope.vars)) fail(`Reference to undeclared input variable: var.${name}`, e.pos); return applyPath(scope.vars[name!], rest, scope, e.pos, `var.${name}`);
        case 'local': if (!name) fail('local.<名前> で参照します', e.pos); return applyPath(scope.local(name!, e.pos), rest, scope, e.pos, `local.${name}`);
        case 'count': if (name !== 'index') fail('count で参照できるのは count.index だけです', e.pos); if (scope.countIndex === undefined) fail('count.index は count を設定したリソースの中でのみ使えます', e.pos); return scope.countIndex!;
        case 'path': return scope.path || '.';
        case 'module': if (!name) fail('module.<名前>.<output> で参照します', e.pos); return applyPath(scope.module(name!, e.pos), rest, scope, e.pos, `module.${name}`);
        case 'data': {
          const second = rest[0];
          if (!name || !second || !('attr' in second)) fail('data.<型>.<名前> で参照します', e.pos);
          const key = `data.${name}.${(second as { attr: string }).attr}`;
          return applyPath(scope.resource(key, e.pos), rest.slice(1), scope, e.pos, key);
        }
        default: {
          if (!name) fail(`参照 "${e.root}" の書き方が正しくありません（例: aws_vpc.main.id）`, e.pos);
          if (!resourceSchema[e.root] && !e.root.startsWith('aws_')) fail(`Invalid reference: "${e.root}" は var / local / module / data / リソース型のいずれでもありません`, e.pos);
          const key = `${e.root}.${name}`;
          return applyPath(scope.resource(key, e.pos), rest, scope, e.pos, key);
        }
      }
    }
  }
}
/** References an expression makes (for dependency graphs), e.g. "aws_vpc.main", "module.net", "local.x". */
export function references(e: Expr | undefined, out = new Set<string>()): Set<string> {
  if (!e) return out;
  switch (e.kind) {
    case 'template': e.parts.forEach(p => typeof p !== 'string' && references(p, out)); break;
    case 'list': e.items.forEach(i => references(i, out)); break;
    case 'object': e.entries.forEach(x => references(x.value, out)); break;
    case 'call': e.args.forEach(a => references(a, out)); break;
    case 'unary': references(e.expr, out); break;
    case 'binary': references(e.left, out); references(e.right, out); break;
    case 'cond': references(e.test, out); references(e.yes, out); references(e.no, out); break;
    case 'ref': {
      const a = e.path[0] && 'attr' in e.path[0] ? e.path[0].attr : undefined;
      const b = e.path[1] && 'attr' in e.path[1] ? e.path[1].attr : undefined;
      if (e.root === 'data' && a && b) out.add(`data.${a}.${b}`);
      else if (['var', 'local', 'module'].includes(e.root) && a) out.add(`${e.root}.${a}`);
      else if (a && e.root !== 'count' && e.root !== 'path') out.add(`${e.root}.${a}`);
      for (const s of e.path) if ('index' in s) references(s.index, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- resource body → attribute values
export function checkType(spec: AttrSpec, v: Value, name: string, pos: Pos): Value {
  if (isUnknown(v) || v === null) return v;
  const ok = spec.type === 'string' ? ['string', 'number', 'boolean'].includes(typeof v) : spec.type === 'number' ? typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))
    : spec.type === 'bool' ? typeof v === 'boolean' : spec.type === 'list' ? Array.isArray(v) : typeof v === 'object' && !Array.isArray(v);
  if (!ok) fail(`Incorrect attribute value type: "${name}" は ${spec.type} 型です。型に合う値を書いてください`, pos);
  if (spec.type === 'string') return typeof v === 'string' ? v : String(v);
  if (spec.type === 'number') return Number(v);
  return v;
}
/** Evaluate a resource body against its schema. Returns attributes including nested blocks as lists. */
export function resourceAttributes(rc: ResourceConfig, scope: Scope): Record<string, Value> {
  const spec = rc.mode === 'managed' ? resourceSchema[rc.type] : undefined;
  const dspec = rc.mode === 'data' ? dataSchema[rc.type] : undefined;
  if (!spec && !dspec) fail(`${rc.mode === 'data' ? 'データソース' : 'リソースタイプ'} "${rc.type}" は教育用シミュレータでは未対応です`, rc.block.pos, `このシミュレータで使えるもの: ${Object.keys(rc.mode === 'data' ? dataSchema : resourceSchema).join(', ')}`);
  const attrs = spec?.attrs ?? dspec!.attrs;
  const out: Record<string, Value> = {};
  const meta = ['count', 'depends_on', 'provider'];
  for (const item of rc.block.body) {
    if (item.kind === 'attribute') {
      if (meta.includes(item.name)) continue;
      const a = attrs[item.name];
      if (!a) fail(`Unsupported argument: "${item.name}" は ${rc.type} の引数ではありません（名前の打ち間違いか、このシミュレータが対応していない引数です）`, item.pos);
      out[item.name] = checkType(a, evaluate(item.value, scope), item.name, item.pos);
    } else {
      if (item.type === 'lifecycle' || (rc.mode === 'data' && item.type === 'filter')) continue;
      const bs = spec?.blocks?.[item.type];
      if (!bs) fail(`Unsupported block type: "${item.type}" は ${rc.type} のブロックではありません`, item.pos);
      const obj: Record<string, Value> = {};
      for (const x of item.body) {
        if (x.kind !== 'attribute') fail(`${item.type} ブロックの中には、さらにブロックを書けません（このシミュレータの制限）`, x.pos);
        const a = bs!.attrs[(x as Attribute).name];
        if (!a) fail(`Unsupported argument: "${(x as Attribute).name}" は ${item.type} ブロックの引数ではありません`, x.pos);
        obj[(x as Attribute).name] = checkType(a, evaluate((x as Attribute).value, scope), (x as Attribute).name, x.pos);
      }
      for (const r of bs!.required ?? []) if (!(r in obj)) fail(`Missing required argument: ${item.type} ブロックに "${r}" が必要です`, item.pos);
      out[item.type] = [...((out[item.type] as Value[]) ?? []), obj];
    }
  }
  for (const [name, a] of Object.entries(attrs)) {
    if (a.required && !(name in out)) fail(`Missing required argument: ${rc.type} には引数 "${name}" が必要です`, rc.block.pos);
    if (!(name in out) && a.default !== undefined) out[name] = a.default as Value;
  }
  return out;
}
export const parseSnippet = (src: string) => parseHcl(src, 'terraform.tfvars');

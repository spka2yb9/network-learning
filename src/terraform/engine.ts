import type { Expr, Pos } from './parser/parser';
import { HclError, parseHcl } from './parser/parser';
import { containsUnknown, evaluate, isUnknown, loadModules, references, resourceAttributes, TfError, UNKNOWN, type Diagnostic, type Lifecycle, type ModuleConfig, type ResourceConfig, type Scope, type Value } from './evaluator/evaluate';
import { dataSchema, resourceSchema } from './resources/schema';
import { cloudToAws } from './resources/toAws';
import { validateModel } from '../aws/model';
import { cidr, dotted } from '../simulator/l3/ipv4';
import { formatHcl } from './fmt';

export type Action = 'create' | 'update' | 'replace' | 'delete' | 'noop';
export interface StateResource { address: string; type: string; id: string; attributes: Record<string, Value>; dependencies: string[] }
export interface TfState { serial: number; lineage: string; resources: Record<string, StateResource>; outputs: Record<string, Value> }
export interface CloudResource { id: string; type: string; attributes: Record<string, Value>; origin: 'terraform' | 'console' }
export interface Cloud { counter: number; resources: Record<string, CloudResource> }
export interface Change { address: string; type: string; action: Action; before?: Record<string, Value>; after: Record<string, Value>; forceNew: string[]; changed: string[]; lifecycle: Lifecycle; dependencies: string[] }
export interface Plan { changes: Change[]; outputs: Record<string, Value>; drift: string[]; diagnostics: Diagnostic[] }
export interface WorkspaceSnapshot { version: 1; files: Record<string, string>; state: TfState; cloud: Cloud; initialized: boolean; lock?: { id: string; who: string; operation: string } }

const clone = <T>(v: T): T => structuredClone(v);
const hex = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0');
const same = (a: Value, b: Value) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const NOTE = '（教育用シミュレーション: 実際の Terraform CLI / AWS Provider の出力ではありません）';
/** Any thrown error as a diagnostic, so a bad expression never makes a command silently do nothing. */
const diagnosticOf = (e: unknown): Diagnostic => e instanceof TfError ? e.diagnostic : e instanceof HclError ? { severity: 'error', summary: e.message.replace(/^[^ ]+ /, ''), pos: e.pos } : { severity: 'error', summary: e instanceof Error ? e.message : String(e) };

interface ModuleInstance { prefix: string; config: ModuleConfig; vars: Record<string, Value>; parent?: ModuleInstance; callPos?: Pos }

/**
 * Educational Terraform workspace: files + state + a simulated "cloud" (what AWS would contain).
 * The same lazy evaluator is used for plan (unknown values) and apply (creates resources in dependency order).
 */
export class TerraformWorkspace {
  files: Record<string, string>;
  state: TfState;
  cloud: Cloud;
  initialized: boolean;
  lock?: { id: string; who: string; operation: string };
  pending?: Plan;
  private pendingFiles = '';
  constructor(snapshot?: Partial<WorkspaceSnapshot>) {
    this.files = clone(snapshot?.files ?? { 'main.tf': '' });
    this.state = clone(snapshot?.state ?? { serial: 0, lineage: 'path-lab', resources: {}, outputs: {} });
    this.cloud = clone(snapshot?.cloud ?? { counter: 0, resources: {} });
    this.initialized = snapshot?.initialized ?? false;
    this.lock = snapshot?.lock;
  }
  snapshot(): WorkspaceSnapshot { return clone({ version: 1, files: this.files, state: this.state, cloud: this.cloud, initialized: this.initialized, lock: this.lock }); }
  awsModel() { return cloudToAws(this.cloud); }

  // ------------------------------------------------------------ commands
  run(line: string): string {
    const args = line.trim().replace(/^terraform\s+/, '').split(/\s+/).filter(Boolean);
    const [cmd, ...rest] = args;
    try {
      switch (cmd) {
        case 'init': return this.init();
        case 'fmt': return this.fmt(rest.includes('-check'));
        case 'validate': return this.validate();
        case 'plan': return this.planText();
        case 'apply': return rest.includes('-auto-approve') ? this.applyText() : this.applyPrompt();
        case 'destroy': return rest.includes('-auto-approve') ? this.applyText(true) : this.applyPrompt(true);
        case 'import': return this.import(rest[0], rest[1]);
        case 'state': return this.stateCommand(rest);
        case 'output': return this.outputText();
        case 'show': return this.show();
        case 'graph': return this.graph();
        case 'force-unlock': return this.forceUnlock(rest[0]);
        case 'version': return 'Terraform v1.x (PATH educational simulator)\non linux_amd64（ブラウザ内の簡易実装）';
        default: return `このシミュレータでは使えないコマンドです: ${cmd ?? ''}\n使えるコマンド: init / fmt / validate / plan / apply / destroy / import / state list|show|rm / output / show / graph / force-unlock`;
      }
    } catch (e) { return formatDiagnostics([diagnosticOf(e)]); }
  }
  private requireInit() {
    if (!this.initialized) throw new TfError({ severity: 'error', summary: 'Inconsistent dependency lock file / Required plugins are not installed', detail: 'まだ terraform init を実行していません。\nterraform init でプロバイダ（AWSと話すプラグイン）を準備してから、もう一度実行してください。' });
  }
  private requireLock() {
    if (this.lock) throw new TfError({ severity: 'error', summary: 'Error acquiring the state lock', detail: `ほかの人（または CI）の操作が state をロックしているため、実行できません。\nLock Info:\n  ID:        ${this.lock.id}\n  Who:       ${this.lock.who}\n  Operation: ${this.lock.operation}\nロックは、2人が同時に apply して state が壊れるのを防ぐ仕組みです。\nまず相手の操作が終わるのを待ってから、もう一度実行してください（この画面では「チームメイトのロックを解除」ボタンで、相手の操作が終わった状態にできます）。\n相手の処理が異常終了してロックだけが残った場合に限り、terraform force-unlock ${this.lock.id} で解除します。` });
  }
  init() {
    const { modules, diagnostics } = loadModules(this.files);
    const errors = diagnostics.filter(d => d.severity === 'error');
    if (errors.length) return formatDiagnostics(errors);
    const missing = [...modules.values()].flatMap(m => [...m.modules.values()].map(c => ({ c, path: normalizePath(m.path, c.source) }))).filter(x => !modules.has(x.path));
    if (missing.length) return formatDiagnostics(missing.map(x => ({ severity: 'error' as const, summary: `Unreadable module directory: ${x.c.source}`, detail: `${x.path}/ に .tf ファイルがありません。source のパスが正しいか、そのディレクトリにファイルを作ったかを確認してください。\n（このシミュレータでは、同じワークスペース内のディレクトリだけをモジュールとして使えます）`, pos: x.c.block.pos })));
    this.initialized = true;
    const mods = [...modules.keys()].filter(Boolean);
    return ['Initializing the backend...', ...(mods.length ? ['Initializing modules...', ...mods.map(m => `- ${m}`)] : []),
      'Initializing provider plugins...', '- Finding hashicorp/aws versions matching "~> 5.0"...', '- Installing hashicorp/aws (simulated)...',
      '', 'Terraform has been successfully initialized!', NOTE].join('\n');
  }
  fmt(check: boolean) {
    const changed: string[] = [];
    for (const [f, src] of Object.entries(this.files)) {
      if (!f.endsWith('.tf') && !f.endsWith('.tfvars')) continue;
      const out = formatHcl(src);
      if (out !== src) { changed.push(f); if (!check) this.files[f] = out; }
    }
    return check ? (changed.length ? `${changed.join('\n')}\n（上のファイルは、書式が標準の形と違います。terraform fmt で整形できます）` : 'すべてのファイルが整形済みです') : changed.join('\n') || '変更はありません（すでに整形済み）';
  }
  validate() {
    this.requireInit();
    const diags = this.buildPlan('validate').diagnostics;
    const errors = diags.filter(d => d.severity === 'error');
    return errors.length ? formatDiagnostics(diags) : `${formatDiagnostics(diags.filter(d => d.severity === 'warning'))}Success! The configuration is valid.\n${NOTE}`;
  }
  planText() {
    this.requireInit(); this.requireLock();
    const plan = this.buildPlan('plan');
    return renderPlan(plan);
  }
  applyPrompt(destroy = false) {
    this.requireInit(); this.requireLock();
    const plan = this.buildPlan(destroy ? 'destroy' : 'plan');
    if (plan.diagnostics.some(d => d.severity === 'error')) return renderPlan(plan);
    this.pending = plan; this.pendingFiles = JSON.stringify(this.files);
    const n = plan.changes.filter(c => c.action !== 'noop').length;
    return `${renderPlan(plan)}${n ? `\nDo you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only 'yes' will be accepted to approve.\n（この画面では、上に表示された「yes: 実行する」ボタンで承認します）` : ''}`;
  }
  confirm(approved: boolean) {
    const plan = this.pending; this.pending = undefined;
    if (!plan) return '承認待ちの plan はありません。先に terraform apply を実行してください。';
    if (!approved) return 'Apply cancelled.';
    try {
      this.requireLock();
      if (JSON.stringify(this.files) !== this.pendingFiles) throw new TfError({ severity: 'error', summary: 'Saved plan is stale', detail: 'plan を表示した後に、コードが変更されました。表示された plan は古いため、実行しません。\nもう一度 terraform apply を実行し、新しい plan を確認してから承認してください。' });
      return this.execute(plan);
    } catch (e) { return formatDiagnostics([diagnosticOf(e)]); }
  }
  applyText(destroy = false) {
    this.requireInit(); this.requireLock();
    const plan = this.buildPlan(destroy ? 'destroy' : 'plan');
    if (plan.diagnostics.some(d => d.severity === 'error')) return renderPlan(plan);
    return `${renderPlan(plan)}\n${this.execute(plan)}`;
  }
  private import(address?: string, id?: string) {
    this.requireInit(); this.requireLock();
    if (!address || !id) return '使い方: terraform import <ADDRESS> <ID>\n例: terraform import aws_vpc.legacy vpc-0legacy01（先に resource "aws_vpc" "legacy" ブロックを書いておきます）';
    if (this.state.resources[address]) return formatDiagnostics([{ severity: 'error', summary: 'Resource already managed by Terraform', detail: `${address} はすでに state にあり、Terraform が管理しています。\n別のアドレスを指定してください。取り込み直す場合は、先に terraform state rm ${address} を実行します。` }]);
    const cfg = this.findConfig(address);
    if (!cfg) return formatDiagnostics([{ severity: 'error', summary: 'Configuration for import target does not exist', detail: `import 先の resource ブロック（${address}）がコードにありません。\n先に resource ブロックを書いてから、もう一度 import してください。import は state に対応を書き込むだけで、コードは作りません。` }]);
    const res = this.cloud.resources[id];
    if (!res || res.type !== cfg.type) return formatDiagnostics([{ severity: 'error', summary: 'Cannot import non-existent remote object', detail: `${id} という ${cfg.type} は、クラウド上に見つかりません。\nIDの打ち間違いがないか、resource ブロックの型が実物の種類と合っているかを確認してください。` }]);
    this.state.resources[address] = { address, type: res.type, id, attributes: clone(res.attributes), dependencies: [] };
    this.state.serial++;
    res.origin = 'terraform';
    return `${address}: Importing from ID "${id}"...\nImport successful!\n\nThe resources that were imported are shown above. These resources are now in\nyour Terraform state and will henceforth be managed by Terraform.\n（次に terraform plan を実行し、コードと実物に差分がないか確認します。差分があれば、コードを実物に合わせます）`;
  }
  private findConfig(address: string) {
    const { modules } = loadModules(this.files);
    const root = modules.get('')!;
    const key = address.replace(/\[\d+\]$/, '');
    return root.resources.get(key);
  }
  private stateCommand(args: string[]) {
    const [sub, address] = args;
    if (sub === 'list') return Object.keys(this.state.resources).sort().join('\n') || '（state は空です。terraform apply でリソースを作ると、ここに一覧が出ます）';
    if (sub === 'show' && address) { const r = this.state.resources[address]; if (!r) return `No instance found for the given address: ${address}\n（terraform state list で、state にあるアドレスを確認できます）`; return `# ${address}:\nresource "${r.type}" "${address.split('.').at(-1)!.replace(/\[\d+\]$/, '')}" {\n${Object.entries(r.attributes).map(([k, v]) => `    ${k.padEnd(28)} = ${renderValue(v)}`).join('\n')}\n}`; }
    if (sub === 'rm' && address) { if (!this.state.resources[address]) return `No instance found for the given address: ${address}`; const id = this.state.resources[address].id; delete this.state.resources[address]; this.state.serial++; if (this.cloud.resources[id]) this.cloud.resources[id].origin = 'console'; return `Removed ${address}\nSuccessfully removed 1 resource instance(s).\n（実物は削除されていません。Terraform の管理から外れただけです）`; }
    return '使い方: terraform state list | state show <ADDRESS> | state rm <ADDRESS>';
  }
  private outputText() {
    const o = Object.entries(this.state.outputs);
    return o.length ? o.map(([k, v]) => `${k} = ${renderValue(v)}`).join('\n') : 'No outputs found.';
  }
  private show() {
    const r = Object.values(this.state.resources);
    return r.length ? r.map(x => `# ${x.address}: (id = ${x.id})`).join('\n') : 'The state file is empty. No resources are represented.';
  }
  private graph() {
    return ['digraph {', ...Object.values(this.state.resources).flatMap(r => r.dependencies.map(d => `  "${r.address}" -> "${d}"`)), '}'].join('\n');
  }
  private forceUnlock(id?: string) {
    if (!this.lock) return 'ロックはかかっていません';
    if (id !== this.lock.id) return formatDiagnostics([{ severity: 'error', summary: 'Failed to unlock state', detail: `指定したロックIDが、今のロックと一致しません。\nエラーに表示された Lock Info の ID（${this.lock.id}）を指定してください。` }]);
    this.lock = undefined;
    return 'Terraform state has been successfully unlocked!';
  }

  // ------------------------------------------------------------ planning
  /** Refresh: compare state with the simulated cloud (drift detection). */
  private refresh() {
    const refreshed = clone(this.state);
    const drift: string[] = [];
    for (const [address, r] of Object.entries(refreshed.resources)) {
      const real = this.cloud.resources[r.id];
      if (!real) { drift.push(`  # ${address} has been deleted（Terraform の外で削除されました）`); delete refreshed.resources[address]; continue; }
      const changed = [...new Set([...Object.keys(real.attributes), ...Object.keys(r.attributes)])].filter(k => !same(real.attributes[k], r.attributes[k]));
      if (changed.length) { drift.push(`  # ${address} has changed（Terraform の外で変更された属性: ${changed.join(', ')}）`); r.attributes = clone(real.attributes); }
    }
    return { refreshed, drift };
  }
  buildPlan(mode: 'plan' | 'destroy' | 'validate'): Plan {
    const { modules, diagnostics } = loadModules(this.files);
    const { refreshed, drift } = mode === 'validate' ? { refreshed: { ...this.state, resources: {} } as TfState, drift: [] } : this.refresh();
    const plan: Plan = { changes: [], outputs: {}, drift, diagnostics: [...diagnostics] };
    if (diagnostics.some(d => d.severity === 'error')) return plan;
    const ev = new Evaluator(modules, this.files, refreshed, mode === 'validate');
    try {
      if (mode !== 'destroy') {
        ev.all();
        plan.outputs = ev.rootOutputs();
      }
    } catch (e) { if (e instanceof TfError) { plan.diagnostics.push(e.diagnostic); return plan; } throw e; }
    plan.changes = [...ev.changes.values()];
    // lifecycleOf() evaluates module inputs, which adds entries to ev.changes: compare against the planned set only.
    const planned = new Set(ev.changes.keys());
    for (const [address, r] of Object.entries(refreshed.resources)) {
      if (planned.has(address)) continue;
      let lc: Lifecycle = { preventDestroy: false, createBeforeDestroy: false, ignoreChanges: [] };
      try { lc = ev.lifecycleOf(address); } catch { /* config may be gone: default lifecycle */ }
      plan.changes.push({ address, type: r.type, action: 'delete', before: r.attributes, after: {}, forceNew: [], changed: [], lifecycle: lc, dependencies: r.dependencies });
    }
    for (const c of plan.changes) if ((c.action === 'delete' || c.action === 'replace') && c.lifecycle.preventDestroy) {
      plan.diagnostics.push({ severity: 'error', summary: 'Instance cannot be destroyed', detail: `${c.address} には lifecycle.prevent_destroy = true が設定されているため、${c.action === 'replace' ? '置き換え（削除を伴う）' : '削除'}できません。\n本当に削除してよい場合だけ、prevent_destroy を外してから実行します。${c.action === 'replace' ? '\n置き換えを避けたい場合は、# forces replacement が付いた属性の変更を元に戻します。' : ''}` });
    }
    return plan;
  }
  // ------------------------------------------------------------ applying
  private execute(plan: Plan): string {
    const log: string[] = [];
    const matches = (dep: string, c: Change) => c.address === dep || c.address.startsWith(`${dep}[`) || c.address.startsWith(`${dep}.`);
    const memo = new Map<Change, number>();
    const depth = (c: Change, path = new Set<Change>()): number => {
      if (memo.has(c)) return memo.get(c)!;
      if (path.has(c)) return 0; path.add(c);
      const d = 1 + Math.max(0, ...plan.changes.filter(o => o !== c && c.dependencies.some(d => matches(d, o))).map(o => depth(o, path)));
      path.delete(c); memo.set(c, d); return d;
    };
    const depthOf = new Map(plan.changes.map(c => [c, depth(c)]));
    const byDepth = (dir: 1 | -1) => (x: Change, y: Change) => dir * (depthOf.get(x)! - depthOf.get(y)!);
    let added = 0, changed = 0, destroyed = 0;
    const before = new Set(validateModel(this.awsModel()));
    const fail = (c: Change, err: string) => {
      log.push(`╷\n│ Error: ${c.action === 'update' ? 'updating' : 'creating'} ${c.type} (${c.address}): ${err}\n╵`);
      return `${log.join('\n')}\n\nApply stopped with an error.\nエラーの時点で apply は止まりました。それまでに作成できたリソースは、実物も state も残っています（部分適用）。\nエラーの原因を直してから、もう一度 plan → apply すると、残りのリソースが作られます。\n${NOTE}`;
    };
    // 1. destroy (dependents first). create_before_destroy replacements are destroyed at the end.
    for (const c of plan.changes.filter(c => c.action === 'delete' || (c.action === 'replace' && !c.lifecycle.createBeforeDestroy)).sort(byDepth(-1))) {
      const r = this.state.resources[c.address];
      if (!r) continue;
      delete this.cloud.resources[r.id]; delete this.state.resources[c.address];
      log.push(`${c.address}: Destroying... [id=${r.id}]`, `${c.address}: Destruction complete`);
      destroyed++;
    }
    // 2. create / update in dependency order, re-evaluating with real values.
    const { modules } = loadModules(this.files);
    const pending = plan.changes.filter(c => c.action === 'create' || c.action === 'update' || c.action === 'replace').sort(byDepth(1));
    for (const c of pending) {
      let attrs: Record<string, Value>;
      try { attrs = new Evaluator(modules, this.files, this.state, false, true).valueForApply(c.address); } catch (e) { return fail(c, diagnosticOf(e).summary); }
      // ignore_changes: an in-place update keeps the current (refreshed) value instead of the configured one.
      if (c.action === 'update') for (const k of c.lifecycle.ignoreChanges) if (c.before && k in c.before) attrs[k] = c.before[k];
      const old = this.state.resources[c.address];
      const id = c.action === 'update' && old ? old.id : this.newId(c.type);
      const full = this.computed(c.type, id, attrs, c.action === 'update' ? old?.attributes : undefined);
      const previous = this.cloud.resources[id];
      this.cloud.resources[id] = { id, type: c.type, attributes: full, origin: 'terraform' };
      const errors = validateModel(this.awsModel()).filter(e => !before.has(e));
      if (errors.length) { if (previous) this.cloud.resources[id] = previous; else delete this.cloud.resources[id]; return fail(c, `AWS API エラー（シミュレーション）: ${errors.join(' / ')}`); }
      this.state.resources[c.address] = { address: c.address, type: c.type, id, attributes: clone(full), dependencies: c.dependencies };
      this.state.serial++;
      log.push(`${c.address}: ${c.action === 'update' ? `Modifying... [id=${id}]` : 'Creating...'}`, `${c.address}: ${c.action === 'update' ? 'Modifications' : 'Creation'} complete [id=${id}]`);
      if (c.action === 'update') changed++; else added++;
    }
    for (const c of plan.changes.filter(c => c.action === 'replace' && c.lifecycle.createBeforeDestroy)) {
      const oldId = plan.changes.find(x => x === c)?.before?.id;
      if (typeof oldId === 'string') { delete this.cloud.resources[oldId]; log.push(`${c.address} (deposed): Destruction complete`); destroyed++; }
    }
    try { this.state.outputs = Object.fromEntries(Object.entries(new Evaluator(modules, this.files, this.state, false, true).rootOutputs()).filter(([, v]) => !containsUnknown(v))); } catch { this.state.outputs = {}; }
    this.state.serial++;
    return [...log, '', `Apply complete! Resources: ${added} added, ${changed} changed, ${destroyed} destroyed.`, ...(Object.keys(this.state.outputs).length ? ['', 'Outputs:', '', this.outputText()] : []), NOTE].join('\n');
  }
  private newId(type: string) { this.cloud.counter++; return `${resourceSchema[type].prefix}-0${hex(this.cloud.counter)}`; }
  private computed(type: string, id: string, attrs: Record<string, Value>, previous?: Record<string, Value>): Record<string, Value> {
    const out: Record<string, Value> = { ...attrs, id };
    const arn = (kind: string) => `arn:aws:ec2:ap-northeast-1:123456789012:${kind}/${id}`;
    const pool = (base: string, start: number, key: string) => {
      const used = new Set(Object.values(this.cloud.resources).map(r => r.attributes[key]).filter(Boolean));
      for (let n = start; n < 250; n++) { const ip = `${base}.${n}`; if (!used.has(ip)) return ip; }
      return `${base}.250`;
    };
    switch (type) {
      case 'aws_vpc': Object.assign(out, { arn: arn('vpc'), main_route_table_id: previous?.main_route_table_id ?? `rtb-0${hex(this.cloud.counter + 7001)}`, default_network_acl_id: previous?.default_network_acl_id ?? `acl-0${hex(this.cloud.counter + 7002)}`, default_security_group_id: previous?.default_security_group_id ?? `sg-0${hex(this.cloud.counter + 7003)}` }); break;
      case 'aws_eip': Object.assign(out, { public_ip: previous?.public_ip ?? pool('203.0.113', 10, 'public_ip'), allocation_id: id }); break;
      case 'aws_nat_gateway': out.public_ip = (this.cloud.resources[attrs.allocation_id as string]?.attributes.public_ip as string) ?? null; break;
      case 'aws_instance': {
        const subnet = this.cloud.resources[attrs.subnet_id as string];
        if (!attrs.private_ip && subnet) {
          const c = cidr(subnet.attributes.cidr_block as string);
          const used = new Set(Object.values(this.cloud.resources).filter(r => r.type === 'aws_instance').map(r => r.attributes.private_ip));
          for (let n = 10; n < c.broadcast - c.network; n++) { const ip = dotted(c.network + n); if (!used.has(ip) || previous?.private_ip === ip) { out.private_ip = previous?.private_ip ?? ip; break; } }
        }
        const wantPublic = attrs.associate_public_ip_address ?? subnet?.attributes.map_public_ip_on_launch;
        out.public_ip = wantPublic ? (previous?.public_ip as string) ?? pool('198.51.100', 100, 'public_ip') : null;
        out.arn = arn('instance'); break;
      }
      case 'aws_lb': out.dns_name = `${String(attrs.name ?? 'lb')}-${hex(this.cloud.counter).slice(0, 6)}.ap-northeast-1.elb.amazonaws.com`; out.arn = `arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/${id}`; break;
      case 'aws_lb_target_group': out.arn = `arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/${id}`; break;
      case 'aws_lb_listener': out.arn = `arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:listener/${id}`; break;
      case 'aws_vpc_peering_connection': out.accept_status = attrs.auto_accept ? 'active' : 'pending-acceptance'; break;
      case 'aws_vpc_endpoint': out.prefix_list_id = String(attrs.service_name).endsWith('.dynamodb') ? 'pl-dynamodb' : 'pl-s3'; break;
      default: if (resourceSchema[type].computed.includes('arn')) out.arn = arn(type.replace('aws_', ''));
    }
    return out;
  }
  /** Simulate a manual change in the AWS console (drift) or an unmanaged resource. */
  consoleChange(mutate: (cloud: Cloud) => void) { mutate(this.cloud); }
}

function normalizePath(from: string, source: string) {
  if (!source.startsWith('./') && !source.startsWith('../')) throw new TfError({ severity: 'error', summary: `module source "${source}" は教育用シミュレータでは未対応です`, detail: 'このシミュレータでは、./ か ../ で始まるローカルパス（例: ./modules/network）だけを source に指定できます。\nTerraform Registry や Git からの取得はできません。' });
  const parts = [...(from ? from.split('/') : []), ...source.split('/')];
  const out: string[] = [];
  for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}

class Evaluator {
  changes = new Map<string, Change>();
  private values = new Map<string, Value>();
  private evaluating = new Set<string>();
  private localValues = new Map<string, Value>();
  private moduleOutputs = new Map<string, Value>();
  private instances = new Map<string, ModuleInstance>();
  private root: ModuleInstance;
  /** readState = apply phase: references read the (already updated) state instead of planning. */
  constructor(private modules: Map<string, ModuleConfig>, files: Record<string, string>, private state: TfState, private validating: boolean, private readState = false) {
    this.root = { prefix: '', config: modules.get('')!, vars: {} };
    this.instances.set('', this.root);
    this.root.vars = this.rootVars(files);
  }
  private rootVars(files: Record<string, string>) {
    const provided: Record<string, Value> = {};
    for (const [f, src] of Object.entries(files)) if (f.endsWith('.tfvars')) {
      for (const item of parseHcl(src, f)) {
        if (item.kind !== 'attribute') throw new TfError({ severity: 'error', summary: '.tfvars には「変数名 = 値」の形式だけを書けます（ブロックは書けません）', pos: item.pos });
        if (!this.root.config.variables.has(item.name)) throw new TfError({ severity: 'error', summary: `Value for undeclared variable: ${item.name}`, detail: `${item.name} は variable ブロックで宣言されていません。\n変数名の打ち間違いがないか、variable "${item.name}" {} の宣言が抜けていないかを確認してください。`, pos: item.pos });
        provided[item.name] = evaluate(item.value, constScope());
      }
    }
    return this.bindVars(this.root.config, provided, true);
  }
  private bindVars(config: ModuleConfig, provided: Record<string, Value>, root: boolean, pos?: Pos) {
    const vars: Record<string, Value> = {};
    for (const [name, v] of config.variables) {
      if (name in provided) vars[name] = checkVarType(v.type, provided[name], name, v.block.pos);
      else if (v.default) vars[name] = checkVarType(v.type, evaluate(v.default, constScope()), name, v.block.pos);
      else if (this.validating) vars[name] = UNKNOWN;
      else throw new TfError({ severity: 'error', summary: `No value for required variable: ${name}`, detail: root ? `variable "${name}" に default（既定値）がなく、値も渡されていません。\nterraform.tfvars に ${name} = ... を書くか、variable ブロックに default を設定してください。` : `モジュールの変数 ${name} に値が渡されていません。\nmodule ブロックの中に ${name} = ... を書いてください。`, pos: pos ?? v.block.pos });
    }
    return vars;
  }
  all() {
    const visit = (inst: ModuleInstance) => {
      for (const [key, rc] of inst.config.resources) this.resource(inst, key, rc.block.pos);
      for (const [name, call] of inst.config.modules) visit(this.child(inst, name, call.block.pos));
    };
    visit(this.root);
  }
  rootOutputs() {
    return Object.fromEntries([...this.root.config.outputs].map(([name, a]) => [name, evaluate(a.value, this.scope(this.root))]));
  }
  private locate(address: string) {
    const key = address.replace(/\[\d+\]$/, '');
    const inst = [...this.instances.values()].find(i => key.startsWith(i.prefix) && i.config.resources.has(key.slice(i.prefix.length)));
    return inst && { inst, rc: inst.config.resources.get(key.slice(inst.prefix.length))! };
  }
  lifecycleOf(address: string): Lifecycle {
    this.discover();
    return this.locate(address)?.rc.lifecycle ?? { preventDestroy: false, createBeforeDestroy: false, ignoreChanges: [] };
  }
  private discover() { const walk = (i: ModuleInstance) => { for (const [name, c] of i.config.modules) walk(this.child(i, name, c.block.pos)); }; walk(this.root); }
  private child(parent: ModuleInstance, name: string, pos: Pos): ModuleInstance {
    const prefix = `${parent.prefix}module.${name}.`;
    const existing = this.instances.get(prefix);
    if (existing) return existing;
    const call = parent.config.modules.get(name);
    if (!call) throw new TfError({ severity: 'error', summary: `Reference to undeclared module: module.${name}`, pos });
    const config = this.modules.get(normalizePath(parent.config.path, call.source));
    if (!config) throw new TfError({ severity: 'error', summary: `Module not installed: ${call.source}`, detail: 'source のディレクトリに .tf ファイルが見つかりません。\nパスの打ち間違いがないか、ファイルを作ったかを確認し、terraform init を実行し直してください。', pos: call.block.pos });
    if (prefix.split('module.').length > 4) throw new TfError({ severity: 'error', summary: 'モジュールの入れ子が深すぎます（このシミュレータでは3階層まで）', pos });
    const provided: Record<string, Value> = {};
    for (const input of call.inputs) {
      if (!config.variables.has(input.name)) throw new TfError({ severity: 'error', summary: `Unsupported argument: module "${name}" に変数 "${input.name}" はありません`, detail: `モジュール側に variable "${input.name}" の宣言が必要です。名前の打ち間違いがないかも確認してください。`, pos: input.pos });
      provided[input.name] = evaluate(input.value, this.scope(parent));
    }
    const inst: ModuleInstance = { prefix, config, vars: {}, parent, callPos: call.block.pos };
    this.instances.set(prefix, inst);
    inst.vars = this.bindVars(config, provided, false, call.block.pos);
    return inst;
  }
  private scope(inst: ModuleInstance, countIndex?: number): Scope {
    return {
      vars: inst.vars, countIndex, path: inst.config.path || '.',
      local: (name, pos) => {
        const key = `${inst.prefix}local.${name}`;
        if (this.localValues.has(key)) return this.localValues.get(key)!;
        const a = inst.config.locals.get(name);
        if (!a) throw new TfError({ severity: 'error', summary: `Reference to undeclared local value: local.${name}`, pos });
        if (this.evaluating.has(key)) throw new TfError({ severity: 'error', summary: `Cycle: local.${name} が自分自身を参照しています（循環参照）`, pos });
        this.evaluating.add(key);
        try { const v = evaluate(a.value, this.scope(inst)); this.localValues.set(key, v); return v; } finally { this.evaluating.delete(key); }
      },
      resource: (key, pos) => this.resource(inst, key, pos),
      module: (name, pos) => {
        const child = this.child(inst, name, pos);
        if (this.moduleOutputs.has(child.prefix)) return this.moduleOutputs.get(child.prefix)!;
        const out = Object.fromEntries([...child.config.outputs].map(([o, a]) => [o, evaluate(a.value, this.scope(child))]));
        this.moduleOutputs.set(child.prefix, out);
        return out;
      },
    };
  }
  /** Static dependencies of a resource: references in its body, followed through locals, module inputs and outputs. */
  private dependencies(inst: ModuleInstance, rc: ResourceConfig) {
    const out = new Set<string>(); const seen = new Set<string>();
    const exprs = (body: ResourceConfig['block']['body']): Expr[] => body.flatMap(x => x.kind === 'attribute' ? [x.value] : exprs(x.body));
    const visit = (i: ModuleInstance, e: Expr) => {
      for (const ref of references(e)) {
        const key = `${i.prefix}${ref}`;
        if (seen.has(key)) continue; seen.add(key);
        if (ref.startsWith('local.')) { const a = i.config.locals.get(ref.slice(6)); if (a) visit(i, a.value); }
        else if (ref.startsWith('var.')) { const input = i.parent && [...i.parent.config.modules.values()].find(m => i.prefix.endsWith(`module.${m.name}.`))?.inputs.find(x => x.name === ref.slice(4)); if (input && i.parent) visit(i.parent, input.value); }
        else if (ref.startsWith('module.')) { out.add(key); }
        else out.add(key);
      }
    };
    for (const e of [...exprs(rc.block.body), ...(rc.count ? [rc.count] : []), ...rc.dependsOn]) visit(inst, e);
    return [...out].filter(d => !d.includes('.data.') && !d.startsWith('data.'));
  }
  private resource(inst: ModuleInstance, key: string, pos: Pos): Value {
    const address = `${inst.prefix}${key}`;
    if (this.values.has(address)) return this.values.get(address)!;
    const rc = inst.config.resources.get(key);
    if (!rc) throw new TfError({ severity: 'error', summary: `Reference to undeclared resource: ${key}`, detail: `${inst.prefix ? `モジュール ${inst.prefix} に ` : ''}${key} を宣言する resource / data ブロックがありません。\n名前の打ち間違いがないか、ブロックを書き忘れていないかを確認してください。`, pos });
    if (this.evaluating.has(address)) throw new TfError({ severity: 'error', summary: `Cycle: ${[...this.evaluating].filter(x => !x.includes('local.')).join(' → ')} → ${address}`, detail: 'リソースどうしが互いを参照しているため、どちらを先に作ればよいか決められません（循環依存）。\nどちらか一方の参照を外すか、ルールを aws_security_group_rule のような別のリソースに分けます。', pos });
    this.evaluating.add(address);
    try {
      for (const d of rc.dependsOn) {
        const refs = references(d);
        if (!refs.size) throw new TfError({ severity: 'error', summary: 'depends_on にはリソースまたはモジュールの参照を書きます（例: depends_on = [aws_internet_gateway.main]）', pos: d.pos });
        for (const r of refs) if (r.startsWith('module.')) this.scope(inst).module(r.split('.')[1], d.pos); else this.resource(inst, r, d.pos);
      }
      let value: Value;
      if (rc.mode === 'data') { resourceAttributes(rc, this.scope(inst)); value = clone(dataSchema[rc.type].values) as Value; }
      else if (rc.count) {
        const n = evaluate(rc.count, this.scope(inst));
        if (isUnknown(n)) throw new TfError({ severity: 'error', summary: 'Invalid count argument', detail: 'count の値が、apply するまで決まらない値（リソースのIDなど）に依存しているため、いくつ作るかを plan の時点で決められません。\n変数や length(var.x) のように、plan の時点で決まる値を使ってください。', pos: rc.count.pos });
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 64) throw new TfError({ severity: 'error', summary: 'count には 0〜64 の整数を指定します（64 はこのシミュレータの上限）', pos: rc.count.pos });
        value = Array.from({ length: n }, (_, i) => this.instance(inst, rc, `${address}[${i}]`, i));
      } else value = this.instance(inst, rc, address);
      this.values.set(address, value);
      return value;
    } finally { this.evaluating.delete(address); }
  }
  private instance(inst: ModuleInstance, rc: ResourceConfig, address: string, index?: number): Value {
    const spec = resourceSchema[rc.type];
    const prior = this.state.resources[address];
    if (this.readState) {
      // Apply phase: dependencies were applied first; read their real attributes.
      return prior ? prior.attributes : Object.fromEntries(spec.computed.map(k => [k, UNKNOWN]));
    }
    const attrs = resourceAttributes(rc, this.scope(inst, index));
    // Optional + computed arguments (e.g. aws_instance.private_ip) keep the prior value when omitted.
    const compared = (k: string) => !rc.lifecycle.ignoreChanges.includes(k) && (k in spec.attrs || !!spec.blocks?.[k]) && (k in attrs || !spec.computed.includes(k));
    let action: Action = 'create'; const forceNew: string[] = []; const changed: string[] = [];
    if (prior && !this.validating) {
      for (const k of new Set([...Object.keys(attrs), ...Object.keys(prior.attributes)])) {
        if (!compared(k)) continue;
        if (containsUnknown(attrs[k] ?? null) || !same(attrs[k], prior.attributes[k])) { changed.push(k); if (spec.attrs[k]?.forceNew) forceNew.push(k); }
      }
      action = forceNew.length ? 'replace' : changed.length ? 'update' : 'noop';
    }
    const fresh = action === 'create' || action === 'replace';
    const after = { ...attrs, ...Object.fromEntries(spec.computed.filter(k => !(k in attrs) || isUnknown(attrs[k])).map(k => [k, fresh ? UNKNOWN : prior!.attributes[k] ?? null])) };
    this.changes.set(address, { address, type: rc.type, action, before: prior?.attributes, after, forceNew, changed, lifecycle: rc.lifecycle, dependencies: this.dependencies(inst, rc) });
    return after;
  }
  /** Apply phase: evaluate one planned change using the real values of already-applied dependencies. */
  valueForApply(address: string): Record<string, Value> {
    this.discover();
    const found = this.locate(address);
    if (!found) throw new TfError({ severity: 'error', summary: `${address} の設定が見つかりません` });
    const index = /\[(\d+)\]$/.exec(address)?.[1];
    const attrs = resourceAttributes(found.rc, this.scope(found.inst, index === undefined ? undefined : Number(index)));
    if (containsUnknown(attrs)) throw new TfError({ severity: 'error', summary: '依存先の値がまだ決まっていません（依存関係の順序を確認してください）' });
    return attrs;
  }
}
const constScope = (): Scope => {
  const no = (what: string) => (_: string, pos: Pos): never => { throw new TfError({ severity: 'error', summary: `${what}は、変数の既定値（default）や .tfvars の中では参照できません。固定の値を書いてください`, pos }); };
  return { vars: {}, local: no('local の値'), resource: no('リソースの値'), module: no('module の値'), path: '' };
};
function checkVarType(type: string | undefined, v: Value, name: string, pos: Pos): Value {
  if (!type || isUnknown(v) || type === 'any') return v;
  const base = type.replace(/\(.*$/, '');
  const ok = base === 'string' ? typeof v === 'string' || typeof v === 'number' : base === 'number' ? typeof v === 'number' : base === 'bool' ? typeof v === 'boolean'
    : base === 'list' || base === 'set' || base === 'tuple' ? Array.isArray(v) : base === 'map' || base === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v) : true;
  if (!ok) throw new TfError({ severity: 'error', summary: `Invalid value for variable: ${name} は ${type} 型の変数です。型に合う値を渡してください`, pos });
  return base === 'string' && typeof v === 'number' ? String(v) : v;
}

// ------------------------------------------------------------ rendering
export function renderValue(v: Value): string {
  if (isUnknown(v)) return '(known after apply)';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return v.length ? `[ ${v.map(renderValue).join(', ')} ]` : '[]';
  if (typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k} = ${renderValue(x)}`).join(', ')} }`;
  return String(v);
}
const symbol: Record<Action, string> = { create: '  +', update: '  ~', replace: '-/+', delete: '  -', noop: '   ' };
const verb: Record<Action, string> = { create: 'will be created', update: 'will be updated in-place', replace: 'must be replaced', delete: 'will be destroyed', noop: '' };
export function renderPlan(plan: Plan): string {
  const out: string[] = [];
  if (plan.drift.length) out.push('Note: Objects have changed outside of Terraform', '', ...plan.drift, '', '（refresh: 実物と state の差分を検出しました。以下の plan は、設定どおりに戻すための変更です）', '');
  const errors = plan.diagnostics.filter(d => d.severity === 'error');
  if (errors.length) return out.join('\n') + formatDiagnostics(plan.diagnostics);
  const changes = plan.changes.filter(c => c.action !== 'noop');
  if (!changes.length) return `${out.join('\n')}No changes. Your infrastructure matches the configuration.\n\nTerraform has compared your real infrastructure against your configuration and found no differences.\n${NOTE}`;
  out.push('Terraform used the selected providers to generate the following execution plan.', 'Resource actions are indicated with the following symbols:',
    ...(['create', 'update', 'delete', 'replace'] as Action[]).filter(a => changes.some(c => c.action === a)).map(a => `${symbol[a]} ${a === 'replace' ? 'destroy and then create replacement' : a === 'update' ? 'update in-place' : a === 'delete' ? 'destroy' : 'create'}`),
    '', 'Terraform will perform the following actions:', '');
  for (const c of changes) {
    const name = c.address.split('.').slice(-1)[0].replace(/\[\d+\]$/, '');
    out.push(`  # ${c.address} ${verb[c.action]}${c.action === 'replace' && c.lifecycle.createBeforeDestroy ? '（create_before_destroy: 先に作成してから削除）' : ''}`);
    out.push(`${symbol[c.action]} resource "${c.type}" "${name}" {`);
    const keys = c.action === 'delete' ? Object.keys(c.before ?? {}) : Object.keys(c.after);
    const width = Math.max(...keys.map(k => k.length), 4);
    for (const k of keys) {
      if (c.action === 'delete') { out.push(`      - ${k.padEnd(width)} = ${renderValue(c.before![k])} -> null`); continue; }
      const after = c.after[k]; const before = c.before?.[k];
      if (c.action === 'create') { if (after !== null && after !== undefined) out.push(`      + ${k.padEnd(width)} = ${renderValue(after)}`); continue; }
      if (c.changed.includes(k) || (c.action === 'replace' && isUnknown(after))) out.push(`      ~ ${k.padEnd(width)} = ${renderValue(before ?? null)} -> ${renderValue(after ?? null)}${c.forceNew.includes(k) ? ' # forces replacement' : ''}`);
    }
    out.push('    }', '');
  }
  const count = (a: Action) => changes.filter(c => c.action === a).length;
  out.push(`Plan: ${count('create') + count('replace')} to add, ${count('update')} to change, ${count('delete') + count('replace')} to destroy.`);
  if (Object.keys(plan.outputs).length) out.push('', 'Changes to Outputs:', ...Object.entries(plan.outputs).map(([k, v]) => `  + ${k} = ${renderValue(v)}`));
  out.push('', NOTE);
  return out.join('\n');
}
export function formatDiagnostics(d: Diagnostic[]) {
  return d.map(x => `╷\n│ ${x.severity === 'error' ? 'Error' : 'Warning'}: ${x.summary}\n${x.pos ? `│\n│   on ${x.pos.file} line ${x.pos.line}:\n` : ''}${x.detail ? `│\n${x.detail.split('\n').map(l => `│ ${l}`).join('\n')}\n` : ''}╵\n`).join('');
}

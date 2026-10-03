import { db, type DesignInfo } from '../db/database';
import { labById } from '../labs';
import type { AwsLab, CheckResult, TerraformLab } from '../labs/types';
import { emptyModel, validateModel, type AwsModel } from '../aws/model';
import { threeTier } from '../aws/scenarios';
import { TerraformWorkspace, type WorkspaceSnapshot } from '../terraform/engine';
import { threeTierFiles } from '../terraform/examples';
import { useUI } from '../stores/ui';
import { completeLab, lab } from './LabController';
import { awsTemplates, terraformTemplates, untitledDesign } from './designs';

const clone = <T>(v: T): T => structuredClone(v);
/** Runs the last scheduled fn 300 ms after the last call; flush() runs it right away. */
const debounce = () => {
  let t: ReturnType<typeof setTimeout> | undefined, pending: (() => void) | undefined;
  const flush = () => { clearTimeout(t); const fn = pending; pending = undefined; fn?.(); };
  return Object.assign((fn: () => void) => { clearTimeout(t); pending = fn; t = setTimeout(flush, 300); }, { flush });
};

/** AWS VPC workspace (educational model). Mutations are validated; invalid designs are shown, not silently accepted. */
class AwsController {
  id = 'aws-playground';
  model: AwsModel = threeTier();
  assessment?: CheckResult[];
  selected = '';
  design: DesignInfo = { name: '3層構成', template: 'three-tier' };
  private saveQueue = Promise.resolve();
  private opened = 0;
  get lab(): AwsLab | undefined { const l = labById(this.id); return l?.workspace === 'aws' ? l : undefined; }
  async open(id: string) {
    const seq = ++this.opened;
    await this.saveQueue;
    const l = labById(id), def = l?.workspace === 'aws' ? l : undefined;
    let model = def ? def.build() : threeTier(), design: DesignInfo = { name: '3層構成', template: 'three-tier' };
    if (lab.storageReady) try { const r = await db.workspaces.get(`aws:${id}`); if (r) { model = r.data as AwsModel; design = r.design ?? untitledDesign(); } } catch { lab.storageFailure(); }
    // Only the latest open() installs its workspace; id and model always change together.
    if (seq !== this.opened) return;
    this.id = id; this.model = model; this.design = design; this.assessment = undefined; this.selected = '';
    useUI.getState().changed();
  }
  errors() { return validateModel(this.model); }
  mutate(fn: (m: AwsModel) => void) {
    const draft = clone(this.model);
    try { fn(draft); } catch (e) { useUI.setState({ notice: e instanceof Error ? e.message : String(e) }); return false; }
    this.model = draft; this.assessment = undefined;
    if (!this.lab) this.design = { ...this.design, modified: true };
    useUI.getState().changed();
    this.persist();
    return true;
  }
  reset(example = false) {
    const def = this.lab;
    const template = this.design.template as keyof typeof awsTemplates | undefined;
    const m = def ? def.build() : template && awsTemplates[template] ? awsTemplates[template].build() : emptyModel();
    if (example && def) def.solve(m);
    this.load(m);
  }
  private persist() {
    if (!lab.storageReady) return;
    const record = { id: `aws:${this.id}`, kind: 'aws' as const, data: clone(this.model), design: { ...this.design }, updatedAt: Date.now() };
    useUI.setState({ saveStatus: 'saving' });
    this.saveQueue = this.saveQueue.then(async () => {
      try { await db.workspaces.put(record); useUI.setState({ saveStatus: 'saved' }); }
      catch { lab.storageFailure(); }
    });
  }
  setDesign(info: DesignInfo) { this.design = info; this.persist(); useUI.getState().changed(); return this.saveQueue; }
  load(model: AwsModel, info: DesignInfo = { ...this.design, modified: true }) {
    this.model = clone(model); this.design = info; this.selected = ''; this.assessment = undefined;
    this.persist(); useUI.setState({ notice: '' }); useUI.getState().changed();
  }
  createDesign(name: string) { this.load(emptyModel(), { name: name.trim() || '無題の構成' }); }
  loadTemplate(id: string) {
    const template = awsTemplates[id as keyof typeof awsTemplates];
    if (template) this.load(template.build(), { name: template.name, template: id });
  }
  assess() {
    const def = this.lab; if (!def) return;
    this.assessment = def.grade(clone(this.model));
    const diagnosisOk = !def.diagnosis || lab.quizzes.get(`diag:${def.id}`)?.correct === true;
    useUI.getState().changed();
    if (this.assessment.every(c => c.pass) && diagnosisOk) void completeLab(def.id);
  }
}

/** Terraform workspace: files + state + simulated cloud, persisted per lab. */
class TerraformController {
  id = 'tf-playground';
  ws = new TerraformWorkspace({ files: threeTierFiles() });
  output: { command: string; text: string }[] = [];
  assessment?: CheckResult[];
  activeFile = 'main.tf';
  /** Bumped whenever `ws` is replaced, so the editor starts fresh (no undo into the previous design, no false "edited"). */
  revision = 0;
  design: DesignInfo = { name: '3層構成', template: 'three-tier' };
  private later = debounce();
  private opened = 0;
  get lab(): TerraformLab | undefined { const l = labById(this.id); return l?.workspace === 'terraform' ? l : undefined; }
  async open(id: string) {
    this.flush();
    const seq = ++this.opened;
    const l = labById(id), def = l?.workspace === 'terraform' ? l : undefined;
    let snap: Partial<WorkspaceSnapshot> = def ? def.build() : { files: threeTierFiles() }, design: DesignInfo = { name: '3層構成', template: 'three-tier' };
    // Drafts saved before designs existed have no design info; they all started from the 3-tier example.
    if (lab.storageReady) try { const r = await db.workspaces.get(`tf:${id}`); if (r) { snap = r.data as WorkspaceSnapshot; design = r.design ?? { ...design, modified: true }; } } catch { /* keep default */ }
    // Only the latest open() installs its workspace; id and files always change together.
    if (seq !== this.opened) return;
    this.id = id; this.design = design; this.assessment = undefined; this.output = [];
    this.ws = new TerraformWorkspace(snap); this.revision++;
    this.activeFile = this.firstFile();
    useUI.getState().changed();
  }
  /** Write a pending (debounced) save now: before switching workspace or when the page is hidden. */
  flush() { this.later.flush(); }
  private firstFile() { return Object.keys(this.ws.files).sort((a, b) => Number(b === 'main.tf') - Number(a === 'main.tf'))[0] ?? 'main.tf'; }
  private persist() { this.later(() => { if (lab.storageReady) void db.workspaces.put({ id: `tf:${this.id}`, kind: 'terraform', data: this.ws.snapshot(), design: { ...this.design }, updatedAt: Date.now() }).catch(() => lab.storageFailure()); }); }
  /** The code changed: a template / saved design is now being edited. */
  private touched() {
    this.assessment = undefined; this.persist();
    if (!this.lab && !this.design.modified) { this.design = { ...this.design, modified: true }; useUI.getState().changed(); }
  }
  edit(file: string, text: string) { this.ws.files[file] = text; this.touched(); }
  addFile(name: string) {
    // Only the .tfvars files Terraform loads automatically: terraform.tfvars and *.auto.tfvars (at the root).
    if (!/^(([a-z0-9_-]+\/)*[a-z0-9_-]+\.tf|terraform\.tfvars|[a-z0-9_-]+\.auto\.tfvars)$/.test(name)) { useUI.setState({ notice: 'ファイル名は xxx.tf / terraform.tfvars / xxx.auto.tfvars（modules/名前/main.tf も可）です' }); return; }
    if (!(name in this.ws.files)) this.ws.files[name] = '';
    this.activeFile = name; this.touched(); useUI.getState().changed();
  }
  removeFile(name: string) { if (Object.keys(this.ws.files).length <= 1) return; delete this.ws.files[name]; if (this.activeFile === name) this.activeFile = this.firstFile(); this.touched(); useUI.getState().changed(); }
  setDesign(info: DesignInfo) { this.design = info; this.persist(); useUI.getState().changed(); }
  load(snapshot: Partial<WorkspaceSnapshot>, info: DesignInfo) {
    this.ws = new TerraformWorkspace(snapshot); this.revision++; this.design = info;
    this.output = []; this.assessment = undefined; this.activeFile = this.firstFile();
    this.persist(); useUI.setState({ notice: '' }); useUI.getState().changed();
  }
  createDesign(name: string) { this.load({ files: { 'main.tf': '' } }, { name: name.trim() || '無題の構成' }); }
  loadTemplate(id: string) {
    const template = terraformTemplates[id as keyof typeof terraformTemplates];
    if (template) this.load(template.build(), { name: template.name, template: id });
  }
  run(command: string) {
    const text = this.ws.run(command);
    this.output = [...this.output, { command: `terraform ${command.replace(/^terraform\s+/, '')}`, text }].slice(-30);
    this.assessment = undefined; this.persist(); useUI.getState().changed();
    return text;
  }
  confirm(approved: boolean) { const text = this.ws.confirm(approved); this.output = [...this.output, { command: approved ? 'yes' : 'no', text }]; this.persist(); useUI.getState().changed(); }
  reset(example = false) {
    const def = this.lab;
    const template = terraformTemplates[this.design.template as keyof typeof terraformTemplates];
    this.ws = new TerraformWorkspace(def ? def.build() : template ? template.build() : { files: { 'main.tf': '' } }); this.revision++;
    if (example && def) def.solve(this.ws);
    if (!def) this.design = { ...this.design, modified: true };
    this.output = []; this.assessment = undefined; this.activeFile = this.firstFile(); this.persist(); useUI.getState().changed();
  }
  /** Educational events: manual console change (drift) and a teammate holding the state lock. */
  simulateDrift() {
    const sg = Object.values(this.ws.state.resources).find(r => r.type === 'aws_security_group');
    if (!sg) { useUI.setState({ notice: 'apply済みのセキュリティグループがありません' }); return; }
    this.ws.consoleChange(c => { const res = c.resources[sg.id]; if (res) res.attributes.ingress = [...((res.attributes.ingress as unknown[]) ?? []), { from_port: 22, to_port: 22, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] }] as never; });
    this.output = [...this.output, { command: '（コンソール）', text: `${sg.address}（${sg.id}）に 0.0.0.0/0 → 22/tcp のルールが手作業で追加されました。` }];
    this.persist(); useUI.getState().changed();
  }
  toggleLock() {
    this.ws.lock = this.ws.lock ? undefined : { id: 'f3c1-77ab', who: 'teammate@ci-runner', operation: 'OperationTypeApply' };
    this.persist(); useUI.getState().changed();
  }
  assess() {
    const def = this.lab; if (!def) return;
    this.assessment = def.grade(new TerraformWorkspace(this.ws.snapshot()));
    const diagnosisOk = !def.diagnosis || lab.quizzes.get(`diag:${def.id}`)?.correct === true;
    useUI.getState().changed();
    if (this.assessment.every(c => c.pass) && diagnosisOk) void completeLab(def.id);
  }
}
export const aws = new AwsController();
export const terraform = new TerraformController();
// Best effort, like lab.save() in main.tsx. (Guarded: unit tests import this module without a DOM.)
globalThis.document?.addEventListener('visibilitychange', () => { if (document.hidden) terraform.flush(); });
globalThis.addEventListener?.('pagehide', () => terraform.flush());

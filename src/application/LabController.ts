import { CliEngine, type DebugResult } from '../cli/CliEngine';
import { db, type DesignInfo, type HistoryRecord } from '../db/database';
import type { CheckResult, NetworkLab } from '../labs/types';
import { labById } from '../labs';
import { NetworkSimulator, createDevice } from '../simulator/core/NetworkSimulator';
import type { DeviceKind, NetworkSnapshot } from '../simulator/core/types';
import { routingScenario } from '../simulator/scenarios/routing';
import { useUI } from '../stores/ui';
import { templates } from './templates';
import { curriculum } from '../lessons/curriculum';
import { untitledDesign } from './designs';

const kindPrefix: Record<DeviceKind, string> = { pc: 'PC', server: 'SRV', router: 'R', switch: 'SW', l3switch: 'L3SW', firewall: 'FW', internet: 'ISP' };
export const PLAYGROUND = 'playground';

/** Application layer for the network workspace: owns the simulator instance, CLI, persistence and grading. */
class LabController {
  network = routingScenario();
  cli = new CliEngine(this.network);
  result?: DebugResult;
  history: HistoryRecord[] = [];
  completed = new Set<string>();
  quizzes = new Map<string, { selected: number; correct: boolean }>();
  assessment?: CheckResult[];
  labId = PLAYGROUND;
  design: DesignInfo = untitledDesign();
  workspaceRevision = 0;
  observations: Record<string, string> = {};
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveQueue = Promise.resolve();
  storageReady = true;
  private saveVersion = 0;
  private opening = Promise.resolve();

  get lab(): NetworkLab | undefined { const l = labById(this.labId); return l?.workspace === 'network' ? l : undefined; }
  private key(id = this.labId) { return id === PLAYGROUND ? 'current' : `lab:${id}`; }

  async initialize() {
    try {
      const [progress, quizzes, history] = await Promise.all([db.progress.toArray(), db.quizzes.toArray(), db.history.orderBy('timestamp').reverse().limit(400).toArray()]);
      this.completed = new Set(progress.filter(p => p.completed).map(p => p.id));
      this.quizzes = new Map(quizzes.map(q => [q.id, q]));
      this.history = history.reverse();
      await this.load(PLAYGROUND);
    } catch {
      this.storageReady = false;
      useUI.setState({ saveStatus: 'error', notice: '保存データを読み込めませんでした（ブラウザの保存領域が使えない可能性があります）。このまま操作できますが、自動保存はされません。残したい設定は「書き出し」でJSONファイルに保存してください。' });
    }
    useUI.getState().changed();
  }
  /** Switch workspace (playground or a lab). Saves the current one first. Opens run one at a time, in order. */
  open(labId: string) {
    const next = this.opening.then(async () => {
      if (labId === this.labId) return;
      await this.save();
      await this.load(labId);
      useUI.getState().changed();
    });
    this.opening = next.catch(() => undefined);
    return next;
  }
  private async load(labId: string) {
    const definition = labById(labId);
    // this.labId (the save key) changes only together with the network below; a save() meanwhile still writes the old lab.
    const id = definition?.workspace === 'network' ? labId : PLAYGROUND;
    let network = definition?.workspace === 'network' ? definition.build() : routingScenario();
    let design = untitledDesign(), observations: Record<string, string> = {};
    let selected: string | undefined;
    if (this.storageReady) {
      try {
        const [record, sel, obs] = await Promise.all([db.labs.get(this.key(id)), db.settings.get(`selected:${id}`), db.settings.get(`obs:${id}`)]);
        if (record) { network = NetworkSimulator.fromSnapshot(record.snapshot); design = record.design ?? { name: record.name }; }
        selected = sel?.value;
        observations = obs ? JSON.parse(obs.value) : {};
      } catch { this.storageReady = false; useUI.setState({ saveStatus: 'error', notice: '保存データを読み込めませんでした。初期状態のラボを表示しています。以降は自動保存されないため、残したい設定は「書き出し」で保存してください。' }); }
    }
    this.labId = id; this.design = design; this.observations = observations;
    this.install(network);
    const devices = network.snapshot().devices;
    useUI.setState({ selectedDevice: devices.find(d => d.id === selected)?.id ?? devices.find(d => d.id === this.lab?.source)?.id ?? devices[0]?.id ?? '', selectedEvent: 0 });
  }
  private install(network: NetworkSimulator) {
    this.workspaceRevision++;
    this.network = network; this.cli = new CliEngine(network); this.cli.explain = this.lab?.explain ?? true;
    this.result = undefined; this.assessment = undefined;
    // Link ids (link-1, link-2, …) repeat across workspaces, so a selected cable must not carry over.
    useUI.setState({ selectedLink: '' });
  }
  private changed(save = true) {
    this.assessment = undefined;
    useUI.getState().changed();
    if (save) this.scheduleSave();
  }
  private scheduleSave() {
    if (!this.storageReady) return;
    this.saveVersion++;
    useUI.setState({ saveStatus: 'saving' });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.save(); }, 250);
  }
  async save() {
    clearTimeout(this.saveTimer);
    if (!this.storageReady) return;
    const snapshot = this.network.snapshot();
    const version = this.saveVersion;
    const labId = this.labId;
    const design = { ...this.design };
    const selectedDevice = useUI.getState().selectedDevice;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await db.transaction('rw', db.labs, db.settings, async () => {
          await db.labs.put({ id: this.key(labId), name: labById(labId)?.title ?? design.name, design, snapshot, updatedAt: Date.now() });
          await db.settings.put({ id: `selected:${labId}`, value: selectedDevice });
        });
        if (version === this.saveVersion) useUI.setState({ saveStatus: 'saved' });
      } catch { this.storageFailure(); }
    });
    return this.saveQueue;
  }
  storageFailure() { useUI.setState({ saveStatus: 'error', notice: 'ブラウザに保存できませんでした。変更が失われないよう、「書き出し」でJSONファイルに保存してください。' }); }
  mutate(action: (network: NetworkSimulator) => void) {
    try {
      action(this.network); this.result = undefined;
      if (!this.lab) this.design = { ...this.design, modified: true };
      const devices = this.network.snapshot().devices;
      const selected = useUI.getState().selectedDevice;
      useUI.setState({ selectedEvent: 0, notice: '', selectedDevice: devices.some(d => d.id === selected) ? selected : devices[0]?.id ?? '' });
      this.changed(); return true;
    } catch (error) { useUI.setState({ notice: error instanceof Error ? error.message : String(error) }); return false; }
  }
  /** `byUser`: a drag edits the design; the automatic overlap separation does not. */
  moveDevice(id: string, position: { x: number; y: number }, byUser = false) {
    this.network.moveDevice(id, position);
    if (byUser && !this.lab) this.design = { ...this.design, modified: true };
    this.changed();
  }
  execute(id: string, command: string) {
    const before = JSON.stringify(this.network.snapshot());
    const output = this.cli.execute(id, command);
    if (this.cli.lastResult) { this.result = this.cli.lastResult; useUI.setState({ selectedEvent: 0 }); }
    else if (before !== JSON.stringify(this.network.snapshot())) this.result = undefined;
    if (output.startsWith('%')) useUI.setState({ notice: output.slice(2) });
    const entry: HistoryRecord = { deviceId: id, command, output, timestamp: Date.now(), labId: this.labId };
    this.history = [...this.history, entry].slice(-400);
    if (this.storageReady) void db.transaction('rw', db.history, async () => {
      await db.history.add(entry);
      const count = await db.history.count();
      if (count > 400) await db.history.orderBy('id').limit(count - 400).delete();
    }).catch(() => this.storageFailure());
    const edited = before !== JSON.stringify(this.network.snapshot());
    if (edited && !this.lab) this.design = { ...this.design, modified: true };
    this.changed(edited);
    return output;
  }
  /** Run a simulator operation from the GUI (ping / curl / dig buttons) and show it in the Debugger. */
  run(title: string, op: (n: NetworkSimulator) => DebugResult) {
    try {
      const r = op(this.network);
      this.cli.record(r, title); this.result = { ...r, title };
      useUI.setState({ selectedEvent: 0, notice: '' });
      useUI.getState().changed();
      return r;
    } catch (error) { useUI.setState({ notice: error instanceof Error ? error.message : String(error) }); return undefined; }
  }
  reset(mode: 'exercise' | 'example' | 'empty' | { template: string }) {
    let network: NetworkSimulator;
    if (mode === 'empty') network = new NetworkSimulator();
    else if (typeof mode === 'object') network = templates[mode.template]?.build() ?? routingScenario();
    else if (this.lab) { network = this.lab.build(); if (mode === 'example') this.lab.solve(network); }
    else network = this.design.template && templates[this.design.template] ? templates[this.design.template].build() : new NetworkSimulator();
    if (!this.lab) this.design = { ...(typeof mode === 'object'
      ? { name: templates[mode.template].name, template: mode.template }
      : mode === 'empty' ? untitledDesign() : { ...this.design, modified: true }), startedAt: Date.now() };
    this.install(network);
    useUI.setState({ selectedDevice: network.snapshot().devices[0]?.id ?? '', selectedLink: '', selectedEvent: 0, notice: '' }); this.changed();
  }
  setDesign(info: DesignInfo) { this.design = info; this.changed(); return this.save(); }
  loadDesign(data: unknown, info: DesignInfo) {
    const network = NetworkSimulator.fromSnapshot(data as NetworkSnapshot);
    this.install(network); this.design = { ...info, startedAt: Date.now() };
    useUI.setState({ selectedDevice: network.snapshot().devices[0]?.id ?? '', selectedLink: '', selectedEvent: 0, notice: '' });
    this.changed();
  }
  addDevice(kind: DeviceKind, position?: { x: number; y: number }) {
    const snapshot = this.network.snapshot();
    const prefix = kindPrefix[kind];
    let ordinal = snapshot.devices.length + 1;
    const macs = new Set(snapshot.devices.flatMap(d => d.interfaces.map(i => i.mac)));
    while (snapshot.devices.some(d => d.id === `${prefix}${ordinal}`) || createDevice('x', kind, ordinal).interfaces.some(i => macs.has(i.mac))) ordinal++;
    const id = `${prefix}${ordinal}`;
    if (this.mutate(n => n.addDevice(createDevice(id, kind, ordinal, position ?? { x: 80 + snapshot.devices.length * 40, y: 60 })))) useUI.setState({ selectedDevice: id });
  }
  importLab(input: string) {
    let snapshot: NetworkSnapshot;
    try { snapshot = JSON.parse(input); } catch { throw new Error('JSONとして読み込めません。このアプリの「書き出し」で保存したファイルを選んでください'); }
    // Validate fully before replacing the current workspace.
    const network = NetworkSimulator.fromSnapshot(snapshot);
    this.install(network);
    if (!this.lab) this.design = { ...untitledDesign(), modified: true, startedAt: Date.now() };
    useUI.setState({ selectedDevice: snapshot.devices[0]?.id ?? '', selectedEvent: 0 }); this.changed();
  }
  async markComplete(id: string) {
    if (this.completed.has(id)) return;
    this.completed.add(id); useUI.getState().changed();
    if (this.storageReady) try { await db.progress.put({ id, completed: true, updatedAt: Date.now() }); } catch { this.storageFailure(); }
  }
  async answerQuiz(id: string, selected: number, correct: boolean) {
    this.quizzes.set(id, { selected, correct }); useUI.getState().changed();
    if (this.storageReady) try { await db.quizzes.put({ id, selected, correct }); } catch { this.storageFailure(); }
  }
  async observe(label: string, value: string) {
    this.observations = { ...this.observations, [label]: value }; useUI.getState().changed();
    if (this.storageReady) try { await db.settings.put({ id: `obs:${this.labId}`, value: JSON.stringify(this.observations) }); } catch { this.storageFailure(); }
  }
  /** Final-state grading on an isolated copy. Troubleshooting labs also require naming the cause. */
  assess() {
    const lab = this.lab;
    this.assessment = lab ? lab.grade(this.network.snapshot()) : [];
    const observationsOk = !lab?.questions || lab.questions.every(q => (this.observations[q.label] ?? '').trim() === q.answer);
    const diagnosisOk = !lab?.diagnosis || this.quizzes.get(`diag:${lab.id}`)?.correct === true;
    useUI.getState().changed();
    if (lab && this.assessment.every(c => c.pass) && observationsOk && diagnosisOk) void completeLab(lab.id);
  }
}
export async function completeLab(id: string) {
  await lab.markComplete(`lab:${id}`);
  // A chapter is mastered by its designated final-state labs (all of them), not by the quiz.
  const chapter = curriculum.find(c => c.mastery.type === 'lab' && c.mastery.labIds.includes(id));
  if (chapter?.mastery.type === 'lab' && chapter.mastery.labIds.every(x => lab.completed.has(`lab:${x}`))) await lab.markComplete(`${chapter.id}-mastery`);
}
export const lab = new LabController();

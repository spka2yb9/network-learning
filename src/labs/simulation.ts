import { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import { TerraformWorkspace } from '../terraform/engine';
import type { AwsModel } from '../aws/model';
import type { AwsLab, CheckResult, Lab, NetworkLab, SimStep, TerraformLab } from './types';

const safe = (fn: () => boolean) => { try { return fn(); } catch { return false; } };
/** Each step's check, on its own fresh copy: a check may ping (ARP, conntrack) without affecting the next one. */
const run = <S>(steps: SimStep<S>[] = [], fresh: () => S) => steps.map(s => !s.check || safe(() => s.check!(fresh())));
const graded = <S>(steps: SimStep<S>[], fresh: () => S): CheckResult[] => run(steps, fresh).map((pass, i) => ({ label: steps[i].title, pass })).filter((_, i) => steps[i].check);

type Def<L, S> = Omit<L, 'workspace' | 'kind' | 'grade' | 'solve' | 'hints' | 'sim'> & { sim: SimStep<S>[]; hints?: string[] };
/** A chapter's Simulation is a lab whose grade and reference solution are its steps, in order. */
export const networkSimulation = (def: Def<NetworkLab, NetworkSimulator>): NetworkLab => ({
  hints: [], ...def, workspace: 'network', kind: 'simulation',
  solve: n => def.sim.forEach(s => s.solve?.(n)),
  grade: snapshot => graded(def.sim, () => NetworkSimulator.fromSnapshot(snapshot)),
});
export const awsSimulation = (def: Def<AwsLab, AwsModel>): AwsLab => ({
  hints: [], ...def, workspace: 'aws', kind: 'simulation',
  solve: m => def.sim.forEach(s => s.solve?.(m)),
  grade: m => graded(def.sim, () => structuredClone(m)),
});
export const terraformSimulation = (def: Def<TerraformLab, TerraformWorkspace>): TerraformLab => ({
  hints: [], ...def, workspace: 'terraform', kind: 'simulation',
  solve: ws => def.sim.forEach(s => s.solve?.(ws)),
  grade: ws => graded(def.sim, () => new TerraformWorkspace(ws.snapshot())),
});

/** Per step: does its check hold on the workspace's current state? (A step without a check: true.) */
export function stepChecks(lab: Lab, state: NetworkSnapshot | AwsModel | TerraformWorkspace): boolean[] {
  if (lab.workspace === 'network') return run(lab.sim, () => NetworkSimulator.fromSnapshot(state as NetworkSnapshot));
  if (lab.workspace === 'aws') return run(lab.sim, () => structuredClone(state as AwsModel));
  if (lab.workspace === 'terraform') return run(lab.sim, () => new TerraformWorkspace((state as TerraformWorkspace).snapshot()));
  return [];
}
/** Saved answer of a step's quiz (LabController.quizzes). */
export const stepQuizId = (labId: string, step: number) => `sim:${labId}:${step}`;

/**
 * Port-agnostic checks for network steps: the learner chooses the ports when cabling,
 * so ask "are PC1 and R1 connected" and "what address faces PC1", not "is eth0 on g0/0".
 */
export const net = {
  has: (n: NetworkSimulator, id: string, kind?: string) => n.snapshot().devices.some(d => d.id === id && (!kind || d.kind === kind)),
  linked: (n: NetworkSimulator, a: string, b: string) => !!net.link(n, a, b),
  link: (n: NetworkSimulator, a: string, b: string) => n.snapshot().links.find(l => l.up && ((l.sourceDevice === a && l.targetDevice === b) || (l.sourceDevice === b && l.targetDevice === a))),
  /** a's interface on the cable to b. */
  port: (n: NetworkSimulator, a: string, b: string) => { const l = net.link(n, a, b); return l && (l.sourceDevice === a ? l.sourceInterface : l.targetInterface); },
  /** a's address (CIDR) on the cable to b. */
  address: (n: NetworkSimulator, a: string, b: string) => { const p = net.port(n, a, b); return n.device(a).interfaces.find(i => i.id === p)?.address; },
  hasAddress: (n: NetworkSimulator, id: string, cidr: string) => n.device(id).interfaces.some(i => i.address === cidr),
  ping: (n: NetworkSimulator, from: string, to: string) => n.ping(from, to).success,
};

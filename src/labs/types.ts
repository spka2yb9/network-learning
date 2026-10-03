import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import type { AwsModel } from '../aws/model';
import type { TerraformWorkspace, WorkspaceSnapshot } from '../terraform/engine';

export type ChapterId = 'tcp-ip' | 'subnet' | 'routing' | 'ethernet-vlan' | 'dns' | 'nat-firewall' | 'linux' | 'capture' | 'topology' | 'aws' | 'vpn-bgp' | 'terraform' | 'capstone';
export type LabKind = 'guided' | 'challenge' | 'troubleshooting' | 'mastery' | 'capstone';
export interface CheckResult { label: string; pass: boolean }
export interface Diagnosis { question: string; options: string[]; answer: number; explanation: string }
interface LabBase {
  id: string;
  chapter: ChapterId;
  kind: LabKind;
  title: string;
  /** One-line objective shown on the lab header. */
  mission: string;
  /** Longer brief (Markdown). */
  brief?: string;
  steps?: string[];
  hints: string[];
  minutes: number;
  /** Troubleshooting labs: which layer failed (asked after the network is fixed). */
  diagnosis?: Diagnosis;
  /** Shown after all checks pass. */
  debrief?: string;
  /** Observation / design questions answered from what the learner saw (checked exactly, trimmed). With `options`, chosen from a list. */
  questions?: { label: string; answer: string; options?: string[] }[];
}
export interface NetworkLab extends LabBase {
  workspace: 'network';
  build(): NetworkSimulator;
  solve(n: NetworkSimulator): void;
  grade(snapshot: NetworkSnapshot): CheckResult[];
  /** false: CLI output does not include the simulator's diagnosis (troubleshooting). */
  explain?: boolean;
  source?: string;
  target?: string;
}
export interface AwsLab extends LabBase {
  workspace: 'aws';
  build(): AwsModel;
  solve(m: AwsModel): void;
  grade(m: AwsModel): CheckResult[];
}
export interface TerraformLab extends LabBase {
  workspace: 'terraform';
  build(): Partial<WorkspaceSnapshot>;
  solve(ws: TerraformWorkspace): void;
  grade(ws: TerraformWorkspace): CheckResult[];
}
export interface CaptureCase { id: string; title: string; question: string; build(): { captures: import('../simulator/core/types').Capture[]; note: string }; options: string[]; answer: number; evidence: (c: import('../simulator/core/types').Capture) => boolean; evidenceHint: string; explanation: string }
export interface CaptureLab extends LabBase {
  workspace: 'capture';
  cases: CaptureCase[];
}
export type Lab = NetworkLab | AwsLab | TerraformLab | CaptureLab;

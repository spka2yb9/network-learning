import { networkLabs } from './network';
import { redundancyLabs } from './redundancy';
import { networkCapstones } from './capstones';
import { awsLabs, terraformLabs } from './cloud';
import { captureLabs } from './capture';
import { simulationLabs } from './simulations';
import type { ChapterId, Lab } from './types';

export const labs: Lab[] = [...networkLabs, ...redundancyLabs, ...networkCapstones, ...awsLabs, ...terraformLabs, ...captureLabs, ...simulationLabs];
export const labById = (id: string) => labs.find(l => l.id === id);
/** The chapter's Simulation tab (one per chapter). */
export const simulationFor = (chapter: ChapterId) => labs.find(l => l.chapter === chapter && l.kind === 'simulation');
// A Simulation lives in its chapter's Simulation tab, not on the lab pages.
export const labPath = (lab: Lab) => lab.kind === 'simulation' ? `/learn/${lab.chapter}?tab=simulation` : lab.workspace === 'network' ? `/lab/${lab.id}` : lab.workspace === 'aws' ? `/aws/${lab.id}` : lab.workspace === 'terraform' ? `/terraform/${lab.id}` : `/analyzer/${lab.id}`;
export type { Lab } from './types';

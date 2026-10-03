import { networkLabs } from './network';
import { redundancyLabs } from './redundancy';
import { networkCapstones } from './capstones';
import { awsLabs, terraformLabs } from './cloud';
import { captureLabs } from './capture';
import type { ChapterId, Lab } from './types';

export const labs: Lab[] = [...networkLabs, ...redundancyLabs, ...networkCapstones, ...awsLabs, ...terraformLabs, ...captureLabs];
export const labById = (id: string) => labs.find(l => l.id === id);
export const labsFor = (chapter: ChapterId) => labs.filter(l => l.chapter === chapter);
export const labPath = (lab: Lab) => lab.workspace === 'network' ? `/lab/${lab.id}` : lab.workspace === 'aws' ? `/aws/${lab.id}` : lab.workspace === 'terraform' ? `/terraform/${lab.id}` : `/analyzer/${lab.id}`;
export type { Lab } from './types';

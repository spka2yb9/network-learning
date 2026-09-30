import Dexie, { type Table } from 'dexie';
import type { NetworkSnapshot } from '../simulator/core/types';

export interface DesignInfo { name: string; template?: string; savedId?: string; modified?: boolean; startedAt?: number }
export interface DesignRecord { id: string; kind: 'network' | 'aws' | 'terraform'; name: string; template?: string; data: unknown; updatedAt: number }
export interface LabRecord { id: string; name: string; snapshot: NetworkSnapshot; design?: DesignInfo; updatedAt: number }
export interface ProgressRecord { id: string; completed: boolean; updatedAt: number }
export interface QuizRecord { id: string; selected: number; correct: boolean }
export interface HistoryRecord { id?: number; deviceId: string; command: string; output: string; timestamp: number; labId?: string }
export interface SettingsRecord { id: string; value: string }
/** AWS models, Terraform workspaces and other non-network workspaces (JSON). */
export interface WorkspaceRecord { id: string; kind: 'aws' | 'terraform' | 'notes'; data: unknown; design?: DesignInfo; updatedAt: number }
class LearningDatabase extends Dexie {
  labs!: Table<LabRecord, string>;
  progress!: Table<ProgressRecord, string>;
  quizzes!: Table<QuizRecord, string>;
  history!: Table<HistoryRecord, number>;
  settings!: Table<SettingsRecord, string>;
  workspaces!: Table<WorkspaceRecord, string>;
  designs!: Table<DesignRecord, string>;
  constructor() {
    super('path-network-learning');
    this.version(1).stores({ labs: 'id, updatedAt', progress: 'id', quizzes: 'id', history: '++id, deviceId, timestamp', settings: 'id' });
    this.version(2).stores({ labs: 'id, updatedAt', progress: 'id', quizzes: 'id', history: '++id, deviceId, timestamp, labId', settings: 'id', workspaces: 'id, kind, updatedAt' });
    this.version(3).stores({ designs: 'id, kind, updatedAt' });
  }
}
export const db = new LearningDatabase();

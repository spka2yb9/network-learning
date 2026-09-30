import { create } from 'zustand';
export type BottomTab = 'terminal' | 'capture' | 'events';
export type InspectorTab = 'config' | 'state' | 'debug' | 'diagnose';
interface UIState {
  revision: number;
  selectedDevice: string;
  selectedLink: string;
  selectedEvent: number;
  bottomTab: BottomTab;
  inspectorTab: InspectorTab;
  /** Topology overlay: color devices by the broadcast domain of the selected device. */
  domainView: boolean;
  saveStatus: 'saved' | 'saving' | 'error';
  notice: string;
  mobileMenu: boolean;
  changed: () => void;
}
export const useUI = create<UIState>(set => ({
  revision: 0, selectedDevice: 'PC1', selectedLink: '', selectedEvent: 0, bottomTab: 'terminal', inspectorTab: 'config', domainView: false, saveStatus: 'saved', notice: '', mobileMenu: false,
  changed: () => set(s => ({ revision: s.revision + 1 })),
}));

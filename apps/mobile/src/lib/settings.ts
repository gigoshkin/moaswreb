import { persisted } from './store';
import type { Place } from './trips';

export interface Settings {
  /** Where trips start by default (F1). `label` is the address; trips show it as "Home". */
  home: Place | null;
  /** Extra minutes on top of the walk and the early-bus margin. */
  bufferMin: number;
  /** Leave-now pushes. Off = the server gets no trips. */
  alerts: boolean;
}

export const settings = persisted<Settings>('settings:v1', { home: null, bufferMin: 0, alerts: true });

export const updateSettings = (patch: Partial<Settings>) => settings.set({ ...settings.get(), ...patch });

export const BUFFER_OPTIONS = [0, 2, 5, 10, 15];

export const bufferText = (min: number) => (min === 0 ? 'None' : `${min} min`);

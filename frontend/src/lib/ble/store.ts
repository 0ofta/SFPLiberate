import type { ResolvedMode } from './types';

type Listener = () => void;

export type BleState = {
  connected: boolean;
  connectionType: 'Not Connected' | 'Direct (Web Bluetooth)' | 'Proxy (via Backend)' | 'ESPHome Proxy (WebSocket)';
  resolvedMode: ResolvedMode;
  deviceVersion?: string | null;
  sfpPresent?: boolean;
  batteryPct?: number;
  rawEepromData?: ArrayBuffer | null;
  logs: string[];
};

let state: BleState = {
  connected: false,
  connectionType: 'Not Connected',
  resolvedMode: 'none',
  deviceVersion: null,
  sfpPresent: undefined,
  batteryPct: undefined,
  rawEepromData: null,
  logs: [],
};

const listeners = new Set<Listener>();

export function getBleState(): BleState {
  return state;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((l) => l());
}

// Replaces `state` with a new object on every change (rather than mutating
// fields in place) so useSyncExternalStore's Object.is snapshot comparison
// actually detects the update and re-renders subscribed components.
function update(patch: Partial<BleState>) {
  state = { ...state, ...patch };
  emit();
}

export function setConnected(yes: boolean) {
  update({ connected: yes, connectionType: yes ? state.connectionType : 'Not Connected' });
}

export function setConnectionType(text: BleState['connectionType']) {
  update({ connectionType: text });
}

export function setResolvedMode(mode: ResolvedMode) {
  update({ resolvedMode: mode });
}

export function setDeviceVersion(v: string | null) {
  update({ deviceVersion: v });
}

export function setSfpPresent(present: boolean | undefined) {
  update({ sfpPresent: present });
}

export function setBattery(pct: number | undefined) {
  update({ batteryPct: pct });
}

export function setRawEeprom(buf: ArrayBuffer | null) {
  update({ rawEepromData: buf });
}

export function log(line: string) {
  update({ logs: [`[${new Date().toLocaleTimeString()}] ${line}`, ...state.logs].slice(0, 500) });
}

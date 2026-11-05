/**
 * The user's chosen BLE connection mode, kept in localStorage so the Settings page can set it
 * and the Dashboard can use it. Falls back to 'auto' when storage is empty, blocked or holds
 * an unknown value.
 */
import type { ConnectionMode } from './types';

const STORAGE_KEY = 'sfp.connectionMode';
const MODES: readonly ConnectionMode[] = ['auto', 'web-bluetooth', 'esphome-proxy', 'proxy'];

/** Read the saved connection mode; 'auto' if none is saved or storage is unavailable. */
export function loadConnectionMode(): ConnectionMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value as ConnectionMode) ? (value as ConnectionMode) : 'auto';
  } catch {
    return 'auto';
  }
}

/** Save the connection mode. Storage errors (private mode, quota) are ignored. */
export function saveConnectionMode(mode: ConnectionMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not fatal: the mode then lasts only for this page view.
  }
}

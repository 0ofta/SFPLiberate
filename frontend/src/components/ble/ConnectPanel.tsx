"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConnectionModeSelector } from './ConnectionModeSelector';
import type { ConnectionMode } from '@/lib/ble/types';
import { connect, requestSfpRead, saveCurrentModule, listModules, writeSfpFromModuleId } from '@/lib/ble/manager';
import { discoverAndConnectSfpDevice, type DiscoveryError } from '@/lib/ble/discovery';
import { getBleState, subscribe } from '@/lib/ble/store';
import { ProxyDiscovery } from '@/components/ble/ProxyDiscovery';
import { ESPHomeDiscovery } from '@/components/esphome/ESPHomeDiscovery';
import { loadActiveProfile } from '@/lib/ble/profile';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { detectBluetoothSupport } from '@/lib/ble/support';
import { isStandalone } from '@/lib/features-client';
import { getModuleRepository } from '@/lib/repositories';
import { SfpDataViewer } from '@/components/sfp/SfpDataViewer';
import { Bluetooth, Download, Plus, Search, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

// Server snapshot that returns stable initial state
const getServerSnapshot = () => ({
  connected: false,
  connectionType: 'Not Connected' as const,
  resolvedMode: 'none' as const,
  deviceVersion: null,
  sfpPresent: undefined,
  batteryPct: undefined,
  rawEepromData: null,
  logs: [],
});

/** A saved module as listed by the backend, with the id normalised to a string. */
interface ModuleRow {
  id: string;
  vendor?: string;
  model?: string;
  serial?: string;
  created_at?: string;
}

/** Selection in the list: a saved module id, the unsaved last read, or nothing. */
type Selection = { kind: 'module'; id: string } | { kind: 'live' } | null;

const LIVE_ROW = 'live';

/** True when a BLE profile (service + write + notify UUIDs) is already saved. */
function hasSavedProfile(): boolean {
  const p = loadActiveProfile();
  return Boolean(p?.serviceUuid && p?.writeCharUuid && p?.notifyCharUuid);
}

/** Load the module list and normalise ids to strings, so comparisons are consistent. */
async function loadModuleRows(): Promise<ModuleRow[]> {
  const list = await listModules();
  return (list ?? []).map((m: any) => ({ ...m, id: String(m.id) }));
}

export function ConnectPanel() {
  const [mode, setMode] = useState<ConnectionMode>('auto');
  const state = useSyncExternalStore(subscribe, getBleState, getServerSnapshot);
  const [busy, setBusy] = useState(false);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedEeprom, setSelectedEeprom] = useState<ArrayBuffer | null>(null);
  const [eepromLoading, setEepromLoading] = useState(false);
  const [supportIssues, setSupportIssues] = useState<string[]>([]);
  const [esphomeEnabled, setEsphomeEnabled] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [liveSaved, setLiveSaved] = useState(false);
  const eepromRequest = useRef(0);

  useEffect(() => {
    if (isStandalone()) {
      loadModuleRows().then(setModules).catch((e) => console.error('Failed to load modules', e));
      fetch('/api/v1/esphome/status')
        .then((r) => r.json())
        .then((d) => setEsphomeEnabled(Boolean(d.enabled)))
        .catch(() => setEsphomeEnabled(false));
    }
    detectBluetoothSupport()
      .then((res) => setSupportIssues(res.reasons))
      .catch((e) => console.error('Failed to detect Bluetooth support', e));
  }, []);

  // A fresh read selects the "last read" row so its details show at once.
  useEffect(() => {
    setLiveSaved(false);
    if (state.rawEepromData) setSelection({ kind: 'live' });
  }, [state.rawEepromData]);

  // Load the EEPROM of the selected saved module; ignore answers to older clicks.
  useEffect(() => {
    if (selection?.kind !== 'module') {
      setSelectedEeprom(null);
      return;
    }
    const request = ++eepromRequest.current;
    setEepromLoading(true);
    setSelectedEeprom(null);
    const id = selection.id;
    void (async () => {
      try {
        const buf = await getModuleRepository().getEEPROMData(id);
        if (request === eepromRequest.current) setSelectedEeprom(buf);
      } catch (e: any) {
        if (request === eepromRequest.current) toast.error(e?.message || String(e));
      } finally {
        if (request === eepromRequest.current) setEepromLoading(false);
      }
    })();
  }, [selection]);

  /**
   * One Connect button for every case. When no BLE profile is saved yet (first use, Web
   * Bluetooth), or `forceDiscover` is set, it opens the device chooser, saves the profile
   * and connects to the device picked there - one chooser, one click.
   */
  const onConnect = async (forceDiscover = false) => {
    setBusy(true);
    try {
      const direct = mode === 'auto' || mode === 'web-bluetooth';
      if (direct && (forceDiscover || !hasSavedProfile())) {
        const { device } = await discoverAndConnectSfpDevice();
        await connect(mode, device);
        toast.success('Connected');
        return;
      }
      await connect(mode);
      toast.success('Connected');
    } catch (e: any) {
      if ((e as DiscoveryError)?.code !== 'user-cancelled') toast.error(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRead = () => run(async () => {
    await requestSfpRead();
    toast('Reading module…');
  });

  const onSave = () => run(async () => {
    await saveCurrentModule();
    const rows = await loadModuleRows();
    setModules(rows);
    // Show the newly saved module (highest id) instead of the unsaved "last read" row.
    const newest = rows.reduce<ModuleRow | undefined>((a, m) => (!a || Number(m.id) > Number(a.id) ? m : a), undefined);
    setLiveSaved(true);
    if (newest) setSelection({ kind: 'module', id: newest.id });
    toast.success('Saved to library');
  });

  const onWriteModule = (id: string) => {
    const confirmed = window.confirm(
      'WARNING: Writing EEPROM data can permanently damage your SFP module if incorrect data is used.\n\n' +
        'Before proceeding:\n' +
        '✓ Ensure you have backed up the original module data\n' +
        '✓ Verify this is the correct module profile\n' +
        '✓ Use test/non-critical modules first\n\n' +
        'NOTE: This only stages the data on the device - you must then confirm on the SFP Wizard\'s own screen to actually apply it to the module.\n\n' +
        'Do you want to continue?'
    );
    if (!confirmed) return;
    void run(async () => {
      await writeSfpFromModuleId(id);
      toast.success('Staged to device - confirm on the SFP Wizard screen', {
        description: 'The module is not written until you approve the snapshot on the device itself.',
      });
    });
  };

  const onDeleteModule = async (id: string) => {
    if (!window.confirm(`Delete module #${id}? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await getModuleRepository().deleteModule(id);
      setModules((prev) => prev.filter((m) => m.id !== id));
      setSelection((s) => (s?.kind === 'module' && s.id === id ? null : s));
      toast.success('Module deleted');
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const selectedModule = selection?.kind === 'module' ? modules.find((m) => m.id === selection.id) : undefined;
  const selectedKey = selection?.kind === 'module' ? selection.id : selection?.kind === 'live' ? LIVE_ROW : null;

  return (
    <div className="grid gap-4 text-sm">
      {supportIssues.length > 0 && (
        <details className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          <summary className="cursor-pointer">Web Bluetooth may not work in this browser ({supportIssues.length} issue{supportIssues.length > 1 ? 's' : ''})</summary>
          <ul className="mt-1 list-disc pl-5">
            {supportIssues.map((r, i) => (<li key={i}>{r}</li>))}
          </ul>
        </details>
      )}

      {/* Toolbar: status on the left, actions on the right */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', state.connected ? 'bg-emerald-500' : 'bg-neutral-400')} />
          <span className="font-medium">{state.connected ? 'Connected' : 'Not connected'}</span>
          {state.connected && (
            <span className="text-xs text-muted-foreground">
              {[state.deviceVersion && `fw ${state.deviceVersion}`,
                state.batteryPct !== undefined && `battery ${state.batteryPct}%`,
                state.sfpPresent !== undefined && (state.sfpPresent ? 'module inserted' : 'no module')]
                .filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ConnectionModeSelector value={mode} onChange={setMode} />
          <Button size="sm" onClick={() => onConnect()} disabled={busy} id="connectButton" className="gap-1.5">
            <Bluetooth className="h-3.5 w-3.5" />
            {state.connected ? 'Reconnect' : 'Connect'}
          </Button>
          {(mode === 'auto' || mode === 'web-bluetooth') && (
            <Button size="sm" variant="ghost" onClick={() => onConnect(true)} disabled={busy} className="gap-1.5" title="Open the device chooser and pick the SFP Wizard again">
              <Search className="h-3.5 w-3.5" />
              Find device
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onRead} disabled={!state.connected || busy} id="readSfpButton" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Read SFP
          </Button>
          <Button size="sm" variant="outline" onClick={onSave} disabled={!state.rawEepromData || busy} id="saveModuleButton" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Save to library
          </Button>
        </div>
      </div>

      {/* Master/detail: module list left, details of the selected row right */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="rounded-lg border">
          <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Library · {modules.length} module{modules.length === 1 ? '' : 's'}
          </div>
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {state.rawEepromData && !liveSaved && (
              <li>
                <button
                  type="button"
                  onClick={() => setSelection({ kind: 'live' })}
                  className={cn('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60', selectedKey === LIVE_ROW && 'bg-muted')}
                >
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">Last read</span>
                  <span className="truncate text-muted-foreground">Not saved yet</span>
                </button>
              </li>
            )}
            {modules.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelection({ kind: 'module', id: m.id })}
                  className={cn('grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-2 text-left hover:bg-muted/60', selectedKey === m.id && 'bg-muted')}
                >
                  <span className="text-xs tabular-nums text-muted-foreground">#{m.id}</span>
                  <span className="truncate">
                    <span className="font-medium">{m.vendor || '—'}</span> <span>{m.model}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{m.serial}</span>
                  </span>
                </button>
              </li>
            ))}
            {modules.length === 0 && (!state.rawEepromData || liveSaved) && (
              <li className="px-3 py-6 text-center text-muted-foreground">No modules yet. Connect, read a module and save it.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border">
          {selection === null && (
            <p className="px-4 py-10 text-center text-muted-foreground">Select a module to see its details.</p>
          )}
          {selection?.kind === 'live' && state.rawEepromData && !liveSaved && (
            <div>
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <span className="font-medium">Last read · {state.rawEepromData.byteLength} bytes</span>
                <Button size="sm" variant="outline" onClick={onSave} disabled={busy} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Save to library
                </Button>
              </div>
              <div className="p-4"><SfpDataViewer eepromData={state.rawEepromData} /></div>
            </div>
          )}
          {selectedModule && (
            <div>
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <span className="truncate font-medium">
                  #{selectedModule.id} {selectedModule.vendor} {selectedModule.model}
                  {selectedModule.created_at && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">saved {new Date(selectedModule.created_at).toLocaleString()}</span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" onClick={() => onWriteModule(selectedModule.id)} disabled={busy || !state.connected} className="gap-1.5" title={state.connected ? undefined : 'Connect first'}>
                    <Upload className="h-3.5 w-3.5" />
                    Write
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteModule(selectedModule.id)}
                    disabled={deletingId === selectedModule.id}
                    aria-label={`Delete module ${selectedModule.id}`}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="p-4"><SfpDataViewer eepromData={selectedEeprom} loading={eepromLoading} /></div>
            </div>
          )}
        </div>
      </div>

      {mode === 'esphome-proxy' && esphomeEnabled && <ESPHomeDiscovery />}
      {mode === 'proxy' && <ProxyDiscovery />}
    </div>
  );
}

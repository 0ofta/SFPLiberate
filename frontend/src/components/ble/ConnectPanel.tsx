"use client";
/**
 * Dashboard: the live SFP Wizard only. A device card (connect, status) and a card for the module
 * currently in the Wizard (read it, save it to the library). The library itself lives on /modules
 * and the connection mode on /settings.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ConnectionMode } from '@/lib/ble/types';
import { connect, requestSfpRead, saveCurrentModule } from '@/lib/ble/manager';
import { loadConnectionMode } from '@/lib/ble/connection-mode';
import { discoverAndConnectSfpDevice, type DiscoveryError } from '@/lib/ble/discovery';
import { getBleState, subscribe } from '@/lib/ble/store';
import { ProxyDiscovery } from '@/components/ble/ProxyDiscovery';
import { ESPHomeDiscovery } from '@/components/esphome/ESPHomeDiscovery';
import { loadActiveProfile } from '@/lib/ble/profile';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { detectBluetoothSupport } from '@/lib/ble/support';
import { isStandalone } from '@/lib/features-client';
import { SfpDataViewer } from '@/components/sfp/SfpDataViewer';
import { Battery, Bluetooth, Cpu, Download, Plus } from 'lucide-react';
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

const MODE_LABELS: Record<ConnectionMode, string> = {
  auto: 'Auto',
  'web-bluetooth': 'Web Bluetooth',
  'esphome-proxy': 'ESPHome proxy',
  proxy: 'Proxy (legacy)',
};

/** True when a BLE profile (service + write + notify UUIDs) is already saved. */
function hasSavedProfile(): boolean {
  const p = loadActiveProfile();
  return Boolean(p?.serviceUuid && p?.writeCharUuid && p?.notifyCharUuid);
}

/** A labelled value in the device card. */
function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
    </div>
  );
}

export function ConnectPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<ConnectionMode>('auto');
  const state = useSyncExternalStore(subscribe, getBleState, getServerSnapshot);
  const [busy, setBusy] = useState(false);
  const [supportIssues, setSupportIssues] = useState<string[]>([]);
  const [esphomeEnabled, setEsphomeEnabled] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    setMode(loadConnectionMode());
    if (isStandalone()) {
      fetch('/api/v1/esphome/status')
        .then((r) => r.json())
        .then((d) => setEsphomeEnabled(Boolean(d.enabled)))
        .catch(() => setEsphomeEnabled(false));
    }
    detectBluetoothSupport()
      .then((res) => setSupportIssues(res.reasons))
      .catch((e) => console.error('Failed to detect Bluetooth support', e));
  }, []);

  // A fresh read has not been saved yet.
  useEffect(() => setSavedId(null), [state.rawEepromData]);

  const direct = mode === 'auto' || mode === 'web-bluetooth';

  /**
   * One Connect button for every case. When no BLE profile is saved yet (first use, Web
   * Bluetooth), or `forceDiscover` is set, it opens the device chooser, saves the profile
   * and connects to the device picked there - one chooser, one click.
   */
  const onConnect = async (forceDiscover = false) => {
    setBusy(true);
    try {
      if (direct && (forceDiscover || !hasSavedProfile())) {
        const { device } = await discoverAndConnectSfpDevice();
        await connect(mode, device);
      } else {
        await connect(mode);
      }
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
    const result = await saveCurrentModule();
    const id = String(result.id);
    setSavedId(id);
    const open = () => router.push(`/modules?open=${encodeURIComponent(id)}`);
    if (result.status === 'duplicate') {
      toast('Already in the library', { description: `Same data as module #${id}`, action: { label: 'Open', onClick: open } });
    } else {
      toast.success(`Saved as module #${id}`, { action: { label: 'Open', onClick: open } });
    }
  });

  const moduleState = state.sfpPresent === undefined ? '—' : state.sfpPresent ? 'Inserted' : 'None';

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

      {/* Device */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', state.connected ? 'bg-emerald-500' : 'bg-neutral-400')} />
              <h2 className="text-base font-semibold">SFP Wizard · {state.connected ? 'Connected' : 'Not connected'}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Connection: {MODE_LABELS[mode]} · <Link href="/settings" className="underline hover:text-foreground">change in Settings</Link>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => onConnect()} disabled={busy} id="connectButton" className="gap-1.5">
              <Bluetooth className="h-4 w-4" />
              {state.connected ? 'Reconnect' : 'Connect'}
            </Button>
            {direct && (
              <button type="button" onClick={() => onConnect(true)} disabled={busy} className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50">
                Pick a different device
              </button>
            )}
          </div>
        </div>
        {state.connected && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Fact icon={<Cpu className="h-4 w-4" />} label="Firmware" value={state.deviceVersion ?? '—'} />
            <Fact icon={<Battery className="h-4 w-4" />} label="Battery" value={state.batteryPct !== undefined ? `${state.batteryPct}%` : '—'} />
            <Fact icon={<Download className="h-4 w-4" />} label="SFP module" value={moduleState} />
          </div>
        )}
      </section>

      {mode === 'esphome-proxy' && esphomeEnabled && <ESPHomeDiscovery />}
      {mode === 'proxy' && <ProxyDiscovery />}

      {/* Module currently in the Wizard */}
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Module in the Wizard</h2>
            <p className="text-xs text-muted-foreground">
              {state.rawEepromData
                ? savedId
                  ? <>Saved as #{savedId} · <Link href={`/modules?open=${encodeURIComponent(savedId)}`} className="underline hover:text-foreground">view in library</Link></>
                  : `Read ${state.rawEepromData.byteLength} bytes · not saved yet`
                : 'Not read yet'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onRead} disabled={!state.connected || busy} id="readSfpButton" className="gap-1.5">
              <Download className="h-4 w-4" />
              Read module
            </Button>
            <Button variant="outline" onClick={onSave} disabled={!state.rawEepromData || busy || savedId !== null} id="saveModuleButton" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Save to library
            </Button>
          </div>
        </div>
        <div className="p-4">
          {state.rawEepromData ? (
            <SfpDataViewer eepromData={state.rawEepromData} />
          ) : (
            <ol className="mx-auto max-w-sm list-decimal space-y-1 py-6 pl-5 text-muted-foreground">
              <li className={cn(state.connected && 'line-through')}>Connect to the SFP Wizard</li>
              <li className={cn(state.sfpPresent && 'line-through')}>Insert a module</li>
              <li>Press Read module</li>
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

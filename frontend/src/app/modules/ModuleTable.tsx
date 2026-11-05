'use client';

/**
 * Module library: search, a compact list, and a slide-out panel with the details and actions
 * (write, edit, comment, delete) of the module clicked. `?open=<id>` opens a module directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { DeploymentMode } from '@/lib/features-client';
import { writeSfpFromModuleId } from '@/lib/ble/manager';
import { appwriteResourceIds } from '@/lib/appwrite/config';
import { mapDocumentToModuleRow, type ModuleRow } from './types';
import { getModuleRepository } from '@/lib/repositories';
import { ChecksumError, describeChecksumProblems } from '@/lib/sfp/eeprom';
import { EepromEditorDialog, repairModuleChecksums } from '@/components/sfp/EepromEditorDialog';
import { SfpDataViewer } from '@/components/sfp/SfpDataViewer';
import { HelpCircle, MoreHorizontal, Pencil, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

import { loadModulesAction } from './actions';

type ModuleTableProps = {
  initialModules: ModuleRow[];
  deploymentMode: DeploymentMode;
  initialError?: string | null;
};

type SortKey = 'newest' | 'vendor';

/** Short form of long (Appwrite) ids so rows stay narrow. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.substring(0, 8)}…` : id;
}

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/** Newest first by date, falling back to numeric id for rows without a date. */
function compareNewest(a: ModuleRow, b: ModuleRow): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
  return Number(b.id) - Number(a.id) || b.id.localeCompare(a.id);
}

/** Why a write to a branded module can be refused by the Wizard. */
function VendorLockHelp() {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Editing fields always works and is saved to your library. Writing to a physical module only works on{' '}
        <strong>generic/unbranded &quot;donor&quot; modules</strong> - these typically have no write-protection.
      </p>
      <p>
        Branded modules from major vendors (Cisco, Ubiquiti, etc.) are commonly write-protected, and the SFP Wizard&apos;s
        firmware respects that protection for known modules - it rejects the write with a &quot;locked by vendor&quot;
        message, and there is no way to override this.
      </p>
      <p>
        <a href="https://blog.ui.com/article/welcome-to-sfp-liberation-day" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          Ubiquiti&apos;s own explanation
        </a>
        {' · '}
        <a href="https://www.l-p.com/eu-en/blog/knowledge-center/sfp-eeprom-logic-for-multi-vendor-interoperability.htm" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          Technical background
        </a>
      </p>
    </div>
  );
}

export function ModuleTable({ initialModules, deploymentMode, initialError }: ModuleTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ModuleRow[]>(initialModules);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  const [eeprom, setEeprom] = useState<ArrayBuffer | null>(null);
  const [eepromLoading, setEepromLoading] = useState(false);
  const [eepromVersion, setEepromVersion] = useState(0);
  const [commentDraft, setCommentDraft] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [editingModule, setEditingModule] = useState<{ id: string; name?: string } | null>(null);
  const [checksumProblem, setChecksumProblem] = useState<{ id: string; message: string } | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const eepromRequest = useRef(0);

  useEffect(() => setRows(initialModules), [initialModules]);

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  // Deep link from the dashboard: /modules?open=<id>
  useEffect(() => {
    const id = searchParams?.get('open');
    if (id) setOpenId(id);
  }, [searchParams]);

  // Appwrite realtime updates (no manual refresh needed)
  useEffect(() => {
    if (deploymentMode !== 'appwrite') return;
    let subscription: any;
    (async () => {
      try {
        const { Realtime } = await import('appwrite');
        const { getAppwriteClient } = await import('@/lib/auth');
        const client = await getAppwriteClient();
        const rt = new Realtime(client);
        const channel = `databases.${appwriteResourceIds.databaseId}.collections.${appwriteResourceIds.userModulesCollectionId}.documents`;
        subscription = await rt.subscribe(channel, (event: any) => {
          const { events, payload } = event || {};
          if (!events || !payload) return;
          const row = mapDocumentToModuleRow(payload as any) as ModuleRow;
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === row.id);
            if (events.some((e: string) => e.endsWith('.delete'))) {
              return idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev;
            }
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...row };
              return next;
            }
            return [row, ...prev];
          });
        });
      } catch (e) {
        console.error('Failed to subscribe to Appwrite realtime:', e);
      }
    })();
    return () => {
      try {
        if (subscription?.unsubscribe) subscription.unsubscribe();
        else if (subscription?.close) subscription.close();
      } catch {
        // best-effort cleanup; ignore errors on unmount
      }
    };
  }, [deploymentMode]);

  const openModule = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);

  // Load the EEPROM of the open module; answers to older requests are ignored.
  useEffect(() => {
    setEeprom(null);
    if (!openId) return;
    const request = ++eepromRequest.current;
    setEepromLoading(true);
    void (async () => {
      try {
        const buf = await getModuleRepository().getEEPROMData(openId);
        if (request === eepromRequest.current) setEeprom(buf);
      } catch (error) {
        if (request === eepromRequest.current) toast.error(error instanceof Error ? error.message : 'Failed to load module data.');
      } finally {
        if (request === eepromRequest.current) setEepromLoading(false);
      }
    })();
  }, [openId, eepromVersion]);

  // Reset the comment draft when another module opens.
  useEffect(() => setCommentDraft(openModule?.comments ?? ''), [openModule?.id, openModule?.comments]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadModulesAction());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh modules. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const onSaveComment = useCallback(async (id: string) => {
    const repository = getModuleRepository();
    if (!repository.updateModuleMetadata) {
      toast.error('Editing modules is not supported in this deployment mode.');
      return;
    }
    setSavingComment(true);
    try {
      const updated = await repository.updateModuleMetadata(id, { comments: commentDraft });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, comments: updated.comments } : r)));
      toast.success('Comment saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save comment.');
    } finally {
      setSavingComment(false);
    }
  }, [commentDraft]);

  const onWrite = useCallback(async (id: string, allowBadChecksums = false) => {
    try {
      toast('Starting write...', { description: `Module #${id}` });
      await writeSfpFromModuleId(id, { allowBadChecksums });
      toast.success('Staged to device - confirm on the SFP Wizard screen', { description: 'The module is not written until you approve the snapshot on the device itself.' });
    } catch (error) {
      if (error instanceof ChecksumError) {
        setChecksumProblem({ id, message: describeChecksumProblems(error.report) });
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to write module to device.');
    }
  }, []);

  /** Fixes bytes 63 and 95 of a saved module in place, then retries the write it blocked. */
  const onRepairAndWrite = useCallback(async (id: string) => {
    setChecksumProblem(null);
    try {
      await repairModuleChecksums(id);
      toast.success('Checksums repaired', { description: `Module #${id}: bytes 63 and 95 now match the data.` });
      await load();
      setEepromVersion((v) => v + 1);
      await onWrite(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Repair failed.');
    }
  }, [load, onWrite]);

  /** Close the panel and drop `?open=` so a refresh or a repeated deep link behaves. */
  const closePanel = useCallback(() => {
    setOpenId(null);
    if (searchParams?.get('open')) router.replace('/modules', { scroll: false });
  }, [router, searchParams]);

  const onDelete = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      await getModuleRepository().deleteModule(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      closePanel();
      toast.success('Module deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete module.');
    } finally {
      setDeleting(false);
    }
  }, [closePanel]);

  const closeEditor = useCallback(() => setEditingModule(null), []);
  /** After an edit, reload and show the module holding the new data (an edited copy may be new). */
  const onEdited = useCallback((savedId?: string) => {
    void load();
    if (savedId) setOpenId(savedId);
    setEepromVersion((v) => v + 1);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((m) =>
          [m.id, m.vendor, m.model, m.serial, m.comments].some((v) => v?.toString().toLowerCase().includes(q))
        )
      : [...rows];
    return list.sort(
      sort === 'vendor'
        ? (a, b) => `${a.vendor ?? ''} ${a.model ?? ''}`.localeCompare(`${b.vendor ?? ''} ${b.model ?? ''}`)
        : compareNewest
    );
  }, [query, rows, sort]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} saved module{rows.length === 1 ? '' : 's'} ·{' '}
            <Badge variant="secondary">{deploymentMode === 'appwrite' ? 'Cloud library' : 'Local library'}</Badge>
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendor, model, serial, comment or #id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            aria-label="Search modules"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[130px]" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="vendor">Vendor A–Z</SelectItem>
          </SelectContent>
        </Select>
        {deploymentMode !== 'appwrite' && (
          <Button variant="ghost" size="icon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        )}
      </div>

      <ul className="divide-y rounded-lg border">
        {visible.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setOpenId(m.id)}
              className={cn(
                'grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60',
                openId === m.id && 'bg-muted'
              )}
            >
              <span className="text-xs tabular-nums text-muted-foreground">#{shortId(m.id)}</span>
              <span className="min-w-0">
                <span className="block truncate">
                  <span className="font-medium">{m.vendor || '—'}</span> {m.model}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{m.serial}</span>
                </span>
                {m.comments && <span className="block truncate text-xs text-muted-foreground">{m.comments}</span>}
              </span>
              <span className="text-xs text-muted-foreground">{formatDate(m.createdAt)}</span>
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-10 text-center text-sm text-muted-foreground">
            {loading ? 'Loading…' : query ? 'No modules match the search.' : 'No modules yet. Read a module on the Dashboard and save it.'}
          </li>
        )}
      </ul>

      <Sheet open={openId !== null} onOpenChange={(open) => !open && closePanel()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {openModule ? (
            <>
              <SheetHeader>
                <SheetTitle>{[openModule.vendor, openModule.model].filter(Boolean).join(' ') || 'Module'}</SheetTitle>
                <SheetDescription>
                  #{openModule.id}
                  {openModule.serial && <> · serial <span className="font-mono">{openModule.serial}</span></>}
                  {formatDate(openModule.createdAt) && <> · saved {formatDate(openModule.createdAt)}</>}
                </SheetDescription>
              </SheetHeader>

              <div className="flex items-center gap-2 px-4">
                <Button onClick={() => setConfirmWrite(true)} className="gap-1.5">
                  <Upload className="h-4 w-4" />
                  Write to device
                </Button>
                <Button variant="outline" onClick={() => setEditingModule({ id: openModule.id, name: openModule.name })} className="gap-1.5">
                  <Pencil className="h-4 w-4" />
                  Edit fields
                </Button>
                {/* modal={false}: a modal menu that opens a dialog can leave the page unclickable. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More actions" className="ml-auto">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setShowHelp(true)}>
                      <HelpCircle className="mr-2 h-4 w-4" />
                      Why writes can fail
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-red-600 focus:text-red-700">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-2 px-4">
                <label htmlFor="module-comment" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comment</label>
                <Textarea
                  id="module-comment"
                  value={commentDraft}
                  maxLength={1000}
                  rows={2}
                  disabled={savingComment}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Where it came from, what it is for…"
                />
                {commentDraft !== (openModule.comments ?? '') && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setCommentDraft(openModule.comments ?? '')} disabled={savingComment}>Cancel</Button>
                    <Button size="sm" onClick={() => onSaveComment(openModule.id)} disabled={savingComment}>Save comment</Button>
                  </div>
                )}
              </div>

              <div className="border-t px-4 pt-4 pb-6">
                <SfpDataViewer eepromData={eeprom} loading={eepromLoading} />
              </div>
            </>
          ) : (
            <SheetHeader>
              <SheetTitle>Module #{openId}</SheetTitle>
              <SheetDescription>{loading ? 'Loading…' : 'This module is not in the library.'}</SheetDescription>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmWrite} onOpenChange={setConfirmWrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write module #{openId} to device?</AlertDialogTitle>
            <AlertDialogDescription>
              Writing EEPROM can permanently damage your module if incorrect data is used. Make sure you have a backup and the
              correct profile is selected. This only stages the data on the device - you must then confirm on the SFP Wizard&apos;s
              own screen to actually apply it to the module. The checksums (bytes 63 and 95) are verified first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => openId && onWrite(openId)}>Write</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete module #{openId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved EEPROM capture from your library. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => openId && onDelete(openId)} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why a write can be refused</DialogTitle>
          </DialogHeader>
          <VendorLockHelp />
        </DialogContent>
      </Dialog>

      <EepromEditorDialog module={editingModule} onClose={closeEditor} onSaved={onEdited} />

      <AlertDialog open={checksumProblem !== null} onOpenChange={(open) => !open && setChecksumProblem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Module #{checksumProblem?.id} has wrong checksums</AlertDialogTitle>
            <AlertDialogDescription>
              {checksumProblem?.message}. A module written like this may not be recognised by the host. Repair fixes only
              these two bytes, in the saved copy. Write anyway sends the data unchanged, for example to clone an
              untouched factory read exactly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const id = checksumProblem?.id;
                setChecksumProblem(null);
                if (id) void onWrite(id, true);
              }}
            >
              Write anyway
            </Button>
            <AlertDialogAction onClick={() => checksumProblem && onRepairAndWrite(checksumProblem.id)}>
              Repair and write
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

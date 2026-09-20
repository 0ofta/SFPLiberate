'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DeploymentMode } from '@/lib/features-client';
import { writeSfpFromModuleId } from '@/lib/ble/manager';
import { appwriteResourceIds } from '@/lib/appwrite/config';
import { mapDocumentToModuleRow, type ModuleRow as Row, type ModuleRow } from './types';
import { getModuleRepository } from '@/lib/repositories';
import { patchSerialNumber, patchVendor, patchModel } from '@/lib/sfp/parser';
import { SfpDataViewer } from '@/components/sfp/SfpDataViewer';
import { Pencil, Check, X, Trash2, Eye, HelpCircle } from 'lucide-react';

import { loadModulesAction } from './actions';

type ModuleTableProps = {
  initialModules: ModuleRow[];
  deploymentMode: DeploymentMode;
  initialError?: string | null;
};

function VendorModelHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Why ${label.toLowerCase()} writes might fail`}
            className="text-blue-500 hover:text-blue-700"
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 text-sm" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2">
            Editing this field always works and is saved to your library. Writing the change to a physical device
            only works on <strong>generic/unbranded &quot;donor&quot; modules</strong> - these typically have no
            write-protection at all, which is the intended way to use this feature.
          </p>
          <p className="mb-2">
            Branded modules from major vendors (Cisco, Ubiquiti, etc.) are commonly write-protected, and the SFP
            Wizard&apos;s own firmware deliberately respects that protection for specific known modules - it will
            reject the write with a &quot;locked by vendor&quot; message, and there is no way to override this.
          </p>
          <p>
            <a
              href="https://blog.ui.com/article/welcome-to-sfp-liberation-day"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Ubiquiti&apos;s own explanation of this
            </a>
            {' · '}
            <a
              href="https://www.l-p.com/eu-en/blog/knowledge-center/sfp-eeprom-logic-for-multi-vendor-interoperability.htm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Technical background
            </a>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ModuleTable({ initialModules, deploymentMode, initialError }: ModuleTableProps) {
  const [rows, setRows] = useState<ModuleRow[]>(initialModules);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  type EeepromField = 'vendor' | 'model' | 'serial';
  const [editingField, setEditingField] = useState<{ id: string; field: EeepromField } | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [savingField, setSavingField] = useState<{ id: string; field: EeepromField } | null>(null);
  const [editingCommentsId, setEditingCommentsId] = useState<string | null>(null);
  const [commentsDraft, setCommentsDraft] = useState('');
  const [savingCommentsId, setSavingCommentsId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingData, setViewingData] = useState<ArrayBuffer | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'id', desc: true }]);
  const [pageSize, setPageSize] = useState(10);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  useEffect(() => {
    setRows(initialModules);
  }, [initialModules]);

  useEffect(() => {
    if (initialError) {
      toast.error(initialError);
    }
  }, [initialError]);

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
          const row = mapDocumentToModuleRow(payload as any) as Row;
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === row.id);
            if (events.some((e: string) => e.endsWith('.delete'))) {
              if (idx >= 0) return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
              return prev;
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const modules = await loadModulesAction();
      setRows(modules);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh modules. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const FIELD_PATCHERS: Record<EeepromField, (data: ArrayBuffer, value: string) => ArrayBuffer> = {
    vendor: patchVendor,
    model: patchModel,
    serial: patchSerialNumber,
  };

  const onSaveField = useCallback(async (id: string, field: EeepromField) => {
    const repository = getModuleRepository();
    if (!repository.updateModuleEeprom) {
      toast.error('Editing modules is not supported in this deployment mode.');
      return;
    }
    setSavingField({ id, field });
    try {
      const current = await repository.getEEPROMData(id);
      const patched = FIELD_PATCHERS[field](current, fieldDraft);
      const updated = await repository.updateModuleEeprom(id, patched);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, serial: updated.serial, vendor: updated.vendor, model: updated.model } : r)));
      setEditingField(null);
      toast.success(`${field[0].toUpperCase()}${field.slice(1)} updated`, { description: 'Write it to the device to test.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to update ${field}.`;
      toast.error(message);
    } finally {
      setSavingField(null);
    }
  }, [fieldDraft]);

  const onSaveComments = useCallback(async (id: string) => {
    const repository = getModuleRepository();
    if (!repository.updateModuleMetadata) {
      toast.error('Editing modules is not supported in this deployment mode.');
      return;
    }
    setSavingCommentsId(id);
    try {
      const updated = await repository.updateModuleMetadata(id, { comments: commentsDraft });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, comments: updated.comments } : r)));
      setEditingCommentsId(null);
      toast.success('Comment saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save comment.';
      toast.error(message);
    } finally {
      setSavingCommentsId(null);
    }
  }, [commentsDraft]);

  const onWrite = useCallback(async (id: string) => {
    try {
      toast('Starting write...', { description: `Module #${id}` });
      await writeSfpFromModuleId(id);
      toast.success('Staged to device - confirm on the SFP Wizard screen', { description: 'The module is not written until you approve the snapshot on the device itself.' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to write module to device.';
      toast.error(message);
    }
  }, []);

  const onDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await getModuleRepository().deleteModule(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success('Module deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete module.';
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const onView = useCallback(async (id: string) => {
    setViewingId(id);
    setViewingLoading(true);
    setViewingData(null);
    try {
      const data = await getModuleRepository().getEEPROMData(id);
      setViewingData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load module data.';
      toast.error(message);
      setViewingId(null);
    } finally {
      setViewingLoading(false);
    }
  }, []);

    const filtered = useMemo(() => {
      if (!query) {

        return rows;
      }
      const q = query.toLowerCase();

      return rows.filter((module) =>
        [module.id, module.vendor, module.model, module.serial, module.comments]
          .filter(Boolean)
          .some((value) => value!.toString().toLowerCase().includes(q))
      );
  }, [query, rows]);

  const renderEditableEepromField = (id: string, field: EeepromField, value: string | undefined) => {
    const isEditing = editingField?.id === id && editingField.field === field;
    const isSaving = savingField?.id === id && savingField.field === field;

    if (!isEditing) {
      return (
        <div className="flex items-center gap-1.5">
          <span>{value}</span>
          <button
            type="button"
            aria-label={`Edit ${field} for module ${id}`}
            className="text-neutral-400 hover:text-neutral-700"
            onClick={() => {
              setEditingField({ id, field });
              setFieldDraft(value ?? '');
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={fieldDraft}
          maxLength={16}
          disabled={isSaving}
          onChange={(e) => setFieldDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveField(id, field);
            if (e.key === 'Escape') setEditingField(null);
          }}
          className="h-7 w-36"
        />
        <button
          type="button"
          aria-label={`Save ${field}`}
          disabled={isSaving}
          className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
          onClick={() => onSaveField(id, field)}
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={`Cancel editing ${field}`}
          disabled={isSaving}
          className="text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
          onClick={() => setEditingField(null)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const columns = useMemo<ColumnDef<ModuleRow>[]>(
    () => [
        {
          accessorKey: 'id',
          header: 'ID',
          cell: (info) => {
            const id = info.getValue<string>();

            return id.length > 10 ? `#${id.substring(0, 8)}...` : `#${id}`;
          },
        },
      {
        accessorKey: 'vendor',
        header: () => <VendorModelHeader label="Vendor" />,
        cell: ({ row }) => renderEditableEepromField(row.original.id, 'vendor', row.original.vendor),
      },
      {
        accessorKey: 'model',
        header: () => <VendorModelHeader label="Model" />,
        cell: ({ row }) => renderEditableEepromField(row.original.id, 'model', row.original.model),
      },
      {
        accessorKey: 'serial',
        header: 'Serial',
        cell: ({ row }) => renderEditableEepromField(row.original.id, 'serial', row.original.serial),
      },
      {
        accessorKey: 'comments',
        header: 'Comments',
        cell: ({ row }) => {
          const id = row.original.id;
          const isEditing = editingCommentsId === id;
          const isSaving = savingCommentsId === id;

          if (!isEditing) {
            return (
              <div className="flex items-center gap-1.5">
                <span className="text-neutral-500">{row.original.comments || '—'}</span>
                <button
                  type="button"
                  aria-label={`Edit comment for module ${id}`}
                  className="text-neutral-400 hover:text-neutral-700"
                  onClick={() => {
                    setEditingCommentsId(id);
                    setCommentsDraft(row.original.comments ?? '');
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={commentsDraft}
                maxLength={1000}
                disabled={isSaving}
                onChange={(e) => setCommentsDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveComments(id);
                  if (e.key === 'Escape') setEditingCommentsId(null);
                }}
                className="h-7 w-48"
              />
              <button
                type="button"
                aria-label="Save comment"
                disabled={isSaving}
                className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                onClick={() => onSaveComments(id)}
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Cancel editing comment"
                disabled={isSaving}
                className="text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
                onClick={() => setEditingCommentsId(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onView(row.original.id)} aria-label={`View data for module ${row.original.id}`}>
              <Eye className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="default">
                  Write
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Write module #{row.original.id} to device?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Writing EEPROM can permanently damage your module if incorrect data is used. Make sure you have a backup and the
                    correct profile is selected. This only stages the data on the device - you must then confirm on the SFP Wizard&apos;s
                    own screen to actually apply it to the module.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onWrite(row.original.id)}>
                    Write
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deletingId === row.original.id}
                  aria-label={`Delete module ${row.original.id}`}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete module #{row.original.id}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the saved EEPROM capture from your local library. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(row.original.id)} className="bg-red-600 hover:bg-red-700">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ),
      },
    ],
    [onWrite, onDelete, onView, deletingId, editingField, fieldDraft, savingField, onSaveField, editingCommentsId, commentsDraft, savingCommentsId, onSaveComments]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setPageSize(pageSize);
  }, [pageSize, table]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
          <p className="mt-1 text-sm text-neutral-500">Saved EEPROM captures</p>
          <Badge variant="secondary" className="mt-2">
            {deploymentMode === 'appwrite' ? 'Appwrite Cloud Library' : 'Local Library'}
          </Badge>
        </div>
        {deploymentMode !== 'appwrite' && (
          <Button onClick={load} variant="secondary" disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Module Library</CardTitle>
          <CardDescription>Write to device or inspect details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Input
              placeholder="Search modules (id, vendor, model, serial)"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                table.setPageIndex(0);
              }}
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
              <div className="mr-2 hidden items-center gap-3 text-sm md:flex">
                <div className="flex items-center gap-1">
                  <Checkbox
                    id="col-vendor"
                    checked={table.getColumn('vendor')?.getIsVisible() ?? true}
                    onCheckedChange={() => table.getColumn('vendor')?.toggleVisibility()}
                  />
                  <label htmlFor="col-vendor">Vendor</label>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox
                    id="col-model"
                    checked={table.getColumn('model')?.getIsVisible() ?? true}
                    onCheckedChange={() => table.getColumn('model')?.toggleVisibility()}
                  />
                  <label htmlFor="col-model">Model</label>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox
                    id="col-serial"
                    checked={table.getColumn('serial')?.getIsVisible() ?? true}
                    onCheckedChange={() => table.getColumn('serial')?.toggleVisibility()}
                  />
                  <label htmlFor="col-serial">Serial</label>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox
                    id="col-comments"
                    checked={table.getColumn('comments')?.getIsVisible() ?? true}
                    onCheckedChange={() => table.getColumn('comments')?.toggleVisibility()}
                  />
                  <label htmlFor="col-comments">Comments</label>
                </div>
              </div>
              <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue placeholder="Rows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="25">25 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.getHeaderGroups().map((headerGroup) =>
                    headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={header.id === 'id' ? 'w-[80px] cursor-pointer' : 'cursor-pointer'}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-neutral-500">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && table.getRowModel().rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-neutral-500">
                      No modules found.
                    </TableCell>
                  </TableRow>
                )}
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-sm text-neutral-500">
            <span>
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </span>
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={viewingId !== null} onOpenChange={(open) => !open && setViewingId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Module #{viewingId} data</DialogTitle>
          </DialogHeader>
          <SfpDataViewer eepromData={viewingData} loading={viewingLoading} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

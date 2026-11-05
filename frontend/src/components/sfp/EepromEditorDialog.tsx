'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getModuleRepository } from '@/lib/repositories';
import {
  EDITABLE_FIELDS,
  applyEdits,
  changesBrandIdentity,
  describeChecksumProblems,
  diffEeprom,
  fieldLockReason,
  readAllFields,
  recomputeChecksums,
  validateField,
  verifyChecksums,
  type EepromField,
  type EepromFieldKey,
} from '@/lib/sfp/eeprom';

/** Name suffix that marks a library entry as an edited copy (edited in place from then on). */
export const EDITED_SUFFIX = ' (edited)';

const GROUPS: { id: EepromField['group']; title: string }[] = [
  { id: 'identity', title: 'Identity' },
  { id: 'link', title: 'Link and optics' },
  { id: 'advanced', title: 'Advanced' },
];

/**
 * Rewrites a saved module with both checksums (bytes 63 and 95) recomputed,
 * in place. This is the recovery path for entries saved by older versions
 * that left byte 95 stale after a serial edit.
 *
 * @returns true when the module was repaired, false when it was already correct
 * @throws Error if the update fails (e.g. the repaired bytes equal another saved module)
 */
export async function repairModuleChecksums(id: string): Promise<boolean> {
  const repository = getModuleRepository();
  if (!repository.updateModuleEeprom) throw new Error('Editing modules is not supported in this deployment mode.');
  const current = await repository.getEEPROMData(id);
  if (verifyChecksums(current).ok) return false;
  await repository.updateModuleEeprom(id, recomputeChecksums(current));
  return true;
}

type EepromEditorDialogProps = {
  /** Module to edit; null closes the dialog. */
  module: { id: string; name?: string } | null;
  onClose: () => void;
  /** Called after any successful save or repair, so the caller can reload its list. */
  /** Called after a save, with the id of the module that now holds the edited data. */
  onSaved: (savedId?: string) => void;
};

/**
 * Edits every common SFF-8472 field of a saved module. Two steps: edit, then
 * review a diff and confirm. Checksums are always recomputed on save.
 * The first edit of an original saves a new "(edited)" copy, so the original
 * read stays in the library as the undo point; an edited copy is updated in place.
 */
export function EepromEditorDialog({ module, onClose, onSaved }: EepromEditorDialogProps) {
  const [original, setOriginal] = useState<ArrayBuffer | null>(null);
  const [values, setValues] = useState<Record<EepromFieldKey, string> | null>(null);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const moduleId = module?.id ?? null;

  useEffect(() => {
    setOriginal(null);
    setValues(null);
    setStep('edit');
    setConfirmed(false);
    if (!moduleId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await getModuleRepository().getEEPROMData(moduleId);
        if (cancelled) return;
        setOriginal(data);
        setValues(readAllFields(data));
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Failed to load module data.');
          onClose();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId, onClose]);

  const errors = useMemo(() => {
    const out: Partial<Record<EepromFieldKey, string>> = {};
    if (!values) return out;
    for (const field of EDITABLE_FIELDS) {
      const error = validateField(field.key, values[field.key]);
      if (error) out[field.key] = error;
    }
    return out;
  }, [values]);

  const hasErrors = Object.keys(errors).length > 0;
  const originalChecksums = useMemo(() => (original ? verifyChecksums(original) : null), [original]);

  // The image that would be saved, or null while there are errors.
  const edited = useMemo(() => {
    if (!original || !values || hasErrors) return null;
    try {
      return applyEdits(original, values);
    } catch {
      return null;
    }
  }, [original, values, hasErrors]);

  const diff = useMemo(() => (original && edited ? diffEeprom(original, edited) : null), [original, edited]);
  const editedChecksums = useMemo(() => (edited ? verifyChecksums(edited) : null), [edited]);
  const nothingChanged = !!diff && diff.fields.length === 0 && diff.otherBytes.length === 0;
  const isEditedCopy = !!module?.name?.endsWith(EDITED_SUFFIX);

  const onRepair = async () => {
    if (!moduleId) return;
    setBusy(true);
    try {
      await repairModuleChecksums(moduleId);
      const data = await getModuleRepository().getEEPROMData(moduleId);
      setOriginal(data);
      setValues(readAllFields(data));
      toast.success('Checksums repaired', { description: 'Bytes 63 and 95 now match the data. Nothing else changed.' });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Repair failed.');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!module || !edited) return;
    // Belt and braces: never save an image whose checksums do not verify.
    if (!verifyChecksums(edited).ok) {
      toast.error('Internal check failed: the edited image has wrong checksums. Nothing was saved.');
      return;
    }
    const repository = getModuleRepository();
    setBusy(true);
    try {
      let savedId = module.id;
      if (isEditedCopy) {
        if (!repository.updateModuleEeprom) throw new Error('Editing modules is not supported in this deployment mode.');
        await repository.updateModuleEeprom(module.id, edited);
        toast.success('Edited copy updated', { description: 'Checksums recomputed. Write it to the device to test.' });
      } else {
        const baseName = module.name || `Module ${module.id}`;
        const result = await repository.createModule({ name: `${baseName}${EDITED_SUFFIX}`, eepromData: edited, read_from_device: false });
        savedId = String(result.module.id);
        if (result.isDuplicate) {
          toast.info(`Identical data is already saved as module #${result.module.id}.`);
        } else {
          toast.success(`Saved as new module #${result.module.id}`, { description: `The original #${module.id} is unchanged.` });
        }
      }
      onSaved(savedId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const setValue = (key: EepromFieldKey, value: string) => setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <Dialog open={module !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 'edit' ? 'Edit' : 'Review changes to'} module #{module?.id}</DialogTitle>
          <DialogDescription>
            {isEditedCopy
              ? 'This is an edited copy; saving updates it in place.'
              : 'Saving creates a new "(edited)" copy. The original read stays in your library.'}
          </DialogDescription>
        </DialogHeader>

        {!values || !original ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : step === 'edit' ? (
          <div className="space-y-5">
            {originalChecksums && !originalChecksums.ok && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="flex-1">Saved data has wrong checksums: {describeChecksumProblems(originalChecksums)}.</span>
                <Button size="sm" variant="outline" onClick={onRepair} disabled={busy} className="gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  Repair checksums
                </Button>
              </div>
            )}

            {GROUPS.map((group) => (
              <section key={group.id}>
                <h3 className="mb-2 text-sm font-semibold">{group.title}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {EDITABLE_FIELDS.filter((f) => f.group === group.id).map((field) => {
                    const lock = fieldLockReason(original, field.key);
                    const error = errors[field.key];
                    const inputId = `eeprom-${field.key}`;
                    return (
                      <div key={field.key} className={field.kind === 'hex' && field.length > 4 ? 'sm:col-span-2' : undefined}>
                        <Label htmlFor={inputId} className="text-xs">
                          {field.label} <span className="font-normal text-muted-foreground">· byte {field.length > 1 ? `${field.offset}-${field.offset + field.length - 1}` : field.offset}</span>
                        </Label>
                        <Input
                          id={inputId}
                          value={values[field.key]}
                          disabled={!!lock || busy}
                          maxLength={field.kind === 'ascii' ? field.length : undefined}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          aria-invalid={!!error}
                          className={`mt-1 h-8 font-mono text-sm ${error ? 'border-red-500' : ''}`}
                        />
                        <p className={`mt-1 text-xs ${error ? 'text-red-600' : 'text-muted-foreground'}`}>{error ?? lock ?? field.help ?? ''}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <ReviewStep
            diff={diff}
            brandChange={!!diff && changesBrandIdentity(diff)}
            checksumsOk={!!editedChecksums?.ok}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {step === 'edit' ? (
            <Button onClick={() => { setConfirmed(false); setStep('review'); }} disabled={!edited || nothingChanged || busy}>
              {nothingChanged ? 'No changes' : 'Review changes'}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('edit')} disabled={busy}>Back</Button>
              <Button onClick={onSave} disabled={!confirmed || !editedChecksums?.ok || busy}>
                {isEditedCopy ? 'Save changes' : 'Save as edited copy'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ReviewStepProps = {
  diff: ReturnType<typeof diffEeprom> | null;
  brandChange: boolean;
  checksumsOk: boolean;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
};

/** Before/after table of changed fields and bytes, checksum result, warnings and the confirm box. */
function ReviewStep({ diff, brandChange, checksumsOk, confirmed, onConfirmedChange }: ReviewStepProps) {
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return (
    <div className="space-y-4 text-sm">
      <table className="w-full text-left">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Before</th><th className="py-1">After</th></tr>
        </thead>
        <tbody className="font-mono">
          {diff?.fields.map((f) => (
            <tr key={f.key} className="border-t">
              <td className="py-1 pr-3 font-sans">{f.label}</td>
              <td className="py-1 pr-3 text-red-600">{f.before || '—'}</td>
              <td className="py-1 text-emerald-600">{f.after || '—'}</td>
            </tr>
          ))}
          {diff?.otherBytes.map((b) => (
            <tr key={b.offset} className="border-t text-muted-foreground">
              <td className="py-1 pr-3 font-sans">
                Byte {b.offset}{b.offset === 63 ? ' (checksum CC_BASE)' : b.offset === 95 ? ' (checksum CC_EXT)' : ''}
              </td>
              <td className="py-1 pr-3">0x{hex(b.before)}</td>
              <td className="py-1">0x{hex(b.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={`flex items-center gap-2 ${checksumsOk ? 'text-emerald-600' : 'text-red-600'}`}>
        {checksumsOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {checksumsOk ? 'Checksums verified: bytes 63 and 95 match the new data.' : 'Checksums do not verify. Saving is blocked.'}
      </p>

      {brandChange && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="font-medium">You are changing the vendor name, part number or OUI.</p>
          <p className="mt-1 text-muted-foreground">
            The SFP Wizard refuses these writes on vendor-locked (branded) modules. Generic donor modules are fine.
            Some hosts (e.g. Cisco) also check a vendor code in bytes 96-127, which this editor does not change, so a
            host may still report the module as unsupported.
          </p>
        </div>
      )}

      <label className="flex items-start gap-2">
        <Checkbox checked={confirmed} onCheckedChange={(v) => onConfirmedChange(v === true)} className="mt-0.5" />
        <span>I have checked these changes. Saving does not write to a module; that is a separate step.</span>
      </label>
    </div>
  );
}

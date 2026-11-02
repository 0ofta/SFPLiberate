/**
 * SFF-8472 A0h editing: field table, validation, checksums and diffs.
 *
 * Every edit goes through applyEdits(), which always recomputes both
 * identification checksums afterwards:
 *
 * - CC_BASE, byte 63 = sum of bytes 0-62, mod 256
 * - CC_EXT,  byte 95 = sum of bytes 64-94, mod 256
 *
 * A wrong CC_EXT is what left a module "semi-bricked" after a serial edit:
 * the serial (bytes 68-83) and date code (84-91) sit inside the CC_EXT range.
 *
 * The A2h page (offsets 256+ in a 512-byte capture) has its own checksum at
 * byte 351 and is never touched here.
 *
 * This file has no imports on purpose, so `node --test` can load it directly.
 */

/** How a field is stored in the EEPROM and shown in the editor. */
export type EepromFieldKind =
  /** Printable ASCII (0x20-0x7E), space-padded to the field length. */
  | 'ascii'
  /** Unsigned big-endian integer, entered as a decimal number. */
  | 'uint'
  /** Raw bytes, entered as hex pairs (spaces allowed). */
  | 'hex';

export type EepromFieldKey =
  | 'vendor'
  | 'partNumber'
  | 'revision'
  | 'serial'
  | 'dateCode'
  | 'vendorOui'
  | 'connector'
  | 'transceiverCodes'
  | 'bitRate'
  | 'wavelength'
  | 'lengthSmfKm'
  | 'lengthSmf100m'
  | 'lengthOm2'
  | 'lengthOm1'
  | 'lengthOm4OrCopper'
  | 'lengthOm3';

export interface EepromField {
  key: EepromFieldKey;
  label: string;
  /** Byte offset within the A0h page. */
  offset: number;
  /** Field size in bytes. */
  length: number;
  kind: EepromFieldKind;
  group: 'identity' | 'link' | 'advanced';
  /** Short hint shown under the input (units, format). */
  help?: string;
}

/** The SFF-8472 A0h fields that every SFP module has, in editor order. */
export const EDITABLE_FIELDS: readonly EepromField[] = [
  { key: 'vendor', label: 'Vendor name', offset: 20, length: 16, kind: 'ascii', group: 'identity' },
  { key: 'partNumber', label: 'Part number', offset: 40, length: 16, kind: 'ascii', group: 'identity' },
  { key: 'revision', label: 'Revision', offset: 56, length: 4, kind: 'ascii', group: 'identity' },
  { key: 'serial', label: 'Serial number', offset: 68, length: 16, kind: 'ascii', group: 'identity' },
  {
    key: 'dateCode', label: 'Date code', offset: 84, length: 8, kind: 'ascii', group: 'identity',
    help: 'YYMMDD plus an optional 2-character lot code, e.g. 251020',
  },
  { key: 'vendorOui', label: 'Vendor OUI', offset: 37, length: 3, kind: 'hex', group: 'identity', help: '3 bytes, e.g. 00 90 65' },
  { key: 'connector', label: 'Connector type', offset: 2, length: 1, kind: 'uint', group: 'link', help: '7 = LC, 1 = SC, 33 = copper pigtail, 34 = RJ45' },
  {
    key: 'wavelength', label: 'Wavelength', offset: 60, length: 2, kind: 'uint', group: 'link',
    help: 'Nanometres, e.g. 850, 1310, 1550',
  },
  {
    key: 'bitRate', label: 'Nominal bit rate', offset: 12, length: 1, kind: 'uint', group: 'link',
    help: 'Units of 100 Mbit/s (e.g. 103 = 10.3 Gbit/s). 255 means "see byte 66".',
  },
  { key: 'lengthSmfKm', label: 'Length, single-mode (km)', offset: 14, length: 1, kind: 'uint', group: 'link', help: 'km' },
  { key: 'lengthSmf100m', label: 'Length, single-mode (100 m)', offset: 15, length: 1, kind: 'uint', group: 'link', help: 'Units of 100 m' },
  { key: 'lengthOm2', label: 'Length, OM2 50 µm (10 m)', offset: 16, length: 1, kind: 'uint', group: 'link', help: 'Units of 10 m' },
  { key: 'lengthOm1', label: 'Length, OM1 62.5 µm (10 m)', offset: 17, length: 1, kind: 'uint', group: 'link', help: 'Units of 10 m' },
  // SFF-8472 rev 11.3+: byte 18 is OM4 (10 m units) or copper cable length (1 m units), byte 19 is OM3.
  { key: 'lengthOm4OrCopper', label: 'Length, OM4 or copper cable', offset: 18, length: 1, kind: 'uint', group: 'link', help: 'Units of 10 m for OM4 fiber, 1 m for copper cable' },
  { key: 'lengthOm3', label: 'Length, OM3 50 µm (10 m)', offset: 19, length: 1, kind: 'uint', group: 'link', help: 'Units of 10 m' },
  {
    key: 'transceiverCodes', label: 'Transceiver compliance codes', offset: 3, length: 8, kind: 'hex', group: 'advanced',
    help: '8 bytes (3-10) that tell the host what the module is. Change only if you know the bit meanings.',
  },
];

/** Smallest image we edit or check: the whole A0h base + extended ID (bytes 0-95). */
const MIN_EDITABLE_SIZE = 96;

const CC_BASE_OFFSET = 63;
const CC_EXT_OFFSET = 95;

/** Looks up a field definition by key. Throws for an unknown key. */
export function getField(key: EepromFieldKey): EepromField {
  const field = EDITABLE_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`Unknown EEPROM field: ${key}`);
  return field;
}

function requireSize(view: Uint8Array) {
  if (view.length < MIN_EDITABLE_SIZE) {
    throw new Error(`EEPROM image too short: ${view.length} bytes, need at least ${MIN_EDITABLE_SIZE}.`);
  }
}

function sumBytes(view: Uint8Array, from: number, toExclusive: number): number {
  let sum = 0;
  for (let i = from; i < toExclusive; i++) sum += view[i];
  return sum & 0xff;
}

export interface ChecksumStatus {
  offset: number;
  stored: number;
  expected: number;
  ok: boolean;
}

export interface ChecksumReport {
  ccBase: ChecksumStatus;
  ccExt: ChecksumStatus;
  /** True when both checksums match the data. */
  ok: boolean;
}

/** Compares the stored CC_BASE (byte 63) and CC_EXT (byte 95) with the values the data needs. */
export function verifyChecksums(eepromData: ArrayBuffer): ChecksumReport {
  const view = new Uint8Array(eepromData);
  requireSize(view);
  const ccBaseExpected = sumBytes(view, 0, CC_BASE_OFFSET);
  const ccExtExpected = sumBytes(view, 64, CC_EXT_OFFSET);
  const ccBase = { offset: CC_BASE_OFFSET, stored: view[CC_BASE_OFFSET], expected: ccBaseExpected, ok: view[CC_BASE_OFFSET] === ccBaseExpected };
  const ccExt = { offset: CC_EXT_OFFSET, stored: view[CC_EXT_OFFSET], expected: ccExtExpected, ok: view[CC_EXT_OFFSET] === ccExtExpected };
  return { ccBase, ccExt, ok: ccBase.ok && ccExt.ok };
}

/** Returns a copy with CC_BASE (byte 63) and CC_EXT (byte 95) set to match the data. */
export function recomputeChecksums(eepromData: ArrayBuffer): ArrayBuffer {
  const copy = eepromData.slice(0);
  const view = new Uint8Array(copy);
  requireSize(view);
  view[CC_BASE_OFFSET] = sumBytes(view, 0, CC_BASE_OFFSET);
  view[CC_EXT_OFFSET] = sumBytes(view, 64, CC_EXT_OFFSET);
  return copy;
}

/**
 * True for passive or active copper cables (SFF-8472 byte 8, bits 2 and 3).
 * On those, bytes 60-61 hold cable compliance data, not a wavelength.
 */
export function isCopperCable(eepromData: ArrayBuffer): boolean {
  const view = new Uint8Array(eepromData);
  return view.length > 8 && (view[8] & 0x0c) !== 0;
}

/** Why a field cannot be edited on this image, or null when it can. */
export function fieldLockReason(eepromData: ArrayBuffer, key: EepromFieldKey): string | null {
  if (key === 'wavelength' && isCopperCable(eepromData)) {
    return 'Copper cable: bytes 60-61 hold cable compliance data, not a wavelength.';
  }
  return null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Reads a field as the string the editor shows (ASCII trimmed, numbers in decimal, bytes as hex). */
export function readField(eepromData: ArrayBuffer, key: EepromFieldKey): string {
  const field = getField(key);
  const view = new Uint8Array(eepromData);
  requireSize(view);
  const bytes = view.slice(field.offset, field.offset + field.length);
  switch (field.kind) {
    case 'ascii': {
      // Trailing padding may be spaces or 0x00 (both seen in real modules); drop it.
      let end = bytes.length;
      while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
      // Other non-printable bytes are shown as "?" so they stand out instead of vanishing.
      return Array.from(bytes.slice(0, end), (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '?')).join('');
    }
    case 'uint':
      return String(bytes.reduce((acc, b) => acc * 256 + b, 0));
    case 'hex':
      return toHex(bytes);
  }
}

/** Reads every editable field. */
export function readAllFields(eepromData: ArrayBuffer): Record<EepromFieldKey, string> {
  const out = {} as Record<EepromFieldKey, string>;
  for (const field of EDITABLE_FIELDS) out[field.key] = readField(eepromData, field.key);
  return out;
}

/** Converts an editor string to the field's raw bytes, or returns an error message. */
function encodeField(field: EepromField, value: string): Uint8Array | string {
  switch (field.kind) {
    case 'ascii': {
      if (value.length > field.length) return `At most ${field.length} characters.`;
      for (const ch of value) {
        const code = ch.charCodeAt(0);
        if (ch.length !== 1 || code < 0x20 || code > 0x7e) {
          return `"${ch}" is not allowed. Use plain ASCII letters, digits and symbols only.`;
        }
      }
      const bytes = new Uint8Array(field.length).fill(0x20);
      for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
      return bytes;
    }
    case 'uint': {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) return 'Enter a whole number.';
      const n = Number(trimmed);
      const max = 2 ** (8 * field.length) - 1;
      if (n > max) return `Must be between 0 and ${max}.`;
      const bytes = new Uint8Array(field.length);
      let rest = n;
      for (let i = field.length - 1; i >= 0; i--) {
        bytes[i] = rest & 0xff;
        rest = Math.floor(rest / 256);
      }
      return bytes;
    }
    case 'hex': {
      const compact = value.replace(/\s+/g, '');
      if (!/^[0-9a-fA-F]*$/.test(compact) || compact.length !== field.length * 2) {
        return `Enter exactly ${field.length} bytes as hex, e.g. ${'00 '.repeat(field.length).trim()}.`;
      }
      const bytes = new Uint8Array(field.length);
      for (let i = 0; i < field.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
      return bytes;
    }
  }
}

/** Returns an error message for an invalid editor value, or null when it is valid. */
export function validateField(key: EepromFieldKey, value: string): string | null {
  const result = encodeField(getField(key), value);
  return typeof result === 'string' ? result : null;
}

export type EepromEdits = Partial<Record<EepromFieldKey, string>>;

/**
 * Applies field edits to a copy of the image and recomputes both checksums.
 * Fields whose value equals the current reading are left byte-for-byte as they were.
 * Throws if a changed value is invalid or the field is locked on this image.
 * The input buffer is never changed.
 */
export function applyEdits(eepromData: ArrayBuffer, edits: EepromEdits): ArrayBuffer {
  const copy = eepromData.slice(0);
  const view = new Uint8Array(copy);
  requireSize(view);
  for (const [key, value] of Object.entries(edits) as [EepromFieldKey, string | undefined][]) {
    // Unchanged values keep their original bytes. The editor sends every field, and
    // readField() shows null padding or odd bytes as "?" - writing that back would
    // corrupt fields the user never touched.
    if (value === undefined || value === readField(eepromData, key)) continue;
    const field = getField(key);
    const lock = fieldLockReason(eepromData, key);
    if (lock) throw new Error(`${field.label}: ${lock}`);
    const bytes = encodeField(field, value);
    if (typeof bytes === 'string') throw new Error(`${field.label}: ${bytes}`);
    view.set(bytes, field.offset);
  }
  return recomputeChecksums(copy);
}

export interface FieldChange {
  key: EepromFieldKey;
  label: string;
  before: string;
  after: string;
}

export interface EepromDiff {
  /** Editable fields whose bytes differ. */
  fields: FieldChange[];
  /** Changed byte offsets not covered by an editable field (e.g. checksums 63 and 95). */
  otherBytes: { offset: number; before: number; after: number }[];
}

/** Lists what differs between two images: changed fields, then any other changed bytes. */
export function diffEeprom(before: ArrayBuffer, after: ArrayBuffer): EepromDiff {
  const a = new Uint8Array(before);
  const b = new Uint8Array(after);
  const covered = new Set<number>();
  const fields: FieldChange[] = [];
  for (const field of EDITABLE_FIELDS) {
    let changed = false;
    for (let i = field.offset; i < field.offset + field.length; i++) {
      covered.add(i);
      if (a[i] !== b[i]) changed = true;
    }
    if (changed) {
      fields.push({ key: field.key, label: field.label, before: readField(before, field.key), after: readField(after, field.key) });
    }
  }
  const otherBytes: EepromDiff['otherBytes'] = [];
  const end = Math.max(a.length, b.length);
  for (let i = 0; i < end; i++) {
    if (!covered.has(i) && a[i] !== b[i]) otherBytes.push({ offset: i, before: a[i] ?? 0, after: b[i] ?? 0 });
  }
  return { fields, otherBytes };
}

/**
 * True when a change would alter the module's brand identity (vendor name,
 * part number or OUI). The SFP Wizard refuses those writes on vendor-locked
 * modules, so the editor warns before saving.
 */
export function changesBrandIdentity(diff: EepromDiff): boolean {
  return diff.fields.some((f) => f.key === 'vendor' || f.key === 'partNumber' || f.key === 'vendorOui');
}

/**
 * Thrown by the device write path when an image's checksums are wrong and the
 * caller did not explicitly allow writing it anyway.
 */
export class ChecksumError extends Error {
  readonly report: ChecksumReport;

  constructor(report: ChecksumReport) {
    super(`Checksums are wrong: ${describeChecksumProblems(report)}. Write it from the Modules page to repair the checksums or write it anyway.`);
    this.name = 'ChecksumError';
    this.report = report;
  }
}

const hexByte = (n: number) => `0x${n.toString(16).padStart(2, '0').toUpperCase()}`;

/** Human-readable list of the failing checksums, e.g. "byte 95 (CC_EXT) is 0x1A, should be 0xD1". */
export function describeChecksumProblems(report: ChecksumReport): string {
  const problems: string[] = [];
  if (!report.ccBase.ok) problems.push(`byte 63 (CC_BASE) is ${hexByte(report.ccBase.stored)}, should be ${hexByte(report.ccBase.expected)}`);
  if (!report.ccExt.ok) problems.push(`byte 95 (CC_EXT) is ${hexByte(report.ccExt.stored)}, should be ${hexByte(report.ccExt.expected)}`);
  return problems.join('; ') || 'none';
}

// Tests for src/lib/sfp/eeprom.ts. Run with: npm test (node --test, Node 22.18+ strips TS types).
// sample-rebranded-by-script.bin was produced by running the reference rebrand.py
// (vendor -> "Vassaunet IT", byte63 = sum(0:63), byte95 = sum(64:95)) on sample.bin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  applyEdits,
  diffEeprom,
  readAllFields,
  readField,
  recomputeChecksums,
  validateField,
  verifyChecksums,
  changesBrandIdentity,
} from '../src/lib/sfp/eeprom.ts';

const fixture = (name) => {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const bytes = (ab) => Buffer.from(new Uint8Array(ab));

test('vendor edit matches the reference rebrand.py byte for byte', () => {
  const out = applyEdits(fixture('sample.bin'), { vendor: 'Vassaunet IT' });
  assert.deepEqual(bytes(out), bytes(fixture('sample-rebranded-by-script.bin')));
});

test('sample fixture has valid checksums', () => {
  assert.equal(verifyChecksums(fixture('sample.bin')).ok, true);
});

test('stale CC_EXT after an old-style serial edit is detected and repaired', () => {
  const bricked = fixture('serial-edit-stale-cc-ext.bin');
  const report = verifyChecksums(bricked);
  assert.equal(report.ccBase.ok, true);
  assert.equal(report.ccExt.ok, false);
  const repaired = recomputeChecksums(bricked);
  assert.equal(verifyChecksums(repaired).ok, true);
  assert.equal(readField(repaired, 'serial'), 'XYZ9999999');
});

test('serial edit now updates byte 95', () => {
  const out = applyEdits(fixture('sample.bin'), { serial: 'NEW-SERIAL-01' });
  assert.equal(verifyChecksums(out).ok, true);
  const diff = diffEeprom(fixture('sample.bin'), out);
  assert.deepEqual(diff.fields.map((f) => f.key), ['serial']);
  assert.deepEqual(diff.otherBytes.map((b) => b.offset), [95]);
});

test('editing every field round-trips through readAllFields', () => {
  const values = readAllFields(fixture('sample.bin'));
  assert.equal(values.vendor, 'OEM');
  assert.equal(values.wavelength, '850');
  assert.equal(values.vendorOui, '00 90 65');
  assert.equal(values.dateCode, '251020');
  const edited = { ...values, revision: 'B2', wavelength: '1310', bitRate: '255', vendorOui: '00 17 6A', dateCode: '260101AB', lengthOm3: '0' };
  const out = applyEdits(fixture('sample.bin'), edited);
  assert.deepEqual(readAllFields(out), { ...edited, dateCode: '260101AB' });
  assert.equal(verifyChecksums(out).ok, true);
});

test('A2h page and vendor area are never touched', () => {
  const before = new Uint8Array(fixture('sample.bin'));
  const after = new Uint8Array(applyEdits(fixture('sample.bin'), { vendor: 'X', serial: 'Y' }));
  assert.deepEqual(after.slice(96), before.slice(96));
});

test('input buffer is not mutated', () => {
  const input = fixture('sample.bin');
  const copy = bytes(input);
  applyEdits(input, { vendor: 'Changed' });
  assert.deepEqual(bytes(input), copy);
});

test('validation rejects bad values', () => {
  assert.match(validateField('vendor', 'Bjørn'), /not allowed/);
  assert.match(validateField('vendor', 'x'.repeat(17)), /At most 16/);
  assert.match(validateField('bitRate', '256'), /between 0 and 255/);
  assert.match(validateField('wavelength', '-1'), /whole number/);
  assert.match(validateField('vendorOui', '00 11'), /exactly 3 bytes/);
  assert.equal(validateField('vendorOui', '0011aa'), null);
  assert.throws(() => applyEdits(fixture('sample.bin'), { vendor: 'Ærlig' }), /Vendor name/);
});

test('wavelength is locked on copper cables', () => {
  const copper = new Uint8Array(fixture('sample.bin'));
  copper[8] = 0x04; // passive cable
  const ab = copper.buffer;
  assert.throws(() => applyEdits(ab, { wavelength: '1310' }), /Copper cable/);
  // Sending the unchanged value (as the editor does for every field) is fine.
  assert.doesNotThrow(() => applyEdits(ab, { wavelength: readField(ab, 'wavelength') }));
});

test('brand identity changes are flagged', () => {
  const s = fixture('sample.bin');
  assert.equal(changesBrandIdentity(diffEeprom(s, applyEdits(s, { serial: 'Q' }))), false);
  assert.equal(changesBrandIdentity(diffEeprom(s, applyEdits(s, { partNumber: 'Q' }))), true);
});

test('too-short images are refused', () => {
  assert.throws(() => verifyChecksums(new ArrayBuffer(64)), /too short/);
});

test('unchanged fields keep their original bytes (null padding is not rewritten)', () => {
  const nulls = new Uint8Array(fixture('sample.bin'));
  nulls.fill(0x00, 23, 36); // vendor "OEM" padded with 0x00 instead of spaces
  const ab = recomputeChecksums(nulls.buffer);
  const values = readAllFields(ab);
  assert.equal(values.vendor, 'OEM');
  const out = new Uint8Array(applyEdits(ab, { ...values, serial: 'CHANGED' }));
  assert.deepEqual(out.slice(20, 36), new Uint8Array(ab).slice(20, 36));
  assert.deepEqual(diffEeprom(ab, out.buffer).fields.map((f) => f.key), ['serial']);
});

test('editing a null-padded field writes space padding, never "?"', () => {
  const nulls = new Uint8Array(fixture('sample.bin'));
  nulls.fill(0x00, 23, 36);
  const ab = recomputeChecksums(nulls.buffer);
  const out = new Uint8Array(applyEdits(ab, { ...readAllFields(ab), vendor: 'OEMX' }));
  assert.deepEqual(Buffer.from(out.slice(20, 36)).toString('latin1'), 'OEMX'.padEnd(16, ' '));
  assert.equal(out.slice(20, 36).includes(0x3f), false);
  assert.equal(verifyChecksums(out.buffer).ok, true);
});

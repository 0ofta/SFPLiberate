/**
 * SFP EEPROM Data Parser
 *
 * Parses SFP/SFP+ EEPROM data according to SFF-8472 specification.
 * This is a client-side implementation for Appwrite mode (no backend available).
 *
 * Standalone mode still uses backend parser for consistency.
 */

import { applyEdits } from './eeprom';

export interface SFPMetadata {
  vendor: string;
  model: string;
  serial: string;
}

/**
 * Parse SFP EEPROM data to extract vendor, model, and serial number
 *
 * Based on SFF-8472 specification (Address A0h):
 * - Bytes 20-35 (16 bytes): Vendor name (ASCII)
 * - Bytes 40-55 (16 bytes): Part number / model (ASCII)
 * - Bytes 68-83 (16 bytes): Serial number (ASCII)
 *
 * @param eepromData - Raw EEPROM data as ArrayBuffer
 * @returns Parsed metadata object
 */
export function parseSFPData(eepromData: ArrayBuffer): SFPMetadata {
  // Minimum valid EEPROM size (at least 96 bytes to include serial number field)
  if (eepromData.byteLength < 96) {
    return {
      vendor: 'Unknown',
      model: 'Unknown',
      serial: 'Unknown',
    };
  }

  try {
    const view = new Uint8Array(eepromData);
    const decoder = new TextDecoder('ascii', { fatal: false });

    // Extract vendor name (bytes 20-35)
    const vendorBytes = view.slice(20, 36);
    const vendor = decoder.decode(vendorBytes).trim();

    // Extract part number / model (bytes 40-55)
    const modelBytes = view.slice(40, 56);
    const model = decoder.decode(modelBytes).trim();

    // Extract serial number (bytes 68-83)
    const serialBytes = view.slice(68, 84);
    const serial = decoder.decode(serialBytes).trim();

    return {
      vendor: vendor || 'N/A',
      model: model || 'N/A',
      serial: serial || 'N/A',
    };
  } catch (error) {
    console.error('Failed to parse SFP EEPROM data:', error);
    return {
      vendor: 'Parse Error',
      model: 'Parse Error',
      serial: 'Parse Error',
    };
  }
}

/** Static identification fields decoded from the SFF-8472 A0h page (bytes 0-255). */
export interface SFPIdentification {
  vendor: string;
  model: string;
  serial: string;
  revision: string;
  dateCode: string | null;
  connectorType: string;
  nominalBitRateMbps: number | null;
  wavelengthNm: number | null;
  /** Optical frequency derived from wavelength (c / lambda), null for copper/DAC or when wavelength is unknown. */
  frequencyTHz: number | null;
  /** Supported link distances, one entry per non-zero SFF-8472 length field (a module typically reports only one). */
  linkLengths: { media: string; distance: string }[];
  ddmSupported: boolean;
  internallyCalibrated: boolean;
}

const SPEED_OF_LIGHT_KM_PER_S = 299792.458; // km/s, used to convert wavelength (nm) to frequency (THz)

const CONNECTOR_TYPES: Record<number, string> = {
  0x00: 'Unknown',
  0x01: 'SC',
  0x07: 'LC',
  0x0b: 'MU',
  0x0c: 'SG',
  0x0d: 'Optical Pigtail',
  0x20: 'HSSDC II',
  0x21: 'Copper Pigtail',
  0x22: 'RJ45',
  0x23: 'No separable connector',
};

function parseDateCode(bytes: Uint8Array): string | null {
  const decoder = new TextDecoder('ascii', { fatal: false });
  const text = decoder.decode(bytes.slice(0, 6));
  if (!/^\d{6}$/.test(text)) return null;
  const yy = text.slice(0, 2);
  const mm = text.slice(2, 4);
  const dd = text.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Parse extended SFF-8472 identification fields beyond vendor/model/serial.
 *
 * @param eepromData - Raw EEPROM data as ArrayBuffer (at least 96 bytes)
 */
export function parseSFPIdentification(eepromData: ArrayBuffer): SFPIdentification {
  const base = parseSFPData(eepromData);
  const view = new Uint8Array(eepromData);
  const decoder = new TextDecoder('ascii', { fatal: false });

  const empty: SFPIdentification = {
    ...base,
    revision: 'N/A',
    dateCode: null,
    connectorType: 'Unknown',
    nominalBitRateMbps: null,
    wavelengthNm: null,
    frequencyTHz: null,
    linkLengths: [],
    ddmSupported: false,
    internallyCalibrated: false,
  };

  if (view.length < 96) return empty;

  try {
    const revision = decoder.decode(view.slice(56, 60)).trim() || 'N/A';
    const dateCode = view.length >= 92 ? parseDateCode(view.slice(84, 92)) : null;
    const connectorType = CONNECTOR_TYPES[view[2]] ?? `Unknown (0x${view[2].toString(16)})`;
    const nominalBitRateMbps = view[12] > 0 ? view[12] * 100 : null;
    // Wavelength (bytes 60-61) is only meaningful for optical transceivers;
    // passive/active copper cables use this field differently, so a value of
    // 0 (common for DAC cables) is reported as null rather than "0nm".
    const wavelengthRaw = (view[60] << 8) | view[61];
    const wavelengthNm = wavelengthRaw > 0 ? wavelengthRaw : null;
    const frequencyTHz = wavelengthNm ? SPEED_OF_LIGHT_KM_PER_S / wavelengthNm : null;

    // SFF-8472 link length fields (bytes 14-19). A module typically reports
    // a nonzero value in only one or two of these, matching its media type.
    const linkLengths: { media: string; distance: string }[] = [];
    if (view[14] > 0) linkLengths.push({ media: 'Single-mode fiber', distance: `${view[14]} km` });
    if (view[15] > 0) linkLengths.push({ media: 'Single-mode fiber (fine)', distance: `${view[15] * 100} m` });
    if (view[16] > 0) linkLengths.push({ media: 'OM2 (50µm MMF)', distance: `${view[16] * 10} m` });
    if (view[17] > 0) linkLengths.push({ media: 'OM1 (62.5µm MMF)', distance: `${view[17] * 10} m` });
    // SFF-8472 rev 11.3+: byte 18 is OM4 (10 m units), or copper cable length
    // in metres on copper modules (byte 8 bits 2-3); byte 19 is OM3.
    const copper = (view[8] & 0x0c) !== 0;
    if (view[18] > 0) {
      linkLengths.push(copper
        ? { media: 'Copper cable', distance: `${view[18]} m` }
        : { media: 'OM4 (50µm MMF)', distance: `${view[18] * 10} m` });
    }
    if (view[19] > 0) linkLengths.push({ media: 'OM3 (50µm MMF)', distance: `${view[19] * 10} m` });

    const dmt = view.length >= 93 ? view[92] : 0;
    const ddmSupported = (dmt & 0x40) !== 0;
    const internallyCalibrated = (dmt & 0x20) !== 0;

    return {
      ...base,
      revision,
      dateCode,
      connectorType,
      nominalBitRateMbps,
      wavelengthNm,
      frequencyTHz,
      linkLengths,
      ddmSupported,
      internallyCalibrated,
    };
  } catch (error) {
    console.error('Failed to parse SFP identification fields:', error);
    return empty;
  }
}

/** Live diagnostic monitoring readings decoded from the SFF-8472 A2h page. */
export interface SFPDiagnostics {
  temperatureC: number;
  vccVolts: number;
  txBiasMa: number;
  txPowerMw: number;
  txPowerDbm: number | null;
  rxPowerMw: number;
  rxPowerDbm: number | null;
}

function mwToDbm(mw: number): number | null {
  return mw > 0 ? 10 * Math.log10(mw) : null;
}

/**
 * Parse SFF-8472 Digital Diagnostics Monitoring (DDM) data - the same live
 * readings (temperature, supply voltage, laser bias current, TX/RX optical
 * power) shown on the SFP Wizard's own screen.
 *
 * Only supports internally-calibrated modules (the vast majority) - external
 * calibration, which requires applying per-module slope/offset calibration
 * constants from A2h bytes 0-55, is not implemented.
 *
 * Real-time diagnostics live at A2h offset 96-105 (i.e. EEPROM byte 352-361
 * in a 512-byte A0h+A2h capture): temperature (signed, 1/256 degC), Vcc
 * (100uV units), TX bias (2uA units), TX power (0.1uW units), RX power
 * (0.1uW units). Verified against real captured hardware.
 *
 * @param eepromData - Raw EEPROM data as ArrayBuffer (must include the A2h
 *   page, i.e. be at least 362 bytes - a 512-byte SFP capture has this)
 * @returns Diagnostics, or null if the module doesn't support DDM or the
 *   capture doesn't include the A2h page
 */
export function parseSFPDiagnostics(eepromData: ArrayBuffer): SFPDiagnostics | null {
  const view = new Uint8Array(eepromData);
  if (view.length < 362) return null;

  const dmt = view.length >= 93 ? view[92] : 0;
  const ddmSupported = (dmt & 0x40) !== 0;
  const internallyCalibrated = (dmt & 0x20) !== 0;
  if (!ddmSupported || !internallyCalibrated) return null;

  const dataView = new DataView(eepromData);
  const a2 = 256; // A2h page start offset within a combined A0h+A2h capture

  const tempRaw = dataView.getInt16(a2 + 96);
  const vccRaw = dataView.getUint16(a2 + 98);
  const biasRaw = dataView.getUint16(a2 + 100);
  const txPowerRaw = dataView.getUint16(a2 + 102);
  const rxPowerRaw = dataView.getUint16(a2 + 104);

  const txPowerMw = txPowerRaw * 0.0001;
  const rxPowerMw = rxPowerRaw * 0.0001;

  return {
    temperatureC: tempRaw / 256,
    vccVolts: vccRaw * 0.0001,
    txBiasMa: biasRaw * 0.002,
    txPowerMw,
    txPowerDbm: mwToDbm(txPowerMw),
    rxPowerMw,
    rxPowerDbm: mwToDbm(rxPowerMw),
  };
}

/**
 * Patches the serial number field (bytes 68-83) and recomputes both
 * checksums. The serial is inside CC_EXT's range (bytes 64-94), so byte 95
 * must change with it - leaving it stale is what semi-bricks a module.
 *
 * @param eepromData - Raw EEPROM data (at least 96 bytes)
 * @param newSerial - New serial number (printable ASCII, max 16 characters)
 * @returns A new ArrayBuffer; the input is not changed
 */
export function patchSerialNumber(eepromData: ArrayBuffer, newSerial: string): ArrayBuffer {
  return applyEdits(eepromData, { serial: newSerial });
}

/**
 * Patches the vendor name field (bytes 20-35) and recomputes both checksums.
 *
 * @param eepromData - Raw EEPROM data (at least 96 bytes)
 * @param newVendor - New vendor name (printable ASCII, max 16 characters)
 */
export function patchVendor(eepromData: ArrayBuffer, newVendor: string): ArrayBuffer {
  return applyEdits(eepromData, { vendor: newVendor });
}

/**
 * Patches the model/part number field (bytes 40-55) and recomputes both checksums.
 *
 * @param eepromData - Raw EEPROM data (at least 96 bytes)
 * @param newModel - New model/part number (printable ASCII, max 16 characters)
 */
export function patchModel(eepromData: ArrayBuffer, newModel: string): ArrayBuffer {
  return applyEdits(eepromData, { partNumber: newModel });
}

/**
 * Calculate SHA-256 hash of EEPROM data
 *
 * Used for duplicate detection - same EEPROM content = same hash.
 *
 * @param eepromData - Raw EEPROM data as ArrayBuffer
 * @returns SHA-256 hash as hex string (64 characters)
 */
export async function calculateSHA256(eepromData: ArrayBuffer): Promise<string> {
  try {
    // Use Web Crypto API (available in all modern browsers)
    const hashBuffer = await crypto.subtle.digest('SHA-256', eepromData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } catch (error) {
    console.error('Failed to calculate SHA-256 hash:', error);
    throw new Error('Failed to calculate hash: Web Crypto API unavailable');
  }
}

/**
 * Validate EEPROM data size
 *
 * SFP EEPROM is typically 256-512 bytes. This function validates
 * that the data is within reasonable bounds.
 *
 * @param eepromData - Raw EEPROM data
 * @returns true if size is valid
 */
export function validateEEPROMSize(eepromData: ArrayBuffer): boolean {
  const size = eepromData.byteLength;
  // Accept 256 bytes (base SFP) up to 512 bytes (extended SFP with DDM)
  return size >= 96 && size <= 1024; // Allow some flexibility
}

/**
 * Format EEPROM data as hex dump (for debugging)
 *
 * @param eepromData - Raw EEPROM data
 * @param maxBytes - Maximum bytes to display (default 96)
 * @returns Hex dump string
 */
export function formatEEPROMHex(eepromData: ArrayBuffer, maxBytes = 96): string {
  const view = new Uint8Array(eepromData);
  const bytes = view.slice(0, Math.min(maxBytes, view.length));
  const hexPairs = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));

  // Format as rows of 16 bytes
  const rows: string[] = [];
  for (let i = 0; i < hexPairs.length; i += 16) {
    const row = hexPairs.slice(i, i + 16).join(' ');
    const offset = i.toString(16).padStart(4, '0');
    rows.push(`${offset}: ${row}`);
  }

  return rows.join('\n');
}

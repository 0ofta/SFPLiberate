/**
 * SFP EEPROM Data Parser
 *
 * Parses SFP/SFP+ EEPROM data according to SFF-8472 specification.
 * This is a client-side implementation for Appwrite mode (no backend available).
 *
 * Standalone mode still uses backend parser for consistency.
 */

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

/**
 * Patches the serial number field (bytes 68-83) of an SFP EEPROM image.
 *
 * Values longer than 16 ASCII characters are truncated; shorter values are
 * space-padded to fill the field, matching how parseSFPData() strips
 * trailing spaces/nulls on read. This field falls after SFF-8472's CC_BASE
 * checksum (byte 63, covers bytes 0-62) and before CC_EXT (byte 95, covers
 * bytes 84-94), so patching it does not require recomputing either checksum.
 *
 * @param eepromData - Raw EEPROM data as ArrayBuffer (must be at least 84 bytes)
 * @param newSerial - New serial number (ASCII, max 16 characters)
 * @returns A new ArrayBuffer with the serial field replaced
 */
export function patchSerialNumber(eepromData: ArrayBuffer, newSerial: string): ArrayBuffer {
  if (eepromData.byteLength < 84) {
    throw new Error(`EEPROM data too short to contain a serial number field (${eepromData.byteLength} bytes, need at least 84)`);
  }

  const patched = eepromData.slice(0);
  const view = new Uint8Array(patched);
  const encoder = new TextEncoder();
  const serialBytes = encoder.encode(newSerial.slice(0, 16));

  const field = new Uint8Array(16).fill(0x20); // space-padded per SFF-8472 convention
  field.set(serialBytes.slice(0, 16));
  view.set(field, 68);

  return patched;
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

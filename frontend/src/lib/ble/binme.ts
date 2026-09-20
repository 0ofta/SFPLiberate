import { deflate, inflate } from 'pako';

/**
 * The SFP Wizard's "binme" binary envelope format (firmware ~v1.1.0+).
 *
 * Reverse-engineered from the open-source sfpw-tool project
 * (https://github.com/vitaminmoo/sfpw-tool), which documents it as a modified
 * version of the upstream "binme" wire format. Verified against real hardware
 * running firmware v1.1.3.
 *
 * Message layout:
 *   [Transport header - 4 bytes]
 *     bytes 0-1: total message length, big-endian, includes this header
 *     bytes 2-3: sequence number, big-endian
 *   [Header section - 9 bytes + data] (device-specific: type 0x03, not standard 0x01)
 *     byte 0: type (0x03)
 *     byte 1: format (0x01 = JSON)
 *     byte 2: isCompressed (0x01 = zlib)
 *     byte 3: flags (0x01 for requests, 0x00 for responses)
 *     bytes 4-7: reserved
 *     byte 8: compressed header length (single byte)
 *     bytes 9+: compressed header data
 *   [Body section - 8 bytes + data] (standard binme: type 0x02)
 *     byte 0: type (0x02)
 *     byte 1: format (0x01 = JSON, 0x02 = string, 0x03 = raw binary)
 *     byte 2: isCompressed
 *     byte 3: reserved
 *     bytes 4-7: body length, big-endian uint32
 *     bytes 8+: body data
 */

const DEVICE_TYPE_HEADER = 0x03;
const TYPE_BODY = 0x02;
const FORMAT_JSON = 0x01;
const FORMAT_BINARY = 0x03;

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readU32be(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

function readU16be(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

/** Reads the transport header's declared total message length (bytes 0-1). */
export function binmeExpectedLength(firstChunk: Uint8Array): number | null {
  if (firstChunk.length < 2) return null;
  return readU16be(firstChunk, 0);
}

/**
 * Encodes a JSON request with a JSON body (used for most API requests).
 */
export function binmeEncode(jsonData: Uint8Array, bodyData: Uint8Array, seqNum: number): Uint8Array {
  const compressedHeader = deflate(jsonData);
  const compressedBody = deflate(bodyData);
  return buildEnvelope(compressedHeader, compressedBody, FORMAT_JSON, true, seqNum);
}

/**
 * Encodes a JSON request with a raw (uncompressed) binary body, used for
 * writing binary EEPROM data to the module/snapshot data endpoints.
 */
export function binmeEncodeRawBody(jsonData: Uint8Array, bodyData: Uint8Array, seqNum: number): Uint8Array {
  const compressedHeader = deflate(jsonData);
  return buildEnvelope(compressedHeader, bodyData, FORMAT_BINARY, false, seqNum);
}

function buildEnvelope(
  compressedHeader: Uint8Array,
  bodyPayload: Uint8Array,
  bodyFormat: number,
  bodyCompressed: boolean,
  seqNum: number,
): Uint8Array {
  if (compressedHeader.length > 0xff) {
    throw new Error(`binme header too large to encode (${compressedHeader.length} bytes, max 255)`);
  }

  const headerSection = concatBytes(
    new Uint8Array([DEVICE_TYPE_HEADER, FORMAT_JSON, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, compressedHeader.length]),
    compressedHeader,
  );

  const bodySection = concatBytes(
    new Uint8Array([TYPE_BODY, bodyFormat, bodyCompressed ? 0x01 : 0x00, 0x00]),
    u32be(bodyPayload.length),
    bodyPayload,
  );

  const totalLen = headerSection.length + bodySection.length + 4;
  const transportHeader = concatBytes(u16be(totalLen), u16be(seqNum));

  return concatBytes(transportHeader, headerSection, bodySection);
}

export type BinmeDecoded = {
  headerJSON: Uint8Array;
  bodyData: Uint8Array | null;
};

/** Decodes a complete (fully reassembled) binme envelope. */
export function binmeDecode(data: Uint8Array): BinmeDecoded {
  if (data.length < 4) throw new Error(`binme data too short: ${data.length} bytes`);

  let pos = 4; // skip transport header
  if (data.length < pos + 9) throw new Error('binme data too short for header section');

  const headerType = data[pos];
  if (headerType !== DEVICE_TYPE_HEADER) {
    throw new Error(`expected header type 0x${DEVICE_TYPE_HEADER.toString(16)}, got 0x${headerType.toString(16)}`);
  }
  const headerIsCompressed = data[pos + 2];
  const headerLen = data[pos + 8];
  pos += 9;

  if (data.length < pos + headerLen) throw new Error('binme header data truncated');
  const rawHeader = data.slice(pos, pos + headerLen);
  pos += headerLen;

  const headerJSON = maybeInflate(rawHeader, headerIsCompressed === 0x01);

  let bodyData: Uint8Array | null = null;
  if (data.length >= pos + 8) {
    const bodyType = data[pos];
    if (bodyType !== TYPE_BODY) {
      throw new Error(`expected body type 0x${TYPE_BODY.toString(16)}, got 0x${bodyType.toString(16)}`);
    }
    const bodyIsCompressed = data[pos + 2];
    const bodyLen = readU32be(data, pos + 4);
    pos += 8;
    if (data.length < pos + bodyLen) throw new Error('binme body data truncated');
    const rawBody = data.slice(pos, pos + bodyLen);
    bodyData = maybeInflate(rawBody, bodyIsCompressed === 0x01);
  }

  return { headerJSON, bodyData };
}

// Response may claim isCompressed=1 but actually send raw data; only inflate
// when the zlib magic byte (0x78) is actually present.
function maybeInflate(data: Uint8Array, claimedCompressed: boolean): Uint8Array {
  if (claimedCompressed && data.length >= 2 && data[0] === 0x78) {
    return inflate(data);
  }
  return data;
}

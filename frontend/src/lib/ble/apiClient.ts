import { binmeEncode, binmeEncodeRawBody, binmeDecode, binmeExpectedLength } from './binme';
import { writeChunks } from './webbluetooth';
import type { GattLikeCharacteristic } from './types';

export { SFP_WRITE_CHAR_UUID, SFP_DEVICE_INFO_CHAR_UUID, SFP_API_NOTIFY_CHAR_UUID } from './sfpProtocolConstants';

export type SfpDeviceInfo = {
  id: string;
  fwv: string;
  apiVersion: string;
  voltage?: string;
  level?: string;
};

export type ApiResponseEnvelope = {
  type: string;
  id: string;
  timestamp: number;
  statusCode: number;
  headers: Record<string, never>;
};

/** Reads the device-info characteristic: a plain JSON GATT read, no binme envelope involved. */
export async function readDeviceInfo(deviceInfoChar: GattLikeCharacteristic): Promise<SfpDeviceInfo> {
  if (!deviceInfoChar.readValue) {
    throw new Error('Device info characteristic does not support read');
  }
  const value = await deviceInfoChar.readValue();
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const text = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(text) as SfpDeviceInfo;
}

/** Builds an API path scoped to this device's own ID, e.g. "/api/1.0/1c6a1b7fb5a8/stats". */
export function buildApiPath(deviceId: string, endpoint: string): string {
  return `/api/1.0/${deviceId.toLowerCase()}${endpoint}`;
}

let requestCounter = 0;

function nextRequestId(): { id: string; seq: number } {
  requestCounter += 1;
  const seq = requestCounter % 0x10000;
  return { id: `00000000-0000-0000-0000-${String(requestCounter).padStart(12, '0')}`, seq };
}

type PendingRequest = {
  resolve: (result: { response: ApiResponseEnvelope; body: Uint8Array | null }) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  chunks: Uint8Array[];
  expectedLen: number | null;
  receivedLen: number;
};

// Only one request is ever in flight at a time in this app's UI (buttons are
// disabled while busy), so responses are routed to the oldest pending entry
// rather than matched by request ID.
const pending: PendingRequest[] = [];

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Feeds a raw notification payload from the API-response characteristic
 * (d587c47f) into the response-reassembly pipeline. Call this from the
 * characteristicvaluechanged handler for that characteristic.
 */
export function handleApiNotification(data: Uint8Array) {
  const req = pending[0];
  if (!req) return;

  if (req.chunks.length === 0) {
    req.expectedLen = binmeExpectedLength(data);
  }
  req.chunks.push(data);
  req.receivedLen += data.length;

  if (req.expectedLen !== null && req.receivedLen >= req.expectedLen) {
    pending.shift();
    clearTimeout(req.timeoutId);
    try {
      const full = concatChunks(req.chunks);
      const { headerJSON, bodyData } = binmeDecode(full);
      const response = JSON.parse(new TextDecoder().decode(headerJSON)) as ApiResponseEnvelope;
      req.resolve({ response, body: bodyData });
    } catch (e) {
      req.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export type SendApiRequestOptions = {
  rawBody?: boolean; // Use uncompressed raw binary body encoding (for EEPROM writes)
  timeoutMs?: number;
};

/** Sends a binme-encoded httpRequest and waits for its httpResponse. */
export async function sendApiRequest(
  writeChar: GattLikeCharacteristic,
  method: 'GET' | 'POST',
  path: string,
  body: Uint8Array | null = null,
  opts: SendApiRequestOptions = {},
): Promise<{ response: ApiResponseEnvelope; body: Uint8Array | null }> {
  const { id, seq } = nextRequestId();
  const request = {
    type: 'httpRequest',
    id,
    timestamp: Date.now(),
    method,
    path,
    headers: {},
  };
  const requestJson = new TextEncoder().encode(JSON.stringify(request));
  const bodyBytes = body ?? new Uint8Array(0);
  const payload = opts.rawBody
    ? binmeEncodeRawBody(requestJson, bodyBytes, seq)
    : binmeEncode(requestJson, bodyBytes, seq);

  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 8000;
    const timeoutId = setTimeout(() => {
      const idx = pending.findIndex((p) => p.resolve === resolve);
      if (idx >= 0) pending.splice(idx, 1);
      reject(new Error(`API request timed out: ${method} ${path}`));
    }, timeoutMs);

    pending.push({ resolve, reject, timeoutId, chunks: [], expectedLen: null, receivedLen: 0 });

    // Chunked, unacknowledged writes: verified against real v1.1.3 hardware.
    // The firmware reassembles fragments using the transport header's
    // declared total length, the same mechanism used for its own responses.
    writeChunks(writeChar, payload, 20, 5, false).catch((err) => {
      const idx = pending.findIndex((p) => p.resolve === resolve);
      if (idx >= 0) pending.splice(idx, 1);
      clearTimeout(timeoutId);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

async function requireOk(
  result: Promise<{ response: ApiResponseEnvelope; body: Uint8Array | null }>,
  context: string,
): Promise<Uint8Array | null> {
  const { response, body } = await result;
  if (response.statusCode !== 200) {
    const bodyText = body ? new TextDecoder().decode(body) : '';
    throw new Error(`${context} failed: status ${response.statusCode}${bodyText ? ` - ${bodyText}` : ''}`);
  }
  return body;
}

export async function getJson<T = unknown>(
  writeChar: GattLikeCharacteristic,
  path: string,
  opts: SendApiRequestOptions = {},
): Promise<T | null> {
  const body = await requireOk(sendApiRequest(writeChar, 'GET', path, null, opts), `GET ${path}`);
  return body ? (JSON.parse(new TextDecoder().decode(body)) as T) : null;
}

export async function postJson<T = unknown>(
  writeChar: GattLikeCharacteristic,
  path: string,
  payload?: unknown,
  opts: SendApiRequestOptions = {},
): Promise<T | null> {
  const bodyBytes = payload !== undefined ? new TextEncoder().encode(JSON.stringify(payload)) : null;
  const body = await requireOk(sendApiRequest(writeChar, 'POST', path, bodyBytes, opts), `POST ${path}`);
  return body ? (JSON.parse(new TextDecoder().decode(body)) as T) : null;
}

/**
 * Fetches binary data using the device's start/data endpoint pattern
 * (used for module EEPROM reads): GET start (returns {size, chunk}), then
 * GET data with {offset, chunk} to retrieve the full payload.
 */
export async function fetchBinary(
  writeChar: GattLikeCharacteristic,
  deviceId: string,
  startEndpoint: string,
  dataEndpoint: string,
): Promise<ArrayBuffer> {
  const startResp = await getJson<{ size?: number; chunk?: number }>(
    writeChar,
    buildApiPath(deviceId, startEndpoint),
    { timeoutMs: 10000 },
  );
  const size = startResp?.size && startResp.size > 0 ? startResp.size : 512;

  const dataReqBody = new TextEncoder().encode(JSON.stringify({ offset: 0, chunk: size }));
  const body = await requireOk(
    sendApiRequest(writeChar, 'GET', buildApiPath(deviceId, dataEndpoint), dataReqBody, { timeoutMs: 20000 }),
    `GET ${dataEndpoint}`,
  );
  if (!body) throw new Error(`No data returned from ${dataEndpoint}`);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

/**
 * Sends binary data using the device's start/data endpoint pattern.
 *
 * NOTE: verified working for READS against real v1.1.3 hardware. The write
 * side (used here for e.g. /xsfp/sync/*) mirrors sfpw-tool's SendBinary
 * implementation but has NOT been verified against real hardware - test with
 * a non-critical module and read the result back before trusting it.
 */
export async function sendBinary(
  writeChar: GattLikeCharacteristic,
  deviceId: string,
  startEndpoint: string,
  dataEndpoint: string,
  data: Uint8Array,
): Promise<void> {
  await requireOk(
    // 45s: when no SFP module is present, this endpoint appears to take much
    // longer to respond than usual (still investigating why) rather than
    // erroring out immediately - give it room before giving up.
    sendApiRequest(writeChar, 'POST', buildApiPath(deviceId, startEndpoint), new TextEncoder().encode(JSON.stringify({ size: data.length })), {
      timeoutMs: 45000,
    }),
    `POST ${startEndpoint}`,
  );
  await requireOk(
    sendApiRequest(writeChar, 'POST', buildApiPath(deviceId, dataEndpoint), data, { rawBody: true, timeoutMs: 20000 }),
    `POST ${dataEndpoint}`,
  );
}

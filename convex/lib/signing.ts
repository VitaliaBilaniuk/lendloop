// HMAC-SHA256 request signing shared by both integration directions.
//
//   Convex -> n8n : X-LendLoop-Signature: v1=HMAC(secret, `${ts}.${body}`)
//   n8n -> Convex : X-LendLoop-Signature: v1=HMAC(secret, `${ts}.${METHOD}.${path}.${body}`)
//
// Each direction uses its own secret. The timestamp bounds replay to a short
// window; binding method + path stops a signature for one Convex endpoint
// being replayed against another.

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();

function importKey(secret: string, usage: "sign" | "verify") {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Signing secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sign(secret: string, message: string): Promise<string> {
  const key = await importKey(secret, "sign");
  return `v1=${toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))}`;
}

export function inboundMessage(ts: string, method: string, path: string, body: string) {
  return `${ts}.${method.toUpperCase()}.${path}.${body}`;
}

export function outboundMessage(ts: string, body: string) {
  return `${ts}.${body}`;
}

/**
 * Verifies a signature header against `message`. Uses WebCrypto's verify,
 * which compares in constant time, and rejects stale or future timestamps.
 */
export async function verify(params: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  message: (ts: string) => string;
  nowSeconds?: number;
}): Promise<boolean> {
  const { secret, timestamp, signature } = params;
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false;
  if (!signature.startsWith("v1=")) return false;
  const provided = fromHex(signature.slice(3));
  if (provided === null) return false;
  const key = await importKey(secret, "verify");
  return await crypto.subtle.verify("HMAC", key, provided, encoder.encode(params.message(timestamp)));
}

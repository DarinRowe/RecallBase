export interface DeviceRawKey {
  id: string;
  version: 1;
  algorithm: "AES-GCM";
  extractable: true;
  createdAt: string;
  rawKeyBase64Url: string;
}

export interface ImportedRawKey {
  id: string;
  version: 1;
  algorithm: "AES-GCM";
  key: CryptoKey;
}

export async function generateDeviceRawKey(now = new Date()): Promise<DeviceRawKey> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt"
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const id = await keyIdForRawKey(raw);

  return {
    id,
    version: 1,
    algorithm: "AES-GCM",
    extractable: true,
    createdAt: now.toISOString(),
    rawKeyBase64Url: toBase64Url(raw)
  };
}

export async function importDeviceRawKey(key: DeviceRawKey): Promise<ImportedRawKey> {
  const raw = fromBase64Url(key.rawKeyBase64Url);
  const expectedId = await keyIdForRawKey(raw);
  if (key.id !== expectedId) {
    throw new Error("Raw encryption key id does not match key material.");
  }

  return {
    id: key.id,
    version: 1,
    algorithm: "AES-GCM",
    key: await crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt"
    ])
  };
}

export async function keyIdForRawKey(raw: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(raw)));
  return `rawkey_${toBase64Url(digest).slice(0, 24)}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return encodeBase64(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = decodeBase64(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(binary: string): string {
  const runtime = globalThis as typeof globalThis & {
    btoa?: (value: string) => string;
    Buffer?: { from(value: string | Uint8Array, encoding?: string): { toString(encoding: string): string } };
  };
  if (runtime.btoa) return runtime.btoa(binary);
  if (runtime.Buffer) return runtime.Buffer.from(binary, "binary").toString("base64");
  throw new Error("No base64 encoder is available in this runtime.");
}

function decodeBase64(value: string): string {
  const runtime = globalThis as typeof globalThis & {
    atob?: (encoded: string) => string;
    Buffer?: { from(value: string, encoding?: string): { toString(encoding: string): string } };
  };
  if (runtime.atob) return runtime.atob(value);
  if (runtime.Buffer) return runtime.Buffer.from(value, "base64").toString("binary");
  throw new Error("No base64 decoder is available in this runtime.");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

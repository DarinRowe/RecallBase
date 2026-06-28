import type { ImportedRawKey } from "./key-management";
import { fromBase64Url, toArrayBuffer, toBase64Url } from "./key-management";

export interface EncryptedRawBlob {
  id: string;
  keyId: string;
  keyVersion: 1;
  algorithm: "AES-GCM";
  ivBase64Url: string;
  ciphertextBase64Url: string;
  contentHashBase64Url: string;
  encryptedAt: string;
}

export async function encryptRawEvidence(
  input: { id: string; plaintext: string },
  rawKey: ImportedRawKey,
  now = new Date()
): Promise<EncryptedRawBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(input.plaintext);
  const additionalData = new TextEncoder().encode(input.id);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(additionalData) },
      rawKey.key,
      toArrayBuffer(plaintext)
    )
  );
  const contentHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(plaintext)));

  return {
    id: input.id,
    keyId: rawKey.id,
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url: toBase64Url(iv),
    ciphertextBase64Url: toBase64Url(ciphertext),
    contentHashBase64Url: toBase64Url(contentHash),
    encryptedAt: now.toISOString()
  };
}

export async function decryptRawEvidence(blob: EncryptedRawBlob, rawKey: ImportedRawKey): Promise<string> {
  if (blob.keyId !== rawKey.id) {
    throw new Error("Raw blob was encrypted with a different device-local key.");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64Url(blob.ivBase64Url)),
      additionalData: toArrayBuffer(new TextEncoder().encode(blob.id))
    },
    rawKey.key,
    toArrayBuffer(fromBase64Url(blob.ciphertextBase64Url))
  );

  return new TextDecoder().decode(plaintext);
}

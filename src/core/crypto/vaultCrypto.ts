/** Version 2: Web Crypto only. No legacy or unauthenticated decryption. */
export const KDF_ITERATIONS = 600_000;
export const MAX_VAULT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const IV_BYTES = 12;

export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function hexToBuffer(hex: string): ArrayBuffer {
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex))
    throw new Error("Hexadecimal inválido.");
  return Uint8Array.from(hex.match(/../g)!, (b) => Number.parseInt(b, 16))
    .buffer;
}
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToBuffer(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
}
async function passwordMaterial(
  password: string,
  usage: KeyUsage,
): Promise<CryptoKey> {
  if (!password) throw new Error("La contraseña no puede estar vacía.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    [usage],
  );
}
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (salt.length !== 32)
    throw new Error("La sal de bóveda debe tener 32 bytes.");
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    await passwordMaterial(passphrase, "deriveKey"),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function deriveAuthPassword(
  email: string,
  passphrase: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Email vacío.");
  const salt = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`infinyx:auth:v2:${normalized}`),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    await passwordMaterial(passphrase, "deriveBits"),
    256,
  );
  return `iv2_${bufferToHex(bits)}`;
}
export interface VaultEncryptionContext {
  userId: string;
  documentId: string;
  versionNumber: number;
  purpose?: "content" | "metadata";
}
export function buildAdditionalData(
  ctx: VaultEncryptionContext,
): Uint8Array<ArrayBuffer> {
  if (
    !ctx.userId ||
    !ctx.documentId ||
    !Number.isSafeInteger(ctx.versionNumber) ||
    ctx.versionNumber < 1
  ) {
    throw new Error("Contexto de cifrado inválido.");
  }
  return new TextEncoder().encode(
    JSON.stringify([
      "infinyx",
      2,
      ctx.userId,
      ctx.documentId,
      ctx.versionNumber,
      ctx.purpose ?? "content",
    ]),
  );
}
export async function encryptBuffer(
  data: ArrayBuffer,
  key: CryptoKey,
  context: VaultEncryptionContext,
): Promise<{ cipherBuffer: ArrayBuffer; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: buildAdditionalData(context),
      tagLength: 128,
    },
    key,
    data,
  );
  return { cipherBuffer, iv: bufferToHex(iv.buffer) };
}
export async function decryptBuffer(
  cipherBuffer: ArrayBuffer,
  key: CryptoKey,
  ivString: string,
  context: VaultEncryptionContext,
): Promise<ArrayBuffer> {
  const iv = hexToBuffer(ivString);
  if (iv.byteLength !== IV_BYTES || cipherBuffer.byteLength < 16)
    throw new Error("Formato cifrado inválido.");
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: buildAdditionalData(context),
      tagLength: 128,
    },
    key,
    cipherBuffer,
  );
}
export async function computeSHA256(data: ArrayBuffer): Promise<string> {
  return bufferToHex(await crypto.subtle.digest("SHA-256", data));
}
export interface FileMetadata {
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}
export async function encryptMetadata(
  metadata: FileMetadata,
  key: CryptoKey,
  context: VaultEncryptionContext,
): Promise<string> {
  const { cipherBuffer, iv } = await encryptBuffer(
    new TextEncoder().encode(JSON.stringify(metadata)).buffer,
    key,
    { ...context, purpose: "metadata" },
  );
  return `v2:${iv}:${bufferToBase64(cipherBuffer)}`;
}
export async function decryptMetadata(
  value: string,
  key: CryptoKey,
  context: VaultEncryptionContext,
): Promise<FileMetadata> {
  const [format, iv, encoded, extra] = value.split(":");
  if (
    format !== "v2" ||
    !iv ||
    !encoded ||
    extra !== undefined ||
    value.length > 32_768
  )
    throw new Error("Metadatos cifrados inválidos.");
  const plain = await decryptBuffer(base64ToBuffer(encoded), key, iv, {
    ...context,
    purpose: "metadata",
  });
  const data: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (
    typeof data !== "object" ||
    data === null ||
    !("name" in data) ||
    typeof data.name !== "string" ||
    !data.name ||
    data.name.length > 1024 ||
    !("mimeType" in data) ||
    typeof data.mimeType !== "string" ||
    data.mimeType.length > 255 ||
    !("size" in data) ||
    typeof data.size !== "number" ||
    !Number.isSafeInteger(data.size) ||
    data.size < 1 ||
    data.size > MAX_VAULT_FILE_SIZE_BYTES ||
    !("sha256" in data) ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256)
  )
    throw new Error("Metadatos descifrados inválidos.");
  return {
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
    sha256: data.sha256,
  };
}

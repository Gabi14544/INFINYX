import { describe, expect, it } from "vitest";
import {
  computeSHA256,
  decryptBuffer,
  deriveKey,
  encryptBuffer,
  MAX_VAULT_FILE_SIZE_BYTES,
} from "../vaultCrypto";

describe("vaultCrypto engine", () => {
  it("garantiza que MAX_VAULT_FILE_SIZE_BYTES sea exactamente 50 MB (límite Supabase Free Tier)", () => {
    expect(MAX_VAULT_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("ejecuta el ciclo completo deriveKey -> encryptBuffer -> decryptBuffer -> computeSHA256 con integridad total", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);

    const passphrase = "INFINYX-ZeroKnowledge-MasterKey-2026!";
    const key = await deriveKey(passphrase, salt);

    const plainText =
      "Contenido altamente confidencial resguardado en la bóveda INFINYX.";
    const encoder = new TextEncoder();
    const plainBuffer = encoder.encode(plainText).buffer;

    const originalHash = await computeSHA256(plainBuffer);
    expect(originalHash).toMatch(/^[0-9a-f]{64}$/);

    const context = {
      userId: "user-uuid-1234",
      documentId: "doc-uuid-5678",
      versionNumber: 1,
    };

    // Cifrado con AAD
    const { cipherBuffer, iv } = await encryptBuffer(plainBuffer, key, context);
    expect(cipherBuffer.byteLength).toBeGreaterThan(0);
    expect(iv.length).toBe(24); // 12 bytes = 24 caracteres hexadecimales

    // Descifrado exitoso
    const decryptedBuffer = await decryptBuffer(cipherBuffer, key, iv, context);
    const decoder = new TextDecoder();
    const decryptedText = decoder.decode(decryptedBuffer);

    expect(decryptedText).toBe(plainText);

    // Integridad de huella SHA-256
    const decryptedHash = await computeSHA256(decryptedBuffer);
    expect(decryptedHash).toBe(originalHash);

    // Fallo si se altera el IV
    const alteredIv = (iv.startsWith("00") ? "ff" : "00") + iv.slice(2);
    await expect(
      decryptBuffer(cipherBuffer, key, alteredIv, context),
    ).rejects.toThrow();

    // Fallo si se utiliza una clave distinta
    const wrongKey = await deriveKey("DifferentPassphrase-999!", salt);
    await expect(
      decryptBuffer(cipherBuffer, wrongKey, iv, context),
    ).rejects.toThrow();
  });

  it("rechaza descifrar una versión de carpeta bajo otro documento", async () => {
    const key = await deriveKey(
      "folder encryption test",
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const context = { userId: "user", documentId: "a", versionNumber: 1 };
    const encrypted = await encryptBuffer(
      new TextEncoder().encode("folder file").buffer,
      key,
      context,
    );
    await expect(
      decryptBuffer(encrypted.cipherBuffer, key, encrypted.iv, {
        ...context,
        documentId: "b",
      }),
    ).rejects.toThrow();
  });
});

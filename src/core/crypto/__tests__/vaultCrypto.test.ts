import { describe, expect, it } from 'vitest';
import {
  computeSHA256,
  decryptBuffer,
  deriveDownloadVerifier,
  deriveKey,
  encryptBuffer,
  generateDownloadSaltHex,
  MAX_VAULT_FILE_SIZE_BYTES,
  timingSafeEqualHex,
} from '../vaultCrypto';

describe('vaultCrypto engine', () => {
  it('garantiza que MAX_VAULT_FILE_SIZE_BYTES sea exactamente 50 MB (límite Supabase Free Tier)', () => {
    expect(MAX_VAULT_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('ejecuta el ciclo completo deriveKey -> encryptBuffer -> decryptBuffer -> computeSHA256 con integridad total', async () => {
    const salt = new Uint8Array(16);
    window.crypto.getRandomValues(salt);

    const passphrase = 'INFINYX-ZeroKnowledge-MasterKey-2026!';
    const key = await deriveKey(passphrase, salt);

    const plainText = 'Contenido altamente confidencial resguardado en la bóveda INFINYX.';
    const encoder = new TextEncoder();
    const plainBuffer = encoder.encode(plainText).buffer;

    const originalHash = await computeSHA256(plainBuffer);
    expect(originalHash).toMatch(/^[0-9a-f]{64}$/);

    const context = {
      userId: 'user-uuid-1234',
      documentId: 'doc-uuid-5678',
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
    const alteredIv = (iv.startsWith('00') ? 'ff' : '00') + iv.slice(2);
    await expect(decryptBuffer(cipherBuffer, key, alteredIv, context)).rejects.toThrow();

    // Fallo si se utiliza una clave distinta
    const wrongKey = await deriveKey('DifferentPassphrase-999!', salt);
    await expect(decryptBuffer(cipherBuffer, wrongKey, iv, context)).rejects.toThrow();
  });

  it('verifica deriveDownloadVerifier y la comparación timingSafeEqualHex', async () => {
    const saltHex = generateDownloadSaltHex();
    expect(saltHex.length).toBe(64); // 32 bytes = 64 caracteres hex

    const password = 'DownloadAuthSecret2026!';
    const verifier1 = await deriveDownloadVerifier(password, saltHex);
    const verifier2 = await deriveDownloadVerifier(password, saltHex);
    const wrongVerifier = await deriveDownloadVerifier('WrongSecretPassword!', saltHex);

    expect(verifier1.length).toBe(64);
    expect(timingSafeEqualHex(verifier1, verifier2)).toBe(true);
    expect(timingSafeEqualHex(verifier1, wrongVerifier)).toBe(false);

    // Verificaciones de tiempo constante
    expect(timingSafeEqualHex('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqualHex('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqualHex('abcdef', 'abcde')).toBe(false);
  });
});

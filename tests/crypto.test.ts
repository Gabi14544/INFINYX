import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptBuffer,
  decryptMetadata,
  deriveAuthPassword,
  deriveKey,
  encryptBuffer,
  encryptMetadata,
  hexToBuffer,
} from "../src/core/crypto/vaultCrypto";
const context = { userId: "alice", documentId: "doc-a", versionNumber: 1 };
const plain = new TextEncoder().encode("confidential content").buffer;
let key: CryptoKey;
beforeAll(async () => {
  key = await deriveKey("a long test passphrase", new Uint8Array(32).fill(42));
});
describe("authenticated encryption v2", () => {
  it("round trips and creates non-extractable keys with fresh IVs", async () => {
    const a = await encryptBuffer(plain, key, context);
    const b = await encryptBuffer(plain, key, context);
    expect(key.extractable).toBe(false);
    expect(a.iv).not.toBe(b.iv);
    expect(await decryptBuffer(a.cipherBuffer, key, a.iv, context)).toEqual(
      plain,
    );
  });
  it("rejects corruption, wrong user, document, version and purpose", async () => {
    const a = await encryptBuffer(plain, key, context);
    for (const change of [
      { userId: "bob" },
      { documentId: "doc-b" },
      { versionNumber: 2 },
      { purpose: "metadata" as const },
    ]) {
      await expect(
        decryptBuffer(a.cipherBuffer, key, a.iv, { ...context, ...change }),
      ).rejects.toThrow();
    }
    const corrupt = a.cipherBuffer.slice(0);
    new Uint8Array(corrupt)[0] ^= 1;
    await expect(decryptBuffer(corrupt, key, a.iv, context)).rejects.toThrow();
  });
  it("rejects a legacy blob instead of silently dropping AAD", async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const legacy = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plain,
    );
    const hex = Array.from(iv, (b) => b.toString(16).padStart(2, "0")).join("");
    await expect(decryptBuffer(legacy, key, hex, context)).rejects.toThrow();
  });
  it("encrypts metadata and rejects cross-document substitution", async () => {
    const data = {
      name: "private-contract.pdf",
      mimeType: "application/pdf",
      size: 19,
      sha256: "a".repeat(64),
    };
    const encrypted = await encryptMetadata(data, key, context);
    expect(encrypted).not.toContain(data.name);
    expect(encrypted).not.toContain(data.sha256);
    expect(await decryptMetadata(encrypted, key, context)).toEqual(data);
    await expect(
      decryptMetadata(encrypted, key, { ...context, documentId: "other" }),
    ).rejects.toThrow();
  });
  it("rejects malformed inputs and invalid metadata", async () => {
    expect(() => hexToBuffer("xy")).toThrow();
    await expect(deriveKey("secret", new Uint8Array(1))).rejects.toThrow();
    await expect(decryptBuffer(plain, key, "01", context)).rejects.toThrow();
    const invalid = await encryptMetadata(
      { name: "x", mimeType: "", size: -1, sha256: "x" },
      key,
      context,
    );
    await expect(decryptMetadata(invalid, key, context)).rejects.toThrow();
  });
  it("separates authentication credentials by normalized email", async () => {
    const a = await deriveAuthPassword(
      " ALICE@example.com ",
      "test passphrase",
    );
    expect(a).toBe(
      await deriveAuthPassword("alice@example.com", "test passphrase"),
    );
    expect(a).not.toBe(
      await deriveAuthPassword("bob@example.com", "test passphrase"),
    );
    expect(a).not.toContain("test passphrase");
  });
});

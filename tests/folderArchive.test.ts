import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildFolderZip,
  groupUploadUnits,
} from "../src/features/vault/archive/folderArchive";
import {
  MAX_VAULT_FILE_SIZE_BYTES,
  deriveKey,
  encryptMetadata,
  decryptMetadata,
} from "../src/core/crypto/vaultCrypto";
import { toVersionDescriptor } from "../src/features/vault/stores/useVaultStore";
// Importing the store requires no real backend for these pure descriptor tests.
import { vi } from "vitest";
vi.mock("../src/shared/lib/supabase", () => ({ supabase: {} }));
vi.mock("../src/features/auth/stores/useAuthStore", () => ({
  useAuthStore: { getState: () => ({}) },
}));
const file = (name: string, text = "data") =>
  new File([text], name, { type: "text/plain" });
describe("whole-folder archive", () => {
  it("groups root folders as units, retaining loose files and ignoring OS metadata", () => {
    const a = file("a.txt"),
      b = file("b.txt"),
      loose = file("loose.txt");
    const units = groupUploadUnits([
      { file: a, relativePath: "Clients/a.txt" },
      { file: b, relativePath: "Clients/Sub/b.txt" },
      { file: file(".DS_Store"), relativePath: "Clients/.DS_Store" },
      { file: loose },
    ]);
    expect(units).toHaveLength(2);
    expect(units[0]?.kind).toBe("folder");
    expect(
      units[0]?.kind === "folder" && units[0].entries.map((e) => e.logicalName),
    ).toEqual(["Clients/a.txt", "Clients/Sub/b.txt"]);
    expect(units[1]?.kind).toBe("file");
  });
  it("creates a single standard ZIP with every nested file intact", () => {
    const entries = [
      { path: "Clients/a.txt", data: new TextEncoder().encode("alpha") },
      { path: "Clients/Sub/b.txt", data: new TextEncoder().encode("beta") },
    ];
    const archive = buildFolderZip("Clients", entries);
    const contents = unzipSync(archive);
    expect(Object.keys(contents)).toEqual(entries.map((e) => e.path));
    expect(strFromU8(contents["Clients/a.txt"]!)).toBe("alpha");
    expect(strFromU8(contents["Clients/Sub/b.txt"]!)).toBe("beta");
  });
  it("rejects oversized source folders before reading file contents", () => {
    const a = file("a"),
      b = file("b");
    Object.defineProperty(a, "size", { value: MAX_VAULT_FILE_SIZE_BYTES / 2 });
    Object.defineProperty(b, "size", {
      value: MAX_VAULT_FILE_SIZE_BYTES / 2 + 1,
    });
    expect(() =>
      groupUploadUnits([
        { file: a, relativePath: "Root/a" },
        { file: b, relativePath: "Root/b" },
      ]),
    ).toThrow("límite total");
  });
  it("rejects wrong roots, traversal and duplicate archive entries", () => {
    const data = new Uint8Array([1]);
    for (const path of ["Root/../a", "Other/a", "Root/./a"])
      expect(() => buildFolderZip("Root", [{ path, data }])).toThrow();
    expect(() =>
      buildFolderZip("Root", [
        { path: "Root/a", data },
        { path: "Root/a", data },
      ]),
    ).toThrow("duplicada");
  });
  it("keeps old metadata compatible and authenticates optional folder metadata", async () => {
    const key = await deriveKey(
      "folder metadata test",
      new Uint8Array(32).fill(1),
    );
    const ctx = { userId: "user", documentId: "document", versionNumber: 1 };
    const old = {
      name: "file.txt",
      mimeType: "text/plain",
      size: 10,
      sha256: "a".repeat(64),
    };
    expect(
      await decryptMetadata(await encryptMetadata(old, key, ctx), key, ctx),
    ).toEqual(old);
    const folder = {
      ...old,
      name: "Clients",
      mimeType: "application/zip",
      folder: { kind: "folder" as const, fileCount: 2, originalSize: 8 },
    };
    expect(
      await decryptMetadata(await encryptMetadata(folder, key, ctx), key, ctx),
    ).toEqual(folder);
    await expect(
      decryptMetadata(
        await encryptMetadata(
          { ...folder, folder: { ...folder.folder, fileCount: 501 } },
          key,
          ctx,
        ),
        key,
        ctx,
      ),
    ).rejects.toThrow("carpeta");
  });
  it("downloads folder documents as ZIP while ordinary files retain their names", () => {
    const base = {
      id: "d",
      name: "Clients",
      mimeType: "application/zip",
      createdAt: "",
      updatedAt: "",
      versionCount: 1,
      latestVersion: {
        id: "v",
        document_id: "d",
        version_number: 1,
        storage_path: "p",
        iv: "ab".repeat(12),
        encrypted_metadata: "v2",
        created_at: "",
        sha256_hash: "a".repeat(64),
        file_size: 12,
      },
    };
    expect(
      toVersionDescriptor({
        ...base,
        folder: { kind: "folder", fileCount: 2, originalSize: 8 },
      })?.fileName,
    ).toBe("Clients.zip");
    expect(
      toVersionDescriptor({ ...base, name: "OldFolder/file.txt" })?.fileName,
    ).toBe("file.txt");
  });
});

it(
  "rejects a ZIP above the limit even when the source content is exactly 50 MiB",
  { timeout: 30_000 },
  () => {
    // Deterministic incompressible fixture; this generator is not used for cryptography.
    const bytes = new Uint8Array(MAX_VAULT_FILE_SIZE_BYTES);
    let value = 0x1234abcd;
    for (let i = 0; i < bytes.length; i++) {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      bytes[i] = value & 255;
    }
    expect(() =>
      buildFolderZip("Root", [{ path: "Root/random.bin", data: bytes }]),
    ).toThrow("ZIP resultante");
  },
);

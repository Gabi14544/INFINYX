import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRow, DocumentVersionRow } from "../../../../shared/types";
const fake = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  access: vi.fn(),
  rows: [] as DocumentRow[],
  pageReads: [] as number[][],
  versionReads: [] as string[][],
  versions: [] as DocumentVersionRow[],
  state: {
    user: { id: "11111111-2222-4333-8444-555555555555" },
    session: { access_token: "fixture" },
    vaultKey: null as CryptoKey | null,
  },
}));
vi.mock("../../../../shared/lib/supabase", () => ({
  supabase: {
    from: fake.from,
    rpc: fake.rpc,
    storage: { from: () => ({ upload: fake.upload }) },
  },
}));
vi.mock("../../../../shared/lib/vaultAccess", () => ({
  vaultAccess: fake.access,
}));
vi.mock("../../../auth/stores/useAuthStore", () => ({
  useAuthStore: { getState: () => fake.state },
}));
import {
  deriveKey,
  decryptMetadata,
  encryptMetadata,
} from "../../../../core/crypto/vaultCrypto";
import { clearSensitiveState } from "../../../../shared/lib/sensitiveState";
import { useDownloadAuthStore } from "../useDownloadAuthStore";
import { useVaultStore } from "../useVaultStore";
let key: CryptoKey;
beforeAll(async () => {
  key = await deriveKey(
    "Batch test master passphrase",
    new Uint8Array(32).fill(42),
  );
});
beforeEach(() => {
  vi.clearAllMocks();
  clearSensitiveState();
  fake.state.vaultKey = key;
  fake.rows = [];
  fake.pageReads = [];
  fake.versionReads = [];
  fake.versions = [];
  fake.upload.mockResolvedValue({ error: null });
  fake.rpc.mockImplementation(async (_name, args) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (!fake.rows.some((r) => r.id === args.p_document_id))
      fake.rows.push({
        id: args.p_document_id,
        user_id: fake.state.user.id,
        deleting: false,
        created_at: now,
        updated_at: now,
      });
    fake.versions.push({
      id,
      document_id: args.p_document_id,
      version_number: args.p_version_number,
      storage_path: args.p_storage_path,
      iv: args.p_iv,
      encrypted_metadata: args.p_metadata,
      created_at: now,
    });
    return { data: id, error: null };
  });
  fake.from.mockImplementation((table: string) =>
    table === "documents"
      ? {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  range: async (from: number, to: number) => {
                    fake.pageReads.push([from, to]);
                    return { data: fake.rows.slice(from, to + 1), error: null };
                  },
                }),
              }),
            }),
          }),
        }
      : {
          select: () => ({
            in: (_column: string, ids: string[]) => ({
              order: async () => {
                fake.versionReads.push(ids);
                return {
                  data: fake.versions.filter((v) =>
                    ids.includes(v.document_id),
                  ),
                  error: null,
                };
              },
            }),
          }),
        },
  );
  fake.access.mockImplementation(async (_action, _password, body) => ({
    ok: true,
    deletedIds: body.documentIds,
    failedIds: [],
  }));
});
const doc = (id: string) => ({
  id,
  name: id,
  mimeType: null,
  createdAt: "",
  updatedAt: "",
  latestVersion: null,
  versionCount: 0,
});
describe("v2 batch deletion", () => {
  it("requires authorization without changing the local catalog", async () => {
    useVaultStore.setState({ documents: [doc("a")] });
    expect(await useVaultStore.getState().deleteDocumentsBatch(["a"])).toBe(
      false,
    );
    expect(fake.access).not.toHaveBeenCalled();
    expect(useVaultStore.getState().documents).toHaveLength(1);
  });
  it("uses only the server gateway and keeps unselected documents", async () => {
    useVaultStore.setState({ documents: [doc("a"), doc("b"), doc("c")] });
    expect(
      await useVaultStore
        .getState()
        .deleteDocumentsBatch(["a", "b"], "fresh second password"),
    ).toBe(true);
    expect(fake.access).toHaveBeenCalledWith(
      "delete-batch",
      "fresh second password",
      { documentIds: ["a", "b"] },
    );
    expect(fake.from).not.toHaveBeenCalled();
    expect(useVaultStore.getState().documents.map((d) => d.id)).toEqual(["c"]);
  });
  it("removes only confirmed successes and preserves failures for retry", async () => {
    useVaultStore.setState({ documents: [doc("a"), doc("b")] });
    fake.access.mockResolvedValue({
      ok: true,
      deletedIds: ["a"],
      failedIds: ["b"],
    });
    expect(
      await useVaultStore
        .getState()
        .deleteDocumentsBatch(["a", "b"], "fresh second password"),
    ).toBe(false);
    expect(useVaultStore.getState().documents.map((d) => d.id)).toEqual(["b"]);
    expect(useVaultStore.getState().error).toContain("pendientes");
  });
  it("chunks large requests, deduplicates ids and reauthorizes each chunk", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => "doc-" + i);
    useVaultStore.setState({ documents: ids.map(doc) });
    expect(
      await useVaultStore
        .getState()
        .deleteDocumentsBatch([...ids, ids[0]!], "fresh password"),
    ).toBe(true);
    expect(fake.access).toHaveBeenCalledTimes(2);
    expect(
      fake.access.mock.calls.map((call) => call[2].documentIds.length),
    ).toEqual([50, 1]);
  });
  it("preserves state and password on rejected authorization", async () => {
    useVaultStore.setState({ documents: [doc("a")] });
    fake.access.mockRejectedValue(new Error("Contraseña incorrecta"));
    expect(
      await useVaultStore
        .getState()
        .deleteDocumentsBatch(["a"], "wrong password"),
    ).toBe(false);
    expect(useVaultStore.getState().documents).toHaveLength(1);
    expect(useDownloadAuthStore.getState().downloadSessionPassword).toBeNull();
  });
  it("does not start another chunk or restore secrets after lock", async () => {
    let finish!: (value: unknown) => void;
    fake.access.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const ids = Array.from({ length: 51 }, (_, i) => "doc-" + i);
    const pending = useVaultStore
      .getState()
      .deleteDocumentsBatch(ids, "fresh password");
    clearSensitiveState();
    fake.state.vaultKey = null;
    finish({ ok: true, deletedIds: ids.slice(0, 50), failedIds: [] });
    expect(await pending).toBe(false);
    expect(fake.access).toHaveBeenCalledTimes(1);
    expect(useDownloadAuthStore.getState().downloadSessionPassword).toBeNull();
  });
});
describe("v2 folder uploads", () => {
  it("encrypts relative paths and uses the same sequential pipeline for every file", async () => {
    const items = [
      { file: new File(["one"], "a.txt"), logicalName: "Clients/2026/a.txt" },
      { file: new File(["two"], "b.txt"), logicalName: "Clients/2026/b.txt" },
    ];
    const progress: number[] = [];
    const unsubscribe = useVaultStore.subscribe((s) => {
      if (s.batchUploadProgress) progress.push(s.batchUploadProgress.current);
    });
    const result = await useVaultStore
      .getState()
      .uploadDocumentsBatch(items, key);
    unsubscribe();
    expect(result.failedFiles).toEqual([]);
    expect(result.uploadedIds).toHaveLength(2);
    expect(progress).toContain(1);
    expect(progress).toContain(2);
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain("Clients/");
    for (const [index, call] of fake.rpc.mock.calls.entries()) {
      const args = call[1];
      const metadata = await decryptMetadata(args.p_metadata, key, {
        userId: fake.state.user.id,
        documentId: args.p_document_id,
        versionNumber: args.p_version_number,
      });
      expect(metadata.name).toBe(items[index]!.logicalName);
    }
    expect(
      useVaultStore
        .getState()
        .documents.map((d) => d.name)
        .sort(),
    ).toEqual(items.map((i) => i.logicalName).sort());
    expect(useVaultStore.getState().batchUploadProgress?.uploaded).toBe(2);
    expect(useVaultStore.getState().uploadStatus).toBe("done");
    expect(useVaultStore.getState().error).toBeNull();
  });
  it("versions a previously uploaded logical name without querying its plaintext", async () => {
    const file = new File(["one"], "a.txt");
    const first = await useVaultStore
      .getState()
      .uploadDocument(file, key, "Folder/a.txt");
    const second = await useVaultStore
      .getState()
      .uploadDocument(file, key, "Folder/a.txt");
    expect(second).toBe(first);
    expect(fake.rpc.mock.calls.map((c) => c[1].p_version_number)).toEqual([
      1, 2,
    ]);
    expect(
      fake.from.mock.calls.every(
        (c) => c[0] === "documents" || c[0] === "document_versions",
      ),
    ).toBe(true);
  });
  it("reports partial commits as failures and keeps the successful catalog entries", async () => {
    fake.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("Upload failed") });
    const result = await useVaultStore
      .getState()
      .uploadDocumentsBatch(
        [
          { file: new File(["a"], "a.txt") },
          { file: new File(["b"], "b.txt") },
        ],
        key,
      );
    expect(result.uploadedIds).toHaveLength(1);
    expect(result.failedFiles).toEqual(["b.txt"]);
    expect(useVaultStore.getState().documents.map((d) => d.name)).toEqual([
      "a.txt",
    ]);
    expect(useVaultStore.getState().uploadStatus).toBe("error");
  });
  it("stops a folder after lock instead of uploading the next file", async () => {
    fake.upload.mockImplementationOnce(async () => {
      clearSensitiveState();
      fake.state.vaultKey = null;
      return { error: null };
    });
    const result = await useVaultStore
      .getState()
      .uploadDocumentsBatch(
        [
          { file: new File(["a"], "a.txt") },
          { file: new File(["b"], "b.txt") },
        ],
        key,
      );
    expect(fake.upload).toHaveBeenCalledTimes(1);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(result.uploadedIds).toEqual([]);
    expect(useVaultStore.getState().documents).toEqual([]);
    expect(useVaultStore.getState().batchUploadProgress).toBeNull();
  });
});

it("loads a catalog beyond the default 1000-row limit in bounded ID queries", async () => {
  const now = new Date().toISOString();
  fake.rows = Array.from({ length: 1001 }, (_, i) => ({
    id: "doc-" + i,
    user_id: fake.state.user.id,
    deleting: false,
    created_at: now,
    updated_at: now,
  }));
  fake.versions = await Promise.all(
    fake.rows.map(async (row) => ({
      id: "version-" + row.id,
      document_id: row.id,
      version_number: 1,
      storage_path: "path",
      iv: "ab".repeat(12),
      created_at: now,
      encrypted_metadata: await encryptMetadata(
        {
          name: `Folder/${row.id}.txt`,
          mimeType: "text/plain",
          size: 1,
          sha256: "a".repeat(64),
        },
        key,
        { userId: fake.state.user.id, documentId: row.id, versionNumber: 1 },
      ),
    })),
  );
  await useVaultStore.getState().fetchDocuments();
  expect(useVaultStore.getState().error).toBeNull();
  expect(useVaultStore.getState().documents).toHaveLength(1001);
  expect(fake.pageReads).toEqual([
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
  expect(fake.versionReads).toHaveLength(11);
  expect(Math.max(...fake.versionReads.map((ids) => ids.length))).toBe(100);
});

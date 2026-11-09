import { beforeAll, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  access: vi.fn(),
  state: {
    user: { id: "alice" },
    session: { access_token: "fixture" },
    vaultKey: null as CryptoKey | null,
  },
}));
vi.mock("../src/shared/lib/supabase", () => ({
  supabase: {
    from: fake.from,
    rpc: fake.rpc,
    storage: { from: () => ({ upload: fake.upload }) },
  },
}));
vi.mock("../src/shared/lib/vaultAccess", () => ({ vaultAccess: fake.access }));
vi.mock("../src/features/auth/stores/useAuthStore", () => ({
  useAuthStore: { getState: () => fake.state },
}));
import { useVaultStore } from "../src/features/vault/stores/useVaultStore";
import { useDownloadAuthStore } from "../src/features/vault/stores/useDownloadAuthStore";
import { clearSensitiveState } from "../src/shared/lib/sensitiveState";
import {
  decryptBuffer,
  decryptMetadata,
  deriveKey,
  encryptMetadata,
} from "../src/core/crypto/vaultCrypto";
let key: CryptoKey;
beforeAll(async () => {
  key = await deriveKey(
    "store test master phrase",
    new Uint8Array(32).fill(42),
  );
});
beforeEach(() => {
  vi.clearAllMocks();
  clearSensitiveState();
  fake.state.vaultKey = key;
  fake.upload.mockResolvedValue({ error: null });
  fake.rpc.mockResolvedValue({ data: "fixture-version-id", error: null });
  fake.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          order: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  }));
});
it("uploads only ciphertext and encrypted metadata, then commits atomically", async () => {
  const file = new File(["store confidential payload"], "secret-name.txt", {
    type: "text/plain",
  });
  const id = await useVaultStore.getState().uploadDocument(file, key);
  expect(id).not.toBeNull();
  const [path, blob] = fake.upload.mock.calls[0]!;
  expect(path).not.toContain(file.name);
  expect(await (blob as Blob).text()).not.toContain(
    "store confidential payload",
  );
  const [name, args] = fake.rpc.mock.calls[0]!;
  expect(name).toBe("commit_vault_version");
  expect(JSON.stringify(args)).not.toContain(file.name);
  const context = { userId: "alice", documentId: id!, versionNumber: 1 };
  expect((await decryptMetadata(args.p_metadata, key, context)).name).toBe(
    file.name,
  );
  const decrypted = await decryptBuffer(
    await (blob as Blob).arrayBuffer(),
    key,
    args.p_iv,
    context,
  );
  expect(new TextDecoder().decode(decrypted)).toBe(
    "store confidential payload",
  );
});
it("does not restore a decrypted catalog after a lock during a pending fetch", async () => {
  let finish!: (value: unknown) => void;
  const pendingVersions = new Promise((resolve) => {
    finish = resolve;
  });
  const row = { id: "doc-a", user_id: "alice", created_at: "", updated_at: "" };
  fake.from.mockImplementation((table: string) =>
    table === "documents"
      ? {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  range: async () => ({ data: [row], error: null }),
                }),
              }),
            }),
          }),
        }
      : { select: () => ({ in: () => ({ order: () => pendingVersions }) }) },
  );
  const pending = useVaultStore.getState().fetchDocuments();
  await vi.waitFor(() => expect(fake.from).toHaveBeenCalledTimes(2));
  const encrypted_metadata = await encryptMetadata(
    {
      name: "secret.txt",
      mimeType: "text/plain",
      size: 1,
      sha256: "a".repeat(64),
    },
    key,
    { userId: "alice", documentId: "doc-a", versionNumber: 1 },
  );
  clearSensitiveState();
  fake.state.vaultKey = null;
  finish({
    data: [
      {
        id: "version",
        document_id: "doc-a",
        version_number: 1,
        encrypted_metadata,
      },
    ],
    error: null,
  });
  await pending;
  expect(useVaultStore.getState().documents).toEqual([]);
  expect(useVaultStore.getState().error).toBeNull();
});
it("does not start a download when lock occurs while authorization is in flight", async () => {
  let finish!: (value: unknown) => void;
  fake.access.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  useDownloadAuthStore
    .getState()
    .setDownloadSessionPassword("second password fixture");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  try {
    const pending = useVaultStore.getState().downloadAndDecrypt(
      {
        documentId: "doc-a",
        versionId: "v",
        versionNumber: 1,
        storagePath: "",
        iv: "",
        sha256Hash: "",
        fileName: "",
        mimeType: "",
      },
      key,
    );
    clearSensitiveState();
    fake.state.vaultKey = null;
    finish({ url: "https://example.invalid" });
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});

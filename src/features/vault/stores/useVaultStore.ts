import { create } from "zustand";
import {
  computeSHA256,
  decryptBuffer,
  decryptMetadata,
  encryptBuffer,
  encryptMetadata,
  MAX_VAULT_FILE_SIZE_BYTES,
} from "../../../core/crypto/vaultCrypto";
import { readBoundedResponse } from "../../../shared/lib/boundedDownload";
import { supabase } from "../../../shared/lib/supabase";
import { vaultAccess } from "../../../shared/lib/vaultAccess";
import {
  registerSensitiveCleanup,
  sensitiveGeneration,
} from "../../../shared/lib/sensitiveState";
import { VAULT_BUCKET } from "../../../shared/types";
import type {
  DocumentRow,
  DocumentVersionRow,
  UploadStatus,
  VaultDocument,
  VaultVersionDescriptor,
} from "../../../shared/types";
import { useAuthStore } from "../../auth/stores/useAuthStore";
import { useDownloadAuthStore } from "./useDownloadAuthStore";
import {
  resolveLogicalDocumentName,
  validateAndPrepareFiles,
  splitFolderAndFileName,
} from "../utils/folderUpload";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No se pudo completar la operación.";
}
function activeVault() {
  const { user, session, vaultKey } = useAuthStore.getState();
  if (!user || !session || !vaultKey)
    throw new Error("La bóveda está bloqueada.");
  const generation = sensitiveGeneration();
  return {
    user,
    vaultKey,
    check: () => {
      const state = useAuthStore.getState();
      if (
        generation !== sensitiveGeneration() ||
        state.user?.id !== user.id ||
        state.vaultKey !== vaultKey
      )
        throw new Error("La sesión cambió o la bóveda fue bloqueada.");
    },
  };
}
function downloadPassword(): string {
  const password = useDownloadAuthStore.getState().downloadSessionPassword;
  if (!password)
    throw new Error("Introduce tu contraseña de descarga/autorización.");
  return password;
}
export function toVersionDescriptor(
  doc: VaultDocument,
): VaultVersionDescriptor | null {
  const v = doc.latestVersion;
  return v
    ? {
        documentId: doc.id,
        versionId: v.id,
        versionNumber: v.version_number,
        storagePath: v.storage_path,
        iv: v.iv,
        sha256Hash: v.sha256_hash,
        fileName: splitFolderAndFileName(doc.name).baseName,
        mimeType: doc.mimeType ?? "application/octet-stream",
      }
    : null;
}
export interface BatchUploadProgress {
  current: number;
  total: number;
  currentFileName: string;
  uploaded: number;
  failed: number;
}
interface VaultState {
  documents: VaultDocument[];
  isLoading: boolean;
  uploadStatus: UploadStatus;
  batchUploadProgress: BatchUploadProgress | null;
  error: string | null;
}
interface VaultActions {
  fetchDocuments: () => Promise<void>;
  uploadDocument: (
    file: File,
    vaultKey: CryptoKey,
    logicalName?: string,
  ) => Promise<string | null>;
  uploadDocumentsBatch: (
    items: Array<{ file: File; logicalName?: string }>,
    vaultKey: CryptoKey,
  ) => Promise<{ uploadedIds: string[]; failedFiles: string[] }>;
  deleteDocumentsBatch: (ids: string[], password?: string) => Promise<boolean>;
  downloadAndDecrypt: (
    version: VaultVersionDescriptor,
    vaultKey: CryptoKey,
  ) => Promise<boolean>;
  deleteDocument: (id: string) => Promise<boolean>;
  resetUploadStatus: () => void;
  clearError: () => void;
  reset: () => void;
}
const initial: VaultState = {
  documents: [],
  isLoading: false,
  uploadStatus: "idle",
  batchUploadProgress: null,
  error: null,
};
const objectUrls = new Set<string>();
export const useVaultStore = create<VaultState & VaultActions>()((set, get) => {
  // One pipeline for single files and folders. Never duplicate crypto or server commits.
  const uploadOne = async (
    file: File,
    suppliedKey: CryptoKey,
    logicalNameOverride?: string,
  ) => {
    const { user, vaultKey, check } = activeVault();
    const logicalName = resolveLogicalDocumentName(file, logicalNameOverride);
    if (suppliedKey !== vaultKey) throw new Error("Clave de otra sesión.");
    if (
      !file.size ||
      file.size > MAX_VAULT_FILE_SIZE_BYTES ||
      logicalName.length > 1024
    )
      throw new Error("Archivo vacío, demasiado grande o nombre inválido.");
    // Name matching happens only in decrypted client memory, never in a server query.
    const existing = get().documents.find((d) => d.name === logicalName);
    const documentId = existing?.id ?? crypto.randomUUID();
    const versionNumber = (existing?.latestVersion?.version_number ?? 0) + 1;
    if (versionNumber > 3)
      throw new Error("Se ha alcanzado el límite máximo de 3 versiones.");
    const context = { userId: user.id, documentId, versionNumber };
    const plain = await file.arrayBuffer();
    check();
    set({ uploadStatus: "hashing" });
    const sha256 = await computeSHA256(plain);
    check();
    set({ uploadStatus: "encrypting" });
    const metadata = await encryptMetadata(
      {
        name: logicalName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        sha256,
      },
      vaultKey,
      context,
    );
    const { cipherBuffer, iv } = await encryptBuffer(plain, vaultKey, context);
    check();
    set({ uploadStatus: "uploading" });
    // Random immutable paths prevent concurrent requests from overwriting or deleting each other's upload.
    const storagePath = `${user.id}/${documentId}/${crypto.randomUUID()}.enc`;
    const { error: storageError } = await supabase.storage
      .from(VAULT_BUCKET)
      .upload(storagePath, new Blob([cipherBuffer]), {
        contentType: "application/octet-stream",
        upsert: false,
        cacheControl: "0",
      });
    if (storageError) throw storageError;
    check();
    const { data: versionId, error: commitError } = await supabase.rpc(
      "commit_vault_version",
      {
        p_document_id: documentId,
        p_version_number: versionNumber,
        p_storage_path: storagePath,
        p_iv: iv,
        p_metadata: metadata,
      },
    );
    if (commitError) throw commitError;
    check();
    if (typeof versionId !== "string")
      throw new Error(
        "Respuesta de versión inválida. Actualiza el catálogo antes de reintentar.",
      );
    const now = new Date().toISOString();
    const updated: VaultDocument = {
      id: documentId,
      name: logicalName,
      mimeType: file.type || "application/octet-stream",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      versionCount: versionNumber,
      latestVersion: {
        id: versionId,
        document_id: documentId,
        version_number: versionNumber,
        storage_path: storagePath,
        encrypted_metadata: metadata,
        iv,
        created_at: now,
        sha256_hash: sha256,
        file_size: file.size,
      },
    };
    set((state) => ({
      documents: [
        updated,
        ...state.documents.filter((d) => d.id !== documentId),
      ],
    }));
    return documentId;
  };
  return {
    ...initial,
    fetchDocuments: async () => {
      const generation = sensitiveGeneration();
      set({ isLoading: true, error: null });
      try {
        const { user, vaultKey, check } = activeVault();
        // Fetch every document, including vaults larger than PostgREST's default 1000-row cap.
        const rows: DocumentRow[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase
            .from("documents")
            .select("id,user_id,deleting,created_at,updated_at")
            .eq("user_id", user.id)
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false })
            .range(offset, offset + 499);
          if (error) throw error;
          check();
          rows.push(...(data ?? []));
          if (!data || data.length < 500) break;
        }
        const versions: DocumentVersionRow[] = [];
        // Three immutable versions per document: 100 IDs stay below URL and row limits.
        for (let offset = 0; offset < rows.length; offset += 100) {
          const { data, error } = await supabase
            .from("document_versions")
            .select("*")
            .in(
              "document_id",
              rows.slice(offset, offset + 100).map((row) => row.id),
            )
            .order("version_number");
          if (error) throw error;
          check();
          versions.push(...(data ?? []));
        }
        const byDocument = new Map<string, DocumentVersionRow[]>();
        for (const version of versions) {
          const history = byDocument.get(version.document_id) ?? [];
          history.push(version);
          byDocument.set(version.document_id, history);
        }
        const documents: VaultDocument[] = [];
        for (const row of rows) {
          const history = byDocument.get(row.id) ?? [];
          const latest = history.at(-1);
          if (!latest) continue;
          const metadata = await decryptMetadata(
            latest.encrypted_metadata,
            vaultKey,
            {
              userId: user.id,
              documentId: row.id,
              versionNumber: latest.version_number,
            },
          );
          check();
          documents.push({
            id: row.id,
            name: metadata.name,
            mimeType: metadata.mimeType,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            versionCount: history.length,
            latestVersion: {
              ...latest,
              sha256_hash: metadata.sha256,
              file_size: metadata.size,
            },
          });
        }
        check();
        set({ documents, isLoading: false });
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({ isLoading: false, error: message(error) });
      }
    },
    uploadDocument: async (file, key, logicalName) => {
      if (get().isLoading) return null;
      const generation = sensitiveGeneration();
      set({
        isLoading: true,
        error: null,
        uploadStatus: "reading",
        batchUploadProgress: null,
      });
      try {
        const id = await uploadOne(file, key, logicalName);
        await get().fetchDocuments();
        if (generation === sensitiveGeneration())
          set({ isLoading: false, uploadStatus: "done" });
        return id;
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({
            isLoading: false,
            uploadStatus: "error",
            error: message(error),
          });
        return null;
      }
    },
    uploadDocumentsBatch: async (items, key) => {
      const uploadedIds: string[] = [];
      const failedFiles: string[] = [];
      if (get().isLoading)
        return {
          uploadedIds,
          failedFiles: items.map((i) => i.logicalName ?? i.file.name),
        };
      if (!items.length) return { uploadedIds, failedFiles };
      const generation = sensitiveGeneration();
      const prepared = validateAndPrepareFiles(
        items.map((i) => ({ file: i.file, relativePath: i.logicalName })),
      );
      if (prepared.error) {
        set({
          uploadStatus: "error",
          error: prepared.error,
          batchUploadProgress: null,
        });
        return {
          uploadedIds,
          failedFiles: items.map((i) => i.logicalName ?? i.file.name),
        };
      }
      set({ isLoading: true, error: null, uploadStatus: "reading" });
      try {
        const vault = activeVault();
        for (let index = 0; index < prepared.validFiles.length; index++) {
          vault.check();
          const item = prepared.validFiles[index]!;
          set({
            batchUploadProgress: {
              current: index + 1,
              total: prepared.validFiles.length,
              currentFileName: item.logicalName,
              uploaded: uploadedIds.length,
              failed: failedFiles.length,
            },
          });
          try {
            uploadedIds.push(await uploadOne(item.file, key, item.logicalName));
          } catch (error) {
            vault.check();
            failedFiles.push(item.logicalName);
            // Do not log filenames or plaintext metadata outside the local UI.
            set({ error: message(error) });
          }
        }
        vault.check();
        set((state) => ({
          batchUploadProgress: state.batchUploadProgress && {
            ...state.batchUploadProgress,
            uploaded: uploadedIds.length,
            failed: failedFiles.length,
          },
        }));
        await get().fetchDocuments();
        vault.check();
        const refreshError = get().error;
        set({
          isLoading: false,
          uploadStatus: failedFiles.length ? "error" : "done",
          error: failedFiles.length
            ? `Se protegieron ${uploadedIds.length} archivos y fallaron ${failedFiles.length}. Puedes reintentar los fallidos.`
            : refreshError,
        });
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({
            isLoading: false,
            uploadStatus: "error",
            error: message(error),
          });
        for (const item of prepared.validFiles.slice(
          uploadedIds.length + failedFiles.length,
        ))
          failedFiles.push(item.logicalName);
      }
      return { uploadedIds, failedFiles };
    },
    deleteDocumentsBatch: async (ids, suppliedPassword) => {
      if (get().isLoading) return false;
      const uniqueIds = [...new Set(ids)];
      if (!uniqueIds.length) return true;
      const generation = sensitiveGeneration();
      let deleted = 0;
      set({ isLoading: true, error: null });
      try {
        const { check } = activeVault();
        const password = suppliedPassword ?? downloadPassword();
        for (let offset = 0; offset < uniqueIds.length; offset += 50) {
          check();
          const chunk = uniqueIds.slice(offset, offset + 50);
          const result = await vaultAccess<{
            ok: true;
            deletedIds: string[];
            failedIds: string[];
          }>("delete-batch", password, { documentIds: chunk });
          check();
          const expected = new Set(chunk);
          const returned = [...result.deletedIds, ...result.failedIds];
          if (
            returned.length !== chunk.length ||
            new Set(returned).size !== returned.length ||
            returned.some((id) => !expected.has(id))
          )
            throw new Error(
              "Resultado de borrado inválido. Actualiza el catálogo.",
            );
          const removed = new Set(result.deletedIds);
          deleted += removed.size;
          useDownloadAuthStore.getState().setDownloadSessionPassword(password);
          set((state) => ({
            documents: state.documents.filter((doc) => !removed.has(doc.id)),
          }));
          if (result.failedIds.length)
            throw new Error(
              `Se eliminaron ${deleted} documentos; ${uniqueIds.length - deleted} siguen pendientes. Reintenta los restantes.`,
            );
        }
        set({ isLoading: false });
        return true;
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({
            isLoading: false,
            error: `${message(error)}${deleted ? ` Se eliminaron ${deleted} documentos antes del fallo.` : ""}`,
          });
        return false;
      }
    },
    downloadAndDecrypt: async (version, suppliedKey) => {
      if (get().isLoading) return false;
      const generation = sensitiveGeneration();
      set({ isLoading: true, error: null });
      try {
        const { user, vaultKey, check } = activeVault();
        if (suppliedKey !== vaultKey) throw new Error("Clave de otra sesión.");
        // The server resolves ownership/path and verifies the second password on EVERY request.
        const result = await vaultAccess<{ url: string }>(
          "download",
          downloadPassword(),
          { versionId: version.versionId },
        );
        check();
        const response = await fetch(result.url, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        const encrypted = await readBoundedResponse(
          response,
          MAX_VAULT_FILE_SIZE_BYTES + 16,
        );
        check();
        const plain = await decryptBuffer(encrypted, vaultKey, version.iv, {
          userId: user.id,
          documentId: version.documentId,
          versionNumber: version.versionNumber,
        });
        const hash = await computeSHA256(plain);
        check();
        if (hash !== version.sha256Hash)
          throw new Error("Integridad comprometida. Descarga abortada.");
        const url = URL.createObjectURL(
          new Blob([plain], { type: version.mimeType }),
        );
        objectUrls.add(url);
        const a = document.createElement("a");
        a.href = url;
        a.download = version.fileName;
        a.rel = "noopener";
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          objectUrls.delete(url);
        }, 1000);
        set({ isLoading: false });
        return true;
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({ isLoading: false, error: message(error) });
        return false;
      }
    },
    deleteDocument: async (id) => {
      if (get().isLoading) return false;
      const generation = sensitiveGeneration();
      set({ isLoading: true, error: null });
      try {
        const { check } = activeVault();
        await vaultAccess("delete", downloadPassword(), { documentId: id });
        check();
        set((state) => ({
          documents: state.documents.filter((d) => d.id !== id),
          isLoading: false,
        }));
        return true;
      } catch (error) {
        if (generation === sensitiveGeneration())
          set({ isLoading: false, error: message(error) });
        return false;
      }
    },
    resetUploadStatus: () =>
      set({ uploadStatus: "idle", batchUploadProgress: null }),
    clearError: () => set({ error: null }),
    reset: () => set({ ...initial }),
  };
});
registerSensitiveCleanup(() => {
  useVaultStore.getState().reset();
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
});

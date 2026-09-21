/**
 * useVaultStore.ts
 * ---------------------------------------------------------------------------
 * Store global de la bóveda: catálogo de documentos y pipeline de
 * subida/descarga cifrada de extremo a extremo.
 *
 * Invariantes del modelo Zero-Knowledge
 * -------------------------------------
 * - Supabase Storage sólo recibe `ArrayBuffer` ya cifrados con AES-GCM-256.
 * - El texto plano nunca abandona la pestaña del navegador.
 * - `sha256_hash` se calcula SOBRE EL TEXTO PLANO antes de cifrar. Al
 *   descargar se recalcula tras descifrar y se compara: esto detecta tanto
 *   corrupción como manipulación del blob en el servidor (defensa en
 *   profundidad sobre el tag de autenticación de AES-GCM).
 * - La `vaultKey` se recibe siempre por parámetro; este store jamás la
 *   almacena, garantizando que la clave viva en un único lugar (`useAuthStore`).
 * ---------------------------------------------------------------------------
 */

import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';

import {
  computeSHA256,
  decryptBuffer,
  encryptBuffer,
} from '../../../core/crypto/vaultCrypto';
import { supabase } from '../../../shared/lib/supabase';
import type {
  AuditAction,
  DocumentVersion,
  Json,
  UploadStatus,
  VaultDocument,
  VaultVersionDescriptor,
} from '../../../shared/types';
import { VAULT_BUCKET } from '../../../shared/types';
import { useAuthStore } from '../../auth/stores/useAuthStore';

/** MIME con el que se sube el blob cifrado: opaco, no filtra el tipo real. */
const CIPHERTEXT_MIME = 'application/octet-stream';

/** Número de versión asignado a la primera subida de un documento. */
const FIRST_VERSION = 1;

/** Límite máximo de versiones permitidas por documento lógico (v1..v3). */
const MAX_VERSIONS = 3;

/** Margen antes de revocar la object URL, para no abortar la descarga. */
const OBJECT_URL_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

/** Normaliza errores de Supabase (`PostgrestError`, `StorageError`) y de JS. */
function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause.length > 0) {
    return cause;
  }
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const { message } = cause;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

/**
 * Obtiene el usuario autenticado, priorizando el que ya está en
 * `useAuthStore` y recurriendo a la red sólo si hace falta.
 */
async function requireUser(): Promise<User> {
  const { user, session } = useAuthStore.getState();
  const cached = user ?? session?.user ?? null;
  if (cached) {
    return cached;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error('No hay un usuario autenticado en la sesión actual.');
  }
  return data.user;
}

/**
 * Inserta una entrada en `audit_logs` sin propagar fallos.
 *
 * Decisión de diseño: la auditoría no debe invalidar una operación
 * criptográfica ya completada con éxito (el blob está cifrado y almacenado).
 * Un fallo aquí se reporta por consola y se deja constancia.
 *
 * RECOMENDACIÓN: para auditoría no repudiable, replicar este registro en un
 * trigger `AFTER INSERT` sobre `document_versions` en Postgres, de modo que no
 * dependa de la buena voluntad del cliente.
 */
async function writeAuditLog(
  userId: string,
  documentId: string | null,
  action: AuditAction,
  details: Json,
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      user_id: userId,
      document_id: documentId,
      action,
      details,
    });

    if (error) {
      // Si la clave foránea a documents falla (p. ej. al registrar DELETE tras eliminar la fila),
      // reintentamos con document_id: null pero manteniendo los detalles completos.
      if (documentId && (error.code === '23503' || error.message.includes('foreign key'))) {
        await supabase.from('audit_logs').insert({
          user_id: userId,
          document_id: null,
          action,
          details,
        });
        return;
      }
      console.warn(`[audit_logs] No se pudo registrar la acción "${action}":`, error.message);
    }
  } catch (cause) {
    console.warn(
      `[audit_logs] No se pudo registrar la acción "${action}":`,
      toErrorMessage(cause, 'error desconocido'),
    );
  }
}

/**
 * Entrega un `ArrayBuffer` ya descifrado al disco del usuario mediante una
 * object URL temporal y un `<a download>` sintético.
 */
function triggerBrowserDownload(
  plainBuffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): void {
  const blob = new Blob([plainBuffer], {
    type: mimeType.length > 0 ? mimeType : CIPHERTEXT_MIME,
  });
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, OBJECT_URL_TTL_MS);
}

/**
 * Compensa una subida a Storage cuando el registro transaccional posterior
 * falla, evitando blobs huérfanos que nadie podría volver a referenciar.
 */
async function rollbackStorageObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
  if (error) {
    console.warn(
      `[vault] Blob huérfano en "${storagePath}" (rollback fallido):`,
      error.message,
    );
  }
}

/**
 * Convierte un documento del catálogo en un descriptor listo para
 * `downloadAndDecrypt`. Devuelve `null` si el documento no tiene versiones.
 */
export function toVersionDescriptor(doc: VaultDocument): VaultVersionDescriptor | null {
  const version = doc.latestVersion;
  if (!version) {
    return null;
  }

  return {
    documentId: doc.id,
    versionId: version.id,
    versionNumber: version.version_number,
    storagePath: version.storage_path,
    iv: version.iv,
    sha256Hash: version.sha256_hash,
    fileName: doc.name,
    mimeType: doc.mimeType ?? CIPHERTEXT_MIME,
  };
}

// ---------------------------------------------------------------------------
// Contrato del store
// ---------------------------------------------------------------------------

export interface VaultState {
  /** Documentos del usuario, con los datos de su última versión resueltos. */
  documents: VaultDocument[];
  isLoading: boolean;
  /** Fase actual del pipeline de subida cifrada. */
  uploadStatus: UploadStatus;
  error: string | null;
}

export interface VaultActions {
  /** Carga `documents` + `document_versions` del usuario, más reciente primero. */
  fetchDocuments: () => Promise<void>;
  /**
   * Pipeline completo: resolver documento por nombre -> leer -> hashear ->
   * cifrar -> subir -> registrar versión -> auditar.
   *
   * Si `name` ya existe para el usuario se añade una versión secuencial
   * (`version_number = total + 1`) hasta un máximo de 3; superado el límite
   * falla con "Se ha alcanzado el límite máximo de 3 versiones…".
   * @returns El `id` del documento creado o versionado, o `null` si falló.
   */
  uploadDocument: (file: File, vaultKey: CryptoKey) => Promise<string | null>;
  /**
   * Pipeline inverso: descargar -> descifrar -> validar integridad ->
   * auditar -> entregar al disco del usuario.
   * @returns `true` si el archivo se descifró, validó y descargó.
   */
  downloadAndDecrypt: (
    versionData: VaultVersionDescriptor,
    vaultKey: CryptoKey,
  ) => Promise<boolean>;
  /**
   * Eliminación segura de un documento y sus versiones asociadas:
   * a) Obtiene todas las versiones para conocer sus storage_path.
   * b) Elimina los blobs .enc de Supabase Storage.
   * c) Elimina el registro de la tabla "documents" (cascada en document_versions).
   * d) Registra en la bitácora "audit_logs" la acción "DELETE".
   * e) Actualiza inmediatamente el estado local de documentos en el store.
   * @returns `true` si el documento fue eliminado con éxito.
   */
  deleteDocument: (documentId: string) => Promise<boolean>;
  /** Devuelve `uploadStatus` a `idle`. */
  resetUploadStatus: () => void;
  /** Limpia el último error registrado. */
  clearError: () => void;
  /** Vacía el catálogo en memoria (p. ej. al cerrar sesión). */
  reset: () => void;
}

export type VaultStore = VaultState & VaultActions;

const INITIAL_STATE: VaultState = {
  documents: [],
  isLoading: false,
  uploadStatus: 'idle',
  error: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useVaultStore = create<VaultStore>()((set, get) => ({
  ...INITIAL_STATE,

  fetchDocuments: async () => {
    set({ isLoading: true, error: null });

    try {
      const user = await requireUser();

      const { data: documentRows, error: documentsError } = await supabase
        .from('documents')
        .select('id, user_id, name, mime_type, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (documentsError) {
        throw documentsError;
      }

      const rows = documentRows ?? [];
      if (rows.length === 0) {
        set({ documents: [], isLoading: false, error: null });
        return;
      }

      const { data: versionRows, error: versionsError } = await supabase
        .from('document_versions')
        .select(
          'id, document_id, version_number, storage_path, sha256_hash, iv, file_size, created_at',
        )
        .in(
          'document_id',
          rows.map((row) => row.id),
        )
        // Orden cronológico: la historia de cada documento crece con `created_at`
        // (desempate determinista por `version_number`).
        .order('created_at', { ascending: true })
        .order('version_number', { ascending: true });

      if (versionsError) {
        throw versionsError;
      }

      // Agrupación por documento en orden cronológico ascendente, por lo que
      // la última de cada grupo es la más reciente (`latestVersion`).
      const versionsByDocument = new Map<string, DocumentVersion[]>();
      for (const version of versionRows ?? []) {
        const bucket = versionsByDocument.get(version.document_id);
        if (bucket) {
          bucket.push(version);
        } else {
          versionsByDocument.set(version.document_id, [version]);
        }
      }

      const documents: VaultDocument[] = rows.map((row) => {
        const versions = versionsByDocument.get(row.id) ?? [];
        const latestVersion = versions.length > 0 ? (versions[versions.length - 1] ?? null) : null;
        return {
          id: row.id,
          name: row.name,
          mimeType: row.mime_type,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          latestVersion,
          versionCount: versions.length,
        };
      });

      set({ documents, isLoading: false, error: null });
    } catch (cause) {
      set({
        isLoading: false,
        error: toErrorMessage(cause, 'No se pudieron cargar los documentos de la bóveda.'),
      });
    }
  },

  uploadDocument: async (file, vaultKey) => {
    set({ isLoading: true, uploadStatus: 'reading', error: null });

    // Se declara fuera del `try` para poder compensar la subida si el
    // registro en base de datos falla después.
    let uploadedPath: string | null = null;

    try {
      const user = await requireUser();

      // 0) Resolución del documento lógico por nombre (versionado por `name`
      //    y `user_id`). Si ya existe, la subida se asocia al `document_id`
      //    existente con el siguiente secuencial; si no, se crea uno nuevo.
      const { data: existingDocs, error: lookupError } = await supabase
        .from('documents')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('name', file.name)
        .limit(1);

      if (lookupError) {
        throw lookupError;
      }

      const existingDocumentId = existingDocs?.[0]?.id ?? null;
      let targetDocumentId: string;
      let nextVersionNumber: number;
      let isNewDocument = false;

      if (existingDocumentId) {
        const { data: existingVersions, error: versionsLookupError } = await supabase
          .from('document_versions')
          .select('version_number')
          .eq('document_id', existingDocumentId)
          .order('created_at', { ascending: true })
          .order('version_number', { ascending: true });

        if (versionsLookupError) {
          throw versionsLookupError;
        }

        const versionCount = existingVersions?.length ?? 0;

        if (versionCount >= MAX_VERSIONS) {
          throw new Error(
            'Se ha alcanzado el límite máximo de 3 versiones para este documento',
          );
        }

        targetDocumentId = existingDocumentId;
        // Secuencial: cantidad existente + 1 (v1 -> v2 -> v3).
        nextVersionNumber = versionCount + 1;
      } else {
        targetDocumentId = window.crypto.randomUUID();
        nextVersionNumber = FIRST_VERSION;
        isNewDocument = true;
      }

      // 1) Lectura del archivo en memoria.
      const plainBuffer = await file.arrayBuffer();

      // 2) Huella digital del TEXTO PLANO (referencia de integridad).
      set({ uploadStatus: 'hashing' });
      const sha256Hash = await computeSHA256(plainBuffer);

      // 3) Cifrado AES-GCM-256 con IV aleatorio único por versión.
      set({ uploadStatus: 'encrypting' });
      const { cipherBuffer, iv } = await encryptBuffer(plainBuffer, vaultKey);

      // 4) Subida del ciphertext. Para documentos nuevos el `documentId` se
      //    genera en cliente para construir la ruta antes de existir la fila;
      //    para versiones adicionales se reutiliza el `document_id` existente
      //    con el siguiente `vN.enc`.
      set({ uploadStatus: 'uploading' });
      const storagePath = `${user.id}/${targetDocumentId}/v${nextVersionNumber}.enc`;
      const mimeType = file.type.length > 0 ? file.type : CIPHERTEXT_MIME;

      const { error: storageError } = await supabase.storage
        .from(VAULT_BUCKET)
        .upload(storagePath, new Blob([cipherBuffer], { type: CIPHERTEXT_MIME }), {
          contentType: CIPHERTEXT_MIME,
          upsert: false,
        });

      if (storageError) {
        throw storageError;
      }
      uploadedPath = storagePath;

      // 5) Registro transaccional: documento (sólo si es nuevo) + versión.
      if (isNewDocument) {
        const { error: documentError } = await supabase.from('documents').insert({
          id: targetDocumentId,
          user_id: user.id,
          name: file.name,
          mime_type: mimeType,
        });

        if (documentError) {
          throw documentError;
        }
      } else {
        // Refresca `updated_at` (y tipo) para que el catálogo ordene por
        // actividad reciente tras cada nueva versión.
        const { error: touchError } = await supabase
          .from('documents')
          .update({ mime_type: mimeType, updated_at: new Date().toISOString() })
          .eq('id', targetDocumentId);

        if (touchError) {
          throw touchError;
        }
      }

      const { error: versionError } = await supabase.from('document_versions').insert({
        document_id: targetDocumentId,
        version_number: nextVersionNumber,
        storage_path: storagePath,
        sha256_hash: sha256Hash,
        iv,
        // Tamaño del texto plano: es el dato que la UI muestra al usuario.
        // El tamaño del ciphertext queda registrado en la auditoría.
        file_size: file.size,
      });

      if (versionError) {
        if (isNewDocument) {
          // Compensa la fila de `documents` para no dejar un documento sin
          // ninguna versión descargable.
          await supabase.from('documents').delete().eq('id', targetDocumentId);
        }
        throw versionError;
      }

      uploadedPath = null; // Transacción consolidada: ya no hay que compensar.

      // 6) Auditoría (no bloqueante).
      await writeAuditLog(user.id, targetDocumentId, 'UPLOAD', {
        file_name: file.name,
        mime_type: mimeType,
        version_number: nextVersionNumber,
        storage_path: storagePath,
        plaintext_size: file.size,
        ciphertext_size: cipherBuffer.byteLength,
        sha256: sha256Hash,
      });

      set({ uploadStatus: 'done', isLoading: false, error: null });

      // Refresca el catálogo para que la UI vea el documento recién creado.
      await get().fetchDocuments();

      return targetDocumentId;
    } catch (cause) {
      if (uploadedPath) {
        await rollbackStorageObject(uploadedPath);
      }

      set({
        uploadStatus: 'error',
        isLoading: false,
        error: toErrorMessage(cause, 'No se pudo cifrar y subir el documento.'),
      });

      return null;
    }
  },

  downloadAndDecrypt: async (versionData, vaultKey) => {
    set({ isLoading: true, error: null });

    try {
      const user = await requireUser();

      // 1) Descarga del blob cifrado.
      const { data: encryptedBlob, error: storageError } = await supabase.storage
        .from(VAULT_BUCKET)
        .download(versionData.storagePath);

      if (storageError) {
        throw storageError;
      }
      if (!encryptedBlob) {
        throw new Error('El blob cifrado no se encontró en el almacenamiento.');
      }

      const cipherBuffer = await encryptedBlob.arrayBuffer();

      // 2) Descifrado. AES-GCM rechaza automáticamente si el tag de
      //    autenticación no cuadra (clave incorrecta o ciphertext alterado).
      const plainBuffer = await decryptBuffer(cipherBuffer, vaultKey, versionData.iv);

      // 3) Verificación de integridad contra el hash almacenado.
      const actualHash = await computeSHA256(plainBuffer);
      if (actualHash !== versionData.sha256Hash) {
        await writeAuditLog(user.id, versionData.documentId, 'INTEGRITY_FAILURE', {
          version_id: versionData.versionId,
          version_number: versionData.versionNumber,
          storage_path: versionData.storagePath,
          expected_sha256: versionData.sha256Hash,
          actual_sha256: actualHash,
        });

        throw new Error(
          'Integridad comprometida: el SHA-256 del contenido descifrado no coincide con el registrado. Descarga abortada.',
        );
      }

      // 4) Auditoría del acceso al texto plano.
      await writeAuditLog(user.id, versionData.documentId, 'DOWNLOAD_DECRYPT', {
        version_id: versionData.versionId,
        version_number: versionData.versionNumber,
        storage_path: versionData.storagePath,
        file_name: versionData.fileName,
        plaintext_size: plainBuffer.byteLength,
        sha256: actualHash,
        integrity_verified: true,
      });

      // 5) Entrega al disco del usuario.
      triggerBrowserDownload(plainBuffer, versionData.fileName, versionData.mimeType);

      set({ isLoading: false, error: null });
      return true;
    } catch (cause) {
      set({
        isLoading: false,
        error: toErrorMessage(
          cause,
          'No se pudo descargar ni descifrar el documento. Verifica que la bóveda esté desbloqueada con la passphrase correcta.',
        ),
      });
      return false;
    }
  },

  deleteDocument: async (documentId: string) => {
    set({ isLoading: true, error: null });

    try {
      const user = await requireUser();
      const targetDoc = get().documents.find((doc) => doc.id === documentId);

      // a) Obtiene todas las versiones del documento para conocer sus storage_path.
      const { data: versions, error: versionsError } = await supabase
        .from('document_versions')
        .select('storage_path')
        .eq('document_id', documentId);

      if (versionsError) {
        throw versionsError;
      }

      // b) Elimina los blobs .enc correspondientes de Supabase Storage.
      const storagePaths = (versions ?? [])
        .map((version) => version.storage_path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(VAULT_BUCKET)
          .remove(storagePaths);

        if (storageError) {
          console.warn('[vault] Error al eliminar blobs de Storage:', storageError.message);
        }
      }

      // c) Elimina el registro de la tabla "documents" (las versiones en "document_versions" se eliminarán en cascada).
      const { error: deleteDocError } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId)
        .eq('user_id', user.id);

      if (deleteDocError) {
        throw deleteDocError;
      }

      // d) Registra en la tabla "audit_logs" la acción "DELETE" con el user_id y document_id.
      await writeAuditLog(user.id, documentId, 'DELETE', {
        file_name: targetDoc?.name ?? null,
        storage_paths_removed: storagePaths,
        version_count: storagePaths.length,
        deleted_at: new Date().toISOString(),
      });

      // e) Actualiza el estado local de documentos en el store para reflejar la eliminación inmediatamente.
      set((state) => ({
        documents: state.documents.filter((doc) => doc.id !== documentId),
        isLoading: false,
        error: null,
      }));

      return true;
    } catch (cause) {
      set({
        isLoading: false,
        error: toErrorMessage(cause, 'No se pudo eliminar el documento de la bóveda.'),
      });
      return false;
    }
  },

  resetUploadStatus: () => {
    set({ uploadStatus: 'idle' });
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));

// ---------------------------------------------------------------------------
// Selectores
// ---------------------------------------------------------------------------

/** `true` mientras haya una subida cifrada en curso. */
export const selectIsUploading = (state: VaultStore): boolean =>
  state.uploadStatus === 'reading' ||
  state.uploadStatus === 'hashing' ||
  state.uploadStatus === 'encrypting' ||
  state.uploadStatus === 'uploading';

/** Documentos que ya tienen al menos una versión cifrada descargable. */
export const selectDownloadableDocuments = (state: VaultStore): VaultDocument[] =>
  state.documents.filter((doc) => doc.latestVersion !== null);

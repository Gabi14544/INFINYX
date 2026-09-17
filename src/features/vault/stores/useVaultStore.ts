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
   * Pipeline completo: leer -> hashear -> cifrar -> subir -> registrar -> auditar.
   * @returns El `id` del documento creado, o `null` si la operación falló.
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
        .order('version_number', { ascending: false });

      if (versionsError) {
        throw versionsError;
      }

      // Agrupación por documento. Las versiones ya llegan en orden
      // descendente, por lo que la primera de cada grupo es la más reciente.
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
        return {
          id: row.id,
          name: row.name,
          mimeType: row.mime_type,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          latestVersion: versions[0] ?? null,
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

      // 1) Lectura del archivo en memoria.
      const plainBuffer = await file.arrayBuffer();

      // 2) Huella digital del TEXTO PLANO (referencia de integridad).
      set({ uploadStatus: 'hashing' });
      const sha256Hash = await computeSHA256(plainBuffer);

      // 3) Cifrado AES-GCM-256 con IV aleatorio único por versión.
      set({ uploadStatus: 'encrypting' });
      const { cipherBuffer, iv } = await encryptBuffer(plainBuffer, vaultKey);

      // 4) Subida del ciphertext. El `documentId` se genera en cliente para
      //    poder construir la ruta antes de existir la fila en `documents`.
      set({ uploadStatus: 'uploading' });
      const documentId = window.crypto.randomUUID();
      const storagePath = `${user.id}/${documentId}/v${FIRST_VERSION}.enc`;
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

      // 5) Registro transaccional: documento + versión inicial.
      const { data: documentRow, error: documentError } = await supabase
        .from('documents')
        .insert({
          id: documentId,
          user_id: user.id,
          name: file.name,
          mime_type: mimeType,
        })
        .select('id')
        .single();

      if (documentError) {
        throw documentError;
      }

      const { error: versionError } = await supabase.from('document_versions').insert({
        document_id: documentRow.id,
        version_number: FIRST_VERSION,
        storage_path: storagePath,
        sha256_hash: sha256Hash,
        iv,
        // Tamaño del texto plano: es el dato que la UI muestra al usuario.
        // El tamaño del ciphertext queda registrado en la auditoría.
        file_size: file.size,
      });

      if (versionError) {
        // Compensa la fila de `documents` para no dejar un documento sin
        // ninguna versión descargable.
        await supabase.from('documents').delete().eq('id', documentId);
        throw versionError;
      }

      uploadedPath = null; // Transacción consolidada: ya no hay que compensar.

      // 6) Auditoría (no bloqueante).
      await writeAuditLog(user.id, documentId, 'UPLOAD', {
        file_name: file.name,
        mime_type: mimeType,
        version_number: FIRST_VERSION,
        storage_path: storagePath,
        plaintext_size: file.size,
        ciphertext_size: cipherBuffer.byteLength,
        sha256: sha256Hash,
      });

      set({ uploadStatus: 'done', isLoading: false, error: null });

      // Refresca el catálogo para que la UI vea el documento recién creado.
      await get().fetchDocuments();

      return documentId;
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

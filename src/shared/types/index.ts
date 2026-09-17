/**
 * index.ts (shared/types)
 * ---------------------------------------------------------------------------
 * Tipos de dominio de la bóveda, derivados del contrato real de la base de
 * datos declarado en `./database.ts`.
 *
 * Los alias `Profile`, `Document`, `DocumentVersion` y `AuditLog` son
 * proyecciones directas de las filas de Postgres, de modo que cualquier
 * cambio en el esquema se propague automáticamente a toda la aplicación.
 * ---------------------------------------------------------------------------
 */

export type {
  Database,
  Json,
  TableRow,
  TableInsert,
  TableUpdate,
  ProfileRow,
  ProfileInsert,
  DocumentRow,
  DocumentInsert,
  DocumentVersionRow,
  DocumentVersionInsert,
  AuditLogRow,
  AuditLogInsert,
} from './database';

export { VAULT_BUCKET } from './database';

import type {
  AuditLogRow,
  DocumentRow,
  DocumentVersionRow,
  ProfileRow,
} from './database';

/** Perfil público del usuario (nunca contiene material criptográfico). */
export type Profile = ProfileRow;

/** Documento lógico de la bóveda; el contenido vive cifrado en Storage. */
export type Document = DocumentRow;

/** Versión inmutable de un documento: apunta a un blob cifrado concreto. */
export type DocumentVersion = DocumentVersionRow;

/** Entrada de la bitácora de auditoría. */
export type AuditLog = AuditLogRow;

/**
 * Acciones auditables registradas en `audit_logs.action`.
 *
 * La columna es `text` (no un ENUM de Postgres), por lo que esta unión actúa
 * como la única fuente de verdad en el cliente para evitar cadenas libres.
 */
export type AuditAction =
  | 'UPLOAD'
  | 'DOWNLOAD_DECRYPT'
  | 'INTEGRITY_FAILURE'
  | 'DELETE';

/**
 * Documento enriquecido con los datos de su última versión, tal y como lo
 * consume la UI de la bóveda.
 */
export interface VaultDocument {
  id: string;
  name: string;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
  /** Versión más reciente (mayor `version_number`) o `null` si no hay ninguna. */
  latestVersion: DocumentVersion | null;
  /** Número total de versiones registradas para el documento. */
  versionCount: number;
}

/**
 * Descriptor autocontenido de una versión: reúne todo lo necesario para
 * descargar, descifrar, validar integridad y nombrar el archivo resultante.
 */
export interface VaultVersionDescriptor {
  documentId: string;
  versionId: string;
  versionNumber: number;
  /** Ruta dentro del bucket `vault_files`. */
  storagePath: string;
  /** IV AES-GCM en hexadecimal usado al cifrar esta versión. */
  iv: string;
  /** SHA-256 esperado del texto plano, para verificación de integridad. */
  sha256Hash: string;
  /** Nombre con el que se entregará el archivo descifrado al usuario. */
  fileName: string;
  mimeType: string;
}

/** Fases del pipeline de subida cifrada, para feedback granular en la UI. */
export type UploadStatus =
  | 'idle'
  | 'reading'
  | 'hashing'
  | 'encrypting'
  | 'uploading'
  | 'done'
  | 'error';

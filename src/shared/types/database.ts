/**
 * database.ts
 * ---------------------------------------------------------------------------
 * Contrato de tipos del esquema `public` de Supabase/PostgreSQL.
 *
 * Este tipo se inyecta en `createClient<Database>()` para que TODAS las
 * consultas (`select`, `insert`, `update`) queden tipadas de forma estricta:
 * columnas inexistentes o tipos incorrectos fallan en tiempo de compilación.
 *
 * Esquema real verificado contra el proyecto Supabase:
 *
 *   profiles(id uuid PK, email text, created_at timestamptz)
 *   documents(id uuid PK, user_id uuid, name text, mime_type text,
 *             created_at timestamptz, updated_at timestamptz)
 *   document_versions(id uuid PK, document_id uuid FK -> documents.id,
 *                     version_number int4, storage_path text,
 *                     sha256_hash text, iv text, file_size int8,
 *                     created_at timestamptz)
 *   audit_logs(id uuid PK, user_id uuid, document_id uuid,
 *              action text, details jsonb, created_at timestamptz)
 *
 * Storage bucket: `vault_files`
 *
 * NOTA IMPORTANTE (Zero-Knowledge): ninguna columna almacena passphrases,
 * claves derivadas ni frases de recuperación. `iv` y `sha256_hash` son
 * metadatos públicos por diseño (el IV no es secreto en AES-GCM y el hash
 * sólo sirve para verificar integridad del texto plano tras descifrar).
 * ---------------------------------------------------------------------------
 */

/** Valor JSON serializable admitido por columnas `json` / `jsonb`. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          created_at: string;
          /** Verificador PBKDF2-SHA256 (hex) de la contraseña de descarga. */
          download_verifier: string | null;
          /** Salt aleatorio (hex) usado para derivar `download_verifier`. */
          download_salt: string | null;
        };
        Insert: {
          /** Debe coincidir con `auth.users.id` (política RLS `id = auth.uid()`). */
          id: string;
          email?: string | null;
          created_at?: string;
          download_verifier?: string | null;
          download_salt?: string | null;
        };
        Update: {
          id?: string;
          email?: string | null;
          created_at?: string;
          download_verifier?: string | null;
          download_salt?: string | null;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          mime_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          /**
           * Se envía explícitamente desde el cliente para poder construir la
           * ruta de Storage (`{user_id}/{document_id}/v1.enc`) ANTES de que
           * exista la fila en base de datos.
           */
          id?: string;
          user_id: string;
          name: string;
          mime_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          mime_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_versions: {
        Row: {
          id: string;
          document_id: string;
          version_number: number;
          storage_path: string;
          sha256_hash: string;
          iv: string;
          file_size: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          version_number: number;
          storage_path: string;
          /** SHA-256 (hex) del TEXTO PLANO, calculado antes de cifrar. */
          sha256_hash: string;
          /** IV AES-GCM de 12 bytes en hexadecimal, único por versión. */
          iv: string;
          file_size: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          version_number?: number;
          storage_path?: string;
          sha256_hash?: string;
          iv?: string;
          file_size?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          document_id: string | null;
          action: string;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          document_id?: string | null;
          action: string;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          document_id?: string | null;
          action?: string;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// ---------------------------------------------------------------------------
// Alias utilitarios por tabla (Row / Insert / Update)
// ---------------------------------------------------------------------------

type PublicTables = Database['public']['Tables'];

export type TableRow<T extends keyof PublicTables> = PublicTables[T]['Row'];
export type TableInsert<T extends keyof PublicTables> = PublicTables[T]['Insert'];
export type TableUpdate<T extends keyof PublicTables> = PublicTables[T]['Update'];

export type ProfileRow = TableRow<'profiles'>;
export type ProfileInsert = TableInsert<'profiles'>;

export type DocumentRow = TableRow<'documents'>;
export type DocumentInsert = TableInsert<'documents'>;

export type DocumentVersionRow = TableRow<'document_versions'>;
export type DocumentVersionInsert = TableInsert<'document_versions'>;

export type AuditLogRow = TableRow<'audit_logs'>;
export type AuditLogInsert = TableInsert<'audit_logs'>;

/** Nombre del bucket privado de Supabase Storage que guarda los blobs cifrados. */
export const VAULT_BUCKET = 'vault_files' as const;

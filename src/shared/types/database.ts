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
          vault_salt: string;
        };
        Insert: {
          /** Debe coincidir con `auth.users.id` (política RLS `id = auth.uid()`). */
          id: string;
          email?: string | null;
          created_at?: string;
          vault_salt?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          created_at?: string;
          vault_salt?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          deleting: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          /**
           * Se envía explícitamente desde el cliente para poder construir la
           * ruta de Storage aleatoria e inmutable ANTES de que
           * exista la fila en base de datos.
           */
          id?: string;
          user_id: string;
          deleting?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          deleting?: boolean;
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
          encrypted_metadata: string;
          iv: string;

          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          version_number: number;
          storage_path: string;
          encrypted_metadata: string;
          /** IV AES-GCM de 12 bytes en hexadecimal, único por versión. */
          iv: string;

          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          version_number?: number;
          storage_path?: string;
          encrypted_metadata?: string;
          iv?: string;

          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
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
            foreignKeyName: "audit_logs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      commit_vault_version: {
        Args: {
          p_document_id: string;
          p_version_number: number;
          p_storage_path: string;
          p_iv: string;
          p_metadata: string;
        };
        Returns: string;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// ---------------------------------------------------------------------------
// Alias utilitarios por tabla (Row / Insert / Update)
// ---------------------------------------------------------------------------

type PublicTables = Database["public"]["Tables"];

export type TableRow<T extends keyof PublicTables> = PublicTables[T]["Row"];
export type TableInsert<T extends keyof PublicTables> =
  PublicTables[T]["Insert"];
export type TableUpdate<T extends keyof PublicTables> =
  PublicTables[T]["Update"];

export type ProfileRow = TableRow<"profiles">;
export type ProfileInsert = TableInsert<"profiles">;

export type DocumentRow = TableRow<"documents">;
export type DocumentInsert = TableInsert<"documents">;

export type DocumentVersionRow = TableRow<"document_versions">;
export type DocumentVersionInsert = TableInsert<"document_versions">;

export type AuditLogRow = TableRow<"audit_logs">;
export type AuditLogInsert = TableInsert<"audit_logs">;

/** Nombre del bucket privado de Supabase Storage que guarda los blobs cifrados. */
export const VAULT_BUCKET = "vault_files" as const;

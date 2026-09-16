export type DocumentStatus = 'active' | 'archived' | 'deleted';

export interface Document {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  is_encrypted: boolean;
  status: DocumentStatus;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  size_bytes: number;
  sha256_hash: string;
  encryption_iv: string;
  encryption_salt: string | null;
  created_by: string;
  created_at: string;
}

export type AuditAction =
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'document.downloaded'
  | 'document.shared'
  | 'auth.login'
  | 'auth.logout';

export interface AuditLog {
  id: string;
  user_id: string | null;
  document_id: string | null;
  action: AuditAction;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

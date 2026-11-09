import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import { deriveKey } from '../../../../core/crypto/vaultCrypto';
import type { VaultDocument } from '../../../../shared/types';
import { useAuthStore } from '../../../auth/stores/useAuthStore';
import { useDownloadAuthStore } from '../useDownloadAuthStore';
import { useVaultStore } from '../useVaultStore';

const mocks = vi.hoisted(() => {
  let versionRows: Array<{ document_id: string; storage_path: string; version_number?: number }> = [];
  let documentRows: Array<{ id: string; user_id: string; name: string; mime_type: string; created_at: string; updated_at: string }> = [];

  return {
    userId: '11111111-2222-3333-4444-555555555555',
    insertDocument: vi.fn().mockResolvedValue({ error: null }),
    insertVersion: vi.fn().mockResolvedValue({ error: null }),
    insertAudit: vi.fn().mockResolvedValue({ error: null }),
    deleteDocuments: vi.fn().mockResolvedValue({ error: null }),
    storageUpload: vi.fn().mockResolvedValue({ error: null }),
    storageRemove: vi.fn().mockResolvedValue({ error: null }),
    getVersionRows: () => versionRows,
    setVersionRows: (rows: Array<{ document_id: string; storage_path: string; version_number?: number }>) => {
      versionRows = rows;
    },
    getDocumentRows: () => documentRows,
    setDocumentRows: (rows: Array<{ id: string; user_id: string; name: string; mime_type: string; created_at: string; updated_at: string }>) => {
      documentRows = rows;
    },
  };
});

vi.mock('../../../../shared/lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: mocks.userId } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'documents') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
                order: vi.fn(() => ({
                  order: vi.fn().mockImplementation(() =>
                    Promise.resolve({ data: mocks.getDocumentRows(), error: null }),
                  ),
                })),
              })),
            })),
            insert: mocks.insertDocument,
            delete: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: mocks.deleteDocuments,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          };
        }

        if (table === 'document_versions') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockImplementation(() =>
                    Promise.resolve({ data: mocks.getVersionRows(), error: null }),
                  ),
                })),
                then: (resolve: (val: unknown) => unknown) =>
                  Promise.resolve({ data: mocks.getVersionRows(), error: null }).then(resolve),
              })),
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
            insert: mocks.insertVersion,
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: mocks.insertAudit,
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: mocks.storageUpload,
          remove: mocks.storageRemove,
        })),
      },
    },
  };
});

describe('useVaultStore - Subida y Borrado en Lote', () => {
  let vaultKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    useVaultStore.getState().reset();
    useDownloadAuthStore.getState().reset();

    const salt = new Uint8Array(16);
    window.crypto.getRandomValues(salt);
    vaultKey = await deriveKey('TestPassphrase-Batch-2026!', salt);

    const testUser = {
      id: mocks.userId,
      email: 'test@infinyx.com',
    } as unknown as User;

    useAuthStore.setState({
      user: testUser,
      session: { user: testUser } as unknown as Session,
      vaultKey,
    });

    mocks.setDocumentRows([]);
    mocks.setVersionRows([]);
  });

  describe('deleteDocumentsBatch', () => {
    it('bloquea y rechaza la eliminación si la contraseña de descarga no está en RAM', async () => {
      const initialDocs: VaultDocument[] = [
        {
          id: 'doc-1',
          name: 'contrato.pdf',
          mimeType: 'application/pdf',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          latestVersion: null,
          versionCount: 1,
        },
      ];
      useVaultStore.setState({ documents: initialDocs });

      // downloadSessionPassword es null en este momento
      expect(useDownloadAuthStore.getState().hasDownloadSessionPassword()).toBe(false);

      const success = await useVaultStore.getState().deleteDocumentsBatch(['doc-1']);

      expect(success).toBe(false);
      expect(useVaultStore.getState().error).toContain('Operación bloqueada');
      expect(useVaultStore.getState().documents).toHaveLength(1);
    });

    it('elimina múltiples documentos de Storage y BD cuando la sesión está autorizada', async () => {
      const doc1: VaultDocument = {
        id: 'doc-1',
        name: 'contrato.pdf',
        mimeType: 'application/pdf',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        latestVersion: null,
        versionCount: 1,
      };
      const doc2: VaultDocument = {
        id: 'doc-2',
        name: 'balance.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        latestVersion: null,
        versionCount: 1,
      };
      const doc3: VaultDocument = {
        id: 'doc-3',
        name: 'manual.pdf',
        mimeType: 'application/pdf',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        latestVersion: null,
        versionCount: 1,
      };

      useVaultStore.setState({ documents: [doc1, doc2, doc3] });
      mocks.setVersionRows([
        { document_id: 'doc-1', storage_path: `${mocks.userId}/doc-1/v1.enc` },
        { document_id: 'doc-2', storage_path: `${mocks.userId}/doc-2/v1.enc` },
      ]);

      // Autorizamos la contraseña de descarga en RAM
      useDownloadAuthStore.getState().setDownloadSessionPassword('AuthSecret123!');
      expect(useDownloadAuthStore.getState().hasDownloadSessionPassword()).toBe(true);

      const success = await useVaultStore.getState().deleteDocumentsBatch(['doc-1', 'doc-2']);

      expect(success).toBe(true);
      expect(mocks.storageRemove).toHaveBeenCalledWith([
        `${mocks.userId}/doc-1/v1.enc`,
        `${mocks.userId}/doc-2/v1.enc`,
      ]);
      expect(mocks.deleteDocuments).toHaveBeenCalled();
      expect(mocks.insertAudit).toHaveBeenCalled();

      // Verifica que el estado local de Zustand refleje de inmediato sólo doc-3
      const remainingDocs = useVaultStore.getState().documents;
      expect(remainingDocs).toHaveLength(1);
      expect(remainingDocs[0]?.id).toBe('doc-3');
    });
  });

  describe('uploadDocumentsBatch', () => {
    it('procesa una carpeta de múltiples archivos secuencialmente actualizando batchUploadProgress y guardando la ruta relativa', async () => {
      const file1 = new File(['contenido de prueba 1'], 'contrato.pdf', {
        type: 'application/pdf',
      });
      const file2 = new File(['contenido de prueba 2'], 'balance.xlsx', {
        type: 'application/vnd.ms-excel',
      });

      const batchItems = [
        { file: file1, logicalName: 'Clientes/2026/contrato.pdf' },
        { file: file2, logicalName: 'Clientes/2026/balance.xlsx' },
      ];

      const progressSnapshots: Array<{ current: number; total: number; currentFileName: string }> = [];

      // Nos suscribimos a useVaultStore para verificar que batchUploadProgress se actualice
      const unsubscribe = useVaultStore.subscribe((state) => {
        if (state.batchUploadProgress) {
          const last = progressSnapshots[progressSnapshots.length - 1];
          const curr = state.batchUploadProgress;
          if (!last || last.current !== curr.current || last.currentFileName !== curr.currentFileName) {
            progressSnapshots.push({ ...curr });
          }
        }
      });

      const result = await useVaultStore.getState().uploadDocumentsBatch(batchItems, vaultKey);
      unsubscribe();

      expect(result.failedFiles).toHaveLength(0);
      expect(result.uploadedIds).toHaveLength(2);

      // Verificamos que se hayan emitido los progresos para archivo 1 y archivo 2
      expect(progressSnapshots.length).toBeGreaterThanOrEqual(2);
      expect(progressSnapshots[0]?.currentFileName).toBe('Clientes/2026/contrato.pdf');
      expect(progressSnapshots[0]?.total).toBe(2);

      // Verificamos que los nombres lógicos con carpeta se enviaran a documents.insert
      const insertedNames = mocks.insertDocument.mock.calls.map(
        (call: unknown[]) => (call[0] as { name: string }).name,
      );
      expect(insertedNames).toContain('Clientes/2026/contrato.pdf');
      expect(insertedNames).toContain('Clientes/2026/balance.xlsx');

      // Verificamos que el estado final sea 'done'
      expect(useVaultStore.getState().uploadStatus).toBe('done');
    });
  });
});

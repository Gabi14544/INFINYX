/**
 * DocumentRow.tsx
 * ---------------------------------------------------------------------------
 * Fila del catálogo institucional "Private Wealth":
 *
 *   1) "Descargar archivo": botón sólido negro ébano con flujo gateado
 *      por la contraseña de descarga en RAM (vía `onDownload` del dashboard).
 *   2) "Visualizar": botón secundario porcelana/blanco que abre modal centrado
 *      (`DocumentPreviewModal`) fuera de la tabla (portal a body), mostrando
 *      metadatos, tipo de archivo y copiado de huella SHA-256.
 *   3) "Eliminar": botón discreto con hover destructivo refinado que abre
 *      `DeleteDocumentModal` (portal a body) para confirmación y autorización en RAM.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import { Download, Eye, FileText, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import type { VaultDocument } from '../../../shared/types';
import DeleteDocumentModal from './DeleteDocumentModal';
import DocumentPreviewModal from './DocumentPreviewModal';
import { formatDate, formatSize, shortHash } from '../utils/formatters';

interface DocumentRowProps {
  doc: VaultDocument;
  downloading: string | null;
  onDownload: (doc: VaultDocument) => void;
}

export default function DocumentRow({ doc, downloading, onDownload }: DocumentRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const version = doc.latestVersion;
  const isBusy = downloading === doc.id;

  return (
    <>
      <tr className="transition hover:bg-[#FAF9F5]">
        {/* Columna Nombre del archivo */}
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] text-[#5C5043]">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="max-w-[220px] truncate text-sm font-medium text-[#181816] sm:max-w-xs md:max-w-sm"
                title={doc.name}
              >
                {doc.name}
              </span>
              <span title="Cifrado AES-GCM-256 verificado" className="inline-flex shrink-0">
                <ShieldCheck className="h-4 w-4 text-[#6E6053]" />
              </span>
            </div>
          </div>
        </td>

        {/* Columna Versión (Pastilla Bronce Topo) */}
        <td className="whitespace-nowrap px-4 py-4">
          <span className="inline-flex items-center rounded-full bg-[#6E6053] px-2.5 py-0.5 font-mono text-xs font-medium text-white shadow-2xs">
            v{version?.version_number ?? '—'}
          </span>
        </td>

        {/* Columna Huella SHA-256 */}
        <td className="whitespace-nowrap px-4 py-4">
          {version ? (
            <span className="font-mono text-xs text-[#6E6A63]" title={version.sha256_hash}>
              {shortHash(version.sha256_hash)}
            </span>
          ) : (
            <span className="text-xs text-[#9E9A91]">sin versión</span>
          )}
        </td>

        {/* Columna Tamaño */}
        <td className="whitespace-nowrap px-4 py-4 text-sm text-[#4A4740]">
          {version ? formatSize(version.file_size) : '—'}
        </td>

        {/* Columna Fecha */}
        <td className="whitespace-nowrap px-4 py-4 text-sm text-[#4A4740]">
          {version ? formatDate(version.created_at) : formatDate(doc.createdAt)}
        </td>

        {/* Columna de Acciones (3 botones limpios y elegantes) */}
        <td className="whitespace-nowrap px-6 py-4">
          <div className="flex items-center justify-end gap-2">
            {/* 1. Descargar archivo */}
            <button
              type="button"
              onClick={() => onDownload(doc)}
              disabled={!version || isBusy}
              title="Descargar archivo"
              aria-label={`Descargar archivo ${doc.name}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#141413] bg-[#141413] px-3 py-1.5 text-xs font-medium text-white shadow-2xs transition hover:bg-[#2B2A27] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Descifrando…
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </>
              )}
            </button>

            {/* 2. Visualizar */}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              aria-label={`Visualizar ${doc.name}`}
              title="Visualizar"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCD9D0] bg-white px-3 py-1.5 text-xs font-medium text-[#181816] shadow-2xs transition hover:bg-[#F5F4EF]"
            >
              <Eye className="h-3.5 w-3.5 text-[#5C5043]" />
              Visualizar
            </button>

            {/* 3. Eliminar */}
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={isBusy}
              aria-label={`Eliminar ${doc.name}`}
              title="Eliminar documento"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E4DD] bg-white px-2.5 py-1.5 text-xs font-medium text-[#8C867B] shadow-2xs transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </button>
          </div>
        </td>
      </tr>

      {/* Modal centrado de visualización de metadatos (portal fuera de la tabla) */}
      <DocumentPreviewModal
        doc={doc}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      {/* Modal de confirmación y autorización para eliminación segura */}
      <DeleteDocumentModal
        doc={doc}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}

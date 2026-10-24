/**
 * DocumentRow.tsx
 * ---------------------------------------------------------------------------
 * Fila del catálogo institucional INFINYX (Soporte Dual: Modo Claro / Oscuro):
 *
 *   1) "Descargar archivo": botón estilizado con flujo gateado
 *      por la contraseña de descarga en RAM (vía `onDownload` del dashboard).
 *   2) "Visualizar": botón secundario que abre modal centrado
 *      (`DocumentPreviewModal`) fuera de la tabla (portal a body), mostrando
 *      metadatos, tipo de archivo y copiado de huella SHA-256.
 *   3) "Eliminar": botón con hover destructivo refinado que abre
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
      <tr className="border-t border-slate-200 transition hover:bg-slate-50/80 dark:border-[#1E293B]/70 dark:hover:bg-[#111827]/70">
        {/* Columna Nombre del archivo */}
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/25 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="max-w-[220px] truncate text-sm font-medium text-[#0F172A] sm:max-w-xs md:max-w-sm dark:text-[#F8FAFC]"
                title={doc.name}
              >
                {doc.name}
              </span>
              <span title="Cifrado AES-GCM-256 verificado" className="inline-flex shrink-0">
                <ShieldCheck className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />
              </span>
            </div>
          </div>
        </td>

        {/* Columna Versión (Pastilla Seis Ojos Adaptable) */}
        <td className="whitespace-nowrap px-4 py-4">
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-mono text-xs font-medium text-sky-800 dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#BAE6FD]">
            v{version?.version_number ?? '—'}
          </span>
        </td>

        {/* Columna Huella SHA-256 */}
        <td className="whitespace-nowrap px-4 py-4">
          {version ? (
            <span className="font-mono text-xs text-slate-500 dark:text-[#94A3B8]" title={version.sha256_hash}>
              {shortHash(version.sha256_hash)}
            </span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-[#64748B]">sin versión</span>
          )}
        </td>

        {/* Columna Tamaño */}
        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500 dark:text-[#94A3B8]">
          {version ? formatSize(version.file_size) : '—'}
        </td>

        {/* Columna Fecha */}
        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500 dark:text-[#94A3B8]">
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#38BDF8]/40 dark:bg-[#0284C7]/20 dark:text-[#BAE6FD] dark:hover:bg-[#0284C7]/35"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0284C7] dark:text-[#38BDF8]" />
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-400 hover:text-sky-800 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD]"
            >
              <Eye className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
              Visualizar
            </button>

            {/* 3. Eliminar */}
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={isBusy}
              aria-label={`Eliminar ${doc.name}`}
              title="Eliminar documento"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300 dark:hover:border-red-500/50 dark:hover:bg-red-500/20"
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

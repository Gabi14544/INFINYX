/**
 * DocumentRow.tsx
 * ---------------------------------------------------------------------------
 * Fila del catálogo con EXACTAMENTE 2 acciones por archivo:
 *
 *   1) "Descargar archivo": botón con icono que ejecuta el flujo gateado
 *      por la contraseña de descarga en RAM (vía `onDownload` del dashboard).
 *   2) "Visualizar": botón con icono que abre un modal centrado y limpio
 *      (`DocumentPreviewModal`) fuera del árbol de la tabla (portal a body),
 *      mostrando metadatos: tipo de archivo, huella SHA-256 completa con copiado,
 *      tamaño, versión y fecha de custodia.
 *
 * No existe ninguna otra acción por archivo. No hay popovers atrapados dentro
 * de <td> que causen barras de scroll o desbordamientos.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import type { VaultDocument } from '../../../shared/types';
import DocumentPreviewModal from './DocumentPreviewModal';
import { formatDate, formatSize, shortHash } from '../utils/formatters';

interface DocumentRowProps {
  doc: VaultDocument;
  downloading: string | null;
  onDownload: (doc: VaultDocument) => void;
}

export default function DocumentRow({ doc, downloading, onDownload }: DocumentRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const version = doc.latestVersion;
  const isBusy = downloading === doc.id;

  return (
    <>
      <tr className="border-t border-zinc-800 transition hover:bg-slate-800/40">
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20">
              <FileText className="h-4 w-4 text-blue-400" />
            </span>
            <span
              className="max-w-[240px] truncate text-sm font-medium text-white sm:max-w-xs"
              title={doc.name}
            >
              {doc.name}
            </span>
          </div>
        </td>

        <td className="whitespace-nowrap px-4 py-3.5">
          <span className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
            v{version?.version_number ?? '—'}
          </span>
        </td>

        <td className="whitespace-nowrap px-4 py-3.5">
          {version ? (
            <span className="font-mono text-xs text-zinc-400" title={version.sha256_hash}>
              {shortHash(version.sha256_hash)}
            </span>
          ) : (
            <span className="text-xs text-zinc-600">sin versión</span>
          )}
        </td>

        <td className="whitespace-nowrap px-4 py-3.5 text-sm text-zinc-400">
          {version ? formatSize(version.file_size) : '—'}
        </td>

        <td className="whitespace-nowrap px-4 py-3.5 text-sm text-zinc-400">
          {version ? formatDate(version.created_at) : formatDate(doc.createdAt)}
        </td>

        {/* Columna de acciones: EXACTAMENTE 2 opciones. */}
        <td className="whitespace-nowrap px-5 py-3.5">
          <div className="flex items-center justify-end gap-2">
            {/* Acción 1/2: Descargar archivo */}
            <button
              type="button"
              onClick={() => onDownload(doc)}
              disabled={!version || isBusy}
              title="Descargar archivo"
              aria-label={`Descargar archivo ${doc.name}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Descifrando…
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Descargar archivo
                </>
              )}
            </button>

            {/* Acción 2/2: Visualizar (abre el modal centrado) */}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              aria-label={`Visualizar ${doc.name}`}
              title="Visualizar"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20"
            >
              <Eye className="h-3.5 w-3.5" />
              Visualizar
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
    </>
  );
}

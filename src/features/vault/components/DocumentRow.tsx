/**
 * DocumentRow.tsx
 * ---------------------------------------------------------------------------
 * Fila del catálogo con EXACTAMENTE 2 acciones por archivo:
 *
 *   1) "Descargar archivo": botón con icono que ejecuta el flujo gateado
 *      por la contraseña de descarga en RAM (vía `onDownload` del dashboard).
 *   2) "Visualizar": botón + nombre del archivo con hover (tooltip/popover)
 *      que muestra un cuadro flotante con la previsualización de metadatos:
 *      tipo de archivo, huella SHA-256 completa, tamaño y fecha de custodia.
 *
 * No existe ninguna otra acción por archivo: el antiguo botón de copiar hash
 * se eliminó; la huella completa vive dentro del popover de visualización.
 *
 * Nota Zero-Knowledge: la previsualización muestra metadatos ya conocidos
 * por el catálogo (el servidor sólo guarda blobs cifrados). El contenido en
 * claro nunca se expone sin pasar por descargar + descifrar en RAM.
 * ---------------------------------------------------------------------------
 */

import { Download, Eye, FileText, Loader2, ShieldCheck } from 'lucide-react';
import type { VaultDocument } from '../../../shared/types';

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 10)}…` : hash;
}

interface DocumentRowProps {
  doc: VaultDocument;
  downloading: string | null;
  onDownload: (doc: VaultDocument) => void;
}

/** Cuadro flotante compartido por el hover del nombre y del botón Visualizar. */
function PreviewPopover({ doc }: { doc: VaultDocument }) {
  const version = doc.latestVersion;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-80 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-left shadow-2xl shadow-black/60 group-hover:block"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        Vista previa en custodia
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-white" title={doc.name}>
        {doc.name}
      </p>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-zinc-500">Tipo de archivo</dt>
          <dd className="truncate font-mono text-zinc-200" title={doc.mimeType ?? 'desconocido'}>
            {doc.mimeType ?? 'desconocido'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-zinc-500">Tamaño</dt>
          <dd className="text-zinc-200">{version ? formatSize(version.file_size) : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-zinc-500">Fecha de custodia</dt>
          <dd className="text-zinc-200">
            {version ? formatDateTime(version.created_at) : formatDateTime(doc.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-zinc-500">Versión</dt>
          <dd className="font-mono text-zinc-200">v{version?.version_number ?? '—'}</dd>
        </div>
      </dl>
      <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Huella SHA-256 completa
        </p>
        <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-emerald-300">
          {version?.sha256_hash ?? 'sin versión'}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Previsualización de metadatos: el contenido en claro sólo se revela al
        descargar y descifrar en RAM (Zero-Knowledge).
      </p>
    </div>
  );
}

export default function DocumentRow({ doc, downloading, onDownload }: DocumentRowProps) {
  const version = doc.latestVersion;
  const isBusy = downloading === doc.id;

  return (
    <tr className="border-t border-zinc-800 transition hover:bg-slate-800/40">
      <td className="px-4 py-3.5">
        {/* Hover sobre el nombre también dispara la previsualización. */}
        <div className="group relative flex w-fit items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20">
            <FileText className="h-4 w-4 text-blue-400" />
          </span>
          <span
            className="max-w-[220px] cursor-help truncate text-sm font-medium text-white underline-offset-4 hover:underline"
            title={doc.name}
          >
            {doc.name}
          </span>
          <PreviewPopover doc={doc} />
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
          v{version?.version_number ?? '—'}
        </span>
      </td>
      <td className="px-4 py-3.5">
        {version ? (
          <span className="font-mono text-xs text-zinc-400" title={version.sha256_hash}>
            {shortHash(version.sha256_hash)}
          </span>
        ) : (
          <span className="text-xs text-zinc-600">sin versión</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-sm text-zinc-400">
        {version ? formatSize(version.file_size) : '—'}
      </td>
      <td className="px-4 py-3.5 text-sm text-zinc-400">
        {version ? formatDate(version.created_at) : formatDate(doc.createdAt)}
      </td>
      {/* Columna de acciones: EXACTAMENTE 2 opciones. */}
      <td className="px-4 py-3.5">
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

          {/* Acción 2/2: Visualizar (hover -> popover flotante). */}
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label={`Visualizar ${doc.name}`}
              title="Visualizar"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20"
            >
              <Eye className="h-3.5 w-3.5" />
              Visualizar
            </button>
            <PreviewPopover doc={doc} />
          </span>
        </div>
      </td>
    </tr>
  );
}

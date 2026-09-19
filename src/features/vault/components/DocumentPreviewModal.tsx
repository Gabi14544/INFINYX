/**
 * DocumentPreviewModal.tsx
 * ---------------------------------------------------------------------------
 * Modal centrado y accesible para visualizar los metadatos de custodia de un
 * documento Zero-Knowledge:
 *  - Nombre del archivo
 *  - Versión
 *  - Huella SHA-256 completa con botón de copiado rápido al portapapeles
 *  - Tamaño formateado
 *  - Tipo MIME
 *  - Fecha y hora exacta de custodia
 *
 * Se renderiza mediante un Portal en el document.body con z-50 y backdrop
 * semitransparente, evitando cualquier confinamiento o desbordamiento (scrollbars)
 * en la tabla del catálogo.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Eye, ShieldCheck, X } from 'lucide-react';
import type { VaultDocument } from '../../../shared/types';
import { formatDateTime, formatSize } from '../utils/formatters';

interface DocumentPreviewModalProps {
  doc: VaultDocument | null;
  open: boolean;
  onClose: () => void;
}

export default function DocumentPreviewModal({
  doc,
  open,
  onClose,
}: DocumentPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    setCopied(false);
    onClose();
  };

  // Cierre con la tecla Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !doc) return null;

  const version = doc.latestVersion;
  const hash = version?.sha256_hash ?? '';

  const handleCopyHash = async () => {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback si el portapapeles no está disponible
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-slate-900 shadow-2xl shadow-black/80"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 ring-1 ring-sky-500/30">
              <Eye className="h-5 w-5 text-sky-400" />
            </span>
            <div>
              <h3 id="preview-modal-title" className="font-semibold text-white">
                Vista previa en custodia
              </h3>
              <p className="text-xs text-zinc-500">
                Metadatos verificados bajo arquitectura Zero-Knowledge
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar modal"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo con metadatos */}
        <div className="space-y-4 px-6 py-5">
          {/* Nombre del archivo */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Nombre del archivo
            </span>
            <p className="mt-1 break-all text-base font-medium text-white" title={doc.name}>
              {doc.name}
            </p>
          </div>

          {/* Cuadrícula de metadatos clave */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5">
            <div>
              <span className="text-xs text-zinc-500">Versión</span>
              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-200">
                v{version?.version_number ?? '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-zinc-500">Tamaño</span>
              <p className="mt-0.5 text-sm font-semibold text-zinc-200">
                {version ? formatSize(version.file_size) : '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-zinc-500">Tipo MIME</span>
              <p
                className="mt-0.5 truncate font-mono text-sm text-zinc-300"
                title={doc.mimeType ?? 'desconocido'}
              >
                {doc.mimeType ?? 'desconocido'}
              </p>
            </div>
            <div>
              <span className="text-xs text-zinc-500">Fecha de custodia</span>
              <p className="mt-0.5 text-sm text-zinc-300">
                {version ? formatDateTime(version.created_at) : formatDateTime(doc.createdAt)}
              </p>
            </div>
          </div>

          {/* Huella SHA-256 completa con botón de copiado */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Huella SHA-256 completa
              </span>
              {hash ? (
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 hover:text-white"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiada</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar huella</span>
                    </>
                  )}
                </button>
              ) : null}
            </div>
            <p className="mt-2 break-all font-mono text-xs leading-relaxed text-emerald-300">
              {hash || 'Sin versión disponible'}
            </p>
          </div>

          {/* Nota Zero-Knowledge */}
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Previsualización de metadatos: el contenido en claro sólo se revela
              tras descargar y descifrar localmente en RAM.
            </span>
          </div>
        </div>

        {/* Pie del modal */}
        <div className="flex justify-end border-t border-zinc-800 bg-zinc-950/40 px-6 py-3.5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}

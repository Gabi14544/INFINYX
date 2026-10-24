/**
 * DocumentPreviewModal.tsx
 * ---------------------------------------------------------------------------
 * Modal centrado y accesible para visualizar los metadatos de custodia de un
 * documento Zero-Knowledge (tema INFINYX / Hexa-Mugen con soporte Dual):
 *  - Nombre del archivo
 *  - Versión
 *  - Huella SHA-256 completa con botón de copiado rápido al portapapeles
 *  - Tamaño formateado
 *  - Tipo MIME
 *  - Fecha y hora exacta de custodia
 *
 * Se renderiza mediante un Portal en el document.body con z-50 y backdrop
 * semitransparente, evitando cualquier confinamiento o desbordamiento en la tabla.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Eye, X } from 'lucide-react';
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
      // Fallback silencioso si el portapapeles no está disponible
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:shadow-black/80 dark:ring-[#38BDF8]/15"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
              <Eye className="h-5 w-5" />
            </span>
            <div>
              <h3 id="preview-modal-title" className="text-lg font-semibold text-slate-900 dark:text-[#F8FAFC]">
                Vista previa en custodia
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                Metadatos verificados bajo arquitectura Zero-Knowledge
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar modal"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#F8FAFC]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo con metadatos y scroll */}
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {/* Nombre del archivo */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">
              Nombre del archivo
            </span>
            <p className="mt-1 break-all text-base font-semibold text-slate-900 dark:text-[#F8FAFC]" title={doc.name}>
              {doc.name}
            </p>
          </div>

          {/* Cuadrícula de metadatos clave */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#1E293B] dark:bg-[#07090E]">
            <div>
              <span className="text-xs text-slate-500 dark:text-[#94A3B8]">Versión</span>
              <p className="mt-0.5 font-mono text-sm font-semibold text-sky-700 dark:text-[#BAE6FD]">
                v{version?.version_number ?? '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-[#94A3B8]">Tamaño</span>
              <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-[#F8FAFC]">
                {version ? formatSize(version.file_size) : '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-[#94A3B8]">Tipo MIME</span>
              <p
                className="mt-0.5 truncate font-mono text-sm text-slate-500 dark:text-[#94A3B8]"
                title={doc.mimeType ?? 'desconocido'}
              >
                {doc.mimeType ?? 'desconocido'}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-[#94A3B8]">Fecha de custodia</span>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-[#94A3B8]">
                {version ? formatDateTime(version.created_at) : formatDateTime(doc.createdAt)}
              </p>
            </div>
          </div>

          {/* Huella SHA-256 completa con botón de copiado */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-900 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#F8FAFC]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">
                Huella SHA-256 completa
              </span>
              {hash ? (
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-sky-400 hover:text-sky-700 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                      <span className="text-[#0284C7] dark:text-[#38BDF8]">Copiada</span>
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
            <p className="mt-2 break-all font-mono text-xs leading-relaxed text-sky-800 dark:text-[#BAE6FD]">
              {hash || 'Sin versión disponible'}
            </p>
          </div>
        </div>

        {/* Pie del modal */}
        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-[#1E293B] dark:bg-[#0A0E17]">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD]"
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

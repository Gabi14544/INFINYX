/**
 * DocumentPreviewModal.tsx
 * ---------------------------------------------------------------------------
 * Modal centrado y accesible para visualizar los metadatos de custodia de un
 * documento Zero-Knowledge (tema Private Wealth):
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
      // Fallback silencioso si el portapapeles no está disponible
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white text-[#181816] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-[#EFECE6] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] text-[#6E6053]">
              <Eye className="h-5 w-5" />
            </span>
            <div>
              <h3 id="preview-modal-title" className="font-editorial text-lg font-semibold text-[#181816]">
                Vista previa en custodia
              </h3>
              <p className="text-xs text-[#6E6A63]">
                Metadatos verificados bajo arquitectura Zero-Knowledge
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar modal"
            className="rounded-lg p-1.5 text-[#8C867B] transition hover:bg-[#F3F1EC] hover:text-[#181816]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo con metadatos */}
        <div className="space-y-4 px-6 py-5">
          {/* Nombre del archivo */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6A63]">
              Nombre del archivo
            </span>
            <p className="mt-1 break-all text-base font-semibold text-[#181816]" title={doc.name}>
              {doc.name}
            </p>
          </div>

          {/* Cuadrícula de metadatos clave */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#E6E4DD] bg-[#F8F7F4] p-3.5">
            <div>
              <span className="text-xs text-[#6E6A63]">Versión</span>
              <p className="mt-0.5 font-mono text-sm font-semibold text-[#181816]">
                v{version?.version_number ?? '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#6E6A63]">Tamaño</span>
              <p className="mt-0.5 text-sm font-semibold text-[#181816]">
                {version ? formatSize(version.file_size) : '—'}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#6E6A63]">Tipo MIME</span>
              <p
                className="mt-0.5 truncate font-mono text-sm text-[#4A4740]"
                title={doc.mimeType ?? 'desconocido'}
              >
                {doc.mimeType ?? 'desconocido'}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#6E6A63]">Fecha de custodia</span>
              <p className="mt-0.5 text-sm text-[#4A4740]">
                {version ? formatDateTime(version.created_at) : formatDateTime(doc.createdAt)}
              </p>
            </div>
          </div>

          {/* Huella SHA-256 completa con botón de copiado */}
          <div className="rounded-xl border border-[#E6E4DD] bg-[#FAF9F6] p-4 text-[#181816]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6E6A63]">
                Huella SHA-256 completa
              </span>
              {hash ? (
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#DCD9D0] bg-white px-2.5 py-1 text-xs font-medium text-[#181816] shadow-2xs transition hover:bg-[#F3F1EC]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#6E6053]" />
                      <span className="text-[#6E6053]">Copiada</span>
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
            <p className="mt-2 break-all font-mono text-xs leading-relaxed text-[#181816]">
              {hash || 'Sin versión disponible'}
            </p>
          </div>

          {/* Nota Zero-Knowledge */}
          <div className="flex items-start gap-2.5 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-2.5 text-xs text-[#5C5043]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6E6053]" />
            <span>
              Previsualización de metadatos: el contenido en claro sólo se revela tras descargar y
              descifrar localmente en la memoria RAM de tu dispositivo.
            </span>
          </div>
        </div>

        {/* Pie del modal */}
        <div className="flex justify-end border-t border-[#EFECE6] bg-[#FAF9F6] px-6 py-3.5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-[#DCD9D0] bg-white px-4 py-2 text-sm font-medium text-[#181816] shadow-2xs transition hover:bg-[#F3F1EC]"
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

import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Cpu,
  FileUp,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../auth/stores/useAuthStore';
import { useVaultStore } from '../stores/useVaultStore';
import { MAX_VAULT_FILE_SIZE_BYTES } from '../../../core/crypto/vaultCrypto';
import { formatSize } from '../utils/formatters';
import type { UploadStatus } from '../../../shared/types';

interface FileUploadModalProps {
  open: boolean;
  onClose: () => void;
}

const STEP_INDEX: Record<UploadStatus, number> = {
  idle: 0,
  reading: 1,
  hashing: 2,
  encrypting: 3,
  uploading: 4,
  done: 4,
  error: -1,
};

export default function FileUploadModal({ open, onClose }: FileUploadModalProps) {
  const vaultKey = useAuthStore((s) => s.vaultKey);
  const uploadStatus = useVaultStore((s) => s.uploadStatus);
  const vaultIsLoading = useVaultStore((s) => s.isLoading);
  const vaultError = useVaultStore((s) => s.error);
  const uploadDocument = useVaultStore((s) => s.uploadDocument);
  const resetUploadStatus = useVaultStore((s) => s.resetUploadStatus);
  const clearError = useVaultStore((s) => s.clearError);

  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al abrir el modal se restablece el estado para partir limpios
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setFile(null);
        setLocalError(null);
        setDragging(false);
        resetUploadStatus();
        clearError();
      });
    }
  }, [open, resetUploadStatus, clearError]);

  if (!open) return null;

  const busy = vaultIsLoading && uploadStatus !== 'done' && uploadStatus !== 'error';
  const finished = uploadStatus === 'done';
  const failed = uploadStatus === 'error';
  const activeIndex = STEP_INDEX[uploadStatus];
  const progressPct =
    uploadStatus === 'done'
      ? 100
      : uploadStatus === 'idle' || uploadStatus === 'error'
        ? 0
        : Math.min(100, Math.round((activeIndex / 4) * 100));

  const pickFile = (candidate: File | undefined | null) => {
    if (!candidate || busy) return;
    clearError();
    if (candidate.size === 0) {
      setFile(null);
      setLocalError('El archivo seleccionado está vacío (0 bytes).');
      return;
    }
    if (candidate.size > MAX_VAULT_FILE_SIZE_BYTES) {
      setFile(null);
      setLocalError(
        `El archivo (${formatSize(candidate.size)}) supera el límite seguro de ${formatSize(MAX_VAULT_FILE_SIZE_BYTES)} en RAM.`,
      );
      return;
    }
    setLocalError(null);
    setFile(candidate);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file || busy) return;
    if (!vaultKey) return;
    await uploadDocument(file, vaultKey);
  };

  const handleClose = () => {
    if (busy) return;
    resetUploadStatus();
    clearError();
    setLocalError(null);
    setFile(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Proteger nuevo documento"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:shadow-black/80 dark:ring-[#38BDF8]/15"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
              <FileUp className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-[#F8FAFC]">
                Proteger nuevo documento
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                Cifrado local antes de cualquier transmisión al servidor
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#F8FAFC]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo central con scroll vertical */}
        <div className="space-y-5 overflow-y-auto px-6 py-5">
          {/* Zona Drag & Drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !busy && inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragging
                ? 'border-sky-500 bg-sky-50 dark:border-[#38BDF8] dark:bg-[#38BDF8]/10'
                : file
                  ? 'border-sky-400/60 bg-slate-50 dark:border-[#38BDF8]/60 dark:bg-[#07090E]'
                  : 'border-slate-200 bg-slate-50 hover:border-sky-400 hover:bg-slate-100/60 dark:border-[#1E293B] dark:bg-[#07090E] dark:hover:border-[#38BDF8]/50 dark:hover:bg-[#07090E]/80'
            } ${busy ? 'pointer-events-none opacity-70' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
              disabled={busy}
            />
            <Upload className="h-8 w-8 text-[#0284C7] dark:text-[#38BDF8]" />
            {file ? (
              <>
                <p className="max-w-full truncate text-sm font-semibold text-slate-900 dark:text-[#F8FAFC]">
                  {file.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  {(file.size / 1024).toFixed(1)} KB · Haz clic para cambiar archivo
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-900 dark:text-[#F8FAFC]">
                  Arrastra tu archivo aquí o haz clic para seleccionarlo
                </p>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  El texto plano nunca abandona este dispositivo sin cifrar · Máx. 50 MB
                </p>
              </>
            )}
          </div>

          {/* Error de subida o validación local */}
          {(localError || (failed && vaultError)) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
              <span className="break-words">{localError || (failed ? vaultError : null)}</span>
            </div>
          )}

          {/* Barra de progreso minimalista y elegante */}
          {(busy || finished || failed) && (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1E293B] dark:bg-[#07090E]/90">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 font-medium text-sky-800 dark:text-[#BAE6FD]">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0284C7] dark:text-[#38BDF8]" />}
                  {finished && <ShieldCheck className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />}
                  {failed
                    ? 'Error al procesar el archivo'
                    : finished
                      ? 'Archivo cifrado y protegido'
                      : 'Cifrando archivo…'}
                </span>
                <span className="font-mono font-semibold text-[#0284C7] dark:text-[#38BDF8]">
                  {finished ? '100%' : `${progressPct}%`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#1E293B]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    failed
                      ? 'bg-red-500'
                      : 'bg-gradient-to-r from-[#0284C7] via-[#38BDF8] to-[#BAE6FD] shadow-[0_0_12px_rgba(56,189,248,0.6)]'
                  }`}
                  style={{ width: `${failed ? 100 : finished ? 100 : progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2.5 pt-1">
            {finished ? (
              <button
                type="button"
                onClick={handleClose}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 dark:text-[#07090E]"
              >
                <Check className="h-4 w-4 text-white dark:text-[#07090E]" />
                Cerrar y ver en catálogo
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!file || busy || !vaultKey}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#07090E]"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white dark:text-[#07090E]" />
                      Protegiendo…
                    </>
                  ) : (
                    <>
                      <Cpu className="h-4 w-4 text-white dark:text-[#07090E]" />
                      Cifrar y subir
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {!vaultKey && (
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">
              La bóveda está bloqueada: debes iniciar sesión para subir documentos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

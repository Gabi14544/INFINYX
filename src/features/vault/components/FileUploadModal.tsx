import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Cpu,
  FileUp,
  Fingerprint,
  HardDrive,
  Loader2,
  Lock,
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

interface PipelineStep {
  id: Exclude<UploadStatus, 'idle' | 'error'>;
  order: number;
  title: string;
  detail: string;
  icon: typeof Cpu;
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'reading',
    order: 1,
    title: 'Lectura en memoria local',
    detail: 'El archivo se carga en memoria RAM. Nada sale del navegador.',
    icon: HardDrive,
  },
  {
    id: 'hashing',
    order: 2,
    title: 'Cálculo de huella SHA-256',
    detail: 'Huella del texto plano como referencia criptográfica de integridad.',
    icon: Fingerprint,
  },
  {
    id: 'encrypting',
    order: 3,
    title: 'Cifrado AES-GCM-256 con IV único',
    detail: 'Cifrado autenticado con tu clave de bóveda en RAM.',
    icon: Lock,
  },
  {
    id: 'uploading',
    order: 4,
    title: 'Transmisión segura del blob .enc a Supabase',
    detail: 'Sólo viaja ciphertext opaco. El servidor es ciego.',
    icon: Upload,
  },
];

const STEP_INDEX: Record<UploadStatus, number> = {
  idle: 0,
  reading: 1,
  hashing: 2,
  encrypting: 3,
  uploading: 4,
  done: 5,
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
        : Math.round((activeIndex / PIPELINE_STEPS.length) * 100);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white text-[#181816] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-[#EFECE6] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] text-[#6E6053]">
              <FileUp className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-editorial text-lg font-semibold text-[#181816]">
                Proteger nuevo documento
              </h3>
              <p className="text-xs text-[#6E6A63]">
                Cifrado local antes de cualquier transmisión al servidor
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-[#8C867B] transition hover:bg-[#F3F1EC] hover:text-[#181816] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
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
                ? 'border-[#6E6053] bg-[#F5F2EB]'
                : file
                  ? 'border-[#6E6053] bg-[#FAF9F6]'
                  : 'border-[#D5D1C8] bg-[#FAF9F6] hover:border-[#6E6053] hover:bg-[#F5F3EE]'
            } ${busy ? 'pointer-events-none opacity-70' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
              disabled={busy}
            />
            <Upload className="h-8 w-8 text-[#6E6053]" />
            {file ? (
              <>
                <p className="max-w-full truncate text-sm font-semibold text-[#181816]">
                  {file.name}
                </p>
                <p className="text-xs text-[#6E6A63]">
                  {(file.size / 1024).toFixed(1)} KB · Haz clic para cambiar archivo
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[#181816]">
                  Arrastra tu archivo aquí o haz clic para seleccionarlo
                </p>
                <p className="text-xs text-[#6E6A63]">
                  El texto plano nunca abandona este dispositivo sin cifrar · Máx. 50 MB
                </p>
              </>
            )}
          </div>

          {/* Error de subida o validación local */}
          {(localError || (failed && vaultError)) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span className="break-words">{localError || (failed ? vaultError : null)}</span>
            </div>
          )}

          {/* Pipeline Zero-Knowledge en tiempo real */}
          {(busy || finished || failed) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-[#6E6A63]">
                  Pipeline Zero-Knowledge
                </span>
                <span
                  className={`font-semibold ${
                    finished ? 'text-[#6E6053]' : failed ? 'text-red-600' : 'text-[#141413]'
                  }`}
                >
                  {finished ? '100%' : `${progressPct}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#EFECE6]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    finished
                      ? 'bg-[#6E6053]'
                      : failed
                        ? 'bg-red-600'
                        : 'bg-[#141413]'
                  }`}
                  style={{ width: `${failed ? 100 : progressPct}%` }}
                />
              </div>

              <ol className="space-y-2">
                {PIPELINE_STEPS.map((step) => {
                  const done =
                    finished || (activeIndex > 0 && step.order < activeIndex);
                  const active =
                    !finished && !failed && step.order === activeIndex;
                  const pending =
                    !done && !active && !(failed && step.order === activeIndex);
                  const Icon = step.icon;
                  return (
                    <li
                      key={step.id}
                      className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 transition ${
                        active
                          ? 'border-[#6E6053] bg-[#FAF9F6]'
                          : done
                            ? 'border-[#D8D0C5] bg-[#F5F2EB]'
                            : failed && step.order === activeIndex
                              ? 'border-red-200 bg-red-50'
                              : 'border-[#E6E4DD] bg-[#F8F7F4]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${
                          done
                            ? 'bg-[#6E6053] text-white ring-[#6E6053]'
                            : active
                              ? 'bg-[#141413] text-white ring-[#141413]'
                              : 'bg-[#F3F1EC] text-[#8C867B] ring-[#E6E4DD]'
                        }`}
                      >
                        {done ? (
                          <Check className="h-4 w-4" />
                        ) : active ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium ${
                            pending && !failed ? 'text-[#8C867B]' : 'text-[#181816]'
                          }`}
                        >
                          Paso {step.order}: {step.title}
                        </p>
                        <p className="text-xs text-[#6E6A63]">{step.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {finished && (
                <div className="flex items-center gap-2.5 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-3 text-sm text-[#5C5043]">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#6E6053]" />
                  Documento cifrado y registrado en la bóveda. Sólo tú puedes descifrarlo.
                </div>
              )}
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2.5 pt-1">
            {finished ? (
              <button
                type="button"
                onClick={handleClose}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27]"
              >
                <Check className="h-4 w-4" />
                Cerrar y ver en catálogo
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-[#DCD9D0] bg-white px-4 py-2.5 text-sm font-medium text-[#181816] transition hover:bg-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!file || busy || !vaultKey}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Protegiendo…
                    </>
                  ) : (
                    <>
                      <Cpu className="h-4 w-4" />
                      Cifrar y subir
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {!vaultKey && (
            <p className="text-center text-xs text-[#8C6D44]">
              La bóveda está bloqueada: debes iniciar sesión para subir documentos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

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
    detail: 'El archivo se carga en RAM. Nada sale del navegador.',
    icon: HardDrive,
  },
  {
    id: 'hashing',
    order: 2,
    title: 'Cálculo de huella SHA-256',
    detail: 'Huella del texto plano como referencia de integridad.',
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
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al reabrir el modal se parte siempre de un estado limpio.
  useEffect(() => {
    if (open) {
      setFile(null);
      setDragging(false);
      resetUploadStatus();
      clearError();
    }
    // Se ejecuta sólo al abrir/cerrar para no pisar el progreso en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    if (candidate && !busy) {
      setFile(candidate);
      clearError();
    }
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
    setFile(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Proteger nuevo documento"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30">
              <FileUp className="h-5 w-5 text-emerald-400" />
            </span>
            <div>
              <h3 className="font-semibold text-white">Proteger nuevo documento</h3>
              <p className="text-xs text-zinc-500">
                Cifrado local antes de cualquier transmisión
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
                ? 'border-emerald-400 bg-emerald-500/10'
                : file
                  ? 'border-zinc-700 bg-zinc-950/60'
                  : 'border-zinc-700 bg-zinc-950/40 hover:border-zinc-600 hover:bg-zinc-950/70'
            } ${busy ? 'pointer-events-none opacity-70' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
              disabled={busy}
            />
            <Upload
              className={`h-8 w-8 ${dragging ? 'text-emerald-300' : 'text-zinc-500'}`}
            />
            {file ? (
              <>
                <p className="max-w-full truncate text-sm font-medium text-white">
                  {file.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {(file.size / 1024).toFixed(1)} KB · clic para cambiar
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-zinc-200">
                  Arrastra tu archivo aquí o haz clic para seleccionarlo
                </p>
                <p className="text-xs text-zinc-500">
                  El texto plano nunca abandona este dispositivo sin cifrar
                </p>
              </>
            )}
          </div>

          {/* Error de subida */}
          {failed && vaultError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{vaultError}</span>
            </div>
          )}

          {/* Pipeline en tiempo real */}
          {(busy || finished || failed) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium uppercase tracking-widest text-zinc-500">
                  Pipeline Zero-Knowledge
                </span>
                <span
                  className={`font-semibold ${finished ? 'text-emerald-400' : failed ? 'text-red-400' : 'text-blue-400'}`}
                >
                  {finished ? '100%' : `${progressPct}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    finished
                      ? 'bg-emerald-500'
                      : failed
                        ? 'bg-red-500'
                        : 'bg-blue-500'
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
                          ? 'border-blue-500/40 bg-blue-500/10'
                          : done
                            ? 'border-emerald-500/25 bg-emerald-500/5'
                            : failed && step.order === activeIndex
                              ? 'border-red-500/40 bg-red-500/10'
                              : 'border-zinc-800 bg-zinc-950/50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${
                          done
                            ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
                            : active
                              ? 'bg-blue-500/15 text-blue-400 ring-blue-500/30'
                              : 'bg-zinc-800 text-zinc-500 ring-zinc-700'
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
                          className={`text-sm font-medium ${pending && !failed ? 'text-zinc-500' : 'text-zinc-100'}`}
                        >
                          Paso {step.order}: {step.title}
                        </p>
                        <p className="text-xs text-zinc-500">{step.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {finished && (
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  Documento cifrado y registrado. Sólo tú puedes descifrarlo.
                </div>
              )}
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2.5">
            {finished ? (
              <button
                type="button"
                onClick={handleClose}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
              >
                <Check className="h-4 w-4" />
                Cerrar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!file || busy || !vaultKey}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="text-center text-xs text-amber-400/90">
              La bóveda está bloqueada: desbloquéala con tu contraseña para subir.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

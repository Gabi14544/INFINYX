import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  AlertTriangle,
  Check,
  Cpu,
  FileUp,
  FolderUp,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useAuthStore } from "../../auth/stores/useAuthStore";
import { useVaultStore } from "../stores/useVaultStore";
import { formatSize } from "../utils/formatters";
import type { UploadStatus } from "../../../shared/types";
import {
  extractDroppedFiles,
  validateAndPrepareFiles,
  type PreparedVaultFile,
} from "../utils/folderUpload";

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

export default function FileUploadModal({
  open,
  onClose,
}: FileUploadModalProps) {
  const vaultKey = useAuthStore((s) => s.vaultKey);
  const uploadStatus = useVaultStore((s) => s.uploadStatus);
  const batchUploadProgress = useVaultStore((s) => s.batchUploadProgress);
  const vaultIsLoading = useVaultStore((s) => s.isLoading);
  const vaultError = useVaultStore((s) => s.error);
  const uploadDocument = useVaultStore((s) => s.uploadDocument);
  const uploadDocumentsBatch = useVaultStore((s) => s.uploadDocumentsBatch);
  const resetUploadStatus = useVaultStore((s) => s.resetUploadStatus);
  const clearError = useVaultStore((s) => s.clearError);

  const [files, setFiles] = useState<PreparedVaultFile[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectionEpoch = useRef(0);

  // Al abrir el modal se restablece el estado para partir limpios
  useEffect(() => {
    const epoch = selectionEpoch;
    const current = ++epoch.current;
    if (open) {
      queueMicrotask(() => {
        if (epoch.current !== current) return;
        setFiles([]);
        setLocalError(null);
        setDragging(false);
        resetUploadStatus();
        clearError();
      });
    }
    return () => {
      epoch.current++;
    };
  }, [open, resetUploadStatus, clearError]);

  if (!open) return null;

  const busy =
    vaultIsLoading && uploadStatus !== "done" && uploadStatus !== "error";
  const finished = uploadStatus === "done";
  const failed = uploadStatus === "error";
  const activeIndex = STEP_INDEX[uploadStatus];
  const isBatch = Boolean(batchUploadProgress && batchUploadProgress.total > 1);

  let progressPct = 0;
  if (uploadStatus === "done") {
    progressPct = 100;
  } else if (uploadStatus === "error") {
    progressPct = 100;
  } else if (isBatch && batchUploadProgress) {
    const currentIdx = Math.max(0, batchUploadProgress.current - 1);
    const phaseFraction = Math.max(0, activeIndex) / 4;
    progressPct = Math.min(
      99,
      Math.round(
        ((currentIdx + phaseFraction) / batchUploadProgress.total) * 100,
      ),
    );
  } else if (uploadStatus !== "idle") {
    progressPct = Math.min(100, Math.round((activeIndex / 4) * 100));
  }

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || busy) return;
    selectionEpoch.current++;
    clearError();
    const candidates = Array.from(fileList).map((f) => ({
      file: f,
      relativePath:
        f.webkitRelativePath && f.webkitRelativePath.length > 0
          ? f.webkitRelativePath
          : undefined,
    }));
    const { validFiles, error: valError } = validateAndPrepareFiles(candidates);
    if (valError) {
      setLocalError(valError);
      setFiles([]);
      return;
    }
    setLocalError(null);
    setFiles(validFiles);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    clearError();
    const selection = ++selectionEpoch.current;
    try {
      const extracted = await extractDroppedFiles(e.dataTransfer);
      if (selection !== selectionEpoch.current) return;
      const { validFiles, error: valError } =
        validateAndPrepareFiles(extracted);
      if (valError) {
        setLocalError(valError);
        setFiles([]);
        return;
      }
      setLocalError(null);
      setFiles(validFiles);
    } catch (cause) {
      if (selection !== selectionEpoch.current) return;
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Error al procesar los archivos arrastrados.",
      );
      setFiles([]);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || busy || !vaultKey) return;
    if (files.length === 1) {
      const single = files[0];
      if (single) {
        await uploadDocument(single.file, vaultKey, single.logicalName);
      }
    } else {
      const result = await uploadDocumentsBatch(
        files.map((f) => ({ file: f.file, logicalName: f.logicalName })),
        vaultKey,
      );
      if (result.failedFiles.length) {
        const failed = new Set(result.failedFiles);
        setFiles((previous) =>
          previous.filter((item) => failed.has(item.logicalName)),
        );
      }
    }
  };

  const handleClose = () => {
    if (busy) return;
    selectionEpoch.current++;
    resetUploadStatus();
    clearError();
    setLocalError(null);
    setFiles([]);
    onClose();
  };

  const totalBytes = files.reduce((acc, f) => acc + f.file.size, 0);

  let statusLabel = "Cifrando archivo…";
  if (failed) {
    statusLabel = batchUploadProgress
      ? `${batchUploadProgress.uploaded} protegidos; ${batchUploadProgress.failed} fallidos`
      : "Error al procesar el archivo";
  } else if (finished) {
    statusLabel = isBatch
      ? `${batchUploadProgress?.total ?? files.length} archivos cifrados y protegidos`
      : "Archivo cifrado y protegido";
  } else if (isBatch && batchUploadProgress) {
    statusLabel = `Cifrando archivo ${batchUploadProgress.current} de ${batchUploadProgress.total}…`;
  }

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
                Proteger documentos
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
            className={`flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragging
                ? "border-sky-500 bg-sky-50 dark:border-[#38BDF8] dark:bg-[#38BDF8]/10"
                : files.length > 0
                  ? "border-sky-400/60 bg-slate-50 dark:border-[#38BDF8]/60 dark:bg-[#07090E]"
                  : "border-slate-200 bg-slate-50 hover:border-sky-400 hover:bg-slate-100/60 dark:border-[#1E293B] dark:bg-[#07090E] dark:hover:border-[#38BDF8]/50 dark:hover:bg-[#07090E]/80"
            } ${busy ? "pointer-events-none opacity-70" : ""}`}
          >
            {/* Inputs nativos ocultos */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
              disabled={busy}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<
                string,
                string
              >)}
              className="hidden"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
              disabled={busy}
            />

            <Upload className="h-8 w-8 text-[#0284C7] dark:text-[#38BDF8]" />

            {files.length === 1 && files[0] ? (
              <>
                <p className="max-w-full truncate text-sm font-semibold text-slate-900 dark:text-[#F8FAFC]">
                  {files[0].logicalName}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  {formatSize(files[0].file.size)} · Listo para cifrar
                </p>
              </>
            ) : files.length > 1 ? (
              <>
                <p className="max-w-full truncate text-sm font-semibold text-slate-900 dark:text-[#F8FAFC]">
                  {files.length} archivos listos para cifrar (Tamaño total:{" "}
                  {formatSize(totalBytes)})
                </p>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  Máx. 50 MB por archivo
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-900 dark:text-[#F8FAFC]">
                  Arrastra archivos o una carpeta completa aquí
                </p>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  El texto plano nunca abandona este dispositivo sin cifrar ·
                  Máx. 50 MB por archivo
                </p>
              </>
            )}

            {/* Botones de selección explícita */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-[#38BDF8]/50 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#BAE6FD] dark:hover:bg-[#1E293B]"
              >
                <FileUp className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                Seleccionar archivos
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-[#38BDF8]/50 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#BAE6FD] dark:hover:bg-[#1E293B]"
              >
                <FolderUp className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                Seleccionar carpeta
              </button>
            </div>
          </div>

          {/* Error de subida o validación local */}
          {(localError || (failed && vaultError)) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
              <span className="break-words">
                {localError || (failed ? vaultError : null)}
              </span>
            </div>
          )}

          {/* Barra de progreso minimalista y elegante en gradiente Azul Seis Ojos */}
          {(busy || finished || failed) && (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1E293B] dark:bg-[#07090E]/90">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 font-medium text-sky-800 dark:text-[#BAE6FD]">
                  {busy && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0284C7] dark:text-[#38BDF8]" />
                  )}
                  {finished && (
                    <ShieldCheck className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />
                  )}
                  {statusLabel}
                </span>
                <span className="font-mono font-semibold text-[#0284C7] dark:text-[#38BDF8]">
                  {finished ? "100%" : `${progressPct}%`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#1E293B]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    failed
                      ? "bg-red-500"
                      : "bg-gradient-to-r from-[#0284C7] via-[#38BDF8] to-[#BAE6FD] shadow-[0_0_12px_rgba(56,189,248,0.6)]"
                  }`}
                  style={{
                    width: `${failed ? 100 : finished ? 100 : progressPct}%`,
                  }}
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
                  disabled={files.length === 0 || busy || !vaultKey}
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
                      {files.length > 1
                        ? `Cifrar ${files.length} archivos`
                        : "Cifrar y subir"}
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {!vaultKey && (
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">
              La bóveda está bloqueada: debes iniciar sesión para subir
              documentos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

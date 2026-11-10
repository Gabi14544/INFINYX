import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import type { VaultDocument } from "../../../shared/types";
import { useAuthStore } from "../../auth/stores/useAuthStore";
import { useDownloadAuthStore } from "../stores/useDownloadAuthStore";
import { useVaultStore } from "../stores/useVaultStore";

interface BulkDeleteModalProps {
  open: boolean;
  docsToDelete: VaultDocument[];
  isDeleteAll: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export default function BulkDeleteModal({
  open,
  docsToDelete,
  isDeleteAll,
  onClose,
  onDeleted,
}: BulkDeleteModalProps) {
  const user = useAuthStore((s) => s.user);
  const sessionPassword = useDownloadAuthStore(
    (s) => s.downloadSessionPassword,
  );
  const deleteDocumentsBatch = useVaultStore((s) => s.deleteDocumentsBatch);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setPassword("");
      setShowPassword(false);
      setBusy(false);
      setError(null);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onClose]);

  if (!open || docsToDelete.length === 0) return null;

  const count = docsToDelete.length;
  const previewDocs = docsToDelete.slice(0, 4);
  const remainingCount = count - previewDocs.length;

  const handleDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const activeUser =
      user ??
      useAuthStore.getState().user ??
      useAuthStore.getState().session?.user ??
      null;
    if (!activeUser) {
      setError("No hay un usuario autenticado en la sesión actual.");
      return;
    }

    if (!sessionPassword && password.length === 0) {
      setError(
        "Debes escribir tu contraseña de descarga para autorizar la eliminación.",
      );
      return;
    }

    setBusy(true);

    try {
      const docIds = docsToDelete.map((doc) => doc.id);
      const success = await deleteDocumentsBatch(
        docIds,
        sessionPassword ?? password,
      );
      setPassword("");

      if (success) {
        onDeleted();
        onClose();
      } else {
        const storeError = useVaultStore.getState().error;
        setError(
          storeError ?? "No se pudieron eliminar los documentos seleccionados.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Ocurrió un error inesperado al procesar la eliminación.",
      );
    } finally {
      setBusy(false);
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-delete-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:shadow-black/80 dark:ring-[#38BDF8]/15"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <h3
                id="bulk-delete-modal-title"
                className="text-lg font-semibold text-slate-900 dark:text-[#F8FAFC]"
              >
                {isDeleteAll ? "Vaciar bóveda" : "Eliminar seleccionados"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                {isDeleteAll
                  ? "Eliminación irreversible de toda la bóveda"
                  : `Eliminación permanente de ${count} documento${count === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#F8FAFC]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo */}
        <form
          onSubmit={handleDelete}
          className="space-y-4 overflow-y-auto px-6 py-5"
        >
          {/* Advertencia destructiva */}
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
            <div>
              <p className="font-semibold text-red-950 dark:text-red-100">
                {isDeleteAll
                  ? `¿Deseas vaciar la bóveda eliminando los ${count} documentos?`
                  : `¿Deseas eliminar permanentemente los ${count} documentos seleccionados?`}
              </p>
              <p className="mt-1 text-red-800/90 dark:text-red-200/90">
                Esta acción es destructiva e irreversible. Todos los archivos y
                versiones cifradas se eliminarán de forma permanente tanto de la
                base de datos como de la nube.
              </p>
            </div>
          </div>

          {/* Lista de archivos a eliminar */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#1E293B] dark:bg-[#07090E]">
            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-[#94A3B8]">
              Archivos afectados ({count}):
            </p>
            <ul className="space-y-1.5">
              {previewDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 text-xs text-slate-800 dark:text-[#F8FAFC]"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[#64748B]" />
                  <span className="truncate" title={d.name}>
                    {d.name}
                  </span>
                </li>
              ))}
              {remainingCount > 0 && (
                <li className="pt-1 text-xs font-semibold text-[#0284C7] dark:text-[#38BDF8]">
                  + {remainingCount} más
                </li>
              )}
            </ul>
          </div>

          {sessionPassword ? (
            <p role="status" className="text-sm text-sky-700 dark:text-sky-300">
              Autorización activa en esta pestaña. Confirma el borrado de los
              elementos indicados.
            </p>
          ) : (
            <>
              {/* Validación de Contraseña de Descarga (Siempre obligatoria) */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#1E293B] dark:bg-[#07090E]">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-[#F8FAFC]">
                  <KeyRound className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />
                  <span>Autorización obligatoria</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  Por seguridad, introduce tu Contraseña de Descarga para
                  confirmar la eliminación:
                </p>
                <div className="relative mt-2">
                  <input
                    id="bulk-delete-auth-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Contraseña de autorización"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-red-500 dark:focus:ring-red-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-label={
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#BAE6FD]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
          {/* Error */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || (!sessionPassword && password.length === 0)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  Eliminando…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {isDeleteAll ? "Vaciar bóveda" : `Eliminar (${count})`}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : modalContent;
}

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  deriveKey,
  encryptBuffer,
  decryptBuffer,
  hexToBuffer,
} from "../../../core/crypto/vaultCrypto";
import { supabase } from "../../../shared/lib/supabase";
import { vaultAccess } from "../../../shared/lib/vaultAccess";
import { sensitiveGeneration } from "../../../shared/lib/sensitiveState";
import { useAuthStore } from "../../auth/stores/useAuthStore";
import { useDownloadAuthStore } from "../stores/useDownloadAuthStore";

interface DownloadAuthModalProps {
  open: boolean;
  onClose: () => void;
  /** El servidor validó la contraseña, guardada temporalmente en RAM. */
  onAuthenticated?: () => void;
}

type ModalMode = "loading" | "create" | "enter";

const MIN_PASSWORD_LENGTH = 15;

export default function DownloadAuthModal({
  open,
  onClose,
  onAuthenticated,
}: DownloadAuthModalProps) {
  const user = useAuthStore((s) => s.user);
  const setDownloadSessionPassword = useDownloadAuthStore(
    (s) => s.setDownloadSessionPassword,
  );

  const [mode, setMode] = useState<ModalMode>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura: estado limpio + consulta del verificador existente.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const resolveMode = async () => {
      setPassword("");
      setConfirm("");
      setShowPassword(false);
      setBusy(false);
      setError(null);
      setMode("loading");

      try {
        const activeUser =
          user ??
          useAuthStore.getState().user ??
          useAuthStore.getState().session?.user ??
          null;
        if (!activeUser) {
          if (!cancelled) {
            setError("No hay un usuario autenticado en la sesión actual.");
            setMode("enter");
          }
          return;
        }

        const { configured } = await vaultAccess<{ configured: boolean }>(
          "status",
        );
        if (cancelled) return;
        setMode(configured ? "enter" : "create");
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "No se pudo consultar el estado de la contraseña de descarga.",
        );
        // Ante duda se ofrece la vista de ingreso (no se sobrescribe nada).
        setMode("enter");
      }
    };

    void resolveMode();
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!open) return null;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }
    if (password !== confirm) {
      setError("La confirmación no coincide con la contraseña.");
      return;
    }

    const activeUser =
      user ??
      useAuthStore.getState().user ??
      useAuthStore.getState().session?.user ??
      null;
    if (!activeUser) {
      setError("No hay un usuario autenticado en la sesión actual.");
      return;
    }

    setBusy(true);
    try {
      const generation = sensitiveGeneration();
      const activeKey = useAuthStore.getState().vaultKey;
      if (!activeKey) throw new Error("La bóveda está bloqueada.");
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("vault_salt")
        .eq("id", activeUser.id)
        .single();
      if (profileError || !data)
        throw new Error("No se pudo comprobar la configuración de la bóveda.");
      const candidateKey = await deriveKey(
        password,
        new Uint8Array(hexToBuffer(data.vault_salt)),
      );
      const context = {
        userId: activeUser.id,
        documentId: crypto.randomUUID(),
        versionNumber: 1,
      };
      const probe = await encryptBuffer(
        crypto.getRandomValues(new Uint8Array(32)).buffer,
        activeKey,
        context,
      );
      let reusesMaster = false;
      try {
        await decryptBuffer(
          probe.cipherBuffer,
          candidateKey,
          probe.iv,
          context,
        );
        reusesMaster = true;
      } catch {
        /* Different key: desired. */
      }
      if (reusesMaster)
        throw new Error(
          "La contraseña de descarga debe ser distinta de tu contraseña maestra.",
        );
      if (generation !== sensitiveGeneration()) return;
      await vaultAccess("setup", password);
      if (generation !== sensitiveGeneration()) return;
      // Sólo en RAM: nunca en localStorage/sessionStorage.
      setDownloadSessionPassword(password);
      setPassword("");
      setConfirm("");
      onAuthenticated?.();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "No se pudo crear la contraseña de descarga.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleEnter = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length === 0) {
      setError("Introduce tu contraseña de descarga.");
      return;
    }

    const activeUser =
      user ??
      useAuthStore.getState().user ??
      useAuthStore.getState().session?.user ??
      null;
    if (!activeUser) {
      setError("No hay un usuario autenticado en la sesión actual.");
      return;
    }

    setBusy(true);
    try {
      const generation = sensitiveGeneration();
      await vaultAccess("verify", password);
      if (generation !== sensitiveGeneration()) return;

      setDownloadSessionPassword(password);
      setPassword("");
      setConfirm("");
      onAuthenticated?.();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "No se pudo verificar la contraseña de descarga.",
      );
    } finally {
      setBusy(false);
    }
  };

  const isCreate = mode === "create";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isCreate
          ? "Crear contraseña única de descarga"
          : "Ingresar contraseña de descarga"
      }
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:shadow-black/80 dark:ring-[#38BDF8]/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-[#F8FAFC]">
                {mode === "loading"
                  ? "Verificando seguridad…"
                  : isCreate
                    ? "Crear Contraseña Única de Descarga"
                    : "Ingresar Contraseña de Descarga"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                {isCreate
                  ? "Usa una contraseña diferente de la maestra: se verificará en el servidor"
                  : "Autoriza la descarga del archivo seleccionado"}
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

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {mode === "loading" ? (
            <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-slate-500 dark:text-[#94A3B8]">
              <Loader2 className="h-5 w-5 animate-spin text-[#0284C7] dark:text-[#38BDF8]" />
              Consultando credenciales de autorización…
            </div>
          ) : (
            <form
              onSubmit={isCreate ? handleCreate : handleEnter}
              className="space-y-4"
            >
              <p className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#94A3B8]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0284C7] dark:text-[#38BDF8]" />
                Ingresa tu contraseña de autorización para habilitar las
                descargas durante esta sesión.
              </p>

              <div className="space-y-1.5">
                <label
                  htmlFor="download-password"
                  className="text-sm font-medium text-slate-700 dark:text-[#F8FAFC]"
                >
                  {isCreate
                    ? "Nueva contraseña de descarga"
                    : "Contraseña de descarga"}
                </label>
                <div className="relative">
                  <input
                    id="download-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete={
                      isCreate ? "new-password" : "current-password"
                    }
                    placeholder={
                      isCreate
                        ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
                        : "Tu contraseña de descarga"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
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

              {isCreate && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="download-password-confirm"
                    className="text-sm font-medium text-slate-700 dark:text-[#F8FAFC]"
                  >
                    Confirmar contraseña
                  </label>
                  <input
                    id="download-password-confirm"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    placeholder="Repite la contraseña"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
                  />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <div className="flex gap-2.5 pt-1">
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
                  disabled={
                    busy ||
                    password.length === 0 ||
                    (isCreate && confirm.length === 0)
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#07090E]"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white dark:text-[#07090E]" />
                      {isCreate ? "Creando…" : "Verificando…"}
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4 text-white dark:text-[#07090E]" />
                      {isCreate ? "Crear y autorizar" : "Autorizar descarga"}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

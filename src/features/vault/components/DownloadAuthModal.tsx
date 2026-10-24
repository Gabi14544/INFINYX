/**
 * DownloadAuthModal.tsx
 * ---------------------------------------------------------------------------
 * Modal de seguridad para la "Contraseña de Descarga" (tema Private Wealth):
 *
 * - Al abrirse consulta `profiles(download_verifier, download_salt)` del
 *   usuario autenticado.
 * - Si NO hay verificador: vista "Crear Contraseña Única de Descarga"
 *   (contraseña + confirmación). Genera salt aleatorio hex, deriva el hash
 *   con PBKDF2-SHA256 (100.000 iteraciones), hace `update` en `profiles` y
 *   guarda la contraseña en RAM (`useDownloadAuthStore`).
 * - Si SÍ hay verificador: vista "Ingresar Contraseña de Descarga".
 *   Deriva el hash con el salt guardado y lo compara (tiempo constante) con
 *   `download_verifier`; si coincide, la guarda en RAM.
 *
 * Tras un `onAuthenticated` exitoso el llamador (dashboard) ejecuta la
 * descarga pendiente del archivo seleccionado.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';
import {
  deriveDownloadVerifier,
  generateDownloadSaltHex,
  timingSafeEqualHex,
} from '../../../core/crypto/vaultCrypto';
import { useAuthStore } from '../../auth/stores/useAuthStore';
import { useDownloadAuthStore } from '../stores/useDownloadAuthStore';

interface DownloadAuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Se invoca con la contraseña validada (ya guardada en RAM). */
  onAuthenticated?: (password: string) => void;
}

type ModalMode = 'loading' | 'create' | 'enter';

const MIN_PASSWORD_LENGTH = 8;

export default function DownloadAuthModal({ open, onClose, onAuthenticated }: DownloadAuthModalProps) {
  const user = useAuthStore((s) => s.user);
  const setDownloadSessionPassword = useDownloadAuthStore((s) => s.setDownloadSessionPassword);

  const [mode, setMode] = useState<ModalMode>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura: estado limpio + consulta del verificador existente.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const resolveMode = async () => {
      setPassword('');
      setConfirm('');
      setShowPassword(false);
      setBusy(false);
      setError(null);
      setMode('loading');

      try {
        const activeUser =
          user ?? useAuthStore.getState().user ?? useAuthStore.getState().session?.user ?? null;
        if (!activeUser) {
          if (!cancelled) {
            setError('No hay un usuario autenticado en la sesión actual.');
            setMode('enter');
          }
          return;
        }

        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('download_verifier, download_salt')
          .eq('id', activeUser.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (cancelled) return;

        const hasVerifier =
          typeof data?.download_verifier === 'string' &&
          data.download_verifier.length > 0 &&
          typeof data?.download_salt === 'string' &&
          data.download_salt.length > 0;

        setMode(hasVerifier ? 'enter' : 'create');
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : 'No se pudo consultar el estado de la contraseña de descarga.',
        );
        // Ante duda se ofrece la vista de ingreso (no se sobrescribe nada).
        setMode('enter');
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
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('La confirmación no coincide con la contraseña.');
      return;
    }

    const activeUser =
      user ?? useAuthStore.getState().user ?? useAuthStore.getState().session?.user ?? null;
    if (!activeUser) {
      setError('No hay un usuario autenticado en la sesión actual.');
      return;
    }

    setBusy(true);
    try {
      const saltHex = generateDownloadSaltHex();
      const verifier = await deriveDownloadVerifier(password, saltHex);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ download_verifier: verifier, download_salt: saltHex })
        .eq('id', activeUser.id);

      if (updateError) throw updateError;

      // Sólo en RAM: nunca en localStorage/sessionStorage.
      setDownloadSessionPassword(password);
      const authenticatedPassword = password;
      setPassword('');
      setConfirm('');
      onAuthenticated?.(authenticatedPassword);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'No se pudo crear la contraseña de descarga.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleEnter = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length === 0) {
      setError('Introduce tu contraseña de descarga.');
      return;
    }

    const activeUser =
      user ?? useAuthStore.getState().user ?? useAuthStore.getState().session?.user ?? null;
    if (!activeUser) {
      setError('No hay un usuario autenticado en la sesión actual.');
      return;
    }

    setBusy(true);
    try {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('download_verifier, download_salt')
        .eq('id', activeUser.id)
        .maybeSingle();

      if (profileError) throw profileError;

      const storedVerifier = data?.download_verifier ?? null;
      const storedSalt = data?.download_salt ?? null;

      if (
        typeof storedVerifier !== 'string' ||
        storedVerifier.length === 0 ||
        typeof storedSalt !== 'string' ||
        storedSalt.length === 0
      ) {
        setMode('create');
        setError('Aún no tienes contraseña de descarga: créala ahora.');
        return;
      }

      const candidate = await deriveDownloadVerifier(password, storedSalt);
      if (!timingSafeEqualHex(candidate, storedVerifier)) {
        setError('Contraseña de descarga incorrecta.');
        return;
      }

      setDownloadSessionPassword(password);
      const authenticatedPassword = password;
      setPassword('');
      setConfirm('');
      onAuthenticated?.(authenticatedPassword);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'No se pudo verificar la contraseña de descarga.',
      );
    } finally {
      setBusy(false);
    }
  };

  const isCreate = mode === 'create';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isCreate ? 'Crear contraseña única de descarga' : 'Ingresar contraseña de descarga'
      }
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white text-[#181816] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EFECE6] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] text-[#6E6053]">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-editorial text-lg font-semibold text-[#181816]">
                {mode === 'loading'
                  ? 'Verificando seguridad…'
                  : isCreate
                    ? 'Crear Contraseña Única de Descarga'
                    : 'Ingresar Contraseña de Descarga'}
              </h3>
              <p className="text-xs text-[#6E6A63]">
                {isCreate
                  ? 'Se usará para autorizar cada descarga en esta sesión'
                  : 'Autoriza la descarga del archivo seleccionado'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-[#8C867B] transition hover:bg-[#F3F1EC] hover:text-[#181816] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {mode === 'loading' ? (
            <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-[#6E6A63]">
              <Loader2 className="h-5 w-5 animate-spin text-[#6E6053]" />
              Consultando credenciales de autorización…
            </div>
          ) : (
            <form onSubmit={isCreate ? handleCreate : handleEnter} className="space-y-4">
              <p className="flex items-start gap-2.5 rounded-lg border border-[#E5E0D5] bg-[#F8F6F1] px-3.5 py-3 text-xs leading-relaxed text-[#5C5346]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6E6053]" />
                {isCreate
                  ? 'Se generará un salt aleatorio y un verificador PBKDF2-SHA256 (100.000 iteraciones). La contraseña en claro sólo vivirá en la memoria RAM de esta pestaña.'
                  : 'Derivamos el hash con tu salt guardado y lo comparamos con el verificador. Al validarse, la contraseña queda en RAM hasta recargar o cerrar sesión.'}
              </p>

              <div className="space-y-1.5">
                <label htmlFor="download-password" className="text-sm font-medium text-[#181816]">
                  {isCreate ? 'Nueva contraseña de descarga' : 'Contraseña de descarga'}
                </label>
                <div className="relative">
                  <input
                    id="download-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={isCreate ? 'new-password' : 'current-password'}
                    placeholder={
                      isCreate
                        ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
                        : 'Tu contraseña de descarga'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoFocus
                    className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2.5 pr-11 text-sm text-[#181816] placeholder:text-[#9E9A91] outline-none transition focus:border-[#141413] focus:ring-2 focus:ring-[#141413]/10 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#6E6A63] transition hover:bg-[#F3F1EC] hover:text-[#181816] disabled:opacity-50"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isCreate && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="download-password-confirm"
                    className="text-sm font-medium text-[#181816]"
                  >
                    Confirmar contraseña
                  </label>
                  <input
                    id="download-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    placeholder="Repite la contraseña"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2.5 text-sm text-[#181816] placeholder:text-[#9E9A91] outline-none transition focus:border-[#141413] focus:ring-2 focus:ring-[#141413]/10 disabled:opacity-60"
                  />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-[#DCD9D0] bg-white px-4 py-2.5 text-sm font-medium text-[#181816] transition hover:bg-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || password.length === 0 || (isCreate && confirm.length === 0)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isCreate ? 'Creando…' : 'Verificando…'}
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4" />
                      {isCreate ? 'Crear y autorizar' : 'Autorizar descarga'}
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

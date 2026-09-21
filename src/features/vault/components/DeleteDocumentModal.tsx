/**
 * DeleteDocumentModal.tsx
 * ---------------------------------------------------------------------------
 * Modal de confirmación para eliminación segura y destructiva de documentos:
 *
 * Paso 1: Advertencia clara sobre la eliminación irreversible del documento
 *         y todas sus versiones físicas (.enc en Storage) y lógicas.
 * Paso 2: Validación de seguridad con contraseña en RAM:
 *         - Si `downloadSessionPassword` ya está en memoria RAM para la sesión
 *           activa, permite confirmar la eliminación inmediatamente.
 *         - Si `downloadSessionPassword` es null, solicita la Contraseña de
 *           Descarga/Autorización de la cuenta, validándola con PBKDF2-SHA256
 *           contra `download_verifier` y `download_salt` en `profiles`.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { deriveDownloadVerifier, timingSafeEqualHex } from '../../../core/crypto/vaultCrypto';
import { supabase } from '../../../shared/lib/supabase';
import type { VaultDocument } from '../../../shared/types';
import { useAuthStore } from '../../auth/stores/useAuthStore';
import { useDownloadAuthStore } from '../stores/useDownloadAuthStore';
import { useVaultStore } from '../stores/useVaultStore';
import { formatSize } from '../utils/formatters';

interface DeleteDocumentModalProps {
  doc: VaultDocument | null;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

export default function DeleteDocumentModal({
  doc,
  open,
  onClose,
  onDeleted,
}: DeleteDocumentModalProps) {
  const user = useAuthStore((s) => s.user);
  const downloadSessionPassword = useDownloadAuthStore((s) => s.downloadSessionPassword);
  const setDownloadSessionPassword = useDownloadAuthStore((s) => s.setDownloadSessionPassword);
  const deleteDocument = useVaultStore((s) => s.deleteDocument);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reiniciar estado cada vez que se abre el modal
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setShowPassword(false);
    setBusy(false);
    setError(null);
  }, [open]);

  // Cierre con la tecla Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  if (!open || !doc) return null;

  const handleDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const activeUser =
      user ?? useAuthStore.getState().user ?? useAuthStore.getState().session?.user ?? null;
    if (!activeUser) {
      setError('No hay un usuario autenticado en la sesión actual.');
      return;
    }

    setBusy(true);

    try {
      // Paso 2: Validación de Seguridad si la contraseña no está en RAM
      if (downloadSessionPassword === null) {
        if (password.length === 0) {
          setError('Introduce tu contraseña de descarga/autorización.');
          setBusy(false);
          return;
        }

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
          setError(
            'Aún no has configurado una contraseña de descarga/autorización en tu cuenta. Configúrala antes de realizar operaciones protegidas.',
          );
          setBusy(false);
          return;
        }

        const candidate = await deriveDownloadVerifier(password, storedSalt);
        if (!timingSafeEqualHex(candidate, storedVerifier)) {
          setError('Contraseña de descarga/autorización incorrecta.');
          setBusy(false);
          return;
        }

        // Autorización exitosa: guardamos en RAM para la sesión activa
        setDownloadSessionPassword(password);
      }

      // Ejecutar la eliminación del documento y sus versiones
      const success = await deleteDocument(doc.id);
      if (success) {
        onDeleted?.();
        onClose();
      } else {
        const currentStoreError = useVaultStore.getState().error;
        setError(currentStoreError ?? 'No se pudo eliminar el documento de la bóveda.');
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'Ocurrió un error inesperado al procesar la eliminación.',
      );
    } finally {
      setBusy(false);
    }
  };

  const hasAuthorizedSession = downloadSessionPassword !== null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-document-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-red-500/20 bg-slate-900 shadow-2xl shadow-red-950/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 ring-1 ring-red-500/30">
              <Trash2 className="h-5 w-5 text-red-400" />
            </span>
            <div>
              <h3 id="delete-document-modal-title" className="font-semibold text-white">
                Eliminar documento
              </h3>
              <p className="text-xs text-zinc-500">Operación destructiva irreversible</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenido del modal */}
        <form onSubmit={handleDelete} className="space-y-4 px-6 py-5">
          {/* Paso 1: Advertencia clara e irreversible */}
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs leading-relaxed text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold text-red-300">¿Deseas eliminar permanentemente este documento y todas sus versiones?</p>
              <p className="mt-1 text-red-200/90">Esta acción es irreversible.</p>
            </div>
          </div>

          {/* Ficha del documento a eliminar */}
          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20">
              <FileText className="h-4 w-4 text-blue-400" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white" title={doc.name}>
                {doc.name}
              </p>
              <p className="text-xs text-zinc-500">
                {doc.versionCount} versión{doc.versionCount === 1 ? '' : 'es'} registrada{doc.versionCount === 1 ? '' : 's'}
                {doc.latestVersion ? ` · ${formatSize(doc.latestVersion.file_size)}` : ''}
              </p>
            </div>
          </div>

          {/* Paso 2: Validación de Seguridad */}
          {hasAuthorizedSession ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="font-medium text-emerald-200">Autorización activa en RAM</p>
                <p className="mt-0.5 text-emerald-300/80">
                  La sesión ya cuenta con tu contraseña en memoria. Puedes confirmar la eliminación directamente.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                <KeyRound className="h-4 w-4 text-amber-400" />
                <span>Autorización requerida</span>
              </div>
              <p className="text-xs text-zinc-400">
                Introduce la Contraseña de Descarga/Autorización de tu cuenta para autorizar la eliminación permanente:
              </p>
              <div className="relative mt-2">
                <input
                  id="delete-auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Contraseña de autorización"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoFocus
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 pr-11 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={busy}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Mensaje de error si falla la autorización o eliminación */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || (!hasAuthorizedSession && password.length === 0)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Eliminar documento
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}

/**
 * DeleteDocumentModal.tsx
 * ---------------------------------------------------------------------------
 * Modal de confirmación para eliminación segura y destructiva de documentos
 * (tema INFINYX / Hexa-Mugen Dual):
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
    queueMicrotask(() => {
      setPassword('');
      setShowPassword(false);
      setBusy(false);
      setError(null);
    });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:shadow-black/80 dark:ring-[#38BDF8]/15"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <h3 id="delete-document-modal-title" className="text-lg font-semibold text-slate-900 dark:text-[#F8FAFC]">
                Eliminar documento
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">Operación destructiva irreversible</p>
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

        {/* Contenido del modal con scroll si es necesario */}
        <form onSubmit={handleDelete} className="space-y-4 overflow-y-auto px-6 py-5">
          {/* Paso 1: Advertencia clara e irreversible */}
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
            <div>
              <p className="font-semibold text-red-950 dark:text-red-100">
                ¿Deseas eliminar permanentemente este documento y todas sus versiones?
              </p>
              <p className="mt-1 text-red-800/90 dark:text-red-200/90">
                Esta acción es irreversible y eliminará el archivo tanto de la base de datos como del
                almacenamiento en la nube.
              </p>
            </div>
          </div>

          {/* Ficha del documento a eliminar */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#1E293B] dark:bg-[#07090E]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#F8FAFC]" title={doc.name}>
                {doc.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                {doc.versionCount} versión{doc.versionCount === 1 ? '' : 'es'} registrada{doc.versionCount === 1 ? '' : 's'}
                {doc.latestVersion ? ` · ${formatSize(doc.latestVersion.file_size)}` : ''}
              </p>
            </div>
          </div>

          {/* Paso 2: Validación de Seguridad */}
          {hasAuthorizedSession ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-xs text-sky-800 dark:border-[#38BDF8]/30 dark:bg-[#0284C7]/15 dark:text-[#BAE6FD]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0284C7] dark:text-[#38BDF8]" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-[#F8FAFC]">Autorización activa en RAM</p>
                <p className="mt-0.5 text-sky-700 dark:text-[#BAE6FD]/90">
                  La sesión ya cuenta con tu contraseña en memoria. Puedes confirmar la eliminación directamente.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#1E293B] dark:bg-[#07090E]">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-[#F8FAFC]">
                <KeyRound className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />
                <span>Autorización requerida</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
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
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-red-500 dark:focus:ring-red-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={busy}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#BAE6FD]"
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
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Botones de acción */}
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
              disabled={busy || (!hasAuthorizedSession && password.length === 0)}
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

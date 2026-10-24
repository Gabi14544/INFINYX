/**
 * VaultDashboard.tsx
 * ---------------------------------------------------------------------------
 * Dashboard institucional "INFINYX" de la bóveda:
 *   1) "Descargar archivo" (flujo gateado por la contraseña en RAM).
 *   2) "Visualizar" (modal centrado y limpio con metadatos y copiado de huella).
 *   3) "Eliminar" (modal de confirmación irreversible y autorización en RAM).
 *   4) Soporte completo de tema dual (Modo Claro / Modo Oscuro).
 *
 * Flujo de descarga
 * -----------------
 * - Si `downloadSessionPassword` ya está en RAM, se descifra y descarga
 *   directamente con la `vaultKey` AES-GCM.
 * - Si es `null`, se abre `DownloadAuthModal`; tras validarse, el callback
 *   `onAuthenticated` ejecuta la descarga del archivo pendiente.
 * - La contraseña de descarga es sólo una compuerta de autorización: el
 *   descifrado sigue usando la `vaultKey` (Zero-Knowledge intacto).
 * - Al cerrar sesión se destruye la contraseña en RAM; al recargar la
 *   página vuelve a `null` automáticamente (el store no usa `persist`).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import HexaMugenLogo from '../../../shared/components/HexaMugenLogo';
import ThemeToggle from '../../../shared/components/ThemeToggle';
import { useAuthStore } from '../../auth/stores/useAuthStore';
import { toVersionDescriptor, useVaultStore } from '../stores/useVaultStore';
import { useDownloadAuthStore } from '../stores/useDownloadAuthStore';
import type { VaultDocument } from '../../../shared/types';
import DocumentRow from './DocumentRow';
import DownloadAuthModal from './DownloadAuthModal';
import FileUploadModal from './FileUploadModal';

export default function VaultDashboard() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<VaultDocument | null>(null);

  // Estados locales para búsqueda y filtrado en RAM
  const [searchQuery, setSearchQuery] = useState('');
  const [versionFilter, setVersionFilter] = useState<'all' | 'v1' | 'multi'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'largest' | 'name'>('newest');

  const vaultKey = useAuthStore((s) => s.vaultKey);
  const signOut = useAuthStore((s) => s.signOut);

  const documents = useVaultStore((s) => s.documents);
  const isLoading = useVaultStore((s) => s.isLoading);
  const error = useVaultStore((s) => s.error);
  const fetchDocuments = useVaultStore((s) => s.fetchDocuments);
  const downloadAndDecrypt = useVaultStore((s) => s.downloadAndDecrypt);
  const clearError = useVaultStore((s) => s.clearError);
  const resetVault = useVaultStore((s) => s.reset);

  const downloadSessionPassword = useDownloadAuthStore((s) => s.downloadSessionPassword);
  const clearDownloadSessionPassword = useDownloadAuthStore((s) => s.clearDownloadSessionPassword);

  useEffect(() => {
    if (vaultKey) {
      void fetchDocuments();
    }
    // Carga inicial al desbloquear; no se repite en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey]);

  /** Filtrado y ordenación 100 % en memoria RAM sin llamadas adicionales a red */
  const filteredDocuments = useMemo(() => {
    let result = documents;

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((doc) => {
        const matchName = doc.name.toLowerCase().includes(query);
        const matchHash = doc.latestVersion?.sha256_hash.toLowerCase().includes(query) ?? false;
        return matchName || matchHash;
      });
    }

    if (versionFilter === 'v1') {
      result = result.filter((doc) => (doc.latestVersion?.version_number ?? 1) === 1);
    } else if (versionFilter === 'multi') {
      result = result.filter(
        (doc) => (doc.latestVersion?.version_number ?? 1) > 1 || doc.versionCount > 1,
      );
    }

    return [...result].sort((a, b) => {
      if (sortOrder === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (sortOrder === 'largest') {
        const sizeA = a.latestVersion?.file_size ?? 0;
        const sizeB = b.latestVersion?.file_size ?? 0;
        return sizeB - sizeA;
      }
      const dateA = new Date(a.latestVersion?.created_at ?? a.createdAt).getTime();
      const dateB = new Date(b.latestVersion?.created_at ?? b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [documents, searchQuery, versionFilter, sortOrder]);

  /** Ejecuta el pipeline inverso (descargar -> descifrar -> validar -> entregar). */
  const runDownload = async (doc: VaultDocument) => {
    const descriptor = toVersionDescriptor(doc);
    if (!descriptor || !vaultKey || downloadingId) return;
    setDownloadingId(doc.id);
    clearError();
    await downloadAndDecrypt(descriptor, vaultKey);
    setDownloadingId(null);
  };

  /**
   * Pulsación de "Descargar archivo":
   * - Con contraseña en RAM -> descarga directa.
   * - Sin ella -> se encola el documento y se abre el modal de seguridad.
   */
  const handleDownload = (doc: VaultDocument) => {
    if (downloadingId) return;
    if (downloadSessionPassword !== null) {
      void runDownload(doc);
      return;
    }
    setPendingDoc(doc);
    setAuthModalOpen(true);
  };

  /** Tras validarse en el modal, descarga el archivo que quedó encolado. */
  const handleAuthenticated = () => {
    setAuthModalOpen(false);
    const target = pendingDoc;
    setPendingDoc(null);
    if (target) {
      void runDownload(target);
    }
  };

  const handleAuthModalClose = () => {
    setAuthModalOpen(false);
    setPendingDoc(null);
  };

  const handleSignOut = async () => {
    clearDownloadSessionPassword();
    resetVault();
    await signOut();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] transition-colors dark:bg-[#07090E] dark:text-[#F8FAFC]">
      {/* 1. Barra Superior (<header>) */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-md transition-colors dark:border-[#1E293B] dark:bg-[#07090E]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Izquierda (Marca INFINYX) */}
          <div className="flex items-center gap-3">
            <HexaMugenLogo className="h-8 w-12" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-wider text-[#0F172A] dark:text-[#F8FAFC]">
                INFINYX
              </span>
              <span className="text-[11px] text-slate-500 dark:text-[#94A3B8]">
                Bóveda de Seguridad
              </span>
            </div>
          </div>

          {/* Centro (Indicador activo Bóveda Documental) */}
          <div className="flex items-center justify-center">
            <span className="border-b-2 border-[#0284C7] py-1 text-sm font-medium text-sky-800 dark:border-[#38BDF8] dark:text-[#BAE6FD]">
              Bóveda Documental
            </span>
          </div>

          {/* Derecha (Conmutador de tema + Cerrar Sesión) */}
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-[#38BDF8]/40 hover:bg-slate-200 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:hover:bg-[#111827]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 2. Cabecera del Dashboard */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0F172A] sm:text-3xl dark:text-[#F8FAFC]">
              Documentos protegidos
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-[#94A3B8]">
              {documents.length === 0
                ? 'Tus archivos cifrados aparecerán aquí.'
                : `${documents.length} documento${documents.length === 1 ? '' : 's'} en custodia`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 dark:text-[#07090E]"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>Proteger Nuevo Documento</span>
          </button>
        </div>

        {/* 3. Barra de Búsqueda y Filtros Instantáneos en Cliente (100 % en memoria RAM) */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-12">
          {/* 1. Buscador */}
          <div className="relative sm:col-span-6 lg:col-span-6">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#64748B]" />
            <input
              type="text"
              placeholder="Buscar por nombre de documento o huella SHA-256…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:placeholder:text-[#64748B] dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
            />
          </div>

          {/* 2. Selector Filtrar por versión */}
          <div className="sm:col-span-3 lg:col-span-3">
            <select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value as 'all' | 'v1' | 'multi')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-[#0F172A] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
            >
              <option value="all">Todas las versiones</option>
              <option value="v1">Versión inicial (v1)</option>
              <option value="multi">Múltiples versiones (v2+)</option>
            </select>
          </div>

          {/* 3. Selector Ordenar por */}
          <div className="sm:col-span-3 lg:col-span-3">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'largest' | 'name')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-[#0F172A] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#F8FAFC] dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
            >
              <option value="newest">Más recientes primero</option>
              <option value="largest">Mayor tamaño</option>
              <option value="name">Nombre (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Advertencia informativa de contraseña en RAM */}
        {downloadSessionPassword === null && documents.length > 0 && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600 dark:border-[#1E293B] dark:bg-[#0D111A] dark:text-[#94A3B8]">
            Las descargas requieren tu contraseña de descarga: se solicitará una vez por pestaña y
            vivirá sólo en la memoria RAM hasta recargar o cerrar sesión.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
            <span className="flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-500/20"
            >
              Descartar
            </button>
          </div>
        )}

        {/* 4. Tarjeta Principal del Catálogo (<section>) */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-[#1E293B] dark:bg-[#0D111A] dark:shadow-2xl dark:shadow-black/60">
          {/* Encabezado interno de la tarjeta */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-[#1E293B]">
            <h2 className="text-base font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
              Documentos Recientes y de Alto Valor
            </h2>
            {documents.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-[#94A3B8]">
                Mostrando {filteredDocuments.length} de {documents.length}
              </span>
            )}
          </div>

          {isLoading && documents.length === 0 ? (
            <div className="flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-slate-500 dark:text-[#94A3B8]">
              <Loader2 className="h-5 w-5 animate-spin text-[#0284C7] dark:text-[#38BDF8]" />
              Descifrando catálogo de la bóveda…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-[#0284C7] shadow-sm dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8] dark:shadow-lg dark:shadow-sky-500/10">
                <FolderOpen className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-xl font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
                Tu bóveda está vacía
              </h3>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-[#94A3B8]">
                Comienza resguardando tu primer documento protegido bajo cifrado de grado militar
                AES-GCM-256.
              </p>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-5 inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 dark:text-[#07090E]"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Proteger Nuevo Documento</span>
              </button>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#0F172A] dark:text-[#F8FAFC]">
                No se encontraron documentos con los filtros seleccionados
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-[#94A3B8]">
                Prueba ajustando el término de búsqueda o restableciendo los selectores.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setVersionFilter('all');
                  setSortOrder('newest');
                }}
                className="mt-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:text-[#BAE6FD]"
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:border-[#1E293B] dark:bg-[#0A0E17] dark:text-[#94A3B8]">
                    <th scope="col" className="px-6 py-3.5 font-semibold">
                      Nombre del archivo
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      Versión
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      Huella SHA-256
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      Tamaño
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      Fecha
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-6 py-3.5 text-right font-semibold"
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#1E293B]/70">
                  {filteredDocuments.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      downloading={downloadingId}
                      onDownload={handleDownload}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Nota pie de página */}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#94A3B8]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
          La integridad SHA-256 se verifica tras cada descifrado. La clave vive sólo en la RAM de
          esta pestaña.
        </p>
      </main>

      {/* Modales */}
      <FileUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DownloadAuthModal
        open={authModalOpen}
        onClose={handleAuthModalClose}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}

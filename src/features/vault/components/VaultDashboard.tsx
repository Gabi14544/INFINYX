/**
 * VaultDashboard.tsx
 * ---------------------------------------------------------------------------
 * Dashboard institucional "Private Wealth" de la bóveda:
 *   1) "Descargar archivo" (flujo gateado por la contraseña en RAM).
 *   2) "Visualizar" (modal centrado y limpio con metadatos y copiado de huella).
 *   3) "Eliminar" (modal de confirmación irreversible y autorización en RAM).
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

  const user = useAuthStore((s) => s.user);
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
    <div className="min-h-screen bg-[#F8F7F4] text-[#181816]">
      {/* 1. Barra Superior en Negro Ébano (<header>) */}
      <header className="sticky top-0 z-10 border-b border-[#262523] bg-[#141413] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Izquierda (Marca) */}
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#24221F] ring-1 ring-[#3A3630]">
              <ShieldCheck className="h-5 w-5 text-[#C8B69E]" />
            </span>
            <div className="flex flex-col">
              <span className="font-editorial text-base font-semibold tracking-tight text-white">
                Tech-Value Vault
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[#8C867B]">
                Private Wealth Custody
              </span>
            </div>
          </div>

          {/* Centro (Navegación contextual limpia) */}
          <nav className="hidden items-center gap-6 md:flex">
            <span className="border-b-2 border-[#C8B69E] pb-1 text-sm font-medium text-white">
              Bóveda Documental
            </span>
            <span className="inline-flex items-center gap-1.5 pb-1 text-xs text-[#8C867B]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6E6053]" />
              Cifrado AES-GCM-256
            </span>
            <span className="inline-flex items-center gap-1.5 pb-1 text-xs text-[#8C867B]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6E6053]" />
              Registro SHA-256
            </span>
          </nav>

          {/* Derecha (Estado en RAM + Usuario + Cerrar Sesión) */}
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-md border border-[#857566] bg-[#6E6053] px-3 py-1 text-xs font-medium text-white shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E5D7C5] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FAF6EE]" />
              </span>
              Bóveda Cifrada en RAM
            </span>
            <span
              className="hidden max-w-[190px] truncate text-xs text-[#A8A29A] sm:inline"
              title={user?.email ?? ''}
            >
              {user?.email ?? 'Sesión corporativa'}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#33312E] bg-[#1F1E1C] px-3 py-1.5 text-xs font-medium text-[#E6E2DC] transition hover:bg-[#2C2A27]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 2. Cabecera del Dashboard (Título + Sello Bronce Topo + Botón Ébano) */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-editorial text-3xl font-semibold tracking-tight text-[#181816] sm:text-4xl">
              Bóveda Documental Institucional
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-[#6E6A63]">
                {documents.length === 0
                  ? 'Tus archivos cifrados aparecerán aquí.'
                  : `${documents.length} documento${documents.length === 1 ? '' : 's'} bajo custodia Zero-Knowledge.`}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#6E6053] px-3 py-0.5 text-xs font-medium text-white shadow-2xs">
                <ShieldCheck className="h-3.5 w-3.5" />
                Protegido con AES-GCM-256 · Zero-Knowledge
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#2B2A27]"
          >
            <Plus className="h-4 w-4" />
            + Proteger Nuevo Documento
          </button>
        </div>

        {/* 3. Barra de Búsqueda y Filtros Instantáneos en Cliente (100 % en memoria RAM) */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-12">
          {/* 1. Buscador */}
          <div className="relative sm:col-span-6 lg:col-span-6">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9E9A91]" />
            <input
              type="text"
              placeholder="Buscar por nombre de documento o huella SHA-256…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#DCD9D0] bg-white py-2 pl-9 pr-3.5 text-sm text-[#181816] placeholder:text-[#9E9A91] outline-none transition focus:border-[#6E6053] focus:ring-2 focus:ring-[#6E6053]/15"
            />
          </div>

          {/* 2. Selector Filtrar por versión */}
          <div className="sm:col-span-3 lg:col-span-3">
            <select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value as 'all' | 'v1' | 'multi')}
              className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2 text-sm text-[#181816] outline-none transition focus:border-[#6E6053] focus:ring-2 focus:ring-[#6E6053]/15"
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
              className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2 text-sm text-[#181816] outline-none transition focus:border-[#6E6053] focus:ring-2 focus:ring-[#6E6053]/15"
            >
              <option value="newest">Más recientes primero</option>
              <option value="largest">Mayor tamaño</option>
              <option value="name">Nombre (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Advertencia informativa de contraseña en RAM */}
        {downloadSessionPassword === null && documents.length > 0 && (
          <p className="mt-4 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-2.5 text-xs leading-relaxed text-[#5C5043]">
            Las descargas requieren tu contraseña de descarga: se solicitará una vez por pestaña y
            vivirá sólo en la memoria RAM hasta recargar o cerrar sesión.
          </p>
        )}

        {/* Notificación de error si existe */}
        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span className="flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
            >
              Descartar
            </button>
          </div>
        )}

        {/* 4. Tarjeta Principal del Catálogo (<section>) */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white shadow-[0_6px_28px_rgba(20,20,19,0.04)]">
          {/* Encabezado interno de la tarjeta */}
          <div className="flex items-center justify-between border-b border-[#EFECE6] px-6 py-4">
            <h2 className="text-base font-semibold text-[#181816]">
              Documentos Recientes y de Alto Valor
            </h2>
            {documents.length > 0 && (
              <span className="text-xs text-[#6E6A63]">
                Mostrando {filteredDocuments.length} de {documents.length}
              </span>
            )}
          </div>

          {isLoading && documents.length === 0 ? (
            <div className="flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-[#6E6A63]">
              <Loader2 className="h-5 w-5 animate-spin text-[#6E6053]" />
              Descifrando catálogo de la bóveda…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#D8D0C5] bg-[#F5F2EB] text-[#6E6053] shadow-xs">
                <FolderOpen className="h-7 w-7" />
              </span>
              <h3 className="font-editorial mt-4 text-xl font-semibold text-[#181816]">
                Tu bóveda está vacía
              </h3>
              <p className="mt-1 max-w-sm text-sm text-[#6E6A63]">
                Comienza resguardando tu primer documento protegido bajo cifrado de grado militar
                AES-GCM-256.
              </p>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#2B2A27]"
              >
                <Plus className="h-4 w-4" />
                Proteger Nuevo Documento
              </button>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#181816]">
                No se encontraron documentos con los filtros seleccionados
              </p>
              <p className="mt-1 text-xs text-[#6E6A63]">
                Prueba ajustando el término de búsqueda o restableciendo los selectores.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setVersionFilter('all');
                  setSortOrder('newest');
                }}
                className="mt-3 rounded-lg border border-[#DCD9D0] bg-white px-3 py-1.5 text-xs font-medium text-[#181816] hover:bg-[#F3F1EC]"
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E6E4DD] bg-[#F5F4EF] text-[11px] font-semibold uppercase tracking-wider text-[#6E6A63]">
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
                <tbody className="divide-y divide-[#EFECE6]">
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
        <p className="mt-4 flex items-center gap-1.5 text-xs text-[#8C867B]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#6E6053]" />
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

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  LogOut,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../../auth/stores/useAuthStore';
import { toVersionDescriptor, useVaultStore } from '../stores/useVaultStore';
import type { VaultDocument } from '../../../shared/types';
import FileUploadModal from './FileUploadModal';

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function shortHash(hash: string): string {
  return hash.length > 10 ? hash.slice(0, 10) : hash;
}

function DocumentRow({
  doc,
  downloading,
  onDownload,
}: {
  doc: VaultDocument;
  downloading: string | null;
  onDownload: (doc: VaultDocument) => void;
}) {
  const [copied, setCopied] = useState(false);
  const version = doc.latestVersion;
  const isBusy = downloading === doc.id;

  const handleCopy = async () => {
    if (!version) return;
    try {
      await navigator.clipboard.writeText(version.sha256_hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin portapapeles: se mantiene el hash visible para copia manual.
    }
  };

  return (
    <tr className="border-t border-zinc-800 transition hover:bg-slate-800/40">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20">
            <FileText className="h-4 w-4 text-blue-400" />
          </span>
          <span
            className="max-w-[220px] truncate text-sm font-medium text-white"
            title={doc.name}
          >
            {doc.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
          v{version?.version_number ?? '—'}
        </span>
      </td>
      <td className="px-4 py-3.5">
        {version ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400">
            {shortHash(version.sha256_hash)}…
            <button
              type="button"
              onClick={handleCopy}
              aria-label={`Copiar huella SHA-256 de ${doc.name}`}
              title={version.sha256_hash}
              className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-emerald-400"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </span>
        ) : (
          <span className="text-xs text-zinc-600">sin versión</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-sm text-zinc-400">
        {version ? formatSize(version.file_size) : '—'}
      </td>
      <td className="px-4 py-3.5 text-sm text-zinc-400">
        {version ? formatDate(version.created_at) : formatDate(doc.createdAt)}
      </td>
      <td className="px-4 py-3.5 text-right">
        <button
          type="button"
          onClick={() => onDownload(doc)}
          disabled={!version || isBusy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Descifrando…
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              Descargar y Descifrar
            </>
          )}
        </button>
      </td>
    </tr>
  );
}

export default function VaultDashboard() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (vaultKey) {
      void fetchDocuments();
    }
    // Carga inicial al desbloquear; no se repite en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey]);

  const handleDownload = async (doc: VaultDocument) => {
    const descriptor = toVersionDescriptor(doc);
    if (!descriptor || !vaultKey || downloadingId) return;
    setDownloadingId(doc.id);
    clearError();
    await downloadAndDecrypt(descriptor, vaultKey);
    setDownloadingId(null);
  };

  const handleSignOut = async () => {
    resetVault();
    await signOut();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header superior */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">
                Tech-Value Vault
              </p>
              <p className="max-w-[220px] truncate text-xs text-zinc-500" title={user?.email ?? ''}>
                {user?.email ?? 'Sesión corporativa'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Bóveda Cifrada en Memoria RAM
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Documentos protegidos
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {documents.length === 0
                ? 'Tus archivos cifrados aparecerán aquí.'
                : `${documents.length} documento${documents.length === 1 ? '' : 's'} bajo custodia Zero-Knowledge.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Proteger Nuevo Documento
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20"
            >
              Descartar
            </button>
          </div>
        )}

        {/* Tabla corporativa / estados */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-slate-900">
          {isLoading && documents.length === 0 ? (
            <div className="flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              Descifrando catálogo de la bóveda…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800 ring-1 ring-zinc-700">
                <FolderOpen className="h-7 w-7 text-zinc-500" />
              </span>
              <h2 className="mt-4 font-semibold text-white">
                Tu bóveda está vacía
              </h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-400">
                Tu bóveda está vacía. Comienza subiendo tu primer archivo
                protegido.
              </p>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                Proteger Nuevo Documento
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Nombre del archivo
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Versión
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Huella SHA-256
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tamaño
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Fecha
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
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

        <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-600">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/70" />
          La integridad SHA-256 se verifica tras cada descifrado. La clave vive
          sólo en la RAM de esta pestaña.
        </p>
      </main>

      <FileUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

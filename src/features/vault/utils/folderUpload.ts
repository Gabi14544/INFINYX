import { MAX_VAULT_FILE_SIZE_BYTES } from '../../../core/crypto/vaultCrypto';
import { formatSize } from './formatters';

/** Archivo listo para subirse a la bóveda con su nombre lógico (incluyendo carpeta si aplica). */
export interface PreparedVaultFile {
  file: File;
  logicalName: string;
}

const IGNORED_SYSTEM_FILES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  '.spotlight-v100',
  '.trashes',
]);

/**
 * Determina si un archivo pertenece a metadatos ocultos del sistema operativo
 * que deben omitirse al subir una carpeta completa.
 */
export function isIgnoredSystemFile(fileName: string): boolean {
  const trimmed = fileName.trim();
  if (trimmed.length === 0) return true;
  const segments = trimmed.split(/[/\\]/);
  const base = (segments[segments.length - 1] ?? '').toLowerCase();
  if (base.length === 0) return true;
  if (IGNORED_SYSTEM_FILES.has(base)) return true;
  if (base.startsWith('._')) return true;
  return false;
}

/**
 * Normaliza la ruta lógica de un archivo: si viene de una carpeta (`webkitRelativePath`
 * o ruta relativa del lector de directorios), conserva `Carpeta/Subcarpeta/archivo.ext`
 * usando barras `/` limpias.
 */
export function resolveLogicalDocumentName(
  file: File,
  customRelativePath?: string,
): string {
  const rawPath =
    customRelativePath && customRelativePath.trim().length > 0
      ? customRelativePath.trim()
      : typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.trim().length > 0
        ? file.webkitRelativePath.trim()
        : file.name.trim();

  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * Separa un nombre lógico (`Carpeta/Subcarpeta/archivo.pdf`) en `{ folderPath, baseName }`
 * para mostrar la carpeta como insignia visual en la tabla del Dashboard.
 */
export function splitFolderAndFileName(logicalName: string): {
  folderPath: string | null;
  baseName: string;
} {
  const normalized = logicalName.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return { folderPath: null, baseName: normalized };
  }
  const folderPath = normalized.slice(0, lastSlash);
  const baseName = normalized.slice(lastSlash + 1);
  return {
    folderPath: folderPath.length > 0 ? folderPath : null,
    baseName: baseName.length > 0 ? baseName : normalized,
  };
}

/**
 * Valida y prepara una lista de archivos (individuales o provenientes de una carpeta),
 * descartando archivos ocultos del SO y verificando que ninguno esté vacío ni supere los 50 MB.
 */
export function validateAndPrepareFiles(
  candidates: Array<{ file: File; relativePath?: string }>,
): { validFiles: PreparedVaultFile[]; error: string | null } {
  const filtered = candidates.filter(({ file, relativePath }) => {
    const nameToCheck = relativePath ?? (file.webkitRelativePath || file.name);
    return !isIgnoredSystemFile(nameToCheck);
  });

  if (filtered.length === 0) {
    return {
      validFiles: [],
      error: 'No se encontraron archivos válidos para cifrar.',
    };
  }

  const prepared: PreparedVaultFile[] = [];

  for (const item of filtered) {
    const logicalName = resolveLogicalDocumentName(item.file, item.relativePath);
    if (item.file.size === 0) {
      return {
        validFiles: [],
        error: `El archivo "${logicalName}" está vacío (0 bytes) y no puede procesarse.`,
      };
    }
    if (item.file.size > MAX_VAULT_FILE_SIZE_BYTES) {
      return {
        validFiles: [],
        error: `El archivo "${logicalName}" (${formatSize(item.file.size)}) supera el límite máximo de ${formatSize(MAX_VAULT_FILE_SIZE_BYTES)} permitido por archivo.`,
      };
    }
    prepared.push({ file: item.file, logicalName });
  }

  return { validFiles: prepared, error: null };
}

/**
 * Extrae recursivamente todos los archivos de un evento Drag & Drop,
 * soportando tanto archivos sueltos como carpetas completas con subcarpetas.
 */
export async function extractDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<Array<{ file: File; relativePath?: string }>> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({ file }));
  }

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && typeof item.webkitGetAsEntry === 'function') {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({ file }));
  }

  const results: Array<{ file: File; relativePath?: string }> = [];

  const readEntry = async (entry: FileSystemEntry, parentPath: string): Promise<void> => {
    const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      results.push({ file, relativePath: parentPath ? currentPath : undefined });
      return;
    }

    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const childEntries: FileSystemEntry[] = [];

      const readBatch = async (): Promise<void> => {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        if (batch.length > 0) {
          childEntries.push(...batch);
          await readBatch();
        }
      };

      await readBatch();
      for (const child of childEntries) {
        await readEntry(child, currentPath);
      }
    }
  };

  for (const entry of entries) {
    await readEntry(entry, '');
  }

  return results;
}

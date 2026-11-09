import { MAX_VAULT_FILE_SIZE_BYTES } from "../../../core/crypto/vaultCrypto";
import { formatSize } from "./formatters";
export const MAX_BATCH_FILES = 500;
const MAX_DEPTH = 32;
const MAX_ENTRIES = 10_000;
export interface PreparedVaultFile {
  file: File;
  logicalName: string;
}
const IGNORED = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".spotlight-v100",
  ".trashes",
  "__macosx",
]);
export function isIgnoredSystemFile(name: string): boolean {
  const segments = name.trim().split(/[/\\]/);
  return (
    !name.trim() ||
    segments.some(
      (part) => IGNORED.has(part.toLowerCase()) || part.startsWith("._"),
    )
  );
}
/** This is an encrypted display name, never a Storage path or a filesystem path. */
export function resolveLogicalDocumentName(
  file: File,
  customRelativePath?: string,
): string {
  const raw =
    customRelativePath?.trim() ||
    file.webkitRelativePath?.trim() ||
    file.name.trim();
  const name = raw
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .normalize("NFC");
  const parts = name.split("/");
  if (
    !name ||
    name.length > 1024 ||
    Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    parts.some((p) => p === "." || p === ".." || !p.trim()) ||
    parts.length > MAX_DEPTH
  ) {
    throw new Error("Ruta lógica inválida o demasiado profunda.");
  }
  return name;
}
export function splitFolderAndFileName(name: string): {
  folderPath: string | null;
  baseName: string;
} {
  const normalized = name.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index < 0
    ? { folderPath: null, baseName: normalized }
    : {
        folderPath: normalized.slice(0, index) || null,
        baseName: normalized.slice(index + 1) || normalized,
      };
}
export function validateAndPrepareFiles(
  candidates: Array<{ file: File; relativePath?: string }>,
): { validFiles: PreparedVaultFile[]; error: string | null } {
  const filtered = candidates.filter(
    ({ file, relativePath }) =>
      !isIgnoredSystemFile(
        relativePath || file.webkitRelativePath || file.name,
      ),
  );
  if (!filtered.length)
    return {
      validFiles: [],
      error: "No se encontraron archivos válidos para cifrar.",
    };
  if (filtered.length > MAX_BATCH_FILES)
    return {
      validFiles: [],
      error: `Selecciona como máximo ${MAX_BATCH_FILES} archivos por lote.`,
    };
  const prepared: PreparedVaultFile[] = [];
  const names = new Set<string>();
  for (const { file, relativePath } of filtered) {
    let logicalName: string;
    try {
      logicalName = resolveLogicalDocumentName(file, relativePath);
    } catch (error) {
      return {
        validFiles: [],
        error: error instanceof Error ? error.message : "Ruta inválida.",
      };
    }
    if (!file.size)
      return {
        validFiles: [],
        error: `El archivo "${logicalName}" está vacío (0 bytes) y no puede procesarse.`,
      };
    if (file.size > MAX_VAULT_FILE_SIZE_BYTES)
      return {
        validFiles: [],
        error: `El archivo "${logicalName}" (${formatSize(file.size)}) supera el límite máximo de ${formatSize(MAX_VAULT_FILE_SIZE_BYTES)} permitido por archivo.`,
      };
    if (names.has(logicalName))
      return {
        validFiles: [],
        error: `El lote contiene la ruta duplicada "${logicalName}".`,
      };
    names.add(logicalName);
    prepared.push({ file, logicalName });
  }
  return { validFiles: prepared, error: null };
}
export async function extractDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<Array<{ file: File; relativePath?: string }>> {
  // Capture entries synchronously: DataTransfer becomes protected after the drop handler yields.
  const entries: FileSystemEntry[] = [];
  const fallback: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry =
      typeof item.webkitGetAsEntry === "function"
        ? item.webkitGetAsEntry()
        : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile?.();
      if (file) fallback.push(file);
    }
  }
  if (!entries.length) {
    const files = fallback.length ? fallback : Array.from(dataTransfer.files);
    if (files.length > MAX_BATCH_FILES)
      throw new Error(
        `Selecciona como máximo ${MAX_BATCH_FILES} archivos por lote.`,
      );
    return files.map((file) => ({ file }));
  }
  const results: Array<{ file: File; relativePath?: string }> = [];
  let visited = 0;
  const add = (file: File, relativePath?: string) => {
    if (isIgnoredSystemFile(relativePath || file.name)) return;
    if (results.length >= MAX_BATCH_FILES)
      throw new Error(
        `Selecciona como máximo ${MAX_BATCH_FILES} archivos por lote.`,
      );
    results.push({ file, relativePath });
  };
  const readEntry = async (
    entry: FileSystemEntry,
    parent: string,
    depth: number,
  ): Promise<void> => {
    if (++visited > MAX_ENTRIES || depth > MAX_DEPTH)
      throw new Error("La carpeta tiene demasiadas entradas o niveles.");
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (isIgnoredSystemFile(path)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      add(file, parent ? path : undefined);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const children = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!children.length) break;
        for (const child of children) await readEntry(child, path, depth + 1);
      }
    }
  };
  for (const file of fallback) add(file);
  for (const entry of entries) await readEntry(entry, "", 1);
  return results;
}

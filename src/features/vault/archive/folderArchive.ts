import { zipSync } from "fflate";
import {
  MAX_VAULT_FILE_SIZE_BYTES,
  type FolderMetadata,
} from "../../../core/crypto/vaultCrypto";
import {
  validateAndPrepareFiles,
  resolveLogicalDocumentName,
  MAX_BATCH_FILES,
} from "../utils/folderUpload";
import type { PreparedVaultFile } from "../utils/folderUpload";
export type FolderInfo = FolderMetadata;
export type UploadUnit =
  | { kind: "file"; name: string; size: number; file: File }
  | {
      kind: "folder";
      name: string;
      size: number;
      entries: PreparedVaultFile[];
    };
export interface ArchiveEntry {
  path: string;
  data: Uint8Array<ArrayBuffer>;
}
/** Group roots before packaging: a folder is one upload, loose files remain individual. */
export function groupUploadUnits(
  candidates: Array<{ file: File; relativePath?: string }>,
): UploadUnit[] {
  const validated = validateAndPrepareFiles(candidates);
  if (validated.error) throw new Error(validated.error);
  const units: UploadUnit[] = [];
  const folders = new Map<string, Extract<UploadUnit, { kind: "folder" }>>();
  for (const item of validated.validFiles) {
    const index = item.logicalName.indexOf("/");
    if (index < 0) {
      units.push({
        kind: "file",
        name: item.logicalName,
        size: item.file.size,
        file: item.file,
      });
      continue;
    }
    const root = item.logicalName.slice(0, index);
    let folder = folders.get(root);
    if (!folder) {
      folder = { kind: "folder", name: root, size: 0, entries: [] };
      folders.set(root, folder);
      units.push(folder);
    }
    folder.size += item.file.size;
    folder.entries.push(item);
    if (folder.size > MAX_VAULT_FILE_SIZE_BYTES)
      throw new Error(`La carpeta "${root}" supera el límite total de 50 MiB.`);
  }
  return units;
}
/** Pure ZIP writer, executed in an owned worker in the browser. Cryptography stays in Web Crypto. */
export function buildFolderZip(
  root: string,
  entries: ArchiveEntry[],
): Uint8Array<ArrayBuffer> {
  if (
    !root ||
    root.includes("/") ||
    root.includes("\\") ||
    resolveLogicalDocumentName({ name: root } as File) !== root
  )
    throw new Error("Nombre de carpeta inválido.");
  if (!entries.length || entries.length > MAX_BATCH_FILES)
    throw new Error("Cantidad de archivos de carpeta inválida.");
  const names = new Set<string>();
  const files: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
  let total = 0;
  for (const entry of entries) {
    if (
      resolveLogicalDocumentName({ name: entry.path } as File) !== entry.path ||
      !entry.path.startsWith(root + "/") ||
      names.has(entry.path)
    )
      throw new Error("Ruta de carpeta inválida o duplicada.");
    total += entry.data.byteLength;
    if (total > MAX_VAULT_FILE_SIZE_BYTES)
      throw new Error("El contenido de la carpeta supera 50 MiB.");
    names.add(entry.path);
    files[entry.path] = entry.data;
  }
  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_VAULT_FILE_SIZE_BYTES)
    throw new Error(
      "El ZIP resultante supera 50 MiB. Reduce el contenido de la carpeta.",
    );
  return archive;
}

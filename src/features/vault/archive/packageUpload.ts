import type { UploadUnit, FolderInfo, ArchiveEntry } from "./folderArchive";
import { MAX_VAULT_FILE_SIZE_BYTES } from "../../../core/crypto/vaultCrypto";
export interface PackagedUpload {
  file: File;
  logicalName: string;
  folder?: FolderInfo;
}
export async function packageUpload(
  unit: UploadUnit,
  signal: AbortSignal,
): Promise<PackagedUpload> {
  signal.throwIfAborted();
  if (unit.kind === "file") return { file: unit.file, logicalName: unit.name };
  if (unit.size > MAX_VAULT_FILE_SIZE_BYTES)
    throw new Error("La carpeta supera el límite total de 50 MiB.");
  const entries: ArchiveEntry[] = [];
  for (const item of unit.entries) {
    signal.throwIfAborted();
    const buffer = await item.file.arrayBuffer();
    signal.throwIfAborted();
    entries.push({ path: item.logicalName, data: new Uint8Array(buffer) });
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(
      new URL("./folderArchive.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Preparación cancelada.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
      finish();
      if (
        data.buffer instanceof ArrayBuffer &&
        data.buffer.byteLength <= MAX_VAULT_FILE_SIZE_BYTES
      )
        resolve(data.buffer);
      else reject(new Error(data.error ?? "Paquete de carpeta inválido."));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("No se pudo empaquetar la carpeta."));
    };
    try {
      signal.throwIfAborted();
      worker.postMessage(
        { root: unit.name, entries },
        entries.map((e) => e.data.buffer),
      );
    } catch (error) {
      finish();
      reject(error);
    }
  });
  signal.throwIfAborted();
  return {
    file: new File([buffer], unit.name + ".zip", { type: "application/zip" }),
    logicalName: unit.name,
    folder: {
      kind: "folder",
      fileCount: unit.entries.length,
      originalSize: unit.size,
    },
  };
}

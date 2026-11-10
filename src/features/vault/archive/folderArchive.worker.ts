import { buildFolderZip } from "./folderArchive";
import type { ArchiveEntry } from "./folderArchive";
// This module runs only in the dedicated worker emitted by Vite, never in the main window.
const scope = globalThis as unknown as {
  onmessage:
    | ((event: MessageEvent<{ root: string; entries: ArchiveEntry[] }>) => void)
    | null;
  postMessage: (
    message: { buffer: ArrayBuffer } | { error: string },
    transfer: Transferable[],
  ) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const zip = buildFolderZip(data.root, data.entries);
    scope.postMessage({ buffer: zip.buffer }, [zip.buffer]);
  } catch (error) {
    scope.postMessage(
      {
        error:
          error instanceof Error ? error.message : "No se pudo crear el ZIP.",
      },
      [],
    );
  }
};

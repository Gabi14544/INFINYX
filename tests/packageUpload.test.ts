import { afterEach, expect, it, vi } from "vitest";
import { packageUpload } from "../src/features/vault/archive/packageUpload";
import type { UploadUnit } from "../src/features/vault/archive/folderArchive";

afterEach(() => vi.unstubAllGlobals());

it("does not read files or create workers after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = vi.fn();
  const worker = vi.fn();
  vi.stubGlobal("Worker", worker);
  const unit: UploadUnit = {
    kind: "folder",
    name: "Root",
    size: 1,
    entries: [
      {
        file: { arrayBuffer: read } as unknown as File,
        logicalName: "Root/a.txt",
      },
    ],
  };
  await expect(packageUpload(unit, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(read).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

it("terminates an active ZIP worker when the vault cancels preparation", async () => {
  const controller = new AbortController();
  const terminated = vi.fn();
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  class WorkerFixture {
    terminate = terminated;
    postMessage() {
      started();
    }
  }
  vi.stubGlobal("Worker", WorkerFixture);
  const unit: UploadUnit = {
    kind: "folder",
    name: "Root",
    size: 1,
    entries: [{ file: new File(["a"], "a.txt"), logicalName: "Root/a.txt" }],
  };
  const preparation = packageUpload(unit, controller.signal);
  const rejection = expect(preparation).rejects.toMatchObject({
    name: "AbortError",
  });
  await running;
  controller.abort();
  await rejection;
  expect(terminated).toHaveBeenCalledTimes(1);
});

/** Registered stores and temporary object URLs are cleared on lock, logout or user change. */
const cleanups = new Set<() => void>();
let generation = 0;
export function registerSensitiveCleanup(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}
export function clearSensitiveState(): void {
  generation += 1;
  for (const cleanup of cleanups) cleanup();
}
export function sensitiveGeneration(): number {
  return generation;
}

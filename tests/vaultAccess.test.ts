import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../src/shared/lib/supabase", () => ({
  supabase: { functions: { invoke: fake.invoke } },
}));
import { vaultAccess } from "../src/shared/lib/vaultAccess";
beforeEach(() => {
  fake.invoke.mockReset();
});
afterEach(() => vi.useRealTimers());

it("distinguishes missing credentials from an unavailable status endpoint", async () => {
  fake.invoke.mockResolvedValueOnce({
    data: { configured: false },
    error: null,
  });
  await expect(vaultAccess("status")).resolves.toEqual({ configured: false });
  fake.invoke.mockResolvedValueOnce({
    data: null,
    error: new Error("Failed to fetch"),
  });
  await expect(vaultAccess("status")).rejects.toThrow(
    "No se pudo consultar si existe",
  );
});

it("bounds a hung status request and aborts its transport", async () => {
  vi.useFakeTimers();
  fake.invoke.mockImplementation(() => new Promise(() => {}));
  const pending = vaultAccess("status");
  const rejected = expect(pending).rejects.toThrow(
    "No se pudo consultar si existe",
  );
  await vi.advanceTimersByTimeAsync(12_000);
  await rejected;
  expect(fake.invoke.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the timeout after successful responses and preserves credential errors", async () => {
  vi.useFakeTimers();
  fake.invoke.mockResolvedValueOnce({
    data: { configured: true },
    error: null,
  });
  await vaultAccess("status");
  expect(vi.getTimerCount()).toBe(0);
  fake.invoke.mockResolvedValueOnce({
    data: null,
    error: {
      context: new Response(
        JSON.stringify({ error: "Contraseña de autorización incorrecta." }),
        { status: 403 },
      ),
    },
  });
  await expect(vaultAccess("verify", "incorrect")).rejects.toThrow(
    "Contraseña de autorización incorrecta.",
  );
  expect(vi.getTimerCount()).toBe(0);
});

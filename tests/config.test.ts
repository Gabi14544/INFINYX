import { describe, expect, it } from "vitest";
import { readPublicConfig } from "../src/shared/lib/config";
import { readBoundedResponse } from "../src/shared/lib/boundedDownload";
describe("public configuration", () => {
  it("rejects missing bindings and insecure external endpoints", () => {
    expect(() => readPublicConfig({})).toThrow();
    expect(() =>
      readPublicConfig({
        VITE_SUPABASE_URL: "http://example.com",
        VITE_SUPABASE_ANON_KEY: "test",
      }),
    ).toThrow();
  });
  it("rejects server-only keys before booting the SDK", () => {
    const env = {
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "sb_secret_test",
    };
    expect(() => readPublicConfig(env)).toThrow();
    const jwt = `test.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
    expect(() =>
      readPublicConfig({ ...env, VITE_SUPABASE_ANON_KEY: jwt }),
    ).toThrow();
  });
  it("allows public keys with HTTPS and local development", () => {
    expect(
      readPublicConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co/",
        VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
      }).url,
    ).toBe("https://example.supabase.co");
  });
});
it("limits ciphertext while streaming even without Content-Length", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(8));
      c.enqueue(new Uint8Array(8));
      c.close();
    },
  });
  await expect(readBoundedResponse(new Response(stream), 10)).rejects.toThrow(
    "demasiado grande",
  );
  expect((await readBoundedResponse(new Response("abc"), 4)).byteLength).toBe(
    3,
  );
});

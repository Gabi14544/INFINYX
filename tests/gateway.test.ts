import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createHandler,
  verifier,
} from "../supabase/functions/vault-access/handler";
const userId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const password = "separate download password";
const salt = "ab".repeat(32);
let hash: string;
beforeAll(async () => {
  hash = await verifier(password, salt);
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function setup(
  options: {
    wrongOwner?: boolean;
    failDelete?: boolean;
    limited?: boolean;
    configured?: boolean;
    invalidSession?: boolean;
    failAudit?: boolean;
    missingOwner?: string;
    failDeleteFor?: string;
  } = {},
) {
  const calls: string[] = [];
  const fakeFetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace("https://project.supabase.co", "");
      calls.push(path);
      if (path === "/auth/v1/user")
        return options.invalidSession ? json({}, 401) : json({ id: userId });
      if (path.endsWith("/rpc/reserve_vault_attempt"))
        return json(!options.limited);
      if (path.startsWith("/rest/v1/vault_credentials"))
        return init?.method === "POST"
          ? json(null, 201)
          : json(
              options.configured === false ? [] : [{ salt, verifier: hash }],
            );
      if (path.startsWith("/rest/v1/document_versions?id="))
        return json([
          {
            document_id: documentId,
            storage_path: `${userId}/${documentId}/44444444-4444-4444-8444-444444444444.enc`,
          },
        ]);
      if (path.startsWith("/rest/v1/documents?")) {
        const filter =
          new URL("https://fixture" + path).searchParams.get("id") ?? "";
        const requested = filter.startsWith("in.(")
          ? filter.slice(4, -1).split(",")
          : [filter.slice(3)];
        return json(
          options.wrongOwner
            ? []
            : requested
                .filter((id) => id !== options.missingOwner)
                .map((id) => ({ id })),
        );
      }
      if (path.startsWith("/storage/v1/object/sign/"))
        return json({
          signedURL: "/object/sign/vault_files/test.enc?token=test-only",
        });
      if (path.startsWith("/rest/v1/document_versions?document_id=")) {
        const id = new URL("https://fixture" + path).searchParams
          .get("document_id")!
          .slice(3);
        return json([
          {
            storage_path: `${userId}/${id}/44444444-4444-4444-8444-444444444444.enc`,
          },
        ]);
      }
      if (path === "/storage/v1/object/vault_files") {
        const payload = JSON.parse(String(init?.body));
        return options.failDelete ||
          (options.failDeleteFor &&
            payload.prefixes.some((p: string) =>
              p.includes("/" + options.failDeleteFor + "/"),
            ))
          ? json({}, 503)
          : json([]);
      }
      if (path === "/rest/v1/audit_logs" && options.failAudit)
        return json({}, 503);
      if (path.startsWith("/rest/v1/rpc/") || path === "/rest/v1/audit_logs")
        return json(null);
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  const handler = createHandler(
    {
      url: "https://project.supabase.co",
      anonKey: "test-public",
      serviceKey: "test-server-only",
      allowedOrigins: ["https://app.example"],
    },
    fakeFetch as typeof fetch,
  );
  const call = (
    body: unknown,
    authorization = "Bearer test-session",
    origin = "https://app.example",
  ) =>
    handler(
      new Request("https://gateway.example", {
        method: "POST",
        headers: { authorization, origin },
        body: JSON.stringify(body),
      }),
    );
  return { call, calls, fakeFetch, handler };
}
describe("server authorization", () => {
  it("rejects missing/invalid sessions before using service privileges", async () => {
    const a = setup();
    expect((await a.call({ action: "status" }, "")).status).toBe(401);
    expect(a.calls).toHaveLength(0);
    const b = setup({ invalidSession: true });
    expect((await b.call({ action: "status" })).status).toBe(401);
    expect(b.calls).toHaveLength(1);
  });
  it("rejects unapproved origins and unexpected actions", async () => {
    const a = setup();
    expect(
      (await a.call({}, "Bearer test", "https://evil.example")).status,
    ).toBe(403);
    expect((await a.call({ action: "anything" })).status).toBe(400);
  });
  it("never exposes verifiers or service credentials in status", async () => {
    const a = setup();
    const response = await a.call({ action: "status" });
    expect(await response.json()).toEqual({ configured: true });
  });
  it("reserves rate limits before credential work", async () => {
    const a = setup({ limited: true });
    expect((await a.call({ action: "verify", password })).status).toBe(429);
    expect(a.calls.some((p) => p.includes("vault_credentials"))).toBe(false);
  });
  it("rejects a wrong password without reaching Storage", async () => {
    const a = setup();
    expect(
      (await a.call({ action: "download", versionId, password: "wrong" }))
        .status,
    ).toBe(403);
    expect(a.calls.some((p) => p.includes("/storage/"))).toBe(false);
  });
  it("does not let an owner change an existing second password", async () => {
    const a = setup();
    expect((await a.call({ action: "setup", password })).status).toBe(409);
  });
  it("creates a verifier only on the server", async () => {
    const a = setup({ configured: false });
    expect((await a.call({ action: "setup", password })).status).toBe(200);
    const stored = a.fakeFetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("vault_credentials") && init?.method === "POST",
    );
    expect(String(stored?.[1]?.body)).not.toContain(password);
  });
  it("rejects cross-user downloads and deletes before touching Storage", async () => {
    const a = setup({ wrongOwner: true });
    expect(
      (await a.call({ action: "download", versionId, password })).status,
    ).toBe(404);
    expect(
      (await a.call({ action: "delete", documentId, password })).status,
    ).toBe(404);
    expect(a.calls.some((p) => p.includes("/storage/"))).toBe(false);
  });
  it("grants a short-lived download and records server authorization", async () => {
    const a = setup();
    const result = await a.call({ action: "download", versionId, password });
    expect(result.status).toBe(200);
    expect((await result.json()).url).toContain("/storage/v1/object/sign/");
    expect(a.calls).toContain("/rest/v1/audit_logs");
  });
  it("does not release the URL when audit insertion fails", async () => {
    const a = setup({ failAudit: true });
    expect(
      (await a.call({ action: "download", versionId, password })).status,
    ).toBe(503);
  });
  it("preserves metadata when Storage deletion fails", async () => {
    const a = setup({ failDelete: true });
    expect(
      (await a.call({ action: "delete", documentId, password })).status,
    ).toBe(503);
    expect(a.calls).not.toContain("/rest/v1/rpc/finish_vault_delete");
  });
  it("finalizes deletion only after successful Storage removal", async () => {
    const a = setup();
    expect(
      (await a.call({ action: "delete", documentId, password })).status,
    ).toBe(200);
    expect(a.calls.indexOf("/rest/v1/rpc/finish_vault_delete")).toBeGreaterThan(
      a.calls.indexOf("/storage/v1/object/vault_files"),
    );
  });
  it("bounds streamed request bodies", async () => {
    const a = setup();
    expect(
      (await a.call({ action: "verify", password: "x".repeat(9000) })).status,
    ).toBe(413);
  });
});

const secondDocumentId = "55555555-5555-4555-8555-555555555555";
describe("server batch deletion", () => {
  it("rejects malformed, duplicate and oversized batches before touching Storage", async () => {
    for (const documentIds of [
      [],
      [documentId, documentId],
      ["malformed"],
      Array(51).fill(documentId),
    ]) {
      const a = setup();
      expect(
        (await a.call({ action: "delete-batch", documentIds, password }))
          .status,
      ).toBe(400);
      expect(
        a.calls.some(
          (p) => p.includes("/storage/") || p.includes("begin_vault_delete"),
        ),
      ).toBe(false);
    }
  });
  it("validates all owners before deleting any item of a mixed batch", async () => {
    const a = setup({ missingOwner: secondDocumentId });
    expect(
      (
        await a.call({
          action: "delete-batch",
          documentIds: [documentId, secondDocumentId],
          password,
        })
      ).status,
    ).toBe(404);
    expect(
      a.calls.some(
        (p) => p.includes("/storage/") || p.includes("begin_vault_delete"),
      ),
    ).toBe(false);
  });
  it("requires the second password for bulk actions too", async () => {
    const a = setup();
    expect(
      (
        await a.call({
          action: "delete-batch",
          documentIds: [documentId],
          password: "wrong",
        })
      ).status,
    ).toBe(403);
    expect(a.calls.some((p) => p.includes("/storage/"))).toBe(false);
  });
  it("finalizes each success and returns only confirmed ids", async () => {
    const a = setup();
    const response = await a.call({
      action: "delete-batch",
      documentIds: [documentId, secondDocumentId],
      password,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      deletedIds: [documentId, secondDocumentId],
      failedIds: [],
    });
    expect(
      a.calls.filter((p) => p.endsWith("/finish_vault_delete")),
    ).toHaveLength(2);
  });
  it("reports partial failures and never finalizes the failed Storage deletion", async () => {
    const a = setup({ failDeleteFor: secondDocumentId });
    const response = await a.call({
      action: "delete-batch",
      documentIds: [documentId, secondDocumentId],
      password,
    });
    expect(await response.json()).toEqual({
      ok: true,
      deletedIds: [documentId],
      failedIds: [secondDocumentId],
    });
    const finalized = a.fakeFetch.mock.calls
      .filter(([url]) => String(url).endsWith("/finish_vault_delete"))
      .map(([, init]) => JSON.parse(String(init?.body)).p_document_id);
    expect(finalized).toEqual([documentId]);
  });
});

import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
export const userId = "11111111-1111-4111-8111-111111111111";
export const master = "long browser test passphrase";
export const email = "alice@example.test";
const user = {
  id: userId,
  email,
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
};
interface Row {
  id: string;
  user_id: string;
  deleting: boolean;
  created_at: string;
  updated_at: string;
}
interface Version {
  id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  iv: string;
  encrypted_metadata: string;
  created_at: string;
}
export async function vaultFixture(page: Page, initiallyConfigured = false) {
  const state = {
    configured: initiallyConfigured,
    password: "additional browser test password",
    setupCalls: 0,
    verifyCalls: 0,
    downloadCalls: 0,
    uploads: 0,
    rows: [] as Row[],
    versions: [] as Version[],
    objects: new Map<string, Buffer>(),
  };
  const token = () =>
    `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test-signature`;
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = async (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (path === "/auth/v1/token")
      return reply({
        access_token: token(),
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    if (path === "/auth/v1/user") return reply(user);
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
    if (path === "/rest/v1/profiles")
      return reply({ id: userId, vault_salt: "ab".repeat(32) });
    if (path === "/rest/v1/documents") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      return reply(state.rows.slice(offset, offset + limit));
    }
    if (path === "/rest/v1/document_versions") return reply(state.versions);
    if (path === "/rest/v1/rpc/commit_vault_version") {
      const args = request.postDataJSON();
      const now = new Date().toISOString();
      const id = randomUUID();
      if (!state.rows.some((r) => r.id === args.p_document_id))
        state.rows.push({
          id: args.p_document_id,
          user_id: userId,
          deleting: false,
          created_at: now,
          updated_at: now,
        });
      state.versions.push({
        id,
        document_id: args.p_document_id,
        version_number: args.p_version_number,
        storage_path: args.p_storage_path,
        iv: args.p_iv,
        encrypted_metadata: args.p_metadata,
        created_at: now,
      });
      return reply(id);
    }
    const prefix = "/storage/v1/object/vault_files/";
    if (path.startsWith(prefix) && request.method() === "POST") {
      const bytes = request.postDataBuffer()!;
      let cipher = bytes;
      const contentType = request.headers()["content-type"] ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        const form = await new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": contentType },
        }).formData();
        const part = Array.from(form.values()).find((v) => v instanceof Blob);
        if (!(part instanceof Blob))
          throw new Error("No ciphertext file in Storage request");
        cipher = Buffer.from(await part.arrayBuffer());
      }
      state.objects.set(decodeURIComponent(path.slice(prefix.length)), cipher);
      state.uploads++;
      return reply({ Key: path.slice("/storage/v1/object/".length) }, 200);
    }
    const signed = "/storage/v1/object/sign/vault_files/";
    if (path.startsWith(signed)) {
      const bytes = state.objects.get(
        decodeURIComponent(path.slice(signed.length)),
      );
      return route.fulfill({
        status: bytes ? 200 : 404,
        contentType: "application/octet-stream",
        body: bytes ?? Buffer.alloc(0),
      });
    }
    if (path === "/functions/v1/vault-access") {
      const body = request.postDataJSON();
      if (body.action === "status")
        return reply({ configured: state.configured });
      if (body.action === "setup") {
        if (state.configured) return reply({ error: "Ya configurada" }, 409);
        state.configured = true;
        state.password = body.password;
        state.setupCalls++;
        return reply({ ok: true });
      }
      if (body.password !== state.password)
        return reply({ error: "Contraseña de autorización incorrecta." }, 403);
      if (body.action === "verify") {
        state.verifyCalls++;
        return reply({ ok: true });
      }
      if (body.action === "download") {
        const v = state.versions.find((v) => v.id === body.versionId);
        if (!v) return reply({ error: "No disponible" }, 404);
        state.downloadCalls++;
        return reply({
          url:
            "https://test-project.supabase.co" +
            signed +
            v.storage_path +
            "?token=fixture",
        });
      }
      if (body.action === "delete" || body.action === "delete-batch") {
        const ids: string[] = body.documentIds ?? [body.documentId];
        for (const version of state.versions.filter((v) =>
          ids.includes(v.document_id),
        ))
          state.objects.delete(version.storage_path);
        state.rows = state.rows.filter((r) => !ids.includes(r.id));
        state.versions = state.versions.filter(
          (v) => !ids.includes(v.document_id),
        );
        return reply(
          body.action === "delete"
            ? { ok: true }
            : { ok: true, deletedIds: ids, failedIds: [] },
        );
      }
    }
    throw new Error(
      `Unexpected mocked API request ${request.method()} ${path}`,
    );
  });
  return state;
}
export async function login(page: Page, navigate = true) {
  if (navigate) await page.goto("/");
  await page.getByLabel("Email corporativo").fill(email);
  await page.getByLabel("Contraseña maestra", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Desbloquear bóveda" }).click();
}

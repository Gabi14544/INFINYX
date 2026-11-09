import { localGateway } from "./localGateway.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import * as c from "../../src/core/crypto/vaultCrypto.ts";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
// Explicit remote integration test: creates two temporary confirmed users, sends no emails,
// and removes only its own fixtures. Never run implicitly from CI or the default unit suite.
const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !anon || !token)
  throw new Error(
    "Configure VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_ACCESS_TOKEN securely.",
  );
const ref = new URL(url).hostname.split(".")[0];
if (!/^[a-z0-9]+$/.test(ref))
  throw new Error("Use the standard Supabase project hostname for this test.");
const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/api-keys`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!keyResponse.ok)
  throw new Error(`Management API rejected access: ${keyResponse.status}`);
const keys = await keyResponse.json();
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!service) throw new Error("Server test credentials are unavailable.");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(url, service, options);
const localHandler = await localGateway({ url, anon, service });
const users = [];
const paths = [];
let assertions = 0;
function check(value, label) {
  assert(value, label);
  assertions++;
  console.log("PASS:", label);
}
function ok(result, label) {
  if (result.error)
    throw new Error(
      label +
        ": " +
        result.error.message +
        ` [HTTP ${result.status ?? result.error.context?.status ?? "?"}; code ${result.error.code ?? result.error.name ?? "?"}]`,
    );
  return result.data;
}
async function gateway(client, body) {
  if (!localHandler)
    return client.functions.invoke("vault-access", {
      body,
      headers: { Origin: "http://127.0.0.1:5173" },
    });
  const { data } = await client.auth.getSession();
  const response = await localHandler(
    new Request(url + "/functions/v1/vault-access", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session?.access_token ?? anon}`,
        Origin: "http://127.0.0.1:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  const payload = await response.clone().json();
  return response.ok
    ? { data: payload, error: null }
    : { data: null, error: { message: payload.error, context: response } };
}

try {
  for (let i = 0; i < 2; i++) {
    const email = `security-check-${randomUUID()}@example.invalid`;
    const master = "Master test " + randomUUID();
    const password = await c.deriveAuthPassword(email, master);
    const created = ok(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      "create test user",
    );
    users.push({ id: created.user.id, master, password, email });
  }
  for (const user of users) {
    user.client = createClient(url, anon, options);
    ok(
      await user.client.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      }),
      "login",
    );
    const profile = ok(
      await user.client.from("profiles").select("id,vault_salt").single(),
      "profile",
    );
    check(
      profile.id === user.id && /^[a-f0-9]{64}$/.test(profile.vault_salt),
      "Perfil propio y sal aleatoria disponibles",
    );
    user.key = await c.deriveKey(
      user.master,
      new Uint8Array(c.hexToBuffer(profile.vault_salt)),
    );
    user.second = "Separate test " + randomUUID();
    const initial = ok(
      await gateway(user.client, { action: "status" }),
      "gateway status",
    );
    check(
      initial.configured === false,
      "Gateway activo sin verificador previo",
    );
    ok(
      await gateway(user.client, { action: "setup", password: user.second }),
      "setup second password",
    );
    check(
      ok(await gateway(user.client, { action: "status" }), "status configured")
        .configured === true,
      "Contraseña adicional configurada en servidor",
    );
  }
  const [a, b] = users;
  const docId = randomUUID();
  const context = { userId: a.id, documentId: docId, versionNumber: 1 };
  const plaintext = new TextEncoder().encode(
    "INFINYX real integration test " + randomUUID(),
  );
  const sha256 = await c.computeSHA256(plaintext.buffer);
  const metadata = await c.encryptMetadata(
    {
      name: "integration-private.txt",
      mimeType: "text/plain",
      size: plaintext.length,
      sha256,
    },
    a.key,
    context,
  );
  const enc = await c.encryptBuffer(plaintext.buffer, a.key, context);
  const path = `${a.id}/${docId}/${randomUUID()}.enc`;
  paths.push(path);
  ok(
    await a.client.storage
      .from("vault_files")
      .upload(
        path,
        new Blob([enc.cipherBuffer], { type: "application/octet-stream" }),
        { contentType: "application/octet-stream", cacheControl: "0" },
      ),
    "encrypted upload",
  );
  const versionId = ok(
    await a.client.rpc("commit_vault_version", {
      p_document_id: docId,
      p_version_number: 1,
      p_storage_path: path,
      p_iv: enc.iv,
      p_metadata: metadata,
    }),
    "atomic commit",
  );
  check(typeof versionId === "string", "Subida real y commit transaccional");
  const own = ok(
    await a.client.from("document_versions").select("*").eq("id", versionId),
    "read own metadata",
  );
  check(
    own.length === 1 &&
      !("sha256_hash" in own[0]) &&
      !JSON.stringify(own).includes("integration-private.txt"),
    "Metadatos sensibles cifrados en PostgREST",
  );
  const decoded = await c.decryptMetadata(
    own[0].encrypted_metadata,
    a.key,
    context,
  );
  check(
    decoded.sha256 === sha256 && decoded.name === "integration-private.txt",
    "Metadatos recuperados con la clave de bóveda",
  );
  check(
    ok(await b.client.from("documents").select("id"), "other docs").length ===
      0,
    "Usuario B no ve documentos de A",
  );
  check(
    ok(await b.client.from("document_versions").select("id"), "other versions")
      .length === 0,
    "Usuario B no ve versiones de A",
  );
  for (const user of users) {
    const read = await user.client.storage.from("vault_files").download(path);
    check(!!read.error, "Storage rechaza lectura directa incluso con sesión");
    await user.client.storage.from("vault_files").remove([path]);
    const preserved = await admin.storage.from("vault_files").download(path);
    check(
      !preserved.error,
      "Storage conserva el objeto tras borrado directo no autorizado",
    );
  }
  check(
    !!(await a.client.from("documents").delete().eq("id", docId)).error,
    "PostgREST bloquea el borrado directo",
  );
  check(
    !!(await a.client.from("vault_credentials").select("*")).error,
    "Verificador inaccesible al cliente",
  );
  check(
    !!(
      await a.client
        .from("audit_logs")
        .insert({ user_id: a.id, document_id: docId, action: "FAKE" })
    ).error,
    "Cliente no puede falsificar auditoría",
  );
  check(
    !!(await a.client.rpc("reserve_vault_attempt", { p_user_id: a.id })).error,
    "Cliente no puede manipular el limitador",
  );
  const publicClient = createClient(url, anon, options);
  check(
    !!(await publicClient.from("documents").select("id")).error,
    "Sin sesión no hay acceso a las tablas",
  );
  const badPassword = await gateway(a.client, {
    action: "download",
    versionId,
    password: "incorrect second password",
  });
  check(
    !!badPassword.error && badPassword.error.context?.status === 403,
    "Gateway rechaza contraseña adicional incorrecta",
  );
  const crossed = await gateway(b.client, {
    action: "download",
    versionId,
    password: b.second,
  });
  check(
    !!crossed.error && crossed.error.context?.status === 404,
    "Gateway rechaza descarga cruzada entre usuarios",
  );
  const crossedDelete = await gateway(b.client, {
    action: "delete",
    documentId: docId,
    password: b.second,
  });
  check(
    !!crossedDelete.error && crossedDelete.error.context?.status === 404,
    "Gateway rechaza borrado cruzado entre usuarios",
  );
  const authorized = ok(
    await gateway(a.client, {
      action: "download",
      versionId,
      password: a.second,
    }),
    "authorized download",
  );
  const response = await fetch(authorized.url);
  check(response.ok, "URL firmada permite descargar ciphertext");
  const ciphertext = await response.arrayBuffer();
  const restored = await c.decryptBuffer(ciphertext, a.key, enc.iv, context);
  check(
    Buffer.from(restored).equals(Buffer.from(plaintext)),
    "Archivo descargado idéntico al original tras descifrar",
  );
  const logs = ok(
    await a.client.from("audit_logs").select("action,details"),
    "audit logs",
  );
  check(
    logs.some((x) => x.action === "UPLOAD") &&
      logs.some((x) => x.action === "DOWNLOAD_AUTHORIZED"),
    "Auditoría real generada por servidor",
  );
  check(
    !JSON.stringify(logs).includes("integration-private.txt") &&
      !JSON.stringify(logs).includes(sha256),
    "Auditoría sin nombre ni hash del archivo",
  );
  let rateLimited = false;
  for (let i = 0; i < 32; i++) {
    const result = await gateway(a.client, {
      action: "verify",
      password: a.second,
    });
    if (result.error) {
      check(
        result.error.context?.status === 429,
        "Límite de intentos persistente responde 429",
      );
      rateLimited = true;
      break;
    }
  }
  check(rateLimited, "El limitador no puede eludirse entre invocaciones");
  ok(
    await admin.from("vault_rate_limits").delete().eq("user_id", a.id),
    "reset fixture rate",
  );
  // Allow expiry to be observed without extending signed URL lifetime.
  const token = authorized.url.split("token=")[1];
  let expiry = 0;
  if (token) {
    try {
      expiry =
        JSON.parse(
          Buffer.from(
            decodeURIComponent(token).split(".")[1],
            "base64url",
          ).toString(),
        ).exp * 1000;
    } catch {}
  }
  if (expiry && expiry - Date.now() < 35000) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, expiry - Date.now() + 2000)),
    );
    check(
      !(await fetch(authorized.url)).ok,
      "La URL firmada expira y deja de permitir descargas",
    );
  }
  ok(
    await gateway(a.client, {
      action: "delete",
      documentId: docId,
      password: a.second,
    }),
    "authorized delete",
  );
  check(
    ok(await a.client.from("documents").select("id"), "post delete").length ===
      0,
    "Borrado autorizado elimina el documento",
  );
  const deletedResponse = await fetch(
    `${url}/storage/v1/object/authenticated/vault_files/${path}?deletion-check=${randomUUID()}`,
    {
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Cache-Control": "no-cache",
      },
    },
  );
  check(
    !deletedResponse.ok,
    "Borrado autorizado elimina el ciphertext (lectura nueva sin caché)",
  );
  const afterLogs = ok(
    await a.client.from("audit_logs").select("action,document_id"),
    "delete logs",
  );
  check(
    afterLogs.some((x) => x.action === "DELETE" && x.document_id === null),
    "Auditoría sobrevive al borrado",
  );
  const batchIds = [];
  for (let i = 0; i < 2; i++) {
    const documentId = randomUUID();
    const ctx = { userId: a.id, documentId, versionNumber: 1 };
    const encrypted = await c.encryptBuffer(plaintext.buffer, a.key, ctx);
    const encryptedMetadata = await c.encryptMetadata(
      {
        name: `PrivateFolder/${i}.txt`,
        mimeType: "text/plain",
        size: plaintext.length,
        sha256,
      },
      a.key,
      ctx,
    );
    const storagePath = `${a.id}/${documentId}/${randomUUID()}.enc`;
    paths.push(storagePath);
    ok(
      await a.client.storage
        .from("vault_files")
        .upload(storagePath, new Blob([encrypted.cipherBuffer]), {
          contentType: "application/octet-stream",
          cacheControl: "0",
        }),
      "batch fixture upload",
    );
    ok(
      await a.client.rpc("commit_vault_version", {
        p_document_id: documentId,
        p_version_number: 1,
        p_storage_path: storagePath,
        p_iv: encrypted.iv,
        p_metadata: encryptedMetadata,
      }),
      "batch fixture commit",
    );
    batchIds.push(documentId);
  }
  const rejected = await gateway(b.client, {
    action: "delete-batch",
    documentIds: batchIds,
    password: b.second,
  });
  check(
    !!rejected.error && rejected.error.context?.status === 404,
    "Borrado en lote cruzado rechazado antes de tocar objetos",
  );
  const mixed = await gateway(a.client, {
    action: "delete-batch",
    documentIds: [batchIds[0], randomUUID()],
    password: a.second,
  });
  check(
    !!mixed.error && mixed.error.context?.status === 404,
    "Lote mixto inválido rechazado por completo",
  );
  check(
    ok(await a.client.from("documents").select("id"), "batch preserved")
      .length === 2,
    "Preflight fallido conserva todos los documentos propios",
  );
  const batchResult = ok(
    await gateway(a.client, {
      action: "delete-batch",
      documentIds: batchIds,
      password: a.second,
    }),
    "authorized batch delete",
  );
  check(
    batchResult.deletedIds.length === 2 && batchResult.failedIds.length === 0,
    "Gateway confirma ambos borrados del lote real",
  );
  check(
    ok(await a.client.from("documents").select("id"), "batch empty").length ===
      0,
    "Catálogo queda vacío después del lote",
  );
  console.log("LIVE_CHECKS_PASSED=" + assertions);
} catch (error) {
  console.error("LIVE_CHECK_FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (paths.length) {
    const result = await admin.storage.from("vault_files").remove(paths);
    if (result.error) {
      console.error("CLEANUP_STORAGE_FAILED");
      process.exitCode = 1;
    }
  }
  for (const user of users) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) {
      console.error("CLEANUP_USER_FAILED");
      process.exitCode = 1;
    }
  }
  console.log("Cuentas temporales retiradas:", users.length);
}

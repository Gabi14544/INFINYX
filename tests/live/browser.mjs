// Explicit live-browser test: confirmed temporary fixture, no emails; requires a running local frontend.
import { localGateway } from "./localGateway.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { deriveAuthPassword } from "../../src/core/crypto/vaultCrypto.ts";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const url = process.env.VITE_SUPABASE_URL;
const ref = new URL(url).hostname.split(".")[0];
const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  })
).json();
const service = keys.find((k) => k.name === "service_role").api_key;
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let id;
let temporaryFolder;
let browser;
let page;
const email = `browser-check-${randomUUID()}@example.invalid`;
const master = "Browser master " + randomUUID();
try {
  const created = await admin.auth.admin.createUser({
    email,
    password: await deriveAuthPassword(email, master),
    email_confirm: true,
  });
  if (created.error) throw created.error;
  id = created.data.user.id;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    ...(process.env.HTTPS_PROXY
      ? {
          proxy: {
            server: process.env.HTTPS_PROXY,
            bypass: "127.0.0.1,localhost",
          },
        }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  const localHandler = await localGateway({
    url,
    anon: process.env.VITE_SUPABASE_ANON_KEY,
    service,
  });
  if (localHandler)
    await page.route(url + "/functions/v1/vault-access", async (route) => {
      const request = route.request();
      const response = await localHandler(
        new Request(request.url(), {
          method: request.method(),
          headers: await request.allHeaders(),
          ...(request.method() === "POST" ? { body: request.postData() } : {}),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  page.on("requestfailed", (r) =>
    console.log(
      "NETWORK_FAILURE:",
      new URL(r.url()).pathname,
      r.failure()?.errorText,
    ),
  );
  page.on("response", (r) => {
    if (r.status() >= 400)
      console.log("HTTP_FAILURE:", new URL(r.url()).pathname, r.status());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.INFINYX_TEST_APP_URL ?? "http://127.0.0.1:5182/");
  await page.getByLabel("Email corporativo").fill(email);
  await page.getByLabel("Contraseña maestra", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Desbloquear bóveda" }).click();
  await expect(
    page.getByRole("heading", { name: "Documentos protegidos" }),
  ).toBeVisible({ timeout: 20000 });
  console.log("PASS: Login real desde Chromium");
  await page
    .getByRole("button", { name: "Proteger Nuevo Documento", exact: true })
    .first()
    .click();
  const payload = Buffer.from(
    "Real browser encryption round trip " + randomUUID(),
  );
  await page.locator("input[type=file]").first().setInputFiles({
    name: "browser-check.txt",
    mimeType: "text/plain",
    buffer: payload,
  });
  await page
    .getByRole("button", { name: "Cifrar y subir", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cerrar y ver en catálogo" }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Cerrar y ver en catálogo" }).click();
  await expect(
    page.getByRole("button", {
      name: "Descargar archivo browser-check.txt",
      exact: true,
    }),
  ).toBeVisible();
  console.log("PASS: Subida cifrada real desde Chromium");
  await page
    .getByRole("button", {
      name: "Descargar archivo browser-check.txt",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Crear Contraseña Única de Descarga" }),
  ).toBeVisible({ timeout: 15000 });
  const second = "Browser separate " + randomUUID();
  await dialog.locator("input").nth(0).fill(second);
  await dialog.locator("input").nth(1).fill(second);
  const downloading = page.waitForEvent("download", { timeout: 20000 });
  await dialog.getByRole("button", { name: "Crear y autorizar" }).click();
  const download = await downloading;
  assert((await readFile(await download.path())).equals(payload));
  console.log(
    "PASS: Descarga y descifrado real idénticos al original en Chromium",
  );
  await page
    .getByRole("button", { name: "Eliminar browser-check.txt", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Eliminar documento", exact: true })
    .click();
  await expect(page.getByText("Tu bóveda está vacía")).toBeVisible({
    timeout: 20000,
  });
  console.log("PASS: Borrado real desde Chromium");
  temporaryFolder = await mkdtemp(join(tmpdir(), "infinyx-batch-"));
  const folder = join(temporaryFolder, "ClientFolder");
  await mkdir(join(folder, "Sub"), { recursive: true });
  await writeFile(join(folder, "a.txt"), "folder A");
  await writeFile(join(folder, "b.txt"), "folder B");
  await writeFile(join(folder, "Sub", "c.txt"), "folder C");
  await writeFile(join(folder, ".DS_Store"), "ignored system file");
  await page
    .getByRole("button", { name: "Proteger Nuevo Documento", exact: true })
    .first()
    .click();
  await page.locator("input[webkitdirectory]").setInputFiles(folder);
  await page
    .getByRole("button", { name: "Cifrar 3 archivos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cerrar y ver en catálogo" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Cerrar y ver en catálogo" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(
    page.getByText("ClientFolder/Sub", { exact: true }),
  ).toBeVisible();
  console.log(
    "PASS: Carpeta real con subcarpetas y descarte de archivos de sistema",
  );
  const rows = await admin.from("documents").select("*").eq("user_id", id);
  const versions = await admin
    .from("document_versions")
    .select("*")
    .in(
      "document_id",
      rows.data.map((doc) => doc.id),
    );
  assert(
    !JSON.stringify(rows.data).includes("ClientFolder") &&
      !JSON.stringify(versions.data).includes("ClientFolder"),
  );
  assert(versions.data.every((v) => v.encrypted_metadata.startsWith("v2:")));
  console.log("PASS: Rutas de carpeta cifradas en el backend real");
  await page
    .getByRole("checkbox", {
      name: "Seleccionar documento ClientFolder/a.txt",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", {
      name: "Seleccionar documento ClientFolder/b.txt",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Eliminar seleccionados (2)", exact: true })
    .click();
  const bulk = page.getByRole("dialog");
  await bulk.locator("input[type=password]").fill("incorrect second password");
  await bulk.getByRole("button", { name: "Eliminar (2)", exact: true }).click();
  await expect(bulk.getByRole("alert")).toContainText("incorrecta", {
    timeout: 15000,
  });
  await expect(page.locator("tbody tr")).toHaveCount(3);
  console.log("PASS: Borrado masivo rechazado sin contraseña correcta");
  await bulk.locator("input[type=password]").fill(second);
  await bulk.getByRole("button", { name: "Eliminar (2)", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 30000 });
  await expect(
    page.getByRole("button", {
      name: "Descargar archivo ClientFolder/Sub/c.txt",
      exact: true,
    }),
  ).toBeVisible();
  console.log(
    "PASS: Borrado real de seleccionados conserva los no seleccionados",
  );
  await page.getByRole("button", { name: "Borrar todo", exact: true }).click();
  const all = page.getByRole("dialog");
  await expect(all.locator("input[type=password]")).toHaveValue("");
  await all.locator("input[type=password]").fill(second);
  await all.getByRole("button", { name: "Vaciar bóveda", exact: true }).click();
  await expect(page.getByText("Tu bóveda está vacía")).toBeVisible({
    timeout: 30000,
  });
  console.log(
    "PASS: Vaciado real de bóveda con nueva confirmación de contraseña",
  );
  await page.getByRole("button", { name: "Cerrar Sesión" }).click();
  await expect(
    page.getByRole("heading", { name: "Acceso a la bóveda" }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("PASS: Logout real sin errores de JavaScript");
} catch (error) {
  console.error("BROWSER_LIVE_FAILED:", error.message);
  if (page)
    console.error(
      "UI_ALERTS:",
      await page.getByRole("alert").allTextContents(),
    );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (temporaryFolder)
    await rm(temporaryFolder, { recursive: true, force: true });
  if (id) {
    const { data } = await admin.storage
      .from("vault_files")
      .list(id, { limit: 100 });
    for (const folder of data ?? []) {
      if (!folder.id) {
        const { data: files } = await admin.storage
          .from("vault_files")
          .list(id + "/" + folder.name, { limit: 100 });
        if (files?.length)
          await admin.storage
            .from("vault_files")
            .remove(files.map((f) => id + "/" + folder.name + "/" + f.name));
      }
    }
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) {
      console.error("BROWSER_CLEANUP_FAILED");
      process.exitCode = 1;
    }
  }
}

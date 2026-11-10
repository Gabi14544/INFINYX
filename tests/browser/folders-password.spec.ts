import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { vaultFixture, login, master, userId } from "./vault-fixture";
import {
  deriveKey,
  hexToBuffer,
  decryptMetadata,
} from "../../src/core/crypto/vaultCrypto";
const second = "different additional password";
test("explicit setup, single encrypted ZIP, remembered tab authorization and reset on reload", async ({
  page,
}) => {
  const state = await vaultFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const temporary = await mkdtemp(join(tmpdir(), "infinyx-folder-test-"));
  const folder = join(temporary, "Clientes");
  await mkdir(join(folder, "Sub"), { recursive: true });
  await writeFile(join(folder, "a.txt"), "alpha");
  await writeFile(join(folder, "Sub", "b.txt"), "beta");
  await writeFile(join(folder, "c.txt"), "gamma");
  await writeFile(join(folder, ".DS_Store"), "ignored");
  try {
    await login(page);
    const create = page.getByRole("button", {
      name: "Crear contraseña de descarga y eliminación",
      exact: true,
    });
    await expect(create).toBeEnabled();
    await create.click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nueva contraseña de descarga y eliminación", { exact: true })
      .fill(master);
    await dialog.getByLabel("Confirmar contraseña").fill(master);
    await dialog
      .getByRole("button", { name: "Crear contraseña", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("distinta");
    expect(state.setupCalls).toBe(0);
    await dialog
      .getByLabel("Nueva contraseña de descarga y eliminación", { exact: true })
      .fill(second);
    await dialog.getByLabel("Confirmar contraseña").fill(second);
    await dialog
      .getByRole("button", { name: "Crear contraseña", exact: true })
      .click();
    await expect(
      page.getByText("Contraseña de descarga y eliminación configurada.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(state.setupCalls).toBe(1);
    expect(state.verifyCalls).toBe(0);
    expect(state.downloadCalls).toBe(0);
    await page
      .getByRole("button", { name: "Proteger Nuevo Documento", exact: true })
      .first()
      .click();
    await page.locator("input[webkitdirectory]").setInputFiles(folder);
    await expect(
      page.getByText("Carpeta: Clientes", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cifrar y subir", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cerrar y ver en catálogo" })
      .click({ timeout: 20000 });
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect(state.uploads).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect(state.versions).toHaveLength(1);
    await expect(
      page.getByText("Carpeta cifrada · 3 archivos · ZIP", { exact: true }),
    ).toBeVisible();
    const key = await deriveKey(
      master,
      new Uint8Array(hexToBuffer("ab".repeat(32))),
    );
    const version = state.versions[0]!;
    const metadata = await decryptMetadata(version.encrypted_metadata, key, {
      userId,
      documentId: version.document_id,
      versionNumber: 1,
    });
    expect(metadata.name).toBe("Clientes");
    expect(metadata.folder).toEqual({
      kind: "folder",
      fileCount: 3,
      originalSize: 14,
    });
    expect(version.encrypted_metadata).not.toContain("Clientes");
    expect(
      [...state.objects.values()][0]!.includes(Buffer.from("Clientes")),
    ).toBe(false);
    const downloadButton = page.getByRole("button", {
      name: "Descargar archivo Clientes",
      exact: true,
    });
    await downloadButton.click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Autorizar descarga y eliminación" }),
    ).toBeVisible();
    await dialog
      .getByLabel("Contraseña de descarga y eliminación", { exact: true })
      .fill("wrong password");
    await dialog.getByRole("button", { name: "Autorizar pestaña" }).click();
    await expect(dialog.getByRole("alert")).toContainText("incorrecta");
    expect(state.downloadCalls).toBe(0);
    await dialog
      .getByLabel("Contraseña de descarga y eliminación", { exact: true })
      .fill(second);
    let pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Autorizar pestaña" }).click();
    let downloaded = await pending;
    expect(downloaded.suggestedFilename()).toBe("Clientes.zip");
    const bytes = await readFile((await downloaded.path())!);
    const contents = unzipSync(bytes);
    expect(Object.keys(contents).sort()).toEqual([
      "Clientes/Sub/b.txt",
      "Clientes/a.txt",
      "Clientes/c.txt",
    ]);
    expect(strFromU8(contents["Clientes/a.txt"]!)).toBe("alpha");
    expect(strFromU8(contents["Clientes/Sub/b.txt"]!)).toBe("beta");
    expect(state.verifyCalls).toBe(1);
    pending = page.waitForEvent("download");
    await downloadButton.click();
    await pending;
    expect(state.verifyCalls).toBe(1);
    expect(state.downloadCalls).toBe(2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await login(page, false);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await downloadButton.click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Autorizar descarga y eliminación" }),
    ).toBeVisible();
    await dialog
      .getByLabel("Contraseña de descarga y eliminación", { exact: true })
      .fill(second);
    pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Autorizar pestaña" }).click();
    await pending;
    expect(state.verifyCalls).toBe(2);
    await page
      .getByRole("button", { name: "Borrar todo", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[type=password]")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Vaciar bóveda", exact: true })
      .click();
    await expect(page.getByText("Tu bóveda está vacía")).toBeVisible();
    expect(state.objects.size).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(state.verifyCalls).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a missing authorization password directs deletion to the explicit setup button", async ({
  page,
}) => {
  const state = await vaultFixture(page);
  await login(page);
  await expect(
    page.getByRole("button", {
      name: "Crear contraseña de descarga y eliminación",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Proteger Nuevo Documento", exact: true })
    .first()
    .click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
  await page
    .getByRole("button", { name: "Cifrar y subir", exact: true })
    .click();
  await page.getByRole("button", { name: "Cerrar y ver en catálogo" }).click();
  await page
    .getByRole("button", { name: "Eliminar file.txt", exact: true })
    .click();
  await expect(
    page.getByText(
      "Primero usa el botón “Crear contraseña de descarga y eliminación”.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.setupCalls).toBe(0);
  expect(state.rows).toHaveLength(1);
});

test("an existing password authorizes the first deletion and is reused for later downloads", async ({
  page,
}) => {
  const state = await vaultFixture(page, true);
  await login(page);
  await expect(
    page.getByText("Contraseña de descarga y eliminación configurada.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Crear contraseña de descarga y eliminación",
      exact: true,
    }),
  ).toHaveCount(0);
  const upload = async (name: string) => {
    await page
      .getByRole("button", { name: "Proteger Nuevo Documento", exact: true })
      .first()
      .click();
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      });
    await page
      .getByRole("button", { name: "Cifrar y subir", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cerrar y ver en catálogo" })
      .click();
  };
  await upload("first.txt");
  await page
    .getByRole("button", { name: "Eliminar first.txt", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=password]").fill(state.password);
  await dialog
    .getByRole("button", { name: "Eliminar documento", exact: true })
    .click();
  await expect(page.getByText("Tu bóveda está vacía")).toBeVisible();
  expect(state.verifyCalls).toBe(1);
  await upload("second.txt");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar archivo second.txt", exact: true })
    .click();
  await download;
  expect(state.verifyCalls).toBe(1);
  expect(state.setupCalls).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
const email = "alice@example.test";
const user = {
  id: userId,
  email,
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
};
function jwt() {
  return `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.browser-test-signature`;
}
test("login uses a derived credential, renders the vault, then clears it on logout", async ({
  page,
}) => {
  await page.clock.install();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let sentPassword: string | undefined;
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") {
      sentPassword = route.request().postDataJSON().password;
      await route.fulfill({
        json: {
          access_token: jwt(),
          refresh_token: "browser-test-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user,
        },
      });
    } else if (url.pathname === "/rest/v1/profiles")
      await route.fulfill({ json: { vault_salt: "ab".repeat(32) } });
    else if (url.pathname === "/rest/v1/documents")
      await route.fulfill({ json: [] });
    else if (url.pathname === "/auth/v1/logout")
      await route.fulfill({ status: 204 });
    else if (url.pathname === "/auth/v1/user")
      await route.fulfill({ json: user });
    else throw new Error(`Unexpected backend call ${url.pathname}`);
  });
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Iniciar Sesión", exact: true }),
  ).toBeVisible();
  const fields = page.locator("input");
  await fields.nth(0).fill(email);
  await fields.nth(1).fill("long browser test passphrase");
  await page.locator("button[type=submit]").click();
  await expect(
    page.getByRole("heading", { name: "Documentos protegidos" }),
  ).toBeVisible();
  expect(sentPassword).toMatch(/^iv2_[a-f0-9]{64}$/);
  expect(sentPassword).not.toContain("long browser test passphrase");
  await expect(page.getByText("Tu bóveda está vacía")).toBeVisible();
  await page.clock.fastForward("10:01");
  await expect(
    page.getByRole("heading", { name: "Documentos protegidos" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("inactividad");
  await page.locator("input").nth(1).fill("long browser test passphrase");
  await page.locator("button[type=submit]").click();
  await expect(
    page.getByRole("heading", { name: "Documentos protegidos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar Sesión" }).click();
  await expect(
    page.getByRole("heading", { name: "Documentos protegidos" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("failed authentication never retries with the original passphrase", async ({
  page,
}) => {
  const credentials: string[] = [];
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") {
      credentials.push(route.request().postDataJSON().password);
      await route.fulfill({
        status: 400,
        json: {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        },
      });
    } else await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.locator("input").nth(0).fill(email);
  await page.locator("input").nth(1).fill("long browser test passphrase");
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(credentials).toHaveLength(1);
  expect(credentials[0]).toMatch(/^iv2_[a-f0-9]{64}$/);
});

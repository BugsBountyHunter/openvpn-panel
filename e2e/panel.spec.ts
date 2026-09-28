import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clientRow, signIn } from "./helpers";

// Demo state lives in the server process, so these run in order.
test.describe.configure({ mode: "serial" });

test("unauthenticated visitors are sent to login and bad passwords are rejected", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login\?next=%2Fclients/);
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid username or password");
});

test("login returns to the requested page", async ({ page }) => {
  await signIn(page, "/clients");
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
});

test("overview shows server status and online clients", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("● up")).toBeVisible();
  await expect(page.getByText("Total traffic")).toBeVisible();
  await expect(page.getByText("alice-laptop")).toBeVisible();
});

test("overview warns before the CRL expires", async ({ page }) => {
  await signIn(page);
  // Demo data puts the CRL 20 days from expiry.
  const warning = page.getByRole("alert").filter({ hasText: "certificate revocation list" });
  await expect(warning).toContainText(/expires in (19|20) days/);
  await expect(warning).toContainText("easyrsa gen-crl");
});

test("live view shows freshness and can be paused", async ({ page }) => {
  await signIn(page, "/clients");
  await expect(page.getByText(/Live · updated (just now|\d+s ago)/)).toBeVisible();
  const toggle = page.getByRole("button", { name: "Pause" });
  await toggle.click();
  await expect(page.getByText(/Paused · updated/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByText(/Paused · updated/)).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText(/Live · updated/)).toBeVisible();
});

test("the server certificate is never listed", async ({ page }) => {
  await signIn(page, "/clients");
  await page.getByLabel("Filter by status").selectOption("all");
  await expect(page.getByText(/^server_/)).toHaveCount(0);
});

test("clients can be filtered, searched and sorted", async ({ page }) => {
  await signIn(page, "/clients");
  const table = page.getByRole("table");
  const dataRows = table.getByRole("row").filter({ has: page.getByRole("cell") });

  await page.getByLabel("Filter by status").selectOption("expiring");
  await expect(dataRows).toHaveCount(1);
  await expect(clientRow(page, "erin-tablet")).toBeVisible();

  await page.getByLabel("Filter by status").selectOption("active");
  await page.getByLabel("Search clients by name or IP").fill("203.0.113");
  await expect(dataRows).toHaveCount(2);
  await expect(clientRow(page, "alice-laptop")).toBeVisible();
  await expect(clientRow(page, "frank-home")).toBeVisible();

  await page.getByLabel("Search clients by name or IP").fill("");
  const nameHeader = table.getByRole("columnheader", { name: "Name" });
  await nameHeader.getByRole("button").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(dataRows.first().getByRole("cell").first()).toHaveText("alice-laptop");
  await nameHeader.getByRole("button").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  await expect(dataRows.first().getByRole("cell").first()).toHaveText("frank-home");
});

test("add client downloads the profile", async ({ page }) => {
  await signIn(page, "/clients");
  await page.getByRole("button", { name: "Add client" }).click();
  const dialog = page.getByRole("dialog", { name: "Add client" });
  await dialog.getByLabel("Client name").fill("bad name!");
  await expect(dialog.getByRole("button", { name: "Create & download" })).toBeDisabled();
  await dialog.getByLabel("Client name").fill("e2e-laptop");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Create & download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e-laptop.ovpn");
  const content = await readFile(await download.path(), "utf8");
  expect(content).toMatch(/^client$/m);

  await expect(page.getByRole("status")).toContainText('Created "e2e-laptop"');
  await expect(clientRow(page, "e2e-laptop")).toBeVisible();
});

test("add client with a validity and a passphrase", async ({ page }) => {
  await signIn(page, "/clients");
  await page.getByRole("button", { name: "Add client" }).click();
  const dialog = page.getByRole("dialog", { name: "Add client" });
  const submit = dialog.getByRole("button", { name: "Create & download" });
  await dialog.getByLabel("Client name").fill("e2e-locked");
  await dialog.getByLabel("Certificate validity (days)").fill("30");
  await dialog.getByLabel("Protect the private key with a passphrase").check();
  await dialog.getByLabel("Passphrase", { exact: true }).fill("short");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Passphrase", { exact: true }).fill("correct horse battery");
  await dialog.getByLabel("Confirm passphrase").fill("correct horse batter");
  await expect(dialog).toContainText("Passphrases do not match.");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Confirm passphrase").fill("correct horse battery");

  const downloadPromise = page.waitForEvent("download");
  await submit.click();
  expect((await downloadPromise).suggestedFilename()).toBe("e2e-locked.ovpn");
  await expect(clientRow(page, "e2e-locked")).toContainText(/\((29|30)d\)/);

  await page.goto("/audit");
  const row = page.getByRole("row").filter({ hasText: "Added client" }).filter({ hasText: "e2e-locked" });
  await expect(row).toContainText("30 days, passphrase");
  await expect(page.getByText("correct horse battery")).toHaveCount(0);
});

test("duplicate names are refused", async ({ page }) => {
  await signIn(page, "/clients");
  await page.getByRole("button", { name: "Add client" }).click();
  const dialog = page.getByRole("dialog", { name: "Add client" });
  await dialog.getByLabel("Client name").fill("alice-laptop");
  await dialog.getByRole("button", { name: "Create & download" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
});

test("disconnect asks for confirmation", async ({ page }) => {
  await signIn(page, "/clients");
  const row = clientRow(page, "bob-phone");
  await expect(row.getByText("● online")).toBeVisible();

  await row.getByRole("button", { name: "Disconnect" }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect client?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByText("● online")).toBeVisible();

  await row.getByRole("button", { name: "Disconnect" }).click();
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("status")).toContainText('Disconnected "bob-phone"');
  await expect(row.getByText("offline")).toBeVisible();
});

test("revoke asks for confirmation and hides the client", async ({ page }) => {
  await signIn(page, "/clients");
  await clientRow(page, "e2e-laptop").getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke client?" });
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByRole("status")).toContainText('Revoked "e2e-laptop"');
  await expect(clientRow(page, "e2e-laptop")).toHaveCount(0);
  await page.getByLabel("Filter by status").selectOption("revoked");
  await expect(clientRow(page, "e2e-laptop").getByText("revoked")).toBeVisible();
});

test("renew re-issues a certificate and downloads the new profile", async ({ page }) => {
  await signIn(page, "/clients");
  await expect(clientRow(page, "erin-tablet")).toContainText(/\((11|12)d\)/);
  await clientRow(page, "erin-tablet").getByRole("button", { name: "Renew" }).click();

  const dialog = page.getByRole("dialog", { name: "Renew certificate?" });
  await expect(dialog).toContainText("old profile stops working");
  await dialog.getByLabel("Certificate validity (days)").fill("0");
  await expect(dialog.getByRole("button", { name: "Renew & download" })).toBeDisabled();
  await dialog.getByLabel("Certificate validity (days)").fill("365");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Renew & download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("erin-tablet.ovpn");
  expect(await readFile(await download.path(), "utf8")).toContain("client");

  await expect(page.getByRole("status")).toContainText('Renewed "erin-tablet"');
  await expect(clientRow(page, "erin-tablet")).not.toContainText(/\(\d+d\)/);
});

test("audit log records the actions", async ({ page }) => {
  await signIn(page, "/audit");
  const table = page.getByRole("table");
  await expect(table.getByRole("row").filter({ hasText: "Added client" }).filter({ hasText: "e2e-laptop" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Revoked client" }).filter({ hasText: "e2e-laptop" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Disconnected client" })).not.toHaveCount(0);
  await expect(table.getByRole("row").filter({ hasText: "Renewed client" }).filter({ hasText: "erin-tablet" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Failed sign-in" })).not.toHaveCount(0);
});

test("audit log can be filtered and exported as CSV", async ({ page }) => {
  await signIn(page, "/audit");
  await page.getByLabel("Action").selectOption("revoke");
  await page.getByLabel("Search audit log").fill("e2e-laptop");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/action=revoke/);
  const dataRows = page.getByRole("table").getByRole("row").filter({ has: page.getByRole("cell") });
  await expect(dataRows).toHaveCount(1);
  await expect(dataRows.first()).toContainText("Revoked client");
  await expect(page.getByRole("heading", { name: "1 matching event" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^openvpn-panel-audit-\d{8}\.csv$/);
  const lines = (await readFile(await download.path(), "utf8")).trim().split("\r\n");
  expect(lines[0]).toBe("timestamp,actor,action,target,ip,result,detail");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(",revoke,e2e-laptop,");

  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("table").getByRole("row").filter({ hasText: "Exported audit log" })).not.toHaveCount(0);
});

test("sign out ends the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login/);
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

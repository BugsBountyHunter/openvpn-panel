import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

for (const path of ["/", "/clients", "/audit"]) {
  test(`no horizontal page scroll on ${path}`, async ({ page }) => {
    await signIn(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

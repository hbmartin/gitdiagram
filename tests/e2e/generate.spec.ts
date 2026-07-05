import { expect, test } from "@playwright/test";

test.describe("diagram generation", () => {
  test("generates and renders a diagram from the home page", async ({
    page,
  }) => {
    await page.goto("/");

    // Retry the interaction until React hydration has taken over the form —
    // before that, a click triggers a native GET submit back to "/".
    await expect(async () => {
      await page.getByPlaceholder("owner/repo or GitHub URL").fill("acme/demo");
      await page.getByRole("button", { name: "Diagram", exact: true }).click();
      await page.waitForURL("**/acme/demo", { timeout: 5_000 });
    }).toPass({ timeout: 90_000 });

    // The generation streams (mocked model) and the diagram renders client-side.
    const svg = page.locator(".mermaid svg");
    await expect(svg).toBeVisible({ timeout: 150_000 });

    // Nodes from the fixture graph are rendered with their labels.
    await expect(svg).toContainText("Web App");
    await expect(svg).toContainText("Generation API");

    // Directory/file nodes carry click-through links back to the repository.
    const nodeLink = page.locator(
      '.mermaid svg a[*|href*="github.com/acme/demo"]',
    );
    await expect(nodeLink.first()).toBeVisible();

    // Export affordances are available once a diagram exists.
    await expect(
      page.getByRole("button", { name: /Export Diagram/ }),
    ).toBeVisible();
  });

  test("reopens the stored diagram without regenerating", async ({ page }) => {
    // The first test persisted the artifact into the mock object store; a
    // fresh visit should load it directly.
    await page.goto("/acme/demo");

    const svg = page.locator(".mermaid svg");
    await expect(svg).toBeVisible({ timeout: 60_000 });
    await expect(svg).toContainText("Artifact Store");
  });
});

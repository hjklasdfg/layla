import { test, expect } from "@playwright/test";

// Minimal MobilityRouteState fixture with geometry required by RouteMap
const MOCK_ROUTE = {
  id: "A",
  etaMin: 22,
  modes: ["Tube", "Walking"],
  disruptions: [],
  instructions: ["Take the Northern line to Tottenham Court Road"],
  steps: [],
  stopPointIds: ["940GZZLUKSX"],
  lineIds: ["northern"],
  accessibilityScore: 85,
  stepFree: true,
  osmEvidence: [],
  tflEvidence: ["All lines reporting good service"],
  mobilityNotes: "",
  geometry: {
    type: "LineString",
    coordinates: [
      [51.5309, -0.1233],
      [51.527, -0.125],
      [51.5194, -0.127],
    ],
  },
  start: { lat: 51.5309, lng: -0.1233 },
  end: { lat: 51.5194, lng: -0.127 },
};

const MOCK_API_RESPONSE = {
  routes: [MOCK_ROUTE],
  meta: {
    source: "tfl",
    from: "King's Cross Station",
    to: "British Museum",
    count: 1,
    profile: "general",
  },
};

test.describe("Journey planner map", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with correct title and empty state", async ({ page }) => {
    await expect(page).toHaveTitle(/TongSense|tongsense/i);
    await expect(page.getByText("Plan Your Journey")).toBeVisible();
    await expect(page.getByPlaceholder(/King's Cross/i)).toBeVisible();
    await expect(page.getByPlaceholder(/British Museum/i)).toBeVisible();
    // Map placeholder shown before search
    await expect(
      page.getByText("Enter locations to search TfL + OSM")
    ).toBeVisible();
  });

  test("inputs accept start and destination text", async ({ page }) => {
    const fromInput = page.getByPlaceholder(/King's Cross/i);
    const toInput = page.getByPlaceholder(/British Museum/i);

    await fromInput.fill("King's Cross Station");
    await toInput.fill("British Museum");

    await expect(fromInput).toHaveValue("King's Cross Station");
    await expect(toInput).toHaveValue("British Museum");

    // Compare Routes button becomes enabled
    await expect(
      page.getByRole("button", { name: /Compare Routes/i })
    ).toBeEnabled();
  });

  test("Compare Routes button is disabled with empty inputs", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: /Compare Routes/i })
    ).toBeDisabled();

    // Only from filled — button stays disabled
    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross");
    await expect(
      page.getByRole("button", { name: /Compare Routes/i })
    ).toBeDisabled();
  });

  test("clicking Compare Routes triggers route search and shows loading state", async ({
    page,
  }) => {
    // Use a slow mock so we can observe the loading state
    await page.route("/api/routes", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_API_RESPONSE),
      });
    });

    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross Station");
    await page.getByPlaceholder(/British Museum/i).fill("British Museum");
    await page.getByRole("button", { name: /Compare Routes/i }).click();

    // Should briefly show a loading indicator
    await expect(
      page.getByRole("button", { name: /Fetching|Analysing|Compare Routes/i })
    ).toBeVisible();
  });

  test("map renders after successful route search", async ({ page }) => {
    await page.route("/api/routes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_API_RESPONSE),
      });
    });
    // Stub agent endpoint to 503 so recommendation stays null (avoids crashing AgentPanel)
    await page.route("**/api/agent/**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "stubbed" }) });
    });

    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross Station");
    await page.getByPlaceholder(/British Museum/i).fill("British Museum");
    await page.getByRole("button", { name: /Compare Routes/i }).click();

    // Leaflet map container should appear
    await expect(page.locator(".leaflet-container")).toBeVisible({
      timeout: 30_000,
    });

    // Map tile pane exists (tiles may be hidden in headless but the pane should be present)
    await expect(page.locator(".leaflet-tile-pane")).toBeAttached();

    // Route A legend button appears at map bottom (match exact legend text)
    await expect(
      page.getByRole("button", { name: /Route A · \d+ min/ }).first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test("map shows layer toggle controls", async ({ page }) => {
    await page.route("/api/routes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_API_RESPONSE),
      });
    });
    await page.route("/api/agent/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross Station");
    await page.getByPlaceholder(/British Museum/i).fill("British Museum");
    await page.getByRole("button", { name: /Compare Routes/i }).click();

    await expect(page.locator(".leaflet-container")).toBeVisible({
      timeout: 30_000,
    });

    // Layer toggles visible and all checked by default
    await expect(page.getByRole("group", { name: "Map layer toggles" })).toBeVisible();
    const routesCheckbox = page
      .getByRole("group", { name: "Map layer toggles" })
      .getByRole("checkbox")
      .first();
    await expect(routesCheckbox).toBeChecked();
  });

  test("TfL status banner shows after search", async ({ page }) => {
    await page.route("/api/routes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_API_RESPONSE),
      });
    });
    await page.route("/api/agent/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross Station");
    await page.getByPlaceholder(/British Museum/i).fill("British Museum");
    await page.getByRole("button", { name: /Compare Routes/i }).click();

    await expect(page.getByText(/Live TfL \+ OSM/)).toBeVisible({
      timeout: 30_000,
    });
    // Banner shows "from → to" truncated in one element
    await expect(
      page.getByText(/King's Cross Station/i).first()
    ).toBeVisible();
  });

  test("shows error state when route fetch fails", async ({ page }) => {
    await page.route("/api/routes", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "TfL API key missing. Add TFL_APP_KEY to .env.local and restart the dev server.",
        }),
      });
    });

    await page.getByPlaceholder(/King's Cross/i).fill("King's Cross Station");
    await page.getByPlaceholder(/British Museum/i).fill("British Museum");
    await page.getByRole("button", { name: /Compare Routes/i }).click();

    // Error message should appear (use first() to avoid strict mode if multiple match)
    await expect(
      page.getByText(/TfL API key missing|Could not load|failed/i).first()
    ).toBeVisible({ timeout: 20_000 });
  });
});

import { expect, test, type Page } from "@playwright/test";

/** Walk the setup wizard as far as the practice screen, without a camera. */
async function walkToPractice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Screen calibration: the default slider position is a plausible laptop.
  await expect(page.getByText(/px\/mm/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue without camera" }).click();
  await expect(page.getByRole("heading", { name: "Choose your test" })).toBeVisible();
  await page.getByRole("button", { name: "Start test" }).click();
  await page.getByRole("button", { name: "I am covered, continue" }).click();
  await page.getByRole("button", { name: "I am at the right distance" }).click();
}

test("the wizard leads from the disclaimer to a runnable test", async ({ page }) => {
  await walkToPractice(page);
  await expect(page.getByRole("heading", { name: "Practice round" })).toBeVisible();
  await expect(page.getByText(/Press the SPACEBAR whenever/)).toBeVisible();
});

test("the disclaimer is on the first screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Please read this first")).toBeVisible();
  await expect(page.getByText(/not a medical device/).first()).toBeVisible();
});

test("screen calibration drives the recommended viewing distance", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const slider = page.getByRole("slider");
  // A physically larger screen (more px per mm means a SMALLER screen, so we
  // move the slider down to make the screen bigger) changes the geometry.
  await slider.fill("300");
  const bigScreen = await page.getByText(/diagonal/).textContent();
  await slider.fill("500");
  const smallScreen = await page.getByText(/diagonal/).textContent();
  expect(bigScreen).not.toBe(smallScreen);

  await slider.fill("380");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue without camera" }).click();
  await expect(page.getByText(/Sit at \d+ cm/)).toBeVisible();
});

test("the practice run puts a stimulus canvas on screen and accepts the spacebar", async ({
  page,
}) => {
  await walkToPractice(page);
  await page.getByRole("button", { name: "Start practice" }).click();

  await expect(page.getByText(/Starting in/)).toBeVisible();
  const canvas = page.locator(".test-surface canvas");
  await expect(canvas).toBeVisible();

  // Wait out the countdown, then respond a few times. The point is that
  // nothing throws and the surface stays up.
  await page.waitForTimeout(3500);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
  }
  await expect(canvas).toBeVisible();

  const painted = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    // The perimetric background is a mid-dark gray, not black.
    return { r: data[0], g: data[1], b: data[2], width: c.width };
  });
  expect(painted).not.toBeNull();
  expect(painted!.width).toBeGreaterThan(100);
  expect(painted!.r).toBeGreaterThan(20);
  expect(painted!.r).toBeLessThan(120);
  expect(painted!.r).toBe(painted!.g);
});

test("debug mode shows the live event console", async ({ page }) => {
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue without camera" }).click();
  await page.getByRole("button", { name: "Start test" }).click();
  await page.getByRole("button", { name: "I am covered, continue" }).click();
  await page.getByRole("button", { name: "I am at the right distance" }).click();
  await page.getByRole("button", { name: "Start practice" }).click();
  await page.waitForTimeout(4000);

  const panel = page.locator(".debug-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Phase")).toBeVisible();
  await expect(panel.locator(".debug-log")).toContainText(/START|STIM/);
});

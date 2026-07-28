import { expect, test } from "@playwright/test";
import { loadSyntheticSession } from "./fixtures";

test("the results screen shows a report per eye and flags the unreliable one", async ({ page }) => {
  await loadSyntheticSession(page);

  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  const canvases = page.locator("canvas.report-canvas");
  await expect(canvases).toHaveCount(2);

  // One eye had a wild false-positive rate, so the run must be called out.
  await expect(page.getByText(/did not pass the reliability checks/)).toBeVisible();
  await expect(page.getByText(/too many presses when nothing was shown/)).toBeVisible();

  await expect(page.getByRole("button", { name: /Save PNG - OD/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save PNG - OS/ })).toBeVisible();

  // The reports must actually contain a drawn map, not a blank canvas.
  const ink = await canvases.first().evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add(data[i]);
    return seen.size;
  });
  expect(ink).toBeGreaterThan(10);
});

test("the session is saved and appears in history", async ({ page }) => {
  await loadSyntheticSession(page);
  await expect(page.getByText("Saved to this device.")).toBeVisible();

  await page.getByRole("button", { name: "Previous results" }).click();
  await expect(page.getByRole("heading", { name: "Previous results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open" }).first()).toBeVisible();
  await expect(page.getByText("low").first()).toBeVisible();
});

test("exporting a PDF produces a real file", async ({ page }) => {
  await loadSyntheticSession(page);
  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.getByRole("button", { name: "Save PDF (both eyes)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^perivision-.*\.pdf$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  // Two full-page report images is not a trivial file.
  expect(bytes.length).toBeGreaterThan(50_000);
});

test("raw JSON export carries the full session", async ({ page }) => {
  await loadSyntheticSession(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save raw data (JSON)" }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const parsed = JSON.parse(Buffer.concat(chunks).toString());
  expect(parsed.results).toHaveLength(2);
  expect(parsed.results[0].eye).toBe("OD");
  expect(parsed.device.pxPerMm).toBeCloseTo(5.57, 2);
  expect(Object.keys(parsed.results[0].thresholds).length).toBeGreaterThan(30);
});

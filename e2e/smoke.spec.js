import fs from "node:fs/promises";
import { test as base, expect } from "@playwright/test";

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = collectErrors(page);
    await use(page);
    expect(errors, `Browser errors:\n${errors.join("\n")}`).toEqual([]);
  },
});

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console error: ${message.text()}`);
  });
  return errors;
}

const componentCount = (page) => page.locator("#grid .comp").count();

async function waitForCanvas(page) {
  await expect.poll(() => componentCount(page), { timeout: 15_000 }).toBeGreaterThan(10);
  await expect(page.locator("#import-screen")).toBeHidden();
}

async function boot(page) {
  await page.goto("/");
  await waitForCanvas(page);
  return componentCount(page);
}

async function panToEmptyCanvas(page) {
  const box = await page.locator("#canvas-wrap").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -20_000);
  return box;
}

async function placeAnd(page) {
  const box = await panToEmptyCanvas(page);
  await page.locator("#palette-search").fill("AND");
  const button = page.locator('#palette button[data-type="and"]');
  await expect(button).toBeVisible();
  await expect(button.locator(".name")).toHaveText("AND");
  await button.click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("boots the demo computer without browser errors", async ({ page }) => {
  const count = await boot(page);
  expect(count).toBeGreaterThan(10);
  await expect(page.locator("#import-screen")).toBeHidden();
});

test("filters the palette and places a component", async ({ page }) => {
  const before = await boot(page);
  await placeAnd(page);
  await expect.poll(() => componentCount(page)).toBe(before + 1);
  await expect(page.locator("#selected-properties-heading")).toHaveText("AND");
});

test("undoes and redoes placement", async ({ page }) => {
  const before = await boot(page);
  await placeAnd(page);
  await expect.poll(() => componentCount(page)).toBe(before + 1);

  await page.locator("#btn-undo").click();
  await expect.poll(() => componentCount(page)).toBe(before);

  await page.locator("#btn-redo").click();
  await expect.poll(() => componentCount(page)).toBe(before + 1);
});

test("draws a wire with the wire tool", async ({ page }) => {
  await boot(page);
  const before = await page.locator("#grid .wire").count();
  const box = await panToEmptyCanvas(page);
  await page.locator("#btn-wire").click();

  const y = box.y + box.height * 0.55;
  const start = { x: box.x + box.width * 0.5, y };
  const end = { x: start.x + 96, y };
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(() => page.locator("#grid .wire").count()).toBeGreaterThan(before);

  await page.mouse.dblclick(end.x, end.y);
  await expect(page.locator("#bus-status")).toContainText("Wire finished");
});

test("switches through every tab", async ({ page }) => {
  await boot(page);

  await page.locator("#tab-module-layout").click();
  await expect(page.locator("#module-layout-view")).toBeVisible();
  await expect(page.locator("#canvas-view")).toBeHidden();

  await page.locator("#tab-monitor").click();
  await expect(page.locator("#monitor-view")).toBeVisible();

  await page.locator("#tab-rom").click();
  await expect(page.locator("#rom-view")).toBeVisible();
  await expect.poll(() => page.locator("#rom-rows input").count()).toBeGreaterThan(0);

  await page.locator("#tab-isa").click();
  await expect(page.locator("#isa-view")).toBeVisible();

  await page.locator("#tab-program").click();
  await expect(page.locator("#program-view")).toBeVisible();
  await expect(page.locator("#program-source")).toHaveValue(/\S/);

  await page.locator("#tab-canvas").click();
  await expect(page.locator("#canvas-view")).toBeVisible();
});

test("saves and imports a project roundtrip", async ({ page, browser }) => {
  const demoCount = await boot(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-download").click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  const project = JSON.parse(await fs.readFile(file, "utf8"));
  expect(project.format).toBe("computer-architecture-project");
  expect(project.version).toBe(1);
  expect(project.document.components.length).toBe(demoCount);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const imported = await context.newPage();
  const errors = collectErrors(imported);
  try {
    await imported.goto("/");
    await waitForCanvas(imported);
    imported.on("dialog", (dialog) => dialog.accept());
    await imported.locator("#file-input").setInputFiles(file);
    await expect.poll(() => componentCount(imported), { timeout: 15_000 }).toBe(demoCount);
    await expect(imported.locator("#import-error")).toBeHidden();
    await expect(imported.locator("#import-screen")).toBeHidden();
  } finally {
    await context.close();
  }
  expect(errors, `Browser errors:\n${errors.join("\n")}`).toEqual([]);
});

test("persists the board across reloads", async ({ page }) => {
  const before = await boot(page);
  await placeAnd(page);
  await expect.poll(() => componentCount(page)).toBe(before + 1);

  await page.reload();
  await waitForCanvas(page);
  await expect.poll(() => componentCount(page)).toBe(before + 1);
});

test("clears the canvas after confirmation", async ({ page }) => {
  await boot(page);
  await page.locator("#btn-clear").click();
  await expect(page.locator("#clear-screen")).toBeVisible();
  await page.locator("#clear-confirm").click();
  await expect.poll(() => componentCount(page)).toBe(0);
  await expect(page.locator("#clear-screen")).toBeHidden();
});

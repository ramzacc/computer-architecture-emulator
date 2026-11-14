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

async function boot(page) {
  await page.goto("/");
  await expect.poll(() => componentCount(page), { timeout: 15_000 }).toBeGreaterThan(10);
  await expect(page.locator("#import-screen")).toBeHidden();
}

async function panToEmptyCanvas(page) {
  const box = await page.locator("#canvas-wrap").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -20_000);
  return box;
}

async function place(page, type, point) {
  const button = page.locator(`#palette button[data-type="${type}"]`);
  await expect(button).toBeVisible();
  if (!(await button.evaluate((el) => el.classList.contains("active")))) await button.click();
  await page.mouse.click(point.x, point.y);
}

async function commitField(page, selector) {
  await page.locator(selector).press("Tab");
}

test("edits a component's size and label in the inspector", async ({ page }) => {
  await boot(page);
  const box = await panToEmptyCanvas(page);
  const before = await componentCount(page);
  await place(page, "and", { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect.poll(() => componentCount(page)).toBe(before + 1);
  await expect(page.locator("#selected-properties-heading")).toHaveText("AND");
  await expect(page.locator("#bus-status")).toContainText("Component selected.");

  await page.locator("#selected-size").fill("4");
  await commitField(page, "#selected-size");
  await expect(page.locator("#bus-status")).toContainText("AND: 4 bits.");
  await expect(page.locator("#selected-size")).toHaveValue("4");

  await page.locator("#component-label").fill("REFACTOR AND");
  await commitField(page, "#component-label");
  await expect(page.locator('#grid .comp[title^="REFACTOR AND"]')).toHaveCount(1);

  await page.reload();
  await expect.poll(() => componentCount(page), { timeout: 15_000 }).toBe(before + 1);
  await expect(page.locator("#import-screen")).toBeHidden();
  await expect(page.locator('#grid .comp[title^="REFACTOR AND"]')).toHaveCount(1);
  await expect(page.locator('#grid .comp[title^="REFACTOR AND"]')).toHaveAttribute("title", /4 bit\(s\)/);
});

test("rejects an invalid constant value and accepts a valid one", async ({ page }) => {
  await boot(page);
  const box = await panToEmptyCanvas(page);
  const before = await componentCount(page);
  await place(page, "constant", { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect.poll(() => componentCount(page)).toBe(before + 1);
  await expect(page.locator("#selected-properties-heading")).toHaveText("Constant");
  await expect(page.locator("#constant-value")).toBeVisible();
  await expect(page.locator("#value-format")).toBeVisible();

  await page.locator("#value-format").selectOption("hex");
  await expect(page.locator("#bus-status")).toContainText("Value format set to Hex (0x).");

  await page.locator("#constant-value").fill("F");
  await commitField(page, "#constant-value");
  await expect(page.locator("#bus-status")).toHaveClass(/error/);
  await expect(page.locator("#bus-status")).toBeVisible();
  await expect(page.locator("#bus-status")).toContainText("Enter a valid hex whole number");

  await page.locator("#constant-value").fill("1");
  await commitField(page, "#constant-value");
  await expect(page.locator("#bus-status")).not.toHaveClass(/error/);
  await expect(page.locator("#bus-status")).toContainText("Constant: 1 bit.");
});

test("supports keyboard rotate, delete, copy, paste, escape and undo", async ({ page }) => {
  await boot(page);
  const box = await panToEmptyCanvas(page);
  const base = await componentCount(page);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await place(page, "and", center);
  await expect.poll(() => componentCount(page)).toBe(base + 1);

  const placed = page.locator("#grid .comp.selected");
  await expect(placed).toHaveCount(1);
  const placedId = await placed.getAttribute("data-id");
  const horizontal = await placed.boundingBox();
  await page.keyboard.press("r");
  await expect.poll(async () => (await placed.boundingBox())?.width).toBeCloseTo(horizontal.height, 0);
  await expect.poll(async () => (await placed.boundingBox())?.height).toBeCloseTo(horizontal.width, 0);

  await page.keyboard.press("Delete");
  await expect.poll(() => componentCount(page)).toBe(base);

  await page.keyboard.press("Control+z");
  await expect.poll(() => componentCount(page)).toBe(base + 1);
  await page.locator(`#grid .comp[data-id="${placedId}"]`).click();

  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect.poll(() => componentCount(page)).toBe(base + 2);
  await expect(page.locator("#bus-status")).toContainText("1 component and 0 wire nets pasted.");

  await page.keyboard.press("Escape");
  await expect(page.locator("#btn-pan")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Control+z");
  await expect.poll(() => componentCount(page)).toBe(base + 1);
});

test("marquee-selects and drags multiple components", async ({ page }) => {
  await boot(page);
  const box = await panToEmptyCanvas(page);
  const base = await componentCount(page);
  const cy = box.y + box.height / 2;
  await place(page, "and", { x: box.x + box.width / 2 - 240, y: cy });
  await expect.poll(() => componentCount(page)).toBe(base + 1);
  await place(page, "and", { x: box.x + box.width / 2 + 240, y: cy });
  await expect.poll(() => componentCount(page)).toBe(base + 2);

  const first = page.locator("#grid .comp").nth(base);
  const second = page.locator("#grid .comp").nth(base + 1);
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();

  await page.locator("#btn-select").click();
  await page.mouse.move(box.x + box.width / 2 - 440, cy - 160);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 440, cy + 160, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#bus-status")).toContainText("2 components and 0 wire nets selected.");
  await expect(page.locator("#grid .comp.selected")).toHaveCount(2);

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 96, firstBox.y + firstBox.height / 2 + 48, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await first.boundingBox())?.x).toBeCloseTo(firstBox.x + 96, 0);
  await expect.poll(async () => (await first.boundingBox())?.y).toBeCloseTo(firstBox.y + 48, 0);
  await expect.poll(async () => (await second.boundingBox())?.x).toBeCloseTo(secondBox.x + 96, 0);
  await expect.poll(async () => (await second.boundingBox())?.y).toBeCloseTo(secondBox.y + 48, 0);
});

test("edits, pages, jumps and saves ROM contents", async ({ page }) => {
  await boot(page);
  await page.locator("#tab-rom").click();
  await expect(page.locator("#rom-rows input").first()).toBeVisible();
  await expect(page.locator("#rom-range")).toHaveText("00–3F of FF");

  await page.locator("#rom-next").click();
  await expect(page.locator("#rom-range")).toHaveText("40–7F of FF");
  await page.locator("#rom-prev").click();
  await expect(page.locator("#rom-range")).toHaveText("00–3F of FF");

  await page.locator("#rom-jump").fill("FF");
  await page.locator("#rom-go").click();
  await expect(page.locator("#rom-range")).toHaveText("C0–FF of FF");

  const cell = page.locator('#rom-rows input[data-address="255"]');
  await expect(cell).toBeVisible();
  await cell.fill("AB");
  await expect(page.locator("#rom-status")).toContainText("Unsaved ROM edits.");
  await page.locator("#rom-save").click();
  await expect(page.locator("#rom-status")).toContainText("ROM changes saved.");

  await page.locator("#tab-canvas").click();
  await page.locator("#tab-rom").click();
  await expect(page.locator('#rom-rows input[data-address="255"]')).toHaveValue("AB");
});

test("opens a module, adds interface pins, and shows them in Module Layout", async ({ page }) => {
  await boot(page);
  const box = await panToEmptyCanvas(page);
  const base = await componentCount(page);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await place(page, "module", center);
  await expect.poll(() => componentCount(page)).toBe(base + 1);
  await expect(page.locator("#selected-properties-heading")).toHaveText("Module");

  await page.locator("#module-open").click();
  await expect(page.locator("#module-navigation")).toBeVisible();
  await expect(page.locator("#module-path")).toHaveText(/^Canvas \/ Module/);

  await place(page, "input", { x: center.x - 120, y: center.y });
  await expect.poll(() => componentCount(page)).toBe(1);
  await place(page, "output", { x: center.x + 120, y: center.y });
  await expect.poll(() => componentCount(page)).toBe(2);

  await page.locator("#module-back").click();
  await expect(page.locator("#module-navigation")).toBeHidden();
  await expect(page.locator("#module-layout-view")).toBeVisible();
  await expect(page.locator(".module-layout-pin")).toHaveCount(2);
  await expect(page.locator('#grid .comp[title*="1 inputs, 1 outputs"]')).toHaveCount(1);
});

test("drives the Program tab source, transport and breakpoints", async ({ page }) => {
  await boot(page);
  await page.locator("#tab-program").click();
  const source = page.locator("#program-source");
  await expect(source).toHaveValue(/\S/);
  await expect(page.locator("#program-save-rom")).toBeDisabled();
  await expect(page.locator("#program-play")).toBeEnabled();
  await expect(page.locator("#program-pause")).toBeDisabled();
  await expect(page.locator("#program-step-button")).toBeEnabled();

  await page.locator("#program-play").click();
  await expect(page.locator("#program-pause")).toBeEnabled();
  await expect(page.locator("#program-play")).toBeDisabled();
  await page.locator("#program-pause").click();
  await expect(page.locator("#program-play")).toBeEnabled();

  const breakpoint = page.locator("#program-gutter-lines button[data-address]").first();
  await expect(breakpoint).toBeVisible();
  await breakpoint.click();
  await expect(breakpoint).toHaveAttribute("aria-pressed", "true");
  await breakpoint.click();
  await expect(breakpoint).toHaveAttribute("aria-pressed", "false");

  const original = await source.inputValue();
  await source.fill(`${original}\n; e2e draft`);
  await expect(page.locator("#program-save-rom")).toBeEnabled();
  await expect(page.locator("#program-play")).toBeDisabled();
  await expect(page.locator("#program-step-button")).toBeDisabled();
  await expect(page.locator("#program-assembly-note")).toContainText("Unsaved assembly edits.");
});

test("renders ISA rules and marks added rules as unsaved", async ({ page }) => {
  await boot(page);
  await page.locator("#tab-isa").click();
  await expect.poll(() => page.locator("#isa-rules .isa-card").count()).toBeGreaterThan(2);
  await page.locator("#isa-add").click();
  await expect(page.locator("#isa-note")).toHaveText("Unsaved assembly rules.");
});

test("zooms with the keyboard and resets the view", async ({ page }) => {
  await boot(page);
  const zoom = page.locator("#zoom-level");
  await expect(zoom).toHaveText("100%");

  await page.keyboard.press("+");
  await expect(zoom).toHaveText("120%");
  await page.keyboard.press("-");
  await expect(zoom).toHaveText("100%");

  const box = await page.locator("#canvas-wrap").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(zoom).toHaveText("120%");

  await page.keyboard.press("Control+0");
  await expect(zoom).toHaveText("100%");
});

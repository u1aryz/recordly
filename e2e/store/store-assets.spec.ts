import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures";

/**
 * Generates the Chrome Web Store listing assets. Run via `pnpm store:assets`,
 * which sets STORE_ASSETS_DIR so the browser context uses the English UI and
 * a 1280x800 viewport (see fixtures.ts, including the macOS locale note).
 */

const assetsDir = process.env.STORE_ASSETS_DIR ?? "docs/store";
const screenshotsDir = path.join(assetsDir, "screenshots");
const promoDir = path.join(assetsDir, "promo");
const pagesDir = fileURLToPath(new URL("./pages", import.meta.url));
const iconPath = fileURLToPath(
	new URL("../../public/icon/128.png", import.meta.url),
);

const DEMO_PAGE_URL = "http://localhost/store-demo.html";
const PROMO_PAGE_URL = "http://localhost/promo.html";

test("captures store screenshots of the picker, HUD, and captures page", async ({
	context,
	extensionId,
	getMessage,
	startPicker,
	stubDirectoryPicker,
}) => {
	await mkdir(screenshotsDir, { recursive: true });
	await context.route(`${DEMO_PAGE_URL}*`, async (route) => {
		await route.fulfill({
			contentType: "text/html",
			body: await readFile(path.join(pagesDir, "store-demo.html"), "utf-8"),
		});
	});

	const page = await context.newPage();
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(DEMO_PAGE_URL);
	const startLabel = await getMessage("chooseFolderAndRecord");
	const stopLabel = await getMessage("stopAndSave");

	await stubDirectoryPicker(page);
	await page.waitForTimeout(500);

	// Picker with the demo video highlighted and the recording menu open.
	await startPicker();
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 10,
	});
	const startButton = page.getByRole("button", { name: startLabel });
	await expect(startButton).toBeVisible();
	await page.waitForTimeout(500);
	await page.screenshot({
		path: path.join(screenshotsDir, "01-pick-a-video.png"),
	});

	// Recording HUD with the timer running.
	await startButton.click();
	const stopButton = page.getByRole("button", { name: stopLabel });
	await expect(stopButton).toBeVisible({ timeout: 15_000 });
	// Wait past the 3-second chunk timeslice so the HUD timer has advanced.
	await page.waitForTimeout(4700);
	await page.mouse.move(640, 780);
	await page.screenshot({
		path: path.join(screenshotsDir, "02-recording-hud.png"),
	});

	// Captures page while the recording is in progress.
	const capturesPage = await context.newPage();
	await capturesPage.setViewportSize({ width: 1280, height: 800 });
	await capturesPage.goto(`chrome-extension://${extensionId}/captures.html`);
	await expect(
		capturesPage.getByRole("button", { name: stopLabel }),
	).toBeVisible({ timeout: 10_000 });
	await capturesPage.screenshot({
		path: path.join(screenshotsDir, "03-captures-recording.png"),
	});

	// Stop, then capture the saved state on the captures page.
	await page.bringToFront();
	await stopButton.click();
	await capturesPage.bringToFront();
	await expect(
		capturesPage.getByText(await getMessage("statusSaved")).first(),
	).toBeVisible({ timeout: 15_000 });
	await capturesPage.screenshot({
		path: path.join(screenshotsDir, "04-captures-saved.png"),
	});
});

test("renders the promo tiles", async ({ context }) => {
	await mkdir(promoDir, { recursive: true });
	const icon = await readFile(iconPath);
	const template = await readFile(path.join(pagesDir, "promo.html"), "utf-8");
	const body = template.replace(
		"__ICON_SRC__",
		`data:image/png;base64,${icon.toString("base64")}`,
	);
	await context.route(`${PROMO_PAGE_URL}*`, async (route) => {
		await route.fulfill({ contentType: "text/html", body });
	});

	const tiles = [
		{ size: "small", width: 440, height: 280, file: "small-tile.png" },
		{ size: "marquee", width: 1400, height: 560, file: "marquee.png" },
	];
	const page = await context.newPage();
	for (const tile of tiles) {
		await page.setViewportSize({ width: tile.width, height: tile.height });
		await page.goto(`${PROMO_PAGE_URL}?size=${tile.size}`);
		await page.screenshot({ path: path.join(promoDir, tile.file) });
	}
});

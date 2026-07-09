import type { Page } from "@playwright/test";
import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

async function hoverVideo(page: Page): Promise<void> {
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 5,
	});
}

test("picker instructions bar, selection, and cancel work correctly", async ({
	context,
	getMessage,
	startPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const instructions = await getMessage("pickerInstructions");
	const videoLabel = await getMessage("videoElementLabel");
	const cancelLabel = await getMessage("cancel");

	await startPicker();

	// Right after starting, only the instructions bar is shown.
	await expect(page.getByText(instructions)).toBeVisible();
	await expect(page.getByText(videoLabel, { exact: true })).toBeHidden();

	// Moving away from the video keeps the instructions bar visible without triggering a selection.
	// Move via the right edge so the midpoint doesn't pass over the video.
	await page.mouse.move(950, 100, { steps: 5 });
	await page.mouse.move(950, 650, { steps: 5 });
	await expect(page.getByText(instructions)).toBeVisible();
	await expect(page.getByText(videoLabel, { exact: true })).toBeHidden();

	// Hovering over the video shows the toolbar, and the instructions bar remains visible.
	await hoverVideo(page);
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();
	await expect(page.getByText(instructions)).toBeVisible();

	// Moving outside the video (e.g. the gap at the top or empty areas) keeps the selection.
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + 50, box.y - 4, { steps: 5 });
	await page.mouse.move(950, 650, { steps: 5 });
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();

	// Moving the real mouse to the cancel button and clicking closes the entire picker.
	await page.getByRole("button", { name: cancelLabel }).click();
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);
});

test("clears the selection when the selected video is removed from the page without scrolling", async ({
	context,
	getMessage,
	startPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const instructions = await getMessage("pickerInstructions");
	const videoLabel = await getMessage("videoElementLabel");

	await startPicker();
	await hoverVideo(page);
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();

	// Simulate an SPA re-render removing the video (no scroll/resize involved).
	await page.evaluate(() => {
		document.getElementById("v")?.remove();
	});

	// The selection is cleared but the picker itself stays open.
	await expect(page.getByText(videoLabel, { exact: true })).toBeHidden();
	await expect(page.getByText(instructions)).toBeVisible();
	await expect(page.locator("recordly-video-picker")).toHaveCount(1);
});

test("picker UI sizing is immune to the page root font-size", async ({
	context,
	getMessage,
	startPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	// Simulate sites using the 62.5% root font-size trick (1rem = 6.25px).
	await page.addStyleTag({ content: "html { font-size: 62.5%; }" });

	await startPicker();
	await hoverVideo(page);

	const recordButton = page.getByRole("button", {
		name: await getMessage("chooseFolderAndRecord"),
	});
	await expect(recordButton).toBeVisible();
	// .btn-xs: --fontsize 11px, height = --size-field(4px) * 6 = 24px.
	expect(
		await recordButton.evaluate((el) => {
			const style = getComputedStyle(el);
			return { fontSize: style.fontSize, height: style.height };
		}),
	).toEqual({ fontSize: "11px", height: "24px" });
});

test("pressing Escape closes the picker", async ({
	context,
	getMessage,
	startPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const instructions = await getMessage("pickerInstructions");

	await startPicker();
	await expect(page.getByText(instructions)).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);
});

test("picker UI stays clickable above a page element with a z-index", async ({
	context,
	getMessage,
	startPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const videoLabel = await getMessage("videoElementLabel");
	const cancelLabel = await getMessage("cancel");

	// Stretch the page's fixed z-index:100 header over the whole viewport so
	// every picker interaction fails if the overlay is stacked beneath it.
	await page.evaluate(() => {
		const header = document.querySelector("header");
		if (header) {
			header.style.height = "100vh";
		}
	});

	await startPicker();
	await hoverVideo(page);
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();

	// Playwright refuses to click a covered element, so this click also
	// proves the toolbar is painted above the header.
	await page.getByRole("button", { name: cancelLabel }).click();
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);
});

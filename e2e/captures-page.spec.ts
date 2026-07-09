import type { Page } from "@playwright/test";
import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

test("stops and deletes a capture from the captures page", async ({
	context,
	extensionId,
	getMessage,
	startPicker,
	stubDirectoryPicker,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const videoLabel = await getMessage("videoElementLabel");
	const startLabel = await getMessage("chooseFolderAndRecord");
	const stopLabel = await getMessage("stopAndSave");

	await stubDirectoryPicker(page);
	await startPicker();
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 5,
	});
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: startLabel }).click();
	await expect(page.getByRole("button", { name: stopLabel })).toBeVisible({
		timeout: 15_000,
	});

	// Starting a capture opens captures.html in a background tab.
	const capturesUrl = `chrome-extension://${extensionId}/captures.html`;
	await expect
		.poll(() => context.pages().some((p) => p.url().startsWith(capturesUrl)), {
			timeout: 15_000,
		})
		.toBe(true);
	const capturesPage = context
		.pages()
		.find((p) => p.url().startsWith(capturesUrl)) as Page;
	await capturesPage.bringToFront();
	const capturesStopButton = capturesPage.getByRole("button", {
		name: stopLabel,
	});
	await expect(capturesStopButton).toBeVisible({ timeout: 15_000 });

	// Pressing Delete while the capture is recording must not remove it.
	await capturesPage.keyboard.press("Delete");
	await expect(capturesStopButton).toBeVisible();

	// Record past one chunk timeslice, then stop from the captures page.
	await page.waitForTimeout(3500);
	await capturesStopButton.click();
	const savedLabel = await getMessage("statusSaved");
	await expect(
		capturesPage.getByText(savedLabel, { exact: true }).first(),
	).toBeVisible({ timeout: 15_000 });

	// Deleting the stopped capture clears the history.
	const deleteLabel = await getMessage("removeFromHistory");
	await capturesPage.getByRole("button", { name: deleteLabel }).click();
	await expect(
		capturesPage.getByText(await getMessage("noCaptures")),
	).toBeVisible({ timeout: 15_000 });
});

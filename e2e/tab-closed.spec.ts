import type { Page } from "@playwright/test";
import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

test("finishes the capture when the recording tab is closed", async ({
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
	const recordingLabel = await getMessage("statusRecording");
	await expect(capturesPage.getByText(recordingLabel).first()).toBeVisible({
		timeout: 15_000,
	});

	// Record past one chunk timeslice, then close the tab mid-recording.
	await page.waitForTimeout(3500);
	await page.close();

	// The background finishes the capture with source_closed. The open part
	// file usually can't be confirmed in time, so the capture needs review;
	// when a part happened to be finalized first it shows as partially saved.
	const needsReview = await getMessage("statusNeedsReview");
	const partiallySaved = await getMessage("statusPartiallySaved");
	await expect(
		capturesPage
			.getByText(needsReview)
			.or(capturesPage.getByText(partiallySaved))
			.first(),
	).toBeVisible({ timeout: 15_000 });
});

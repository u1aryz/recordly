import { expect, test, VIDEO_TEST_PAGE_URL } from "../fixtures";

/**
 * Records the demo video for the README. Run via `pnpm demo:record` with
 * DEMO_VIDEO_DIR set, tracing the same flow as capture.spec.ts but at a
 * viewer-friendly pace.
 */
test("demo: select a video with the picker, record, and save an MP4", async ({
	context,
	getMessage,
	startPicker,
	stubDirectoryPicker,
	readOpfsFiles,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const startLabel = await getMessage("chooseFolderAndRecord");
	const stopLabel = await getMessage("stopAndSave");

	await stubDirectoryPicker(page);
	await page.waitForTimeout(1000);

	// Start the picker and pause long enough to read the instructions bar.
	await startPicker();
	await page.waitForTimeout(1200);

	// Move the cursor slowly to the video so the highlight is visible.
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 25,
	});
	await page.waitForTimeout(1000);

	const startButton = page.getByRole("button", { name: startLabel });
	await startButton.hover();
	await page.waitForTimeout(600);
	await startButton.click();

	// Show the recording until the HUD timer crosses the chunk boundary (3 seconds).
	const stopButton = page.getByRole("button", { name: stopLabel });
	await expect(stopButton).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(5500);

	await stopButton.hover();
	await page.waitForTimeout(600);
	await stopButton.click();

	// Verify the MP4 was saved so the demo doesn't pass with a broken flow.
	await expect
		.poll(
			async () => {
				const files = await readOpfsFiles(page);
				return files.filter(
					(file) => /-part-001\.mp4$/.test(file.name) && file.size > 0,
				);
			},
			{ timeout: 15_000 },
		)
		.toHaveLength(1);

	// Show the final state briefly before finishing.
	await page.waitForTimeout(1500);
});

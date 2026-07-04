import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

/** Whether the first 12 bytes of the MP4 contain the ftyp box signature. */
function hasFtypBox(head: number[]): boolean {
	// The layout is [size(4)] "ftyp" ..., so check starting at offset 4.
	const ftyp = [0x66, 0x74, 0x79, 0x70];
	return ftyp.every((byte, index) => head[4 + index] === byte);
}

test("selects a video, records, and saves an MP4", async ({
	context,
	getMessage,
	startPicker,
	stubDirectoryPicker,
	readOpfsFiles,
}) => {
	const page = await context.newPage();
	await page.goto(VIDEO_TEST_PAGE_URL);
	const videoLabel = await getMessage("videoElementLabel");
	const startLabel = await getMessage("chooseFolderAndRecord");
	const stopLabel = await getMessage("stopAndSave");

	// The folder selection dialog can't be automated, so replace showDirectoryPicker
	// with OPFS in the content script's isolated world.
	await stubDirectoryPicker(page);

	// Start the picker, select the video, and begin recording.
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

	// Once recording starts, the HUD appears and the picker closes.
	const stopButton = page.getByRole("button", { name: stopLabel });
	await expect(stopButton).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);

	// Record past the chunk timeslice (3 seconds) before stopping.
	await page.waitForTimeout(3500);
	await stopButton.click();

	// OPFS part files only have their size finalized once writable.close() completes,
	// so we can verify the save completed by checking that a part file with size > 0 appears.
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

	const [saved] = (await readOpfsFiles(page)).filter((file) =>
		/-part-001\.mp4$/.test(file.name),
	);
	expect(saved.size).toBeGreaterThan(0);
	expect(hasFtypBox(saved.head)).toBe(true);
});

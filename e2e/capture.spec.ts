import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

/** Whether the first 12 bytes of the MP4 contain the ftyp box signature. */
function hasFtypBox(head: number[]): boolean {
	// The layout is [size(4)] "ftyp" ..., so check starting at offset 4.
	const ftyp = [0x66, 0x74, 0x79, 0x70];
	return ftyp.every((byte, index) => head[4 + index] === byte);
}

/** Lists the top-level box types of an MP4, or null when the layout is malformed. */
function topLevelBoxTypes(bytes: number[]): string[] | null {
	const types: string[] = [];
	let offset = 0;
	while (offset < bytes.length) {
		if (offset + 8 > bytes.length) {
			return null;
		}
		const size =
			bytes[offset] * 0x1000000 +
			bytes[offset + 1] * 0x10000 +
			bytes[offset + 2] * 0x100 +
			bytes[offset + 3];
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7],
		);
		if (size === 1) {
			// Large-size boxes don't appear in files this small; treat as malformed.
			return null;
		}
		if (size < 8 || offset + size > bytes.length) {
			return null;
		}
		types.push(type);
		offset += size;
	}
	return types;
}

/** Reads the mvhd duration of the moov box that starts at `moovOffset`. */
function readMvhdDuration(bytes: number[], moovOffset: number): number {
	// moov header (8) is followed by mvhd: [size][mvhd][version+flags]...
	const mvhdStart = moovOffset + 8;
	const version = bytes[mvhdStart + 8];
	// version 0: creation(4) + modification(4) + timescale(4) precede duration.
	// version 1: creation(8) + modification(8) + timescale(4) precede duration.
	const durationOffset = mvhdStart + 12 + (version === 1 ? 20 : 12);
	let duration = 0;
	const width = version === 1 ? 8 : 4;
	for (let index = 0; index < width; index += 1) {
		duration = duration * 256 + bytes[durationOffset + index];
	}
	return duration;
}

test("selects a video, records, and saves an MP4", async ({
	context,
	getMessage,
	startPicker,
	stubDirectoryPicker,
	readOpfsFiles,
	readOpfsFileBytes,
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

	// The saved fragmented MP4 is defragmented in place after the recording
	// stops, so poll until the flat faststart layout (single moov before the
	// mdat, no moof fragments) appears.
	await expect
		.poll(
			async () => {
				const bytes = await readOpfsFileBytes(page, saved.name);
				return bytes ? topLevelBoxTypes(bytes) : null;
			},
			{ timeout: 15_000 },
		)
		.toEqual(["ftyp", "moov", "mdat"]);

	const defragged = await readOpfsFileBytes(page, saved.name);
	if (!defragged) {
		throw new Error("part file disappeared after defragmentation");
	}
	// The moov sits right after ftyp and now carries the real duration.
	const ftypSize = defragged[3] + defragged[2] * 0x100;
	expect(readMvhdDuration(defragged, ftypSize)).toBeGreaterThan(0);
});

import { expect, test, VIDEO_TEST_PAGE_URL } from "./fixtures";

/** MP4 の先頭 12 バイトに ftyp box シグネチャが含まれるか。 */
function hasFtypBox(head: number[]): boolean {
	// [size(4)] "ftyp" ... の並びなので offset 4 から確認する。
	const ftyp = [0x66, 0x74, 0x79, 0x70];
	return ftyp.every((byte, index) => head[4 + index] === byte);
}

test("動画を選択して録画し MP4 が保存される", async ({
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

	// フォルダ選択ダイアログは自動化できないため、content script の isolated world で
	// showDirectoryPicker を OPFS に差し替える。
	await stubDirectoryPicker(page);

	// ピッカーを起動して動画を選択し、録画を開始する。
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

	// 録画が始まると HUD が表示され、ピッカーは閉じる。
	const stopButton = page.getByRole("button", { name: stopLabel });
	await expect(stopButton).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);

	// チャンクの timeslice(3 秒)を跨ぐまで録画してから停止する。
	await page.waitForTimeout(3500);
	await stopButton.click();

	// OPFS の part ファイルは writable.close() 完了時にのみサイズが確定するため、
	// 「size > 0 の part ファイルが現れる」= 保存完了として検証できる。
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

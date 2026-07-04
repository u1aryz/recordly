import { expect, test, VIDEO_TEST_PAGE_URL } from "../fixtures";

/**
 * README 用のデモ動画を録画する。DEMO_VIDEO_DIR を指定した pnpm demo:record
 * から実行し、capture.spec.ts と同じフローを鑑賞向けのペースでなぞる。
 */
test("デモ: ピッカーで動画を選択して録画し MP4 を保存する", async ({
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

	// ピッカーを起動し、案内バーを読めるだけの間を置く。
	await startPicker();
	await page.waitForTimeout(1200);

	// ハイライトが見えるよう、動画までゆっくりカーソルを移動する。
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

	// HUD のタイマーがチャンク境界(3 秒)を跨ぐまで録画を見せる。
	const stopButton = page.getByRole("button", { name: stopLabel });
	await expect(stopButton).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(5500);

	await stopButton.hover();
	await page.waitForTimeout(600);
	await stopButton.click();

	// フローが壊れたままデモが成功しないよう、MP4 の保存を検証する。
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

	// 最終状態を少し映してから終了する。
	await page.waitForTimeout(1500);
});

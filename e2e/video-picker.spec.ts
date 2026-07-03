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

test("ピッカーの案内バー・選択・キャンセルが機能する", async ({
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

	// 起動直後は案内バーのみ表示される。
	await expect(page.getByText(instructions)).toBeVisible();
	await expect(page.getByText(videoLabel, { exact: true })).toBeHidden();

	// 動画から離れた場所へ動かしても案内バーは表示されたまま、選択は発生しない。
	// 中間点が動画上を通らないよう、右端を経由して移動する。
	await page.mouse.move(950, 100, { steps: 5 });
	await page.mouse.move(950, 650, { steps: 5 });
	await expect(page.getByText(instructions)).toBeVisible();
	await expect(page.getByText(videoLabel, { exact: true })).toBeHidden();

	// 動画上に載せるとツールバーが表示され、案内バーも表示され続ける。
	await hoverVideo(page);
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();
	await expect(page.getByText(instructions)).toBeVisible();

	// 動画の外(上端の隙間や空きエリア)へ動かしても選択は維持される。
	const box = await page.locator("#v").boundingBox();
	if (!box) {
		throw new Error("video element not found");
	}
	await page.mouse.move(box.x + 50, box.y - 4, { steps: 5 });
	await page.mouse.move(950, 650, { steps: 5 });
	await expect(page.getByText(videoLabel, { exact: true })).toBeVisible();

	// キャンセルボタンまで実マウスで移動してクリックするとピッカー全体が閉じる。
	await page.getByRole("button", { name: cancelLabel }).click();
	await expect(page.locator("recordly-video-picker")).toHaveCount(0);
});

test("Escape でピッカーが閉じる", async ({
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

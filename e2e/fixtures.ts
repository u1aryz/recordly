import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type BrowserContext,
	test as base,
	type CDPSession,
	chromium,
	type Page,
	type Worker,
} from "@playwright/test";

/** service worker 内(evaluate コールバック)で参照する chrome API の最小型。 */
declare const chrome: {
	i18n: { getMessage: (key: string) => string };
	tabs: {
		query: (info: { url: string }) => Promise<{ id?: number }[]>;
		sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
	};
};

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = path.join(rootDir, "output/chrome-mv3");
const videoTestPagePath = fileURLToPath(
	new URL("./pages/video-test.html", import.meta.url),
);

/** テストページの URL。localhost は secure context なので OPFS が使える。 */
export const VIDEO_TEST_PAGE_URL = "http://localhost/video-test.html";

type ExtensionFixtures = {
	context: BrowserContext;
	extensionId: string;
	serviceWorker: Worker;
	/** 拡張機能に適用されているロケールの UI 文言を返す。 */
	getMessage: (key: string) => Promise<string>;
	/** アクティブタブへ START_PICKER を送ってピッカーを起動する。 */
	startPicker: () => Promise<void>;
	/** content script の isolated world で showDirectoryPicker を OPFS に差し替える。 */
	stubDirectoryPicker: (page: Page) => Promise<void>;
	/** テストページの OPFS ルート直下のファイル一覧(名前・サイズ・先頭バイト)を返す。 */
	readOpfsFiles: (
		page: Page,
	) => Promise<{ name: string; size: number; head: number[] }[]>;
};

export const test = base.extend<ExtensionFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture の作法
	context: async ({}, use) => {
		// DEMO_VIDEO_DIR が指定されたときだけ、デモ録画用にページ動画の保存と
		// 鑑賞向けのスロー再生を有効にする(通常のテスト実行には影響しない)。
		const demoVideoDir = process.env.DEMO_VIDEO_DIR;
		const context = await chromium.launchPersistentContext("", {
			// 拡張機能を headless でロードするには channel: "chromium" が必要。
			channel: "chromium",
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
			],
			...(demoVideoDir
				? {
						// デモは英語 UI で録画する。macOS では拡張の UI 言語が OS 設定に従うため、
						// 必要なら次で上書きする:
						// defaults write com.google.chrome.for.testing AppleLanguages '("en-US")'
						// (録画後は defaults delete で戻す)
						locale: "en-US",
						slowMo: 250,
						viewport: { width: 1280, height: 720 },
						recordVideo: {
							dir: demoVideoDir,
							size: { width: 1280, height: 720 },
						},
					}
				: {}),
		});
		// テストページはネットワークを介さず route で配信する。
		await context.route(`${VIDEO_TEST_PAGE_URL}*`, async (route) => {
			await route.fulfill({
				contentType: "text/html",
				body: await readFile(videoTestPagePath, "utf-8"),
			});
		});
		await use(context);
		await context.close();
	},
	serviceWorker: async ({ context }, use) => {
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker"));
		await use(worker);
	},
	extensionId: async ({ serviceWorker }, use) => {
		await use(new URL(serviceWorker.url()).host);
	},
	getMessage: async ({ serviceWorker }, use) => {
		await use(async (key) => {
			const message = await serviceWorker.evaluate(
				(k) => chrome.i18n.getMessage(k),
				key,
			);
			if (!message) {
				throw new Error(`i18n message not found: ${key}`);
			}
			return message;
		});
	},
	startPicker: async ({ serviceWorker }, use) => {
		await use(async () => {
			await serviceWorker.evaluate(async () => {
				const tabs = await chrome.tabs.query({ url: "http://localhost/*" });
				const tabId = tabs[0]?.id;
				if (tabId === undefined) {
					throw new Error("video test page tab not found");
				}
				await chrome.tabs.sendMessage(tabId, { type: "START_PICKER" });
			});
		});
	},
	stubDirectoryPicker: async ({ context, extensionId }, use) => {
		await use(async (page) => {
			const cdp = await context.newCDPSession(page);
			const contextId = await findContentScriptContextId(cdp, extensionId);
			await cdp.send("Runtime.evaluate", {
				contextId,
				expression:
					"window.showDirectoryPicker = () => navigator.storage.getDirectory()",
			});
			await cdp.detach();
		});
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture の作法
	readOpfsFiles: async ({}, use) => {
		await use(async (page) => {
			return await page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				const files: { name: string; size: number; head: number[] }[] = [];
				for await (const [name, handle] of root.entries()) {
					if (handle.kind !== "file") {
						continue;
					}
					const file = await (handle as FileSystemFileHandle).getFile();
					const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
					files.push({ name, size: file.size, head: Array.from(head) });
				}
				return files;
			});
		});
	},
});

export const expect = test.expect;

type ExecutionContextDescription = {
	id: number;
	origin: string;
	name: string;
	auxData?: { isDefault?: boolean; type?: string };
};

/**
 * content script(isolated world)の execution context を特定する。
 * Runtime.enable で既存コンテキスト分の executionContextCreated が再生されるのを利用する。
 * Playwright 自身の utility world も isolated として現れるため、拡張 ID で絞り込む。
 */
async function findContentScriptContextId(
	cdp: CDPSession,
	extensionId: string,
): Promise<number> {
	const contexts: ExecutionContextDescription[] = [];
	cdp.on("Runtime.executionContextCreated", (event) => {
		contexts.push(event.context as ExecutionContextDescription);
	});
	await cdp.send("Runtime.enable");
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const found = contexts.find(
			(context) =>
				context.auxData?.isDefault === false &&
				(context.name.includes(extensionId) ||
					context.origin.includes(extensionId)),
		);
		if (found) {
			await cdp.send("Runtime.disable");
			return found.id;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`content script isolated world not found. contexts: ${JSON.stringify(contexts)}`,
	);
}

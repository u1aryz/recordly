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

/** Minimal type for the chrome API referenced inside the service worker (evaluate callback). */
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

/** URL of the test page. localhost is a secure context, so OPFS is available. */
export const VIDEO_TEST_PAGE_URL = "http://localhost/video-test.html";

type ExtensionFixtures = {
	context: BrowserContext;
	extensionId: string;
	serviceWorker: Worker;
	/** Returns the UI text for the locale currently applied to the extension. */
	getMessage: (key: string) => Promise<string>;
	/** Sends START_PICKER to the active tab to launch the picker. */
	startPicker: () => Promise<void>;
	/** Replaces showDirectoryPicker with OPFS in the content script's isolated world. */
	stubDirectoryPicker: (page: Page) => Promise<void>;
	/**
	 * Returns the list of files directly under the test page's OPFS root
	 * (name, size, and leading bytes).
	 * Skips files that can't be read because they're still being written
	 * (they'll be picked up on the next polling attempt).
	 */
	readOpfsFiles: (
		page: Page,
	) => Promise<{ name: string; size: number; head: number[] }[]>;
	/**
	 * Reads the full bytes of one file under the test page's OPFS root.
	 * Returns null while the file is missing or being rewritten (so callers
	 * can retry from expect.poll).
	 */
	readOpfsFileBytes: (page: Page, name: string) => Promise<number[] | null>;
};

export const test = base.extend<ExtensionFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture convention
	context: async ({}, use) => {
		// Only enable page video recording and viewer-friendly slow motion for
		// demo recordings when DEMO_VIDEO_DIR is set (no effect on normal test runs).
		const demoVideoDir = process.env.DEMO_VIDEO_DIR;
		// Store asset generation (pnpm store:assets) uses the English UI and the
		// Chrome Web Store screenshot viewport (no effect on normal test runs).
		const storeAssetsDir = process.env.STORE_ASSETS_DIR;
		const context = await chromium.launchPersistentContext("", {
			// channel: "chromium" is required to load the extension in headless mode.
			channel: "chromium",
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
			],
			...(demoVideoDir
				? {
						// Demos are recorded with the English UI. On macOS, the extension's
						// UI language follows the OS setting instead of this locale option;
						// english-ui-global-setup.ts overrides it for the run.
						locale: "en-US",
						slowMo: 250,
						viewport: { width: 1280, height: 720 },
						recordVideo: {
							dir: demoVideoDir,
							size: { width: 1280, height: 720 },
						},
					}
				: {}),
			...(storeAssetsDir
				? {
						// Same macOS UI-language caveat as the demo recording above.
						locale: "en-US",
						viewport: { width: 1280, height: 800 },
					}
				: {}),
		});
		// Serve the test page via route rather than over the network.
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
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture convention
	readOpfsFiles: async ({}, use) => {
		await use(async (page) => {
			return await page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				const files: { name: string; size: number; head: number[] }[] = [];
				for await (const [name, handle] of root.entries()) {
					if (handle.kind !== "file") {
						continue;
					}
					// A File is a snapshot reference, so if the underlying file is
					// rewritten after it's obtained, reading it fails with
					// NotReadableError. Skip files that are still being written and
					// leave them for the next expect.poll attempt.
					try {
						const file = await (handle as FileSystemFileHandle).getFile();
						const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
						files.push({ name, size: file.size, head: Array.from(head) });
					} catch {
						// Skip files rewritten while reading; don't include them this round.
					}
				}
				return files;
			});
		});
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture convention
	readOpfsFileBytes: async ({}, use) => {
		await use(async (page, name) => {
			return await page.evaluate(async (fileName) => {
				const root = await navigator.storage.getDirectory();
				try {
					const handle = await root.getFileHandle(fileName);
					const file = await handle.getFile();
					return Array.from(new Uint8Array(await file.arrayBuffer()));
				} catch {
					// Missing or rewritten mid-read; let the caller poll again.
					return null;
				}
			}, name);
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
 * Identifies the execution context of the content script (isolated world).
 * Relies on Runtime.enable replaying executionContextCreated events for
 * already-existing contexts.
 * Playwright's own utility world also appears as isolated, so filter by
 * extension ID to narrow it down.
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

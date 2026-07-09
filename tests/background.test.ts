import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { createCaptureMetadata } from "@/shared/capture-state";
import { getCapture, putCapture } from "@/shared/storage";
import type { CaptureMetadata, PortMessage } from "@/shared/types";

type FakeEvent<Args extends unknown[]> = {
	addListener: (fn: (...args: Args) => void) => void;
	removeListener: (fn: (...args: Args) => void) => void;
	hasListener: (fn: (...args: Args) => void) => boolean;
	trigger: (...args: Args) => void;
};

function createFakeEvent<Args extends unknown[]>(): FakeEvent<Args> {
	const listeners = new Set<(...args: Args) => void>();
	return {
		addListener: (fn) => listeners.add(fn),
		removeListener: (fn) => listeners.delete(fn),
		hasListener: (fn) => listeners.has(fn),
		trigger: (...args) => {
			for (const fn of listeners) {
				fn(...args);
			}
		},
	};
}

type FakePort = {
	name: string;
	sender?: { tab?: { id: number; url: string } };
	postMessage: (message: unknown) => void;
	disconnect: () => void;
	onMessage: FakeEvent<[unknown]>;
	onDisconnect: FakeEvent<[]>;
};

// fakeBrowser does not implement runtime.connect/onConnect, so stand in a
// minimal two-ended port pair: the server end goes to the background's
// onConnect listener, the client end drives the test.
function createPortPair(
	name: string,
	sender?: FakePort["sender"],
): { client: FakePort; server: FakePort } {
	const toServer = createFakeEvent<[unknown]>();
	const toClient = createFakeEvent<[unknown]>();
	const disconnected = createFakeEvent<[]>();
	return {
		client: {
			name,
			postMessage: (message) => toServer.trigger(message),
			onMessage: toClient,
			onDisconnect: disconnected,
			disconnect: () => disconnected.trigger(),
		},
		server: {
			name,
			sender,
			postMessage: (message) => toClient.trigger(message),
			onMessage: toServer,
			onDisconnect: disconnected,
			disconnect: () => disconnected.trigger(),
		},
	};
}

let onConnect: FakeEvent<[FakePort]>;

async function startBackground(): Promise<void> {
	const background = (await import("@/entrypoints/background")).default;
	background.main?.();
}

function connectPort(name: string, sender?: FakePort["sender"]): FakePort {
	const { client, server } = createPortPair(name, sender);
	onConnect.trigger(server);
	return client;
}

function createTestMetadata(
	overrides: Partial<CaptureMetadata> = {},
): CaptureMetadata {
	return {
		...createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			status: "recording",
			fileStatus: "writing",
			storageMode: "segmented-files",
			scope: "element",
		}),
		...overrides,
	};
}

function createSender(tabId: number): Browser.runtime.MessageSender {
	return {
		tab: { id: tabId, url: "https://example.test/watch" },
	} as Browser.runtime.MessageSender;
}

async function triggerMessage(
	message: unknown,
	sender: Browser.runtime.MessageSender,
): Promise<unknown[]> {
	return fakeBrowser.runtime.onMessage.trigger(message, sender);
}

beforeEach(() => {
	// A fresh module copy per test resets the background's module-level
	// capture registries.
	vi.resetModules();
	onConnect = createFakeEvent();
	fakeBrowser.runtime.onConnect =
		onConnect as unknown as typeof fakeBrowser.runtime.onConnect;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("background message handling", () => {
	it("persists a started capture, updates the badge, and opens the captures page", async () => {
		await startBackground();
		const setBadgeText = vi.spyOn(fakeBrowser.action, "setBadgeText");
		const metadata = createTestMetadata();

		const results = await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		expect(results).toContainEqual({ ok: true });
		expect(await getCapture(metadata.id)).toMatchObject({
			status: "recording",
			tabId: 11,
			pageUrl: "https://example.test/watch",
		});
		expect(setBadgeText).toHaveBeenLastCalledWith({ text: "1" });
		const tabs = await fakeBrowser.tabs.query({});
		expect(tabs.some((tab) => tab.url?.includes("/captures.html"))).toBe(true);
	});

	it("applies progress while recording and ignores it after the capture ends", async () => {
		await startBackground();
		const metadata = createTestMetadata();
		await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		await triggerMessage(
			{
				type: "CAPTURE_PROGRESS",
				captureId: metadata.id,
				sizeBytes: 1024,
				elapsedMs: 1000,
				chunkCount: 1,
			},
			createSender(11),
		);
		expect((await getCapture(metadata.id))?.sizeBytes).toBe(1024);

		await triggerMessage(
			{
				type: "CAPTURE_FINISHED",
				captureId: metadata.id,
				status: "complete",
				fileStatus: "saved",
				stopReason: "user",
				elapsedMs: 2000,
			},
			createSender(11),
		);
		await triggerMessage(
			{
				type: "CAPTURE_PROGRESS",
				captureId: metadata.id,
				sizeBytes: 4096,
				elapsedMs: 3000,
				chunkCount: 4,
			},
			createSender(11),
		);

		expect(await getCapture(metadata.id)).toMatchObject({
			status: "complete",
			sizeBytes: 1024,
		});
	});

	it("forwards STOP_CAPTURE to the recording tab without finishing the capture", async () => {
		await startBackground();
		const sendMessage = vi
			.spyOn(fakeBrowser.tabs, "sendMessage")
			.mockResolvedValue(undefined);
		const metadata = createTestMetadata();
		await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		await triggerMessage(
			{ type: "STOP_CAPTURE", captureId: metadata.id },
			createSender(11),
		);

		expect(sendMessage).toHaveBeenCalledWith(11, {
			type: "STOP_CAPTURE",
			captureId: metadata.id,
		});
		expect((await getCapture(metadata.id))?.status).toBe("recording");
	});

	it("force-finishes the capture when the recording tab cannot be reached", async () => {
		await startBackground();
		const setBadgeText = vi.spyOn(fakeBrowser.action, "setBadgeText");
		const metadata = createTestMetadata();
		await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		// fakeBrowser's tabs.sendMessage throws by default, which is exactly
		// the unreachable-tab path.
		await triggerMessage(
			{ type: "STOP_CAPTURE", captureId: metadata.id },
			createSender(11),
		);

		expect(await getCapture(metadata.id)).toMatchObject({
			status: "stopped",
			fileStatus: "unknown",
			stopReason: "source_closed",
		});
		expect(setBadgeText).toHaveBeenLastCalledWith({ text: "" });
	});

	it("finishes recordings for a tab when the tab is closed", async () => {
		await startBackground();
		const metadata = createTestMetadata();
		await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		fakeBrowser.tabs.onRemoved.trigger(11, {
			windowId: 0,
			isWindowClosing: false,
		});

		await vi.waitFor(async () => {
			expect(await getCapture(metadata.id)).toMatchObject({
				status: "stopped",
				stopReason: "source_closed",
			});
		});
	});

	it("deletes a capture and broadcasts the deletion to captures pages", async () => {
		await startBackground();
		const metadata = createTestMetadata();
		await triggerMessage(
			{ type: "CAPTURE_STARTED", metadata },
			createSender(11),
		);

		const received: PortMessage[] = [];
		const port = connectPort("captures");
		port.onMessage.addListener((message) =>
			received.push(message as PortMessage),
		);

		await triggerMessage(
			{ type: "DELETE_CAPTURE", captureId: metadata.id },
			createSender(11),
		);

		expect(await getCapture(metadata.id)).toBeUndefined();
		expect(received).toContainEqual({
			type: "CAPTURE_DELETED",
			captureId: metadata.id,
		});
	});

	it("sends the stored captures when a captures page subscribes", async () => {
		const metadata = createTestMetadata({ status: "complete" });
		await putCapture(metadata);
		await startBackground();

		const received: PortMessage[] = [];
		const port = connectPort("captures");
		port.onMessage.addListener((message) =>
			received.push(message as PortMessage),
		);
		port.postMessage({ type: "CAPTURES_SUBSCRIBE" });

		await vi.waitFor(() => {
			expect(received).toContainEqual({
				type: "CAPTURE_UPDATED",
				metadata,
			});
		});
	});
});

describe("background startup recovery", () => {
	it("marks captures interrupted by an extension restart", async () => {
		const metadata = createTestMetadata();
		await putCapture(metadata);

		await startBackground();

		await vi.waitFor(async () => {
			expect(await getCapture(metadata.id)).toMatchObject({
				status: "stopped",
				fileStatus: "unknown",
				stopReason: "source_closed",
				errorMessage:
					"The extension restarted before the MP4 save could be confirmed.",
			});
		});
	});
});

describe("capture-stream port", () => {
	it("finishes the capture when the port disconnects without a finish message", async () => {
		await startBackground();
		const metadata = createTestMetadata();
		const port = connectPort("capture-stream", {
			tab: { id: 11, url: "https://example.test/watch" },
		});

		port.postMessage({ type: "CAPTURE_STARTED", metadata });
		port.postMessage({
			type: "CAPTURE_PROGRESS",
			captureId: metadata.id,
			sizeBytes: 2048,
			elapsedMs: 1500,
			chunkCount: 2,
		});
		await vi.waitFor(async () => {
			expect((await getCapture(metadata.id))?.sizeBytes).toBe(2048);
		});

		port.disconnect();

		await vi.waitFor(async () => {
			expect(await getCapture(metadata.id)).toMatchObject({
				status: "stopped",
				fileStatus: "unknown",
				stopReason: "source_closed",
				sizeBytes: 2048,
			});
		});
	});

	it("reports the file as saved when parts were already written", async () => {
		await startBackground();
		const metadata = createTestMetadata();
		const port = connectPort("capture-stream", {
			tab: { id: 11, url: "https://example.test/watch" },
		});

		port.postMessage({ type: "CAPTURE_STARTED", metadata });
		port.postMessage({
			type: "CAPTURE_PROGRESS",
			captureId: metadata.id,
			sizeBytes: 2048,
			elapsedMs: 1500,
			chunkCount: 2,
			partCount: 1,
			savedPartCount: 1,
		});
		await vi.waitFor(async () => {
			expect((await getCapture(metadata.id))?.savedPartCount).toBe(1);
		});

		port.disconnect();

		await vi.waitFor(async () => {
			expect(await getCapture(metadata.id)).toMatchObject({
				status: "stopped",
				fileStatus: "saved",
				stopReason: "source_closed",
			});
		});
	});
});

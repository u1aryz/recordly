import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/entrypoints/captures/App";
import * as storageModule from "@/shared/storage";
import type { CaptureMetadata, PortMessage } from "@/shared/types";

function createCapture(
	overrides: Partial<CaptureMetadata> = {},
): CaptureMetadata {
	return {
		id: "capture-1",
		videoId: "video-1",
		tabId: 1,
		pageUrl: "https://example.test",
		title: "Demo",
		startedAt: Date.now(),
		status: "recording",
		fileStatus: "writing",
		mimeType: "video/mp4",
		fileName: "demo.mp4",
		sizeBytes: 0,
		elapsedMs: 0,
		width: 1920,
		height: 1080,
		chunkCount: 0,
		...overrides,
	};
}

function createFakePort() {
	const listeners: Array<(message: unknown) => void> = [];
	const port = {
		postMessage: vi.fn(),
		onMessage: {
			addListener: vi.fn((fn: (message: unknown) => void) => {
				listeners.push(fn);
			}),
		},
		onDisconnect: { addListener: vi.fn() },
		disconnect: vi.fn(),
	};
	return {
		port: port as unknown as Browser.runtime.Port,
		emit(message: PortMessage) {
			for (const listener of listeners) {
				listener(message);
			}
		},
	};
}

describe("captures App", () => {
	let fakePort: ReturnType<typeof createFakePort>;
	let resolveInitialLoad!: (captures: CaptureMetadata[]) => void;

	beforeEach(() => {
		// jsdom は scrollIntoView を実装していないため、選択行のスクロール処理
		// (App.tsx の useEffect)がテストで落ちないようスタブする。
		Element.prototype.scrollIntoView = vi.fn();
		fakePort = createFakePort();
		vi.spyOn(browser.runtime, "connect").mockReturnValue(fakePort.port);
		vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
			async () => undefined,
		);
		// reload() が読む listCaptures(IndexedDB)の解決タイミングをテストから
		// 明示的に制御し、port イベントとの競合(後から reload の結果で上書き
		// されてしまう)を避ける。
		vi.spyOn(storageModule, "listCaptures").mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveInitialLoad = resolve;
				}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function renderAppWithInitialCaptures(
		captures: CaptureMetadata[] = [],
	): Promise<void> {
		render(<App />);
		await act(async () => {
			resolveInitialLoad(captures);
		});
	}

	it("subscribes over the captures port and renders rows as they arrive", async () => {
		await renderAppWithInitialCaptures();

		expect(browser.runtime.connect).toHaveBeenCalledWith({ name: "captures" });
		expect(fakePort.port.postMessage).toHaveBeenCalledWith({
			type: "CAPTURES_SUBSCRIBE",
		});

		act(() => {
			fakePort.emit({
				type: "CAPTURE_CREATED",
				metadata: createCapture({ title: "My Recording" }),
			});
		});

		const matches = await screen.findAllByText("My Recording");
		expect(matches.length).toBeGreaterThan(0);
	});

	it("rejects the delete shortcut while the capture is still recording", async () => {
		await renderAppWithInitialCaptures([
			createCapture({ status: "recording" }),
		]);
		await screen.findAllByText("Demo");

		fireEvent.keyDown(window, { key: "Delete" });

		expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "DELETE_CAPTURE" }),
		);
	});

	it("sends DELETE_CAPTURE via the delete shortcut once the capture has stopped", async () => {
		await renderAppWithInitialCaptures([
			createCapture({ status: "complete", fileStatus: "saved" }),
		]);
		await screen.findAllByText("Demo");

		fireEvent.keyDown(window, { key: "Delete" });

		await waitFor(() => {
			expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
				type: "DELETE_CAPTURE",
				captureId: "capture-1",
			});
		});
	});

	it("moves the selection with the arrow keys", async () => {
		await renderAppWithInitialCaptures([
			createCapture({ id: "a", title: "First", startedAt: 2000 }),
			createCapture({ id: "b", title: "Second", startedAt: 1000 }),
		]);
		const list = within(await screen.findByRole("complementary"));
		await list.findByText("First");

		const firstButton = list.getByText("First").closest("button");
		expect(firstButton).toHaveAttribute("aria-current", "true");

		fireEvent.keyDown(window, { key: "ArrowDown" });

		const secondButton = list.getByText("Second").closest("button");
		expect(secondButton).toHaveAttribute("aria-current", "true");
		expect(firstButton).not.toHaveAttribute("aria-current");
	});
});

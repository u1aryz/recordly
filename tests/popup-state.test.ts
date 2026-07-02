import { afterEach, describe, expect, it, vi } from "vitest";
import {
	countRecordingCaptures,
	getActiveTabId,
	loadPopupState,
} from "@/entrypoints/popup/popup-state";
import type { CaptureMetadata } from "@/shared/types";

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

afterEach(() => {
	vi.restoreAllMocks();
});

describe("countRecordingCaptures", () => {
	it("counts only captures currently recording", () => {
		const captures = [
			createCapture({ status: "recording" }),
			createCapture({ status: "complete" }),
			createCapture({ status: "recording" }),
		];
		expect(countRecordingCaptures(captures)).toBe(2);
	});

	it("returns 0 for an empty list", () => {
		expect(countRecordingCaptures([])).toBe(0);
	});
});

describe("getActiveTabId", () => {
	it("returns the id of the active tab in the current window", async () => {
		vi.spyOn(browser.tabs, "query").mockImplementation(async () => [
			{ id: 42 } as Browser.tabs.Tab,
		]);
		expect(await getActiveTabId()).toBe(42);
		expect(browser.tabs.query).toHaveBeenCalledWith({
			active: true,
			currentWindow: true,
		});
	});

	it("throws when there is no active tab", async () => {
		vi.spyOn(browser.tabs, "query").mockImplementation(async () => []);
		await expect(getActiveTabId()).rejects.toThrow();
	});
});

describe("loadPopupState", () => {
	it("returns the videos from the active tab and the recording count", async () => {
		vi.spyOn(browser.tabs, "query").mockImplementation(async () => [
			{ id: 7 } as Browser.tabs.Tab,
		]);
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async () => ({
			videos: [{ id: "video-1", canCapture: true }],
		}));

		const state = await loadPopupState();

		expect(state.loading).toBe(false);
		expect(state.videos).toEqual([{ id: "video-1", canCapture: true }]);
		expect(state.recordingCount).toBe(0);
	});

	it("falls back to an empty video list when the response has none", async () => {
		vi.spyOn(browser.tabs, "query").mockImplementation(async () => [
			{ id: 7 } as Browser.tabs.Tab,
		]);
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(
			async () => undefined,
		);

		const state = await loadPopupState();

		expect(state.videos).toEqual([]);
	});
});

import { describe, expect, it, vi } from "vitest";
import {
	applyPartDiscard,
	applyProgress,
	createCaptureMetadata,
	finishCapture,
	markResolutionChangeFileDiscarded,
	normalizeStartedCapture,
	restoreInterruptedCapture,
	toCaptureProgress,
} from "@/shared/capture-state";

describe("capture state", () => {
	it("creates metadata with mp4 filename", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000000",
		);
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo Video",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
		});
		expect(metadata.id).toBe("00000000-0000-4000-8000-000000000000");
		expect(metadata.fileName).toContain("Demo_Video");
		expect(metadata.fileName).toMatch(/\.mp4$/);
		expect(metadata.status).toBe("recording");
	});

	it("creates direct-file metadata for element capture", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Large Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			status: "recording",
			fileStatus: "writing",
			storageMode: "direct-file",
			scope: "element",
		});
		expect(metadata.status).toBe("recording");
		expect(metadata.fileStatus).toBe("writing");
		expect(metadata.storageMode).toBe("direct-file");
		expect(metadata.scope).toBe("element");
	});

	it("initializes segmented-file progress", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Large Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});

		expect(metadata).toMatchObject({
			partCount: 1,
			savedPartCount: 0,
			currentPartSizeBytes: 0,
		});
	});

	it("applies progress and terminal states", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 640,
			height: 360,
		});
		const progressed = applyProgress(metadata, {
			sizeBytes: 1024,
			elapsedMs: 5000,
			chunkCount: 2,
			partCount: undefined,
			savedPartCount: undefined,
			currentPartSizeBytes: undefined,
		});
		expect(progressed.sizeBytes).toBe(1024);
		const stopped = finishCapture(progressed, {
			status: "stopped",
			elapsedMs: 5500,
			stopReason: "resolution_changed",
		});
		expect(stopped.status).toBe("stopped");
		expect(stopped.stopReason).toBe("resolution_changed");
		const completed = finishCapture(progressed, {
			status: "complete",
			fileStatus: "saved",
			elapsedMs: 6000,
			stopReason: "user",
		});
		expect(completed.status).toBe("complete");
		expect(completed.fileStatus).toBe("saved");
	});

	it("applies segmented-file progress", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Large Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});

		const progressed = applyProgress(metadata, {
			sizeBytes: 2_147_483_649,
			elapsedMs: 60_000,
			chunkCount: 100,
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 1,
		});

		expect(progressed).toMatchObject({
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 1,
		});
	});

	it("merges resolutionChanges history and keeps it when progress omits it", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Large Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});

		const withChange = applyProgress(metadata, {
			sizeBytes: 1024,
			elapsedMs: 1000,
			chunkCount: 1,
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 0,
			resolutionChanges: [
				{
					from: { width: 1920, height: 1080 },
					to: { width: 1280, height: 720 },
					partIndex: 2,
				},
			],
		});
		expect(withChange.resolutionChanges).toHaveLength(1);

		const nextProgress = applyProgress(withChange, {
			sizeBytes: 2048,
			elapsedMs: 2000,
			chunkCount: 2,
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 1024,
		});
		expect(nextProgress.resolutionChanges).toEqual(
			withChange.resolutionChanges,
		);
	});

	it("marks the matching resolutionChange entry as fileDiscarded", () => {
		const changes = [
			{
				from: { width: 1920, height: 1080 },
				to: { width: 1280, height: 720 },
				partIndex: 2,
			},
			{
				from: { width: 1280, height: 720 },
				to: { width: 640, height: 360 },
				partIndex: 3,
			},
		];

		const marked = markResolutionChangeFileDiscarded(changes, 3);

		expect(marked).toEqual([
			changes[0],
			{ ...changes[1], fileDiscarded: true },
		]);
	});

	it("returns the input unchanged when no entry matches", () => {
		const changes = [
			{
				from: { width: 1920, height: 1080 },
				to: { width: 1280, height: 720 },
				partIndex: 2,
			},
		];

		expect(markResolutionChangeFileDiscarded(changes, 5)).toBe(changes);
		expect(markResolutionChangeFileDiscarded(undefined, 5)).toBeUndefined();
	});

	it("rolls back the discarded part's totals", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
			}),
			sizeBytes: 500,
			chunkCount: 5,
			currentPartSizeBytes: 200,
		};

		const rolledBack = applyPartDiscard(metadata, {
			sizeBytes: 200,
			chunkCount: 2,
			index: 1,
		});

		expect(rolledBack.sizeBytes).toBe(300);
		expect(rolledBack.chunkCount).toBe(3);
		expect(rolledBack.currentPartSizeBytes).toBe(0);
	});

	it("never rolls the totals back below zero", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
			}),
			sizeBytes: 100,
			chunkCount: 1,
		};

		const rolledBack = applyPartDiscard(metadata, {
			sizeBytes: 999,
			chunkCount: 9,
			index: 1,
		});

		expect(rolledBack.sizeBytes).toBe(0);
		expect(rolledBack.chunkCount).toBe(0);
	});

	it("marks the discarded part's resolution change entry", () => {
		const changes = [
			{
				from: { width: 1920, height: 1080 },
				to: { width: 1280, height: 720 },
				partIndex: 2,
			},
			{
				from: { width: 1280, height: 720 },
				to: { width: 640, height: 360 },
				partIndex: 3,
			},
		];
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
			}),
			resolutionChanges: changes,
		};

		const rolledBack = applyPartDiscard(metadata, {
			sizeBytes: 0,
			chunkCount: 0,
			index: 3,
		});

		expect(rolledBack.resolutionChanges).toEqual([
			changes[0],
			{ ...changes[1], fileDiscarded: true },
		]);

		const untouched = applyPartDiscard(metadata, {
			sizeBytes: 0,
			chunkCount: 0,
			index: 5,
		});

		expect(untouched.resolutionChanges).toBe(changes);
	});

	it("preserves fileDiscarded flags through applyProgress merges", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Large Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});

		const withDiscardedPart = applyProgress(metadata, {
			sizeBytes: 1024,
			elapsedMs: 1000,
			chunkCount: 1,
			partCount: 3,
			savedPartCount: 1,
			currentPartSizeBytes: 0,
			resolutionChanges: [
				{
					from: { width: 1920, height: 1080 },
					to: { width: 1280, height: 720 },
					partIndex: 2,
				},
				{
					from: { width: 1280, height: 720 },
					to: { width: 640, height: 360 },
					partIndex: 3,
					fileDiscarded: true,
				},
			],
		});

		const nextProgress = applyProgress(withDiscardedPart, {
			sizeBytes: 2048,
			elapsedMs: 2000,
			chunkCount: 2,
			partCount: 3,
			savedPartCount: 1,
			currentPartSizeBytes: 1024,
		});

		expect(nextProgress.resolutionChanges).toEqual(
			withDiscardedPart.resolutionChanges,
		);
	});

	it("fills in part progress fields from the finish input when provided", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});
		const finished = finishCapture(metadata, {
			status: "stopped",
			elapsedMs: 9000,
			stopReason: "write_failed",
			sizeBytes: 4096,
			chunkCount: 8,
			partCount: 3,
			savedPartCount: 2,
			currentPartSizeBytes: 512,
		});
		expect(finished).toMatchObject({
			sizeBytes: 4096,
			chunkCount: 8,
			partCount: 3,
			savedPartCount: 2,
			currentPartSizeBytes: 512,
		});
	});

	it("falls back part progress fields to the current metadata when omitted", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
			}),
			sizeBytes: 100,
			chunkCount: 2,
			partCount: 1,
			savedPartCount: 0,
			currentPartSizeBytes: 100,
		};
		const finished = finishCapture(metadata, {
			status: "complete",
			elapsedMs: 9000,
		});
		expect(finished).toMatchObject({
			sizeBytes: 100,
			chunkCount: 2,
			partCount: 1,
			savedPartCount: 0,
			currentPartSizeBytes: 100,
		});
	});

	it("overwrites stopReason and resolutionChange even when the input omits them", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
			}),
			stopReason: "resolution_changed" as const,
			resolutionChange: {
				from: { width: 1920, height: 1080 },
				to: { width: 1280, height: 720 },
			},
		};
		const finished = finishCapture(metadata, {
			status: "complete",
			elapsedMs: 9000,
		});
		expect(finished.stopReason).toBeUndefined();
		expect(finished.resolutionChange).toBeUndefined();
	});
});

describe("normalizeStartedCapture", () => {
	it("prefers the sender tab id and url over the metadata's own values", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 0,
			pageUrl: "https://from-metadata.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
		});
		const next = normalizeStartedCapture(metadata, {
			tabId: 42,
			url: "https://from-sender.test",
		});
		expect(next.tabId).toBe(42);
		expect(next.pageUrl).toBe("https://from-sender.test");
		expect(next.status).toBe("recording");
		expect(next.fileStatus).toBe("writing");
		expect(next.scope).toBe("element");
	});

	it("falls back to the metadata's own tabId/pageUrl without a sender", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 7,
			pageUrl: "https://from-metadata.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
		});
		const next = normalizeStartedCapture(metadata);
		expect(next.tabId).toBe(7);
		expect(next.pageUrl).toBe("https://from-metadata.test");
	});

	it("defaults storageMode to direct-file when not set", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
		});
		expect(normalizeStartedCapture(metadata).storageMode).toBe("direct-file");
	});

	it("keeps an explicit storageMode", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		});
		expect(normalizeStartedCapture(metadata).storageMode).toBe(
			"segmented-files",
		);
	});
});

describe("restoreInterruptedCapture", () => {
	it("returns undefined for a capture that is not recording", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
			}),
			status: "complete" as const,
		};
		expect(restoreInterruptedCapture(metadata, "unknown")).toBeUndefined();
	});

	it("marks a recording capture as stopped with saved fileStatus when parts exist", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
			}),
			savedPartCount: 2,
		};
		const restored = restoreInterruptedCapture(metadata, "unknown");
		expect(restored?.status).toBe("stopped");
		expect(restored?.fileStatus).toBe("saved");
		expect(restored?.stopReason).toBe("source_closed");
		expect(restored?.errorMessage).toBe("unknown");
		expect(restored?.endedAt).toBeDefined();
	});

	it("marks fileStatus as unknown when no parts were saved", () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
		});
		const restored = restoreInterruptedCapture(metadata, "unknown");
		expect(restored?.fileStatus).toBe("unknown");
	});
});

describe("toCaptureProgress", () => {
	it("projects the fields the captures page needs to render progress", () => {
		const metadata = {
			...createCaptureMetadata({
				videoId: "video-id",
				tabId: 1,
				pageUrl: "https://example.test",
				title: "Demo",
				mimeType: "video/mp4",
				width: 1920,
				height: 1080,
				storageMode: "segmented-files",
				thumbnailDataUrl: "data:image/jpeg;base64,abc",
			}),
			sizeBytes: 1024,
			elapsedMs: 5000,
			chunkCount: 3,
		};
		expect(toCaptureProgress(metadata)).toEqual({
			id: metadata.id,
			status: metadata.status,
			sizeBytes: 1024,
			elapsedMs: 5000,
			chunkCount: 3,
			partCount: metadata.partCount,
			savedPartCount: metadata.savedPartCount,
			currentPartSizeBytes: metadata.currentPartSizeBytes,
			resolutionChanges: metadata.resolutionChanges,
			thumbnailDataUrl: metadata.thumbnailDataUrl,
		});
	});
});

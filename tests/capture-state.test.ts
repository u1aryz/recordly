import { describe, expect, it, vi } from "vitest";
import {
	applyProgress,
	createCaptureMetadata,
	finishCapture,
	markResolutionChangeFileDiscarded,
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
});

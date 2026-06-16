import { describe, expect, it, vi } from "vitest";
import {
	applyProgress,
	createCaptureMetadata,
	finishCapture,
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
		});
		expect(progressed.sizeBytes).toBe(1024);
		const stopped = finishCapture(progressed, {
			status: "stopped",
			elapsedMs: 5500,
			stopReason: "resolution_changed",
		});
		expect(stopped.status).toBe("stopped");
		expect(stopped.stopReason).toBe("resolution_changed");
	});
});

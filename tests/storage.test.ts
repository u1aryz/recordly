import { describe, expect, it } from "vitest";
import { createCaptureMetadata } from "@/shared/capture-state";
import { deleteCapture, listCaptures, putCapture } from "@/shared/storage";

describe("capture storage", () => {
	it("persists capture metadata", async () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Stored",
			mimeType: "video/mp4",
			width: 320,
			height: 180,
		});
		await putCapture(metadata);
		const captures = await listCaptures();
		expect(captures.some((capture) => capture.id === metadata.id)).toBe(true);
	});

	it("deletes capture metadata", async () => {
		const metadata = createCaptureMetadata({
			videoId: "delete-video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Delete me",
			mimeType: "video/mp4",
			width: 320,
			height: 180,
		});
		await putCapture(metadata);
		await deleteCapture(metadata.id);
		const captures = await listCaptures();
		expect(captures.some((capture) => capture.id === metadata.id)).toBe(false);
	});
});

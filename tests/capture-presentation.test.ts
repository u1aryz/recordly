import { describe, expect, it } from "vitest";
import {
	getCapturePresentation,
	getEffectiveFileStatus,
} from "@/shared/capture-presentation";
import { createCaptureMetadata } from "@/shared/capture-state";

describe("capture presentation", () => {
	it("shows partial save when an automatic stop closed the file", () => {
		const capture = {
			...createDirectCapture(),
			status: "stopped" as const,
			fileStatus: "saved" as const,
			stopReason: "video_removed" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "途中まで保存",
			tone: "warning",
		});
	});

	it("does not claim success when completion cannot be confirmed", () => {
		const capture = {
			...createDirectCapture(),
			status: "stopped" as const,
			fileStatus: "unknown" as const,
			stopReason: "source_closed" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "要確認",
			tone: "warning",
		});
	});

	it("keeps legacy indexeddb captures downloadable", () => {
		const capture = {
			...createDirectCapture(),
			status: "complete" as const,
			storageMode: "indexeddb" as const,
			fileStatus: undefined,
		};

		expect(getEffectiveFileStatus(capture)).toBe("saved");
		expect(getCapturePresentation(capture).label).toBe("保存完了");
	});
});

function createDirectCapture() {
	return createCaptureMetadata({
		videoId: "video-id",
		tabId: 1,
		pageUrl: "https://example.test",
		title: "Demo",
		mimeType: "video/mp4",
		width: 1280,
		height: 720,
		status: "recording",
		fileStatus: "writing",
		storageMode: "direct-file",
		scope: "element",
	});
}

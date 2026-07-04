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
			label: "Partially saved",
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
			label: "Check required",
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
		expect(getCapturePresentation(capture).label).toBe("Saved");
	});

	it("explains that recording stopped because data stopped arriving", () => {
		const capture = {
			...createDirectCapture(),
			status: "stopped" as const,
			fileStatus: "saved" as const,
			stopReason: "no_data_timeout" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "Partially saved",
			tone: "warning",
		});
		expect(getCapturePresentation(capture).description).toContain(
			"Stopped automatically because no recording data arrived",
		);
	});

	it("explains the resolution change before and after automatic stop", () => {
		const capture = {
			...createDirectCapture(),
			status: "stopped" as const,
			fileStatus: "saved" as const,
			stopReason: "resolution_changed" as const,
			resolutionChange: {
				from: { width: 1280, height: 720 },
				to: { width: 1920, height: 1080 },
			},
		};

		expect(getCapturePresentation(capture).description).toContain(
			"Stopped automatically because the video resolution changed from 1280 x 720 to 1920 x 1080",
		);
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

import { describe, expect, it } from "vitest";
import {
	getCapturePresentation,
	getEffectiveFileStatus,
	getStatusBadgeClass,
	translateStopReason,
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

	it("presents an in-progress recording with an informational tone", () => {
		expect(getCapturePresentation(createDirectCapture())).toMatchObject({
			label: "Recording",
			title: "Recording and saving to file",
			tone: "info",
		});
	});

	it("reports success when the recording ended with the video", () => {
		const capture = {
			...createDirectCapture(),
			status: "complete" as const,
			fileStatus: "saved" as const,
			stopReason: "video_ended" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "Saved",
			description:
				"Recording stopped when the video ended, and the MP4 was saved.",
			tone: "success",
		});
	});

	it("reports plain success for a completed capture", () => {
		const capture = {
			...createDirectCapture(),
			status: "complete" as const,
			fileStatus: "saved" as const,
			stopReason: "user" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "Saved",
			description: "The split MP4 files were saved to the selected folder.",
			tone: "success",
		});
	});

	it("surfaces the stored error message when the save failed", () => {
		const capture = {
			...createDirectCapture(),
			status: "error" as const,
			fileStatus: "failed" as const,
			errorMessage: "Disk full",
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "Save failed",
			description: "Disk full",
			tone: "error",
		});
	});

	it("falls back to a generic message when the save failed without details", () => {
		const capture = {
			...createDirectCapture(),
			status: "error" as const,
			fileStatus: "failed" as const,
		};

		expect(getCapturePresentation(capture)).toMatchObject({
			label: "Save failed",
			description: "A problem occurred while writing the file.",
			tone: "error",
		});
	});
});

describe("getEffectiveFileStatus", () => {
	it("keeps an explicitly stored file status", () => {
		expect(getEffectiveFileStatus(createDirectCapture())).toBe("writing");
	});

	it("infers the direct-file status from the capture status", () => {
		const base = { ...createDirectCapture(), fileStatus: undefined };

		expect(getEffectiveFileStatus({ ...base, status: "recording" })).toBe(
			"writing",
		);
		expect(getEffectiveFileStatus({ ...base, status: "complete" })).toBe(
			"saved",
		);
		expect(getEffectiveFileStatus({ ...base, status: "error" })).toBe("failed");
		expect(getEffectiveFileStatus({ ...base, status: "stopped" })).toBe(
			"unknown",
		);
	});

	it("treats segmented captures as saved once recording ends", () => {
		const base = { ...createSegmentedCapture(), fileStatus: undefined };

		expect(getEffectiveFileStatus({ ...base, status: "recording" })).toBe(
			"writing",
		);
		expect(getEffectiveFileStatus({ ...base, status: "complete" })).toBe(
			"saved",
		);
		expect(getEffectiveFileStatus({ ...base, status: "stopped" })).toBe(
			"saved",
		);
	});
});

describe("getStatusBadgeClass", () => {
	it("always uses the primary badge while recording", () => {
		expect(getStatusBadgeClass("recording", "warning")).toBe(
			"badge badge-soft badge-primary",
		);
	});

	it("maps the tone to a badge class once recording ends", () => {
		expect(getStatusBadgeClass("complete", "success")).toBe(
			"badge badge-soft badge-success",
		);
		expect(getStatusBadgeClass("stopped", "warning")).toBe(
			"badge badge-soft badge-warning",
		);
		expect(getStatusBadgeClass("error", "error")).toBe(
			"badge badge-soft badge-error",
		);
		expect(getStatusBadgeClass("stopped", "info")).toBe(
			"badge badge-soft badge-info",
		);
	});
});

describe("translateStopReason", () => {
	it("translates every stop reason", () => {
		expect(translateStopReason("user")).toBe("Stopped by the user");
		expect(translateStopReason("source_closed")).toBe(
			"The source page or stream was closed",
		);
		expect(translateStopReason("video_ended")).toBe("The selected video ended");
		expect(translateStopReason("video_removed")).toBe(
			"Stopped automatically because the selected video was removed from the page",
		);
		expect(translateStopReason("error")).toBe(
			"An error occurred while recording",
		);
		expect(translateStopReason("write_failed")).toBe(
			"Could not write to the file",
		);
		expect(translateStopReason("no_data_timeout")).toBe(
			"Stopped automatically because no recording data arrived",
		);
	});

	it("omits resolution details when the capture has none", () => {
		expect(
			translateStopReason("resolution_changed", createDirectCapture()),
		).toBe("Stopped automatically because the video resolution changed");
	});

	it("falls back to a generic label without a reason", () => {
		expect(translateStopReason(undefined)).toBe("Recording ended");
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

function createSegmentedCapture() {
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
		storageMode: "segmented-files",
		scope: "element",
	});
}

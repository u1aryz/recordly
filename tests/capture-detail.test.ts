import { describe, expect, it } from "vitest";
import {
	getAlertPresentation,
	getPartCountLabel,
	getProgressSummary,
	getResolutionLabel,
} from "@/entrypoints/captures/CaptureDetail";
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
		startedAt: 1000,
		status: "complete",
		fileStatus: "saved",
		mimeType: "video/mp4",
		fileName: "demo.mp4",
		sizeBytes: 2048,
		elapsedMs: 65_000,
		width: 1920,
		height: 1080,
		chunkCount: 3,
		...overrides,
	};
}

describe("getPartCountLabel", () => {
	it("shows the in-progress part count while recording", () => {
		const capture = createCapture({ status: "recording", partCount: 3 });
		expect(getPartCountLabel(capture)).toContain("3");
	});

	it("falls back to 1 while recording without a partCount", () => {
		const capture = createCapture({
			status: "recording",
			partCount: undefined,
		});
		expect(getPartCountLabel(capture)).toContain("1");
	});

	it("shows the saved part count once stopped", () => {
		const capture = createCapture({
			status: "complete",
			savedPartCount: 2,
			partCount: 3,
		});
		expect(getPartCountLabel(capture)).toBe("2");
	});

	it("falls back to partCount then 0 once stopped without savedPartCount", () => {
		expect(
			getPartCountLabel(
				createCapture({
					status: "complete",
					savedPartCount: undefined,
					partCount: 4,
				}),
			),
		).toBe("4");
		expect(
			getPartCountLabel(
				createCapture({
					status: "complete",
					savedPartCount: undefined,
					partCount: undefined,
				}),
			),
		).toBe("0");
	});
});

describe("getResolutionLabel", () => {
	it("uses the capture's own resolution when there is no history", () => {
		const capture = createCapture({ width: 1280, height: 720 });
		expect(getResolutionLabel(capture)).toBe("1280 x 720");
	});

	it("uses the most recent resolution change when present", () => {
		const capture = createCapture({
			width: 1920,
			height: 1080,
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
				},
			],
		});
		expect(getResolutionLabel(capture)).toBe("640 x 360");
	});
});

describe("getAlertPresentation", () => {
	it.each([
		["success", "alert-success", "text-success"],
		["warning", "alert-warning", "text-warning"],
		["error", "alert-error", "text-error"],
		["info", "alert-info", "text-info"],
	] as const)("maps tone %s to its classes", (tone, alertClassName, iconClassName) => {
		const presentation = getAlertPresentation(tone);
		expect(presentation.alertClassName).toBe(alertClassName);
		expect(presentation.iconClassName).toBe(iconClassName);
	});
});

describe("getProgressSummary", () => {
	it("combines the status label, elapsed time, and file size", () => {
		const capture = createCapture({
			status: "complete",
			fileStatus: "saved",
			elapsedMs: 65_000,
			sizeBytes: 1536,
		});
		const summary = getProgressSummary(capture);
		expect(summary).toContain("1:05");
		expect(summary).toContain("1.50 KB");
	});
});

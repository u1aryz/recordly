import { describe, expect, it } from "vitest";
import {
	createCaptureFinishedMessage,
	createProgressMessage,
	getErrorMessage,
	getFinalStatus,
	getHudResult,
	isFatalStopReason,
	reduceStopReason,
} from "@/shared/capture-finish";
import { createCaptureMetadata } from "@/shared/capture-state";
import type { CaptureMetadata } from "@/shared/types";

function createMetadata(
	overrides: Partial<CaptureMetadata> = {},
): CaptureMetadata {
	return {
		...createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Demo Video",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			storageMode: "segmented-files",
		}),
		...overrides,
	};
}

describe("isFatalStopReason", () => {
	it.each([
		"error",
		"unsupported",
		"write_failed",
	] as const)("treats %s as fatal", (reason) => {
		expect(isFatalStopReason(reason)).toBe(true);
	});

	it.each([
		"user",
		"video_ended",
		"resolution_changed",
		undefined,
	] as const)("treats %s as non-fatal", (reason) => {
		expect(isFatalStopReason(reason)).toBe(false);
	});
});

describe("getFinalStatus", () => {
	it("returns stopped for a fatal reason when parts were saved", () => {
		expect(getFinalStatus("write_failed", true)).toBe("stopped");
	});

	it("returns error for a fatal reason when nothing was saved", () => {
		expect(getFinalStatus("write_failed", false)).toBe("error");
	});

	it.each([
		["user", "complete"],
		["video_ended", "complete"],
		[undefined, "complete"],
		["resolution_changed", "stopped"],
		["source_closed", "stopped"],
	] as const)("returns %s -> %s for a non-fatal reason", (reason, status) => {
		expect(getFinalStatus(reason, false)).toBe(status);
	});
});

describe("getHudResult", () => {
	it("returns an error tone for a fatal reason without saved parts", () => {
		const result = getHudResult("write_failed", undefined, false);
		expect(result.tone).toBe("error");
	});

	it("returns a warning tone for a fatal reason with saved parts", () => {
		const result = getHudResult("write_failed", undefined, true);
		expect(result.tone).toBe("warning");
	});

	it("prefers the provided error message when present", () => {
		const result = getHudResult("write_failed", "disk full", false);
		expect(result.message).toBe("disk full");
	});

	it("returns a success tone for a user-initiated stop", () => {
		const result = getHudResult("user");
		expect(result.tone).toBe("success");
	});

	it("returns a warning tone for a non-fatal, non-user reason", () => {
		const result = getHudResult("video_removed");
		expect(result.tone).toBe("warning");
	});
});

describe("getErrorMessage", () => {
	it("returns the error message when available", () => {
		expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
	});

	it("returns the fallback for a non-Error value", () => {
		expect(getErrorMessage("boom", "fallback")).toBe("fallback");
	});

	it("returns the fallback for an Error with an empty message", () => {
		expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
	});
});

describe("createProgressMessage", () => {
	it("projects metadata into a CAPTURE_PROGRESS message", () => {
		const metadata = createMetadata({
			sizeBytes: 1024,
			elapsedMs: 5000,
			chunkCount: 3,
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 512,
		});
		expect(createProgressMessage(metadata)).toEqual({
			type: "CAPTURE_PROGRESS",
			captureId: metadata.id,
			sizeBytes: 1024,
			elapsedMs: 5000,
			chunkCount: 3,
			partCount: 2,
			savedPartCount: 1,
			currentPartSizeBytes: 512,
			resolutionChanges: undefined,
		});
	});

	it("falls back part fields to defaults when absent", () => {
		const metadata = createMetadata({
			partCount: undefined,
			savedPartCount: undefined,
			currentPartSizeBytes: undefined,
		});
		const message = createProgressMessage(metadata);
		expect(message.partCount).toBe(1);
		expect(message.savedPartCount).toBe(0);
		expect(message.currentPartSizeBytes).toBe(0);
	});
});

describe("createCaptureFinishedMessage", () => {
	it("maps a user stop to an undefined stopReason and complete status", () => {
		const metadata = createMetadata({ savedPartCount: 1 });
		const message = createCaptureFinishedMessage(metadata, {
			stopReason: "user",
			elapsedMs: 1000,
		});
		expect(message.stopReason).toBeUndefined();
		expect(message.status).toBe("complete");
		expect(message.fileStatus).toBe("saved");
	});

	it("reports a failed fileStatus when no parts were saved", () => {
		const metadata = createMetadata({ savedPartCount: 0 });
		const message = createCaptureFinishedMessage(metadata, {
			stopReason: "write_failed",
			errorMessage: "disk full",
			elapsedMs: 2000,
		});
		expect(message.status).toBe("error");
		expect(message.fileStatus).toBe("failed");
		expect(message.errorMessage).toBe("disk full");
	});

	it("keeps a fatal stopReason with saved parts as stopped", () => {
		const metadata = createMetadata({ savedPartCount: 2 });
		const message = createCaptureFinishedMessage(metadata, {
			stopReason: "write_failed",
			elapsedMs: 3000,
		});
		expect(message.stopReason).toBe("write_failed");
		expect(message.status).toBe("stopped");
	});
});

describe("reduceStopReason", () => {
	it("adopts the first stop reason when none was set", () => {
		const next = reduceStopReason({}, { stopReason: "video_ended" });
		expect(next).toEqual({
			stopReason: "video_ended",
			errorMessage: undefined,
		});
	});

	it("keeps the first non-fatal reason when a later non-fatal reason arrives", () => {
		const current = { stopReason: "video_ended" as const };
		const next = reduceStopReason(current, { stopReason: "source_closed" });
		expect(next).toBe(current);
	});

	it("overwrites with a fatal reason even if one was already set", () => {
		const current = { stopReason: "video_ended" as const };
		const next = reduceStopReason(current, {
			stopReason: "write_failed",
			errorMessage: "disk full",
		});
		expect(next).toEqual({
			stopReason: "write_failed",
			errorMessage: "disk full",
		});
	});
});

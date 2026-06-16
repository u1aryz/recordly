import { describe, expect, it, vi } from "vitest";
import {
	findVideoFromPoint,
	formatBytes,
	formatDuration,
	getMp4MimeType,
} from "@/shared/video";

describe("video helpers", () => {
	it("selects the first video from elementsFromPoint", () => {
		const video = document.createElement("video");
		const div = document.createElement("div");
		const result = findVideoFromPoint(
			10,
			20,
			vi.fn(() => [div, video]),
		);
		expect(result).toBe(video);
	});

	it("finds nested video behind page overlays", () => {
		const wrapper = document.createElement("div");
		const video = document.createElement("video");
		wrapper.append(video);
		const result = findVideoFromPoint(
			10,
			20,
			vi.fn(() => [wrapper]),
		);
		expect(result).toBe(video);
	});

	it("formats elapsed time and file sizes", () => {
		expect(formatDuration(65_000)).toBe("1:05");
		expect(formatBytes(1536)).toBe("1.50 KB");
	});

	it("returns null when MediaRecorder MP4 is unsupported", () => {
		vi.stubGlobal("MediaRecorder", {
			isTypeSupported: () => false,
		});
		expect(getMp4MimeType()).toBeNull();
		vi.unstubAllGlobals();
	});
});

import { describe, expect, it, vi } from "vitest";
import {
	createMediaRecorderOptions,
	createVideoCaptureStream,
	findVideoFromPoint,
	formatBytes,
	formatDuration,
	formatResolution,
	getMp4MimeType,
	getVideoBitsPerSecond,
	isVideoConnected,
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

	it("treats videos inside connected shadow roots as connected", () => {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		const video = document.createElement("video");
		shadow.append(video);
		document.body.append(host);

		expect(document.contains(video)).toBe(false);
		expect(isVideoConnected(video)).toBe(true);

		host.remove();
		expect(isVideoConnected(video)).toBe(false);
	});

	it("formats elapsed time, file sizes, and resolutions", () => {
		expect(formatDuration(65_000)).toBe("1:05");
		expect(formatBytes(1536)).toBe("1.50 KB");
		expect(formatResolution({ width: 1920, height: 1080 })).toBe("1920 x 1080");
	});

	it("creates high quality MediaRecorder options from video dimensions", () => {
		expect(getVideoBitsPerSecond(1280, 720)).toBe(7_372_800);
		expect(getVideoBitsPerSecond(1920, 1080)).toBe(16_588_800);
		expect(getVideoBitsPerSecond(3840, 2160)).toBe(66_355_200);
		expect(getVideoBitsPerSecond(0, 0)).toBe(4_000_000);

		expect(createMediaRecorderOptions("video/mp4", 1920, 1080)).toEqual({
			mimeType: "video/mp4",
			audioBitsPerSecond: 192_000,
			videoBitsPerSecond: 16_588_800,
		});
	});

	it("returns null when MediaRecorder MP4 is unsupported", () => {
		vi.stubGlobal("MediaRecorder", {
			isTypeSupported: () => false,
		});
		expect(getMp4MimeType()).toBeNull();
		vi.unstubAllGlobals();
	});

	it("returns an unsupported message when captureStream is blocked by EME", () => {
		const video = document.createElement("video");
		video.captureStream = vi.fn(() => {
			throw new DOMException(
				"Stream capture not supported with EME",
				"NotSupportedError",
			);
		});

		const result = createVideoCaptureStream(video);

		expect(result.stream).toBeNull();
		expect(result.errorMessage).toContain("保護");
	});

	it("returns a short actionable message when captureStream has no tracks", () => {
		const video = document.createElement("video");
		video.captureStream = vi.fn(
			() =>
				({
					getTracks: () => [],
				}) as unknown as MediaStream,
		);

		const result = createVideoCaptureStream(video);

		expect(result.stream).toBeNull();
		expect(result.errorMessage).toBe(
			"録画できる映像・音声がありません。動画を再生してからお試しください。",
		);
	});
});
